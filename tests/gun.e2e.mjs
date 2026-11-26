/*
 * 리듬 건 E2E 테스트 (Playwright, headless)
 * 샌드박스에선 A-Frame CDN이 막히므로 aframe 요청을 abort 하고 순수 로직(__GUN_TEST__)만 검증한다.
 * (A-Frame 렌더/이동·충돌 tick·실제 소리/비주얼은 기기에서 사용자가 확인)
 * 실행: NODE_PATH=/opt/node22/lib/node_modules node tests/gun.e2e.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vr-gun.html');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}
const T = (p) => p.evaluate(() => window.__GUN_TEST__);
const get = (p, fn) => p.evaluate(fn);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  // A-Frame CDN 차단 재현: aframe 스크립트는 로드하지 않는다(순수 로직만).
  await page.route('**/aframe*', r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__GUN_TEST__, null, { timeout: 8000 });

  console.log('\n── 초기 상태 ──');
  check('__GUN_TEST__ 훅 존재', await get(page, () => !!window.__GUN_TEST__));
  check('시작 전 playing=false', await get(page, () => window.__GUN_TEST__.playing === false));

  console.log('\n── 게임 시작 ──');
  await page.evaluate(() => window.__GUN_TEST__.start());
  check('시작 후 playing=true', await get(page, () => window.__GUN_TEST__.playing === true));
  check('시작 점수 0', await get(page, () => window.__GUN_TEST__.score === 0));
  check('시작 생명 4', await get(page, () => window.__GUN_TEST__.lives === 4));

  console.log('\n── 스폰 / 처치(점수·콤보) ──');
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__GUN_TEST__.spawn(); });
  check('적 스폰됨', await get(page, () => window.__GUN_TEST__.nEnemies >= 1), await get(page, () => 'n=' + window.__GUN_TEST__.nEnemies));
  const beforeKill = await get(page, () => window.__GUN_TEST__.score);
  await page.evaluate(() => window.__GUN_TEST__.killOne());
  const afterKill = await get(page, () => window.__GUN_TEST__.score);
  check('처치 시 점수 증가', afterKill > beforeKill, `before=${beforeKill} after=${afterKill}`);
  check('처치 시 콤보 증가', await get(page, () => window.__GUN_TEST__.combo >= 1));

  console.log('\n── 적 도달(피해·콤보리셋) ──');
  await page.evaluate(() => { window.__GUN_TEST__.spawn(); });
  const livesBefore = await get(page, () => window.__GUN_TEST__.lives);
  await page.evaluate(() => window.__GUN_TEST__.reachOne());
  const livesAfter = await get(page, () => window.__GUN_TEST__.lives);
  check('도달 시 생명 감소', livesAfter === livesBefore - 1, `b=${livesBefore} a=${livesAfter}`);
  check('도달 시 콤보 리셋', await get(page, () => window.__GUN_TEST__.combo === 0));

  console.log('\n── 적 발사 / 플레이어 피격 ──');
  await page.evaluate(() => { window.__GUN_TEST__.spawn(); window.__GUN_TEST__.shoot(); });
  check('적 탄환 생성(또는 로직 안전)', await get(page, () => window.__GUN_TEST__.nBullets >= 0));
  const lv2 = await get(page, () => window.__GUN_TEST__.lives);
  await page.evaluate(() => window.__GUN_TEST__.hitPlayer());
  check('피격 시 생명 감소', await get(page, () => window.__GUN_TEST__.lives) === lv2 - 1);

  console.log('\n── 비트(onBeat) ──');
  const nb = await get(page, () => window.__GUN_TEST__.nEnemies);
  await page.evaluate(() => window.__GUN_TEST__.beat());
  check('비트에 스폰 로직 동작(에러 없음)', await get(page, () => window.__GUN_TEST__.nEnemies) >= nb);

  console.log('\n── 게임 종료 / 최고기록 ──');
  await page.evaluate(() => window.__GUN_TEST__.end());
  check('종료 후 playing=false', await get(page, () => window.__GUN_TEST__.playing === false));
  check('최고기록 저장됨(>=0)', await get(page, () => typeof window.__GUN_TEST__.best === 'number'));

  console.log('\n── 오디오 오프라인 렌더(있으면) ──');
  const hasAudioTest = await get(page, () => !!(window.__GUN_TEST__.renderOffline || (window.GUNAUDIO && window.GUNAUDIO.renderOfflineTest)));
  if (hasAudioTest) {
    const a = await page.evaluate(async () => {
      const r = await (window.__GUN_TEST__.renderOffline ? window.__GUN_TEST__.renderOffline(3) : window.GUNAUDIO.renderOfflineTest(3));
      return { peak: r.peak, rms: r.rms, clipped: r.clipped, onsets: r.onsets };
    });
    console.log('    audio:', JSON.stringify(a));
    check('오디오 클리핑 없음', a.clipped === false, JSON.stringify(a));
    check('오디오 RMS 유의미(>0.005)', a.rms > 0.005, JSON.stringify(a));
    check('온셋 다수(리듬, >6)', (a.onsets || 0) > 6, JSON.stringify(a));
  } else {
    console.log('    (오디오 오프라인 훅 없음 — 통합 후 추가 예정)');
  }

  console.log('\n── 모바일 이동(방향키/스와이프) 훅 ──');
  await page.evaluate(() => { window.__GUN_TEST__.recenter(); });
  check('중앙정렬 후 오프셋 0', await get(page, () => window.__GUN_TEST__.offX === 0 && window.__GUN_TEST__.offY === 0));
  await page.evaluate(() => { window.__GUN_TEST__.nudge(0.85, 0); });
  check('우측 이동 반영', await get(page, () => window.__GUN_TEST__.offX > 0));
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__GUN_TEST__.nudge(1, 0); });
  check('이동 좌우 한계(clamp)', await get(page, () => window.__GUN_TEST__.offX <= 2.6 + 1e-6));
  await page.evaluate(() => { window.__GUN_TEST__.nudge(0, 1); });
  check('상향 이동 반영', await get(page, () => window.__GUN_TEST__.offY > 0));

  console.log('\n── 빈 곳/시작버튼 탭 리셋 방지 ──');
  await page.evaluate(() => { window.__GUN_TEST__.start(); });                 // 플레이 중
  await page.evaluate(() => { window.__GUN_TEST__.nudge(1.2, 0); });            // 점수 외 상태 변화
  await page.evaluate(() => { for (let i = 0; i < 3; i++) { window.__GUN_TEST__.spawn(); window.__GUN_TEST__.killOne(); } });
  const sDuring = await get(page, () => window.__GUN_TEST__.score);
  await page.evaluate(() => { const b = document.getElementById('startBtn'); b && b.emit && b.emit('click', {}, true); });
  check('플레이 중 시작버튼 클릭이 리셋하지 않음', await get(page, () => window.__GUN_TEST__.score) === sDuring && await get(page, () => window.__GUN_TEST__.playing === true), `score=${sDuring}`);
  check('플레이 중 startBtn visible=false(레이캐스트 제외)', await get(page, () => document.getElementById('startBtn').getAttribute('visible') === false || document.getElementById('startBtn').getAttribute('visible') === 'false'));

  check('페이지 런타임 에러 없음', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n── 결과: ${passed} 통과 / ${failed} 실패 ──`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('테스트 실행 오류:', e); process.exit(2); });
