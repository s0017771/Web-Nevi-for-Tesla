/*
 * 리듬 세이버 E2E 테스트 (Playwright, 헤드리스)
 * 실행: NODE_PATH=/opt/node22/lib/node_modules node tests/vr-saber.e2e.mjs
 * (전역 playwright + chromium 필요. 로컬 설치 시: npm i playwright 후 실행)
 *
 * 샌드박스에서 A-Frame CDN은 차단(route abort)하고 순수 로직/오디오만 검증한다.
 * 검증: 등급 A~F 경계 · 정확도(맞음/놓침) 집계 · 틀린 색 미적중 ·
 *       게임오버↔메뉴 흐름(겹침 방지) · 멜로디 오디오 경로(renderOffline) ·
 *       새 효과음(베기+깨짐+미스) 클리핑 없음/광대역/완전감쇠.
 * A-Frame 렌더·자이로·실제 샘플 소리·비주얼·헤드셋 검증은 기기(퀘스트·폰)에서 사용자 확인 필요.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vr-saber.html');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console:' + m.text()); });
await page.route('**/aframe*', r => r.abort());   // 샌드박스 재현: A-Frame CDN 차단
await page.goto(APP, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SABER_TEST__ && window.resetScore && window.endGame, null, { timeout: 5000 });

const R = await page.evaluate(async () => {
  const T = window.__SABER_TEST__, o = {};
  o.grades = [95, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(p => T.grade(p));
  const scene = document.querySelector('a-scene');
  const blk = (c) => { const e = document.createElement('a-box'); e.className = 'block'; e.dataset.color = c; scene.appendChild(e); return e; };
  // 8맞 2놓 → 80% → B
  window.__saberPlaying = true; window.resetScore();
  for (let i = 0; i < 8; i++) window.__saberHit(blk('red'), 'red');
  for (let i = 0; i < 2; i++) window.__saberMiss(blk('red'));
  o.acc = T.acc; o.accGrade = T.grade(T.acc); o.hits = T.hits; o.misses = T.misses;
  // 틀린 색은 미적중
  window.resetScore(); window.__saberHit(blk('red'), 'blue'); o.wrongColorHits = T.hits;
  // 멜로디 오디오 경로
  const ro = await T.renderOffline(0, 2.0, true);
  let peak = 0; for (const v of ro.pcm) { const a = Math.abs(v); if (a > peak) peak = a; }
  o.offline = { notes: ro.notes.length, peak: +peak.toFixed(4) };
  o.nSongs = T.nSongs;
  // 게임오버 → 메뉴 재오픈 흐름 (9맞 1놓 → 90% → A)
  window.__saberPlaying = true; window.resetScore();
  for (let i = 0; i < 9; i++) window.__saberHit(blk('red'), 'red');
  window.__saberMiss(blk('red'));
  o.endAcc = T.acc; o.endGrade = T.grade(T.acc);
  window.endGame();
  o.afterEnd = { go: String(document.getElementById('gameover').getAttribute('visible')), sw: String(document.getElementById('startWrap').getAttribute('visible')), playing: T.playing };
  window.reopenMenu();
  o.afterReopen = { go: String(document.getElementById('gameover').getAttribute('visible')), sw: String(document.getElementById('startWrap').getAttribute('visible')) };
  return o;
});

// 효과음: 베기+깨짐 연타 + 미스를 오프라인 렌더해 클리핑/광대역/감쇠 확인
const SND = await page.evaluate(async () => {
  const sr = 44100, dur = 0.7;
  window.AC = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, Math.ceil(sr * dur), sr);
  window.MASTER = null; window.buildMaster();
  window.sliceSound(0, { color: 'red', speed: 1.4 }); window.shatterSound(0.015, { kind: 'cube' });
  window.sliceSound(0.25, { color: 'blue', speed: 0.9 }); window.shatterSound(0.265, { kind: 'drum' });
  window.missSound(0.5);
  const d = (await window.AC.startRendering()).getChannelData(0);
  let peak = 0, sq = 0, zc = 0, prev = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sq += d[i] * d[i]; if ((d[i] >= 0) !== (prev >= 0)) zc++; prev = d[i]; }
  const ts = Math.floor(d.length * 0.92); let tsq = 0; for (let i = ts; i < d.length; i++) tsq += d[i] * d[i];
  return { peak: +peak.toFixed(4), rms: +Math.sqrt(sq / d.length).toFixed(5), zcr: Math.round(zc / (d.length / sr)), tailRms: +Math.sqrt(tsq / (d.length - ts)).toFixed(6) };
});

console.log('리듬 세이버 E2E');
check('등급 A~F 경계', JSON.stringify(R.grades) === JSON.stringify(['A','A','B','B','C','C','D','D','F','F']), JSON.stringify(R.grades));
check('정확도 8맞/2놓 → 80% B', R.acc === 80 && R.accGrade === 'B' && R.hits === 8 && R.misses === 2);
check('틀린 색은 미적중', R.wrongColorHits === 0);
check('멜로디 오디오 경로(음표>0·클리핑없음)', R.offline.notes > 0 && R.offline.peak < 1.0 && R.offline.peak > 0.05, JSON.stringify(R.offline));
check('노래 3곡 로드', R.nSongs === 3, 'nSongs=' + R.nSongs);
check('게임오버 90% → A', R.endAcc === 90 && R.endGrade === 'A');
check('게임오버 카드만 표시(메뉴 숨김)', R.afterEnd.go === 'true' && R.afterEnd.sw === 'false' && R.afterEnd.playing === false, JSON.stringify(R.afterEnd));
check('다시 고르기 → 메뉴 복귀', R.afterReopen.go === 'false' && R.afterReopen.sw === 'true', JSON.stringify(R.afterReopen));
check('효과음 클리핑 없음(<0.99)', SND.peak < 0.99 && SND.peak > 0.05, 'peak=' + SND.peak);
check('효과음 광대역(비-순음)', SND.zcr > 1500, 'zcr=' + SND.zcr);
check('효과음 꼬리 감쇠', SND.tailRms < SND.rms * 0.5, 'tail=' + SND.tailRms + ' rms=' + SND.rms);
check('페이지 에러 없음', errors.length === 0, errors.join(' | '));

console.log(`\n  SOUND: ${JSON.stringify(SND)}`);
console.log(`\n합계: ${passed} 통과, ${failed} 실패`);
await browser.close();
process.exit(failed ? 1 : 0);
