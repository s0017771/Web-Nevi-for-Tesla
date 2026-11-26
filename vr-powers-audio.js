/* ══════════════════════════════════════════════════════════════════════════
   powers-audio.js — "초능력 체험(염력)" 사운드 엔진 (순수 WebAudio, 외부 라이브러리 없음)
   ─ 전역 1개 객체 window.POWERSAUDIO 로 노출. 자체 AudioContext + 마스터 버스 소유.
   ─ 게임 스크립트보다 먼저 로드되는 독립 <script> 하나로 동작(A-Frame 불필요·헤드리스 안전).
   ─ 염력 SFX는 전부 "레이어드 합성"(노이즈 버퍼 + 바이쿼드 필터 스윕 + 엔벨로프).
     단순 오실레이터 비프가 아니라 공기·질감·힘이 느껴지는 리얼 사운드 디자인.
   ─ 마스터 버스: 리버브 send + 컴프레서(사양서 '보통' 프리셋) + 최종 세이프티 리미터.
   사양(HANDOFF/CONTEXT.md):
     컴프 threshold −16dB / knee 12 / ratio 2.5 / attack 10ms / release 250ms / makeup 0.9
     리버브 IR tail 1.6s / 감쇠 (1 - t/tail)^2.8 / wet send 0.22 기본
   요소별 send: pull 0.18 / grab 0.12 / charge 0.14 / throw 0.24 / impact 0.22
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ───────── 모듈 상태 (오프라인 렌더 시 통째로 스왑되는 핸들들) ───────── */
  var AC = null;           // 현재 AudioContext (실시간 또는 오프라인 렌더용)
  var MASTER = null;       // 마스터 컴프레서(버스 입구)
  var MASTERGAIN = null;   // makeup gain
  var LIMITER = null;      // 최종 세이프티 리미터
  var REVERB = null;       // 리버브 send 입구

  var VERB = { tail: 1.6, decay: 2.8, wet: 0.22 };
  var COMP = { threshold: -16, knee: 12, ratio: 2.5, attack: 0.01, release: 0.25, makeup: 0.9 };
  var SEND = { pull: 0.18, grab: 0.12, charge: 0.14, throw: 0.24, impact: 0.22, amb: 0.30 };

  /* ───────── 마스터 버스 / 리버브 ───────── */
  function buildMaster() {
    try {
      var c = AC.createDynamicsCompressor();
      c.threshold.value = COMP.threshold; c.knee.value = COMP.knee; c.ratio.value = COMP.ratio;
      c.attack.value = COMP.attack; c.release.value = COMP.release;
      var g = AC.createGain(); g.gain.value = COMP.makeup;
      var lim = AC.createDynamicsCompressor();
      lim.threshold.value = -5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
      c.connect(g); g.connect(lim); lim.connect(AC.destination);
      MASTER = c; MASTERGAIN = g; LIMITER = lim;
      buildReverb();
    } catch (e) { MASTER = null; MASTERGAIN = null; LIMITER = null; }
  }
  function buildReverb() {
    try {
      var len = Math.max(1, Math.floor(AC.sampleRate * VERB.tail));
      var ch = (AC.destination && AC.destination.channelCount > 1) ? 2 : 1;
      var ir = AC.createBuffer(ch, len, AC.sampleRate);
      for (var c = 0; c < ch; c++) {
        var d = ir.getChannelData(c);
        for (var i = 0; i < len; i++) { var t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, VERB.decay); }
      }
      var conv = AC.createConvolver(); conv.buffer = ir;
      var pre = AC.createGain(); pre.gain.value = 1;
      var wet = AC.createGain(); wet.gain.value = 1;
      pre.connect(conv); conv.connect(wet); wet.connect(MASTER || AC.destination);
      REVERB = pre;
    } catch (e) { REVERB = null; }
  }
  function out() { return MASTER || AC.destination; }
  function sendVerb(node, amt) {
    try { if (REVERB) { var s = AC.createGain(); s.gain.value = (amt == null ? VERB.wet : amt); node.connect(s); s.connect(REVERB); } } catch (e) {}
  }
  /* 노이즈 버퍼: dur초, 감쇠곡선 (1 - i/n)^pow. pow=0이면 균일(정상 노이즈) */
  function noiseBuf(dur, pow) {
    var n = Math.max(1, Math.floor(AC.sampleRate * dur));
    var b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
    if (pow === 0) { for (var j = 0; j < n; j++) d[j] = Math.random() * 2 - 1; return b; }
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, pow);
    return b;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  /* ══════════════════════════════════════════════════════════════════════
     착(pull) — "에너지 끌림/흡인": 밴드패스 노이즈가 아래→위로 스윕(빨려옴),
       낮은 디튠 험이 살짝 받쳐 초자연적 느낌. ~0.34s.
     ════════════════════════════════════════════════════════════════════ */
  function _pull(t) {
    try {
      /* (1) 흡인 스윕: 밴드패스 노이즈 300→1500Hz 상승 */
      var dur = rnd(0.30, 0.38);
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(dur, 0.6);
      var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4.5;
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(rnd(1350, 1650), t + dur);
      var ng = AC.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.75);
      ng.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.05);
      ns.connect(bp); bp.connect(ng); ng.connect(out()); sendVerb(ng, SEND.pull); ns.start(t); ns.stop(t + dur + 0.08);
      /* (2) 공기 하모닉 험(디튠 삼각 2개, 저역, 로우패스) — 상승 글라이드 */
      var o1 = AC.createOscillator(), o2 = AC.createOscillator(), hg = AC.createGain(), lp = AC.createBiquadFilter();
      o1.type = 'triangle'; o2.type = 'triangle'; o1.frequency.setValueAtTime(130, t); o2.frequency.setValueAtTime(137, t);
      o1.frequency.exponentialRampToValueAtTime(260, t + dur); o2.frequency.exponentialRampToValueAtTime(274, t + dur);
      lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.6;
      hg.gain.setValueAtTime(0.0001, t); hg.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.6); hg.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.04);
      o1.connect(lp); o2.connect(lp); lp.connect(hg); hg.connect(out()); sendVerb(hg, SEND.pull * 0.7);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.06); o2.stop(t + dur + 0.06);
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════
     잡힘(grab/catch) — "척!": 짧은 자기장 스냅 트랜지언트 + 저역 바디 펀치. ~0.12s.
     ════════════════════════════════════════════════════════════════════ */
  function _grab(t) {
    try {
      /* 스냅 트랜지언트: 밴드패스 노이즈 버스트 */
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(0.05, 2.0);
      var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(1100, 1500); bp.Q.value = 1.4;
      var ng = AC.createGain(); ng.gain.setValueAtTime(0.26, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      ns.connect(bp); bp.connect(ng); ng.connect(out()); sendVerb(ng, SEND.grab); ns.start(t);
      /* 저역 바디(사물이 손에 '턱' 걸리는 느낌) */
      var ob = AC.createOscillator(), og = AC.createGain(); ob.type = 'sine';
      ob.frequency.setValueAtTime(220, t); ob.frequency.exponentialRampToValueAtTime(95, t + 0.09);
      og.gain.setValueAtTime(0.22, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      ob.connect(og); og.connect(out()); sendVerb(og, SEND.grab * 0.6); ob.start(t); ob.stop(t + 0.12);
      /* 미세 금속 틱(자성) */
      var tk = AC.createOscillator(), tg = AC.createGain(); tk.type = 'triangle'; tk.frequency.setValueAtTime(2600, t);
      tg.gain.setValueAtTime(0.05, t); tg.gain.exponentialRampToValueAtTime(0.0008, t + 0.02); tk.connect(tg); tg.connect(out()); tk.start(t); tk.stop(t + 0.03);
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════
     차징(charge) — "힘을 모음": 지속 드론(디튠 저음 + 밴드패스 스윕 노이즈 + 진동 LFO).
       buildChargeVoice 가 핸들을 돌려줘서 실시간엔 setLevel/stop, 오프라인엔 스케줄로 사용.
     ════════════════════════════════════════════════════════════════════ */
  function buildChargeVoice(t0) {
    var h = {};
    try {
      /* 디튠 저음 드론(삼각 2개) */
      var o1 = AC.createOscillator(), o2 = AC.createOscillator(), lp = AC.createBiquadFilter(), dg = AC.createGain();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = 62; o2.frequency.value = 62 * 1.012;
      lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2.0;
      dg.gain.value = 0.0001;
      o1.connect(lp); o2.connect(lp); lp.connect(dg); dg.connect(out()); sendVerb(dg, SEND.charge);
      /* 밴드패스 스윕 노이즈(상승 에너지) — 긴 루프 노이즈 */
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(2.5, 0); ns.loop = true;
      var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 3.5;
      var ngn = AC.createGain(); ngn.gain.value = 0.0001;
      ns.connect(bp); bp.connect(ngn); ngn.connect(out()); sendVerb(ngn, SEND.charge);
      /* 떨림 LFO(진폭 흔들림 → 불안정한 힘의 느낌) */
      var lfo = AC.createOscillator(), lfg = AC.createGain(); lfo.type = 'sine'; lfo.frequency.value = 7;
      lfg.gain.value = 0; lfo.connect(lfg); lfg.connect(dg.gain);
      o1.start(t0); o2.start(t0); ns.start(t0); lfo.start(t0);
      h.o1 = o1; h.o2 = o2; h.ns = ns; h.lfo = lfo; h.lfg = lfg; h.dg = dg; h.ngn = ngn; h.bp = bp; h.lp = lp;
      h.setLevel = function (c, when) {
        c = clamp01(c); when = (when == null ? AC.currentTime : when);
        try {
          dg.gain.setTargetAtTime(0.03 + 0.20 * c, when, 0.05);
          ngn.gain.setTargetAtTime(0.02 + 0.13 * c, when, 0.05);
          o1.frequency.setTargetAtTime(62 + 42 * c, when, 0.08);
          o2.frequency.setTargetAtTime((62 + 42 * c) * 1.012, when, 0.08);
          bp.frequency.setTargetAtTime(400 + 2200 * c, when, 0.06);
          lp.frequency.setTargetAtTime(520 + 1400 * c, when, 0.08);
          lfo.frequency.setTargetAtTime(7 + 9 * c, when, 0.1);
          lfg.gain.setTargetAtTime(0.01 + 0.05 * c, when, 0.1);
        } catch (e) {}
      };
      h.stop = function (when) {
        when = (when == null ? AC.currentTime : when);
        try {
          dg.gain.setTargetAtTime(0.0001, when, 0.05); ngn.gain.setTargetAtTime(0.0001, when, 0.05);
          var endT = when + 0.4;
          o1.stop(endT); o2.stop(endT); ns.stop(endT); lfo.stop(endT);
        } catch (e) {}
      };
    } catch (e) {
      h.setLevel = function () {}; h.stop = function () {};
    }
    return h;
  }
  var liveCharge = null;
  function chargeStart() {
    ensure(); if (!AC) return;
    if (liveCharge) { try { liveCharge.stop(); } catch (e) {} liveCharge = null; }
    liveCharge = buildChargeVoice(AC.currentTime + 0.01);
    liveCharge.setLevel(0.0, AC.currentTime + 0.02);
  }
  function chargeUpdate(c) { if (liveCharge) liveCharge.setLevel(c); }
  function chargeStop() { if (liveCharge) { liveCharge.stop(); liveCharge = null; } }

  /* 오프라인용: t0부터 dur동안 c0→c1로 차오르는 차징 한 구간 */
  function _chargeBurst(t0, dur, c0, c1) {
    var v = buildChargeVoice(t0);
    var steps = 10;
    for (var i = 0; i <= steps; i++) {
      var f = i / steps; v.setLevel(c0 + (c1 - c0) * f, t0 + dur * f);
    }
    v.stop(t0 + dur);
  }

  /* ══════════════════════════════════════════════════════════════════════
     탈(throw) — "휙/방출": 밴드패스 노이즈 하강 스윕(공기 가름) + 저역 펀치(발사 반동).
       power(0~1) 클수록 크고 묵직하게. ~0.3s.
     ════════════════════════════════════════════════════════════════════ */
  function _throw(t, power) {
    power = clamp01(power == null ? 0.6 : power);
    try {
      var lv = 0.5 + 0.7 * power;
      /* 공기 가르는 whoosh: 밴드패스 1800→300 하강 */
      var dur = 0.22 + 0.12 * power;
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(dur + 0.05, 0.4);
      var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(rnd(1600, 2000), t); bp.frequency.exponentialRampToValueAtTime(rnd(260, 360), t + dur);
      var ng = AC.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.34 * lv, t + 0.02);
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      ns.connect(bp); bp.connect(ng); ng.connect(out()); sendVerb(ng, SEND.throw); ns.start(t); ns.stop(t + dur + 0.05);
      /* 저역 펀치(방출 반동) */
      var ob = AC.createOscillator(), og = AC.createGain(); ob.type = 'sine';
      ob.frequency.setValueAtTime(150 + 40 * power, t); ob.frequency.exponentialRampToValueAtTime(48, t + 0.1 + 0.05 * power);
      og.gain.setValueAtTime(0.28 * lv, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + 0.06 * power);
      ob.connect(og); og.connect(out()); sendVerb(og, SEND.throw * 0.5); ob.start(t); ob.stop(t + 0.2);
      /* 고역 "쉭" 공기(하이패스 노이즈, 짧게) */
      var hs = AC.createBufferSource(); hs.buffer = noiseBuf(0.08, 1.2);
      var hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
      var hgn = AC.createGain(); hgn.gain.setValueAtTime(0.09 * lv, t); hgn.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      hs.connect(hp); hp.connect(hgn); hgn.connect(out()); hs.start(t);
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════
     충돌(impact) — "쿵/달그락": 저역 바디(사물 무게) + 로우패스 노이즈(바닥) + 잔해 래틀.
       v(0~1) 클수록 세고 밝게.
     ════════════════════════════════════════════════════════════════════ */
  function _impact(t, v) {
    v = clamp01(v == null ? 0.5 : v);
    try {
      /* 저역 바디 thud */
      var ob = AC.createOscillator(), og = AC.createGain(); ob.type = 'sine';
      var f0 = 90 + 70 * v;
      ob.frequency.setValueAtTime(f0, t); ob.frequency.exponentialRampToValueAtTime(42, t + 0.09 + 0.05 * v);
      og.gain.setValueAtTime(0.15 + 0.3 * v, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + 0.08 * v);
      ob.connect(og); og.connect(out()); sendVerb(og, SEND.impact * 0.6); ob.start(t); ob.stop(t + 0.22);
      /* 바닥 노이즈(로우패스) */
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(0.1, 1.8);
      var lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + 900 * v;
      var ng = AC.createGain(); ng.gain.setValueAtTime(0.12 + 0.18 * v, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      ns.connect(lp); lp.connect(ng); ng.connect(out()); sendVerb(ng, SEND.impact); ns.start(t);
      /* 잔해 래틀(짧은 밴드패스 틱 몇 개 — v에 비례) */
      var ticks = Math.round(1 + v * 3);
      for (var i = 0; i < ticks; i++) {
        var tt = t + rnd(0.005, 0.05 + 0.04 * v);
        var rs = AC.createBufferSource(); rs.buffer = noiseBuf(0.02, 2.5);
        var rbp = AC.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = rnd(1800, 4200); rbp.Q.value = 2.0;
        var rg = AC.createGain(); rg.gain.setValueAtTime(0.05 + 0.05 * v, tt); rg.gain.exponentialRampToValueAtTime(0.0008, tt + 0.03);
        rs.connect(rbp); rbp.connect(rg); rg.connect(out()); sendVerb(rg, SEND.impact * 0.5); rs.start(tt);
      }
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════
     앰비언스 — 아주 낮은 레벨의 공간 룸톤(초자연적 저역 웅웅). start/stop 토글.
     ════════════════════════════════════════════════════════════════════ */
  var ambNodes = null;
  function ambientStart() {
    ensure(); if (!AC || ambNodes) return;
    try {
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(3, 0); ns.loop = true;
      var lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 0.3;
      var g = AC.createGain(); g.gain.value = 0.0001;
      ns.connect(lp); lp.connect(g); g.connect(out()); sendVerb(g, SEND.amb);
      ns.start(AC.currentTime); g.gain.setTargetAtTime(0.02, AC.currentTime, 0.8);
      /* 느린 떨림 */
      var lfo = AC.createOscillator(), lfg = AC.createGain(); lfo.type = 'sine'; lfo.frequency.value = 0.12; lfg.gain.value = 0.008;
      lfo.connect(lfg); lfg.connect(g.gain); lfo.start(AC.currentTime);
      ambNodes = { ns: ns, g: g, lfo: lfo };
    } catch (e) {}
  }
  function ambientStop() {
    if (!ambNodes) return;
    try { var when = AC.currentTime; ambNodes.g.gain.setTargetAtTime(0.0001, when, 0.3); ambNodes.ns.stop(when + 1.2); ambNodes.lfo.stop(when + 1.2); } catch (e) {}
    ambNodes = null;
  }

  /* ───────── 컨텍스트 수명 ───────── */
  function ensure() {
    try {
      if (!AC) { AC = new (global.AudioContext || global.webkitAudioContext)(); buildMaster(); }
      if (AC.state === 'suspended' && AC.resume) AC.resume();
    } catch (e) {}
    return AC;
  }
  function resume() { try { if (AC && AC.state === 'suspended' && AC.resume) AC.resume(); } catch (e) {} }

  /* ══════════════════════════════════════════════════════════════════════
     오프라인 렌더 검증 — 헤드리스에서 실제 PCM 분석(합성 경로만, fetch 없음)
     대표 시퀀스: pull → grab → charge(모음) → throw → impact ×2
     ════════════════════════════════════════════════════════════════════ */
  function renderOfflineTest(seconds) {
    seconds = seconds || 4;
    var sr = 44100;
    return new Promise(function (resolve, reject) {
      var OfflineCtor = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!OfflineCtor) { reject(new Error('no OfflineAudioContext')); return; }
      var oac = new OfflineCtor(2, Math.ceil(sr * seconds), sr);
      var sAC = AC, sM = MASTER, sMG = MASTERGAIN, sLM = LIMITER, sR = REVERB, sLive = liveCharge, sAmb = ambNodes;
      AC = oac; MASTER = null; REVERB = null; liveCharge = null; ambNodes = null;
      buildMaster();
      try {
        /* 시퀀스 1: 착 → 잡힘 → 차징(0→1, 0.7s) → 탈(강) */
        _pull(0.10); _grab(0.55);
        _chargeBurst(0.65, 0.70, 0.0, 1.0); _throw(1.40, 1.0);
        /* 충돌 2회(강/약) */
        _impact(1.95, 0.9); _impact(2.35, 0.4);
        /* 시퀀스 2: 약한 즉시 밀기(탈 저차징) → 착 → 탈(중) */
        _throw(2.70, 0.25); _pull(3.00); _throw(3.45, 0.6);
      } catch (e) {}
      oac.startRendering().then(function (buf) {
        AC = sAC; MASTER = sM; MASTERGAIN = sMG; LIMITER = sLM; REVERB = sR; liveCharge = sLive; ambNodes = sAmb;
        var L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
        var n = L.length, peak = 0, sum = 0, pcm = new Array(n);
        for (var j = 0; j < n; j++) {
          var m = (L[j] + R[j]) * 0.5; pcm[j] = m;
          var al = Math.abs(L[j]); if (al > peak) peak = al;
          var ar = Math.abs(R[j]); if (ar > peak) peak = ar;
          sum += m * m;
        }
        var rms = Math.sqrt(sum / n);
        /* 온셋: 10ms 윈도 RMS 엔벨로프 상승 에지 */
        var win = Math.floor(sr * 0.01), prev = 0, onsets = 0, refractory = 0;
        for (var w = 0; w + win <= n; w += win) {
          var e = 0; for (var k = 0; k < win; k++) { var vv = pcm[w + k]; e += vv * vv; }
          e = Math.sqrt(e / win);
          if (refractory > 0) refractory--;
          if (e > 0.02 && e > prev * 1.8 && refractory === 0) { onsets++; refractory = 4; }
          prev = e;
        }
        resolve({ sr: sr, peak: peak, rms: rms, clipped: peak >= 1.0, onsets: onsets });
      }).catch(function (err) {
        AC = sAC; MASTER = sM; MASTERGAIN = sMG; LIMITER = sLM; REVERB = sR; liveCharge = sLive; ambNodes = sAmb;
        reject(err);
      });
    });
  }

  /* ───────── 공개 API ───────── */
  global.POWERSAUDIO = {
    ensure: ensure,
    resume: resume,
    pull: function () { ensure(); if (AC) _pull(AC.currentTime + 0.001); },
    grab: function () { ensure(); if (AC) _grab(AC.currentTime + 0.001); },
    chargeStart: chargeStart,
    chargeUpdate: chargeUpdate,
    chargeStop: chargeStop,
    throw: function (power) { ensure(); if (AC) _throw(AC.currentTime + 0.001, power); },
    impact: function (v) { ensure(); if (AC) _impact(AC.currentTime + 0.001, v); },
    ambientStart: ambientStart,
    ambientStop: ambientStop,
    renderOfflineTest: renderOfflineTest,
    VERSION: '1.0.0'
  };

})(typeof window !== 'undefined' ? window : this);
