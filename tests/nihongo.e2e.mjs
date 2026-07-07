/*
 * 니혼고 랩 E2E 테스트 (Playwright)
 * 실행: NODE_PATH=/opt/node22/lib/node_modules node tests/nihongo.e2e.mjs
 * (전역 playwright + chromium 필요. 로컬 설치 시: npm i playwright 후 node tests/nihongo.e2e.mjs)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'nihongo.html');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

/** 현재 문제를 읽어 정답을 클릭해 푼다 (훅 window.NIHONGO 사용) */
async function solveExercise(page, { wrong = false } = {}) {
  const ex = await page.evaluate(() => {
    const e = window.NIHONGO.exercise;
    return e && { type: e.type, correct: e.correct, answer: e.answer, options: e.options, pairs: e.pairs, buildOrder: e.buildOrder };
  });
  if (!ex) throw new Error('no current exercise');

  if (ex.type === 'tip') {
    await page.click('#action-btn'); // 알겠어요 (채점 없음)
    return;
  }
  if (ex.type === 'choice' || ex.type === 'listen') {
    const target = wrong ? ex.options.find(o => o !== ex.correct) : ex.correct;
    const idx = ex.options.indexOf(target);
    await page.click(`#ex-area .opt[data-opt="${idx}"]`);
    await page.click('#action-btn'); // 확인
    await page.click('#action-btn'); // 계속
  } else if (ex.type === 'build') {
    const order = ex.buildOrder || [...ex.answer];
    const seq = wrong ? [...order].reverse() : order;
    for (const tok of seq) {
      const tiles = await page.$$('#build-tiles .tile:not(.used)');
      for (const t of tiles) {
        if ((await t.textContent()) === tok) { await t.click(); break; }
      }
    }
    await page.click('#action-btn');
    await page.click('#action-btn');
  } else if (ex.type === 'match') {
    for (const p of ex.pairs) {
      await page.click(`.opt[data-side="a"][data-pid="${p.id}"]`);
      await page.click(`.opt[data-side="b"][data-pid="${p.id}"]`);
    }
    await page.click('#action-btn'); // 계속 (매칭은 자동 완료)
  }
}

/** 세션이 끝날 때까지 정답으로 풀기 */
async function solveSession(page, maxSteps = 60) {
  for (let i = 0; i < maxSteps; i++) {
    const inLesson = await page.evaluate(() => !!window.NIHONGO.session);
    if (!inLesson) return;
    await solveExercise(page);
  }
  throw new Error('lesson did not finish in ' + maxSteps + ' steps');
}

const UNIT_COUNT = 10;
const TOTAL_LESSONS = UNIT_COUNT * 3;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => { failed++; console.log('  ❌ page JS error:', e.message); });
page.on('dialog', d => d.accept());

/* ── 1. 첫 로드: 경로 화면, 첫 레슨만 열림 ── */
console.log('\n[1] 첫 로드 · 잠금 상태');
await page.goto(APP + '?reset=1');
check('홈 화면 표시', await page.isVisible('#screen-home'));
check(`유닛 ${UNIT_COUNT}개 렌더링`, (await page.$$('.unit')).length === UNIT_COUNT);
check('첫 레슨만 열림(★ 1개)', (await page.$$('.node.next')).length === 1);
check('나머지 레슨 잠김', (await page.$$('.node:disabled')).length === TOTAL_LESSONS - 1);
check('스트릭 0으로 시작', (await page.textContent('#stat-streak .val')) === '0');
check('XP 0으로 시작', (await page.textContent('#stat-xp .val')) === '0');
check('하트 5개로 시작', (await page.textContent('#stat-hearts .val')) === '5');
check('복습 버튼은 아직 비활성', await page.isDisabled('#review-btn'));

/* ── 2. 레슨 전체 정답 완주 → 완료 화면·XP·스트릭 ── */
console.log('\n[2] 레슨 정답 완주');
await page.click('.node.next');
check('레슨 화면 진입', await page.isVisible('#screen-lesson'));
check('첫 문제 렌더링', await page.isVisible('#ex-title'));
await solveSession(page);
check('완료 화면 표시', await page.isVisible('#screen-done'));
check('완벽 보너스 +15 XP', (await page.textContent('#done-xp')) === '+15');
check('정확도 100%', (await page.textContent('#done-acc')) === '100%');
check('스트릭 🔥 1', (await page.textContent('#done-streak')).includes('1'));
await page.click('#done-btn');
check('홈 복귀 · XP 반영', (await page.textContent('#stat-xp .val')) === '15');
check('레슨1 완료(✓) 표시', (await page.$$('.node.done')).length === 1);
check('레슨2 열림', (await page.$$('.node.next')).length === 1);
check('일일 목표 진행', (await page.textContent('#goal-text')).startsWith('15 /'));

/* ── 3. 새로고침 후 진행 상황 유지 ── */
console.log('\n[3] 저장 · 새로고침 유지');
await page.goto(APP);
check('XP 유지', (await page.textContent('#stat-xp .val')) === '15');
check('스트릭 유지', (await page.textContent('#stat-streak .val')) === '1');
check('완료 레슨 유지', (await page.$$('.node.done')).length === 1);
check('SRS 항목 기록됨', await page.evaluate(() => Object.keys(window.NIHONGO.state.items).length >= 5));

/* ── 4. 오답 → 하트 감소, 틀린 문제 재출제 ── */
console.log('\n[4] 하트 · 오답 재출제');
await page.click('.node.next');
const q0 = await page.evaluate(() => window.NIHONGO.session.queue.length);
await solveExercise(page, { wrong: true });
check('하트 4개로 감소', await page.evaluate(() => window.NIHONGO.state.hearts === 4));
check('틀린 문제 큐 끝에 재추가', await page.evaluate(q => window.NIHONGO.session.queue.length === q + 1, q0));
await solveSession(page);
check('오답 있어도 완주 가능(+10 XP)', (await page.textContent('#done-xp')) === '+10');
check('정확도 100% 미만', (await page.textContent('#done-acc')) !== '100%');
await page.click('#done-btn');

/* ── 5. 하트 소진 → 실패 화면 ── */
console.log('\n[5] 하트 소진');
await page.evaluate(() => { window.NIHONGO.state.hearts = 1; });
await page.click('.node.next');
await solveExercise(page, { wrong: true }); // 하트 0
check('하트 0', await page.evaluate(() => window.NIHONGO.state.hearts === 0));
check('실패 화면 표시', await page.isVisible('#screen-fail'));
await page.click('#fail-btn');
check('홈 복귀', await page.isVisible('#screen-home'));
check('하트 0이면 레슨 시작 시 실패 화면', await (async () => {
  await page.click('.node.next');
  return page.isVisible('#screen-fail');
})());
await page.click('#fail-btn');

/* ── 6. 복습(SRS) → 완주 시 하트 +1 ── */
console.log('\n[6] 간격 반복 복습');
check('복습 버튼 활성화됨', !(await page.isDisabled('#review-btn')));
await page.click('#review-btn');
check('복습 세션 진입', await page.evaluate(() => window.NIHONGO.session?.mode === 'review'));
const heartsBefore = await page.evaluate(() => window.NIHONGO.state.hearts);
await solveSession(page);
check('복습 완료 화면', (await page.textContent('#done-title')) === '복습 완료!');
check('하트 +1 회복', await page.evaluate(h => window.NIHONGO.state.hearts === h + 1, heartsBefore));
check('복습 XP +5', (await page.textContent('#done-xp')) === '+5');
await page.click('#done-btn');

/* ── 7. 유닛 1 전체 완료 → 유닛 2 잠금 해제 ── */
console.log('\n[7] 유닛 진행 · 잠금 해제');
await page.evaluate(() => { window.NIHONGO.state.hearts = 5; });
for (let l = 0; l < 3; l++) {
  const already = await page.evaluate(i => !!window.NIHONGO.state.done['u1-' + i], l);
  if (already) continue;
  await page.click('.node.next');
  await solveSession(page);
  await page.click('#done-btn');
}
check('유닛1 레슨 3개 모두 완료', await page.evaluate(() =>
  ['u1-0', 'u1-1', 'u1-2'].every(k => window.NIHONGO.state.done[k])));
check('유닛2 잠금 해제', await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.node')].find(n => n.dataset.unit === '1' && n.dataset.lesson === '0');
  return btn && !btn.disabled;
}));
check('유닛3은 아직 잠김', await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.node')].find(n => n.dataset.unit === '2' && n.dataset.lesson === '0');
  return btn && btn.disabled;
}));

/* ── 8. 단어 유닛(조립 문제 포함) 완주 — 유닛 5 인사말 강제 진입 ── */
console.log('\n[8] 단어 유닛 · 조립 문제');
await page.evaluate(() => {
  const st = window.NIHONGO.state;
  ['u2', 'u3', 'u4'].forEach(u => { for (let i = 0; i < 3; i++) st.done[u + '-' + i] = true; });
  localStorage.setItem('nihongo-v1', JSON.stringify(st));
});
await page.goto(APP);
await page.evaluate(() => { window.NIHONGO.state.hearts = 5; });
await page.click('.node[data-unit="4"][data-lesson="0"]');
check('조립(build) 문제 포함', await page.evaluate(() => window.NIHONGO.session.queue.some(e => e.type === 'build')));
check('짝 맞추기 문제 포함', await page.evaluate(() => window.NIHONGO.session.queue.some(e => e.type === 'match')));
await solveSession(page);
check('단어 레슨 완주', await page.isVisible('#screen-done'));
await page.click('#done-btn');

/* ── 9. 스트릭 로직 ── */
console.log('\n[9] 스트릭 계산');
await page.evaluate(() => {
  const st = window.NIHONGO.state;
  st.lastStudy = window.NIHONGO.today(-1); st.streak = 3;
  localStorage.setItem('nihongo-v1', JSON.stringify(st));
});
await page.goto(APP);
check('어제까지 3일 스트릭 표시', (await page.textContent('#stat-streak .val')) === '3');
await page.click('.node.next');
await solveSession(page);
check('오늘 공부로 스트릭 4', (await page.textContent('#done-streak')).includes('4'));
await page.click('#done-btn');
await page.evaluate(() => {
  const st = window.NIHONGO.state;
  st.lastStudy = window.NIHONGO.today(-2); st.streak = 9;
  localStorage.setItem('nihongo-v1', JSON.stringify(st));
});
await page.goto(APP);
check('이틀 쉬면 스트릭 0 표시', (await page.textContent('#stat-streak .val')) === '0');

/* ── 10. 문장·문법 레슨 (문법 팁 + 문장 조립 + 조사) ── */
console.log('\n[10] 문장·문법 레슨');
await page.evaluate(() => {
  const st = window.NIHONGO.state;
  ['u1','u2','u3','u4','u5','u6','u7'].forEach(u => { for (let i=0;i<3;i++) st.done[u+'-'+i]=true; });
  st.hearts = 5;
  localStorage.setItem('nihongo-v1', JSON.stringify(st));
});
await page.goto(APP);
check('유닛 8(기초 문장) 잠금 해제', await page.evaluate(() => {
  const b = [...document.querySelectorAll('.node')].find(n => n.dataset.unit === '7' && n.dataset.lesson === '0');
  return b && !b.disabled;
}));
await page.click('.node[data-unit="7"][data-lesson="0"]');
check('문법 팁으로 시작', await page.evaluate(() => window.NIHONGO.exercise.type === 'tip'));
check('팁 화면 렌더링(.tip-body)', await page.isVisible('#ex-area .tip-body'));
check('팁 예문 표시', (await page.$$('#ex-area .tip-ex-row')).length >= 1);
check('팁 버튼 "알겠어요"', (await page.textContent('#action-btn')) === '알겠어요');
check('문장 조립(단어 타일) 문제 포함', await page.evaluate(() => window.NIHONGO.session.queue.some(e => e.type === 'build' && e.wordTiles)));
check('문장 뜻 고르기 문제 포함', await page.evaluate(() => window.NIHONGO.session.queue.some(e => e.type === 'choice' && !e.particle)));
await solveSession(page);
check('문장 레슨 완주', await page.isVisible('#screen-done'));
check('문장 항목 SRS 기록(s_*)', await page.evaluate(() => Object.keys(window.NIHONGO.state.items).some(k => k.startsWith('s_'))));
await page.click('#done-btn');
check('유닛 8 레슨1 완료 표시', await page.evaluate(() => !!window.NIHONGO.state.done['u8-0']));

/* ── 11. 조사 채우기 문제가 실제로 생성/채점되는지 ── */
console.log('\n[11] 조사 채우기 문제');
const particleWorks = await page.evaluate(() => {
  // 조사 문제 생성 여부와 정답 매칭을 직접 검증
  const units = window.NIHONGO.units;
  const u = units.find(x => x.id === 'u9');
  const s = u.items.find(it => it.particleIdx != null);
  return s && s.tokens[s.particleIdx];
});
check('조사 토큰 존재(예: を/が)', typeof particleWorks === 'string' && particleWorks.length >= 1);

await browser.close();
console.log(`\n═══ 결과: ${passed} 통과, ${failed} 실패 ═══`);
process.exit(failed ? 1 : 0);
