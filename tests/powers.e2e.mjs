/*
 * 초능력 체험(염력) E2E 테스트 (Playwright, headless)
 * 샌드박스에선 A-Frame CDN이 막히므로 aframe 요청을 abort 하고,
 *   (1) 순수 물리 코어 __TKPHYS 의 손맛 로직(질량·끌림·던지기·낙하·반발·조준)을 직접 검증하고,
 *   (2) 앱 레벨은 로드/사물생성/입력-무크래시만 검증한다.
 * A-Frame 렌더/컨트롤러 tick·실제 소리·비주얼·모바일 자이로는 기기(퀘스트·폰)에서 사용자가 확인.
 * 실행: NODE_PATH=/opt/node22/lib/node_modules node tests/powers.e2e.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vr-powers.html');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}
const get = (p, fn) => p.evaluate(fn);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.route('**/aframe*', r => r.abort());   // A-Frame CDN 차단 재현
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__TKPHYS && !!window.__POWERS_TEST__, null, { timeout: 8000 });

  console.log('\n── 순수 물리 코어 __TKPHYS 존재 ──');
  check('__TKPHYS 로드됨(A-Frame 없이도)', await get(page, () => !!window.__TKPHYS));
  check('__POWERS_TEST__ 훅 존재', await get(page, () => !!window.__POWERS_TEST__));

  console.log('\n── 던지기 세기: 차징·질량 손맛 ──');
  // 차징이 클수록 더 빠르게, 질량이 클수록 더 느리게 날아간다.
  const thr = await get(page, () => {
    const P = window.__TKPHYS;
    return {
      c0: P.throwSpeed(0, 1), c1: P.throwSpeed(1, 1),
      m1: P.throwSpeed(1, 1), m4: P.throwSpeed(1, 4),
      pull1: P.pullSpeed(1), pull4: P.pullSpeed(4)
    };
  });
  check('차징 1 던지기 > 차징 0', thr.c1 > thr.c0, JSON.stringify(thr));
  check('가벼운 물건이 더 세게 날아감(질량1 > 질량4)', thr.m1 > thr.m4, JSON.stringify(thr));
  check('가벼운 물건이 더 빨리 끌려옴(pull 질량1 > 질량4)', thr.pull1 > thr.pull4, JSON.stringify(thr));

  console.log('\n── throwVel: 던지기 속도벡터 ──');
  const tv = await get(page, () => {
    const P = window.__TKPHYS, out = { x: 0, y: 0, z: 0 };
    const sp = P.throwVel({ x: 0, y: 0, z: -1 }, 1, 1, out);
    return { out, sp, up: out.y };
  });
  check('던진 방향(-z)으로 속도', tv.out.z < -1, JSON.stringify(tv));
  check('위로 올리는 성분(y>0)', tv.up > 0, JSON.stringify(tv));

  console.log('\n── 끌림(pullStep): 무거운 건 느리게 ──');
  // 같은 거리에서 20스텝 끌었을 때, 가벼운 물건이 target 에 더 가까이 온다.
  const pull = await get(page, () => {
    const P = window.__TKPHYS;
    function run(m) {
      const pos = { x: 0, y: 1, z: -4 }, vel = { x: 0, y: 0, z: 0 }, tgt = { x: 0, y: 1.4, z: -1 };
      let caught = false;
      for (let i = 0; i < 20; i++) caught = P.pullStep(pos, vel, tgt, 0.016, m) || caught;
      const d = Math.hypot(pos.x - tgt.x, pos.y - tgt.y, pos.z - tgt.z);
      return { d, caught };
    }
    return { light: run(0.7), heavy: run(2.4) };
  });
  check('가벼운 물건이 더 가까이 끌려옴', pull.light.d < pull.heavy.d, JSON.stringify(pull));

  console.log('\n── 낙하/바닥(freeStep): 중력·착지·반발 ──');
  const fall = await get(page, () => {
    const P = window.__TKPHYS;
    const pos = { x: 0, y: 3, z: 0 }, vel = { x: 0, y: 0, z: 0 }, r = 0.2;
    let landed = false, bounces = 0, maxAfterFirst = 0, firstHit = false;
    for (let i = 0; i < 600; i++) {
      const res = P.freeStep(pos, vel, 0.016, r);
      if (res.impact > 0) { bounces++; firstHit = true; }
      if (firstHit) maxAfterFirst = Math.max(maxAfterFirst, pos.y);
      if (res.landed) { landed = true; break; }
    }
    return { yFinal: pos.y, landed, bounces, maxAfterFirst, r };
  });
  check('중력으로 바닥에 착지', fall.landed === true, JSON.stringify(fall));
  check('착지 높이 ≈ 반지름(r)', Math.abs(fall.yFinal - fall.r) < 0.02, JSON.stringify(fall));
  check('반발로 1회 이상 튕김', fall.bounces >= 1, JSON.stringify(fall));
  check('반발 후 튕긴 높이 < 처음 낙하 높이(에너지 손실)', fall.maxAfterFirst < 3, JSON.stringify(fall));

  console.log('\n── held 추종(heldStep): target 으로 수렴 ──');
  const held = await get(page, () => {
    const P = window.__TKPHYS;
    const pos = { x: 1, y: 1, z: -3 }, vel = { x: 0, y: 0, z: 0 }, tgt = { x: 0, y: 1.5, z: -1 };
    for (let i = 0; i < 60; i++) P.heldStep(pos, vel, tgt, 0.016, 1);
    return { d: Math.hypot(pos.x - tgt.x, pos.y - tgt.y, pos.z - tgt.z) };
  });
  check('held 가 손 앞 target 으로 수렴', held.d < 0.1, JSON.stringify(held));

  console.log('\n── 조준(aim): 레이-구 교차 ──');
  const aim = await get(page, () => {
    const P = window.__TKPHYS;
    const p = { x: 0, y: 1.4, z: 1 }, d = { x: 0, y: 0, z: -1 };
    const objs = [
      { x: 0.05, y: 1.4, z: -2, r: 0.2 },   // 정면 가까움
      { x: 0.0,  y: 1.4, z: -5, r: 0.2 },   // 정면 멂
      { x: 3.0,  y: 1.4, z: -2, r: 0.2 }    // 옆(빗나감)
    ];
    return {
      front: P.aim(p, d, objs, 0.12),                 // 0 기대(가까운 정면)
      offAxisOnly: P.aim(p, d, [objs[2]], 0.12),      // -1 기대(옆)
      none: P.aim(p, d, [], 0.12)                     // -1 기대(없음)
    };
  });
  check('정면의 가장 가까운 사물 선택(idx 0)', aim.front === 0, JSON.stringify(aim));
  check('옆으로 빗나간 사물은 미선택(-1)', aim.offAxisOnly === -1, JSON.stringify(aim));
  check('사물 없으면 -1', aim.none === -1, JSON.stringify(aim));

  console.log('\n── 앱 레벨: 시작/스폰/입력 무크래시 ──');
  check('시작 전 playing=false', await get(page, () => window.__POWERS_TEST__.playing === false));
  await page.evaluate(() => window.__POWERS_TEST__.start());
  check('시작 후 playing=true', await get(page, () => window.__POWERS_TEST__.playing === true));
  check('사물 8개 생성', await get(page, () => window.__POWERS_TEST__.nObjs === 8), await get(page, () => 'n=' + window.__POWERS_TEST__.nObjs));
  // 입력 호출이 크래시 없이 동작하는지 (헤드리스는 A-Frame 컴포넌트가 없어 상태변화는 기기에서 확인)
  await page.evaluate(() => { const T = window.__POWERS_TEST__; T.setHandAhead(); T.pull(); T.pushDown(); T.pushUp(); });
  check('착/탈 입력 체인 무크래시', await get(page, () => window.__POWERS_TEST__.playing === true));
  check('차징 플래그 접근 가능', await get(page, () => typeof window.__POWERS_TEST__.charging === 'boolean'));

  console.log('\n── 사운드/비주얼 모듈 로드·통합 ──');
  // 로컬 파일이라 CDN 차단과 무관하게 로드됨(A-Frame 불필요).
  check('POWERSAUDIO 로드됨', await get(page, () => !!window.POWERSAUDIO));
  check('POWERSVIZ 로드됨', await get(page, () => !!window.POWERSVIZ));
  const viz = await get(page, () => window.POWERSVIZ && window.POWERSVIZ.selfTest());
  check('viz selfTest ok(모든 텍스처 생성)', !!(viz && viz.ok && viz.allPng), JSON.stringify(viz));
  check('viz 텍스처 12종', !!(viz && viz.count >= 12), JSON.stringify(viz && { count: viz.count }));
  const au = await get(page, async () => { try { return await window.POWERSAUDIO.renderOfflineTest(2); } catch (e) { return { err: String(e) }; } });
  console.log('    audio:', JSON.stringify(au));
  check('오디오 오프라인 렌더 클리핑 없음', au && au.clipped === false, JSON.stringify(au));
  check('오디오 RMS 유의미(>0.01)', au && au.rms > 0.01, JSON.stringify(au));
  // 통합 지점(분위기/오라/빔 교체)이 start() 안에서 실행됨 — 아래 에러 0 으로 무크래시 확인

  check('페이지 런타임 에러 없음', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n── 결과: ${passed} 통과 / ${failed} 실패 ──`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('테스트 실행 오류:', e); process.exit(2); });
