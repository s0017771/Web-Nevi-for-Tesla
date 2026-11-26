/*
 * 시간정지 슈터 E2E/로직/오디오 테스트 (Playwright, 헤드리스)
 * 실행: NODE_PATH=/opt/node22/lib/node_modules node tests/timeshot.e2e.mjs
 * 샌드박스에선 A-Frame CDN이 막히므로 aframe 요청을 route-abort → 순수 로직/오디오만 검증.
 * (A-Frame 렌더/이동/충돌 tick·실제 샘플 소리·비주얼은 기기에서 사용자 확인 필요)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vr-timeshot.html');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  // A-Frame CDN 차단 재현 + 로그 수집
  await page.route('**/aframe*', r => r.abort());
  const errors = [];
  // A-Frame CDN abort로 생기는 리소스 로드 실패는 의도된 것이라 무시
  const ignore = t => /ERR_FAILED|Failed to load resource|aframe/i.test(t);
  page.on('pageerror', e => { if (!ignore(String(e))) errors.push(String(e)); });
  page.on('console', m => { if (m.type() === 'error' && !ignore(m.text())) errors.push('console:' + m.text()); });

  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // ── 1) 로드 & 훅 존재 ──
  console.log('\n[로드/훅]');
  const hasHook = await page.evaluate(() => !!window.__SHOT_TEST__);
  check('__SHOT_TEST__ 훅 존재', hasHook);
  check('페이지 에러 없음(초기)', errors.length === 0, errors.join(' | '));

  // ── 2) 게임 흐름: 시작/스폰/처치/점수 ──
  console.log('\n[게임 로직]');
  await page.evaluate(() => window.__SHOT_TEST__.start());
  check('시작 후 playing=true', await page.evaluate(() => window.__SHOT_TEST__.playing));
  check('시작 시 생명=3', await page.evaluate(() => window.__SHOT_TEST__.lives) === 3);
  check('시작 시 점수=0', await page.evaluate(() => window.__SHOT_TEST__.score) === 0);

  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__SHOT_TEST__.spawnEnemy(); });
  const nE = await page.evaluate(() => window.__SHOT_TEST__.nEnemies);
  check('적 스폰됨(>=1)', nE >= 1, 'n=' + nE);

  const scoreBefore = await page.evaluate(() => window.__SHOT_TEST__.score);
  await page.evaluate(() => window.__SHOT_TEST__.killOne());
  const scoreAfter = await page.evaluate(() => window.__SHOT_TEST__.score);
  check('처치 시 점수 +1', scoreAfter === scoreBefore + 1, `${scoreBefore}->${scoreAfter}`);

  // 내 총알 발사 → mybullet 생성
  await page.evaluate(() => window.__SHOT_TEST__.myShoot());
  check('내 총알 발사됨(mybullet>=1)', await page.evaluate(() => window.__SHOT_TEST__.nMine) >= 1);

  // 적 발사 → 총알 생성
  await page.evaluate(() => { window.__SHOT_TEST__.spawnEnemy(); window.__SHOT_TEST__.shootAtPlayer(); });
  check('적 총알 생성됨(bullet>=1)', await page.evaluate(() => window.__SHOT_TEST__.nBullets) >= 1);

  // ── 2.5) 난이도 웨이브 / 모바일 탭 / 스프라이트 ──
  console.log('\n[웨이브/모바일/스프라이트]');
  const m0 = await page.evaluate(() => window.__SHOT_TEST__.maxEnemies);
  await page.evaluate(() => window.__SHOT_TEST__.ramp(22));
  const m1 = await page.evaluate(() => window.__SHOT_TEST__.maxEnemies);
  check('시간 경과로 최대 적 수 증가', m1 > m0, `${m0}->${m1}`);

  const mineBefore = await page.evaluate(() => window.__SHOT_TEST__.nMine);
  await page.evaluate(() => {
    const ray = { ray: { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } } };
    window.__vrTapAt(100, 100, { x: 0, y: 0 }, null, ray);
  });
  check('모바일 탭 → 내 총알 발사', await page.evaluate(() => window.__SHOT_TEST__.nMine) > mineBefore);

  const spriteOk = await page.evaluate(() => {
    const e = document.querySelector('.enemy');
    return e && e.tagName.toLowerCase() === 'a-image' && e.hasAttribute('billboard') && e.dataset.variant != null;
  });
  check('적이 빌보드 스프라이트(a-image)로 생성', spriteOk);

  // ── 3) 피격/게임오버 ──
  console.log('\n[피격/종료]');
  await page.evaluate(() => { window.__SHOT_TEST__.hitPlayer(); window.__SHOT_TEST__.hitPlayer(); window.__SHOT_TEST__.hitPlayer(); });
  check('생명 0 → 게임오버(playing=false)', await page.evaluate(() => window.__SHOT_TEST__.playing) === false);
  check('최고점수 기록됨(best>=1)', await page.evaluate(() => window.__SHOT_TEST__.best) >= 1);

  // ── 4) 오디오: OfflineAudioContext로 synth 경로 렌더(브로드밴드/비클리핑) ──
  console.log('\n[오디오 synth]');
  const hasSnd = await page.evaluate(() => !!(window.__SHOT_TEST__ && window.__SHOT_TEST__.renderOffline));
  if (!hasSnd) {
    console.log('  ⚠ renderOffline 훅 없음(통합 전) — 오디오 검증 건너뜀');
  } else {
    for (const fx of ['playerShot', 'enemyShot', 'enemyDeath', 'playerHit', 'whizz']) {
      const r = await page.evaluate(async (name) => {
        try {
          const buf = await window.__SHOT_TEST__.renderOffline(name, 0.4);
          if (!buf || !buf.length) return { ok: false };
          let peak = 0, sum = 0, zc = 0, prev = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = buf[i]; const a = Math.abs(v);
            if (a > peak) peak = a; sum += a * a;
            if ((v >= 0) !== (prev >= 0)) zc++; prev = v;
          }
          const rms = Math.sqrt(sum / buf.length);
          return { ok: true, peak, rms, zc, len: buf.length };
        } catch (e) { return { ok: false, err: String(e) }; }
      }, fx);
      check(`${fx}: 렌더됨`, r.ok, r.err || '');
      if (r.ok) {
        check(`${fx}: 클리핑 없음(peak<0.99)`, r.peak < 0.99, 'peak=' + r.peak.toFixed(3));
        check(`${fx}: 소리 있음(peak>0.05)`, r.peak > 0.05, 'peak=' + r.peak.toFixed(3));
        // 브로드밴드(노이즈성): 제로크로싱이 순수 톤보다 많아야 함 — 대략적 지표
        check(`${fx}: 노이즈성(zc 다수)`, r.zc > 50, 'zc=' + r.zc);
        console.log(`     ↳ peak=${r.peak.toFixed(3)} rms=${r.rms.toFixed(3)} zc=${r.zc}`);
      }
    }
  }

  // ── 5) 모바일 조작 배선(터치 컨텍스트) ──
  console.log('\n[모바일 조작]');
  const mctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.route('**/aframe*', r => r.abort());
  const merr = [];
  mp.on('pageerror', e => { if (!ignore(String(e))) merr.push(String(e)); });
  await mp.goto(APP, { waitUntil: 'load' });
  await mp.waitForTimeout(200);
  check('모바일: 조작 UI 표시(#mctl.show)', await mp.evaluate(() => { const e = document.getElementById('mctl'); return e && e.classList.contains('show'); }));
  check('모바일: __MOBILE_TEST__ 훅 생성', await mp.evaluate(() => !!window.__MOBILE_TEST__));
  check('모바일: 방향패드 4개 존재', await mp.evaluate(() => document.querySelectorAll('#mpad .mb').length === 4));
  check('모바일: 발사/정면 버튼 존재', await mp.evaluate(() => !!document.getElementById('mfire') && !!document.getElementById('mcenter')));
  await mp.evaluate(() => { window.__SHOT_TEST__.start(); window.__MOBILE_TEST__.press('f'); window.__MOBILE_TEST__.fire(); window.__MOBILE_TEST__.recenter(); window.__MOBILE_TEST__.release('f'); });
  await mp.waitForTimeout(80);
  check('모바일: 입력 처리 중 에러 없음', merr.length === 0, merr.join(' | '));
  await mctx.close();

  console.log(`\n에러 로그 수: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 8).join('\n'));
  await browser.close();
  console.log(`\n━━━ 결과: ${passed} 통과 / ${failed} 실패 ━━━`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
