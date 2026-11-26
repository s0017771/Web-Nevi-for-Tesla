/* ══════════════════════════════════════════════════════════════════════════
   gun-audio.js — "리듬 건" 사운드 엔진 (순수 WebAudio, 외부 라이브러리 없음)
   ─ 전역 1개 객체 window.GUNAUDIO 로 노출. 자체 AudioContext + 마스터 버스 소유.
   ─ 게임 스크립트보다 먼저 로드되는 독립 <script> 하나로 동작(A-Frame 불필요).
   ─ 리얼 권총 발사음(레이어드 합성) + 음악적 리듬 베드(샘플 우선 + 오실레이터 폴백).
   ─ 마스터 버스: 리버브 send + 컴프레서(사양서 '보통' 프리셋, vr-saber와 동일 수치).
   사양(HANDOFF/CONTEXT.md):
     컴프 threshold −16dB / knee 12 / ratio 2.5 / attack 10ms / release 250ms / makeup 0.9
     리버브 IR tail 1.6s / 감쇠 (1 - t/tail)^2.8 / wet send 0.22 기본
     샘플 base: https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ───────── 모듈 상태 (오프라인 렌더 시 통째로 스왑되는 핸들들) ───────── */
  var AC = null;           // 현재 AudioContext (실시간 또는 오프라인 렌더용)
  var MASTER = null;       // 마스터 컴프레서(버스 입구)
  var MASTERGAIN = null;   // makeup gain
  var LIMITER = null;      // 최종 세이프티 리미터(클리핑 방지 — 겹치는 트랜지언트 보호)
  var REVERB = null;       // 리버브 send 입구(프리 게인 → convolver → wet → master)
  var OFFLINE = false;     // true면 fetch 금지(항상 합성 폴백)

  /* 사양서 '보통' 프리셋 수치 */
  var VERB = { tail: 1.6, decay: 2.8, wet: 0.22 };
  var COMP = { threshold: -16, knee: 12, ratio: 2.5, attack: 0.01, release: 0.25, makeup: 0.9 };

  /* 리버브 send 레벨(요소별) — vr-saber 참고: 총성 0.30 / 음 0.18 / 킥 0.06 */
  var SEND = { shot: 0.30, note: 0.18, bass: 0.12, kick: 0.06, snare: 0.12, hat: 0.14, hit: 0.20, hurt: 0.10 };

  /* ───────── 마스터 버스 / 리버브 ───────── */
  function buildMaster() {
    try {
      var c = AC.createDynamicsCompressor();
      c.threshold.value = COMP.threshold; c.knee.value = COMP.knee; c.ratio.value = COMP.ratio;
      c.attack.value = COMP.attack; c.release.value = COMP.release;
      var g = AC.createGain(); g.gain.value = COMP.makeup;
      /* 최종 세이프티 리미터: 동시 발사/드럼/리버브 트랜지언트가 겹쳐도 0dBFS 넘지 않게 */
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
  /* 스테레오 패너(좌우 미세 패닝). 미지원/모노면 그냥 Gain 통과 */
  function panner(hand) {
    try {
      if (AC.createStereoPanner && (!AC.destination || AC.destination.channelCount > 1 || AC.destination.maxChannelCount > 1)) {
        var p = AC.createStereoPanner();
        var base = (hand === 'l') ? -0.33 : 0.33;
        p.pan.value = Math.max(-1, Math.min(1, base + (Math.random() * 0.12 - 0.06)));
        return p;
      }
    } catch (e) {}
    var g = AC.createGain(); return g;
  }
  /* 노이즈 버퍼 생성: dur초, 감쇠곡선 (1 - i/n)^pow */
  function noiseBuf(dur, pow) {
    var n = Math.max(1, Math.floor(AC.sampleRate * dur));
    var b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, pow);
    return b;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  /* 비명용 약한 디스토션 커브(거친 성대 느낌) */
  var _scurve = null;
  function screamCurve() { if (_scurve) return _scurve; var n = 1024, c = new Float32Array(n); for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * 2.3); } _scurve = c; return c; }

  /* ══════════════════════════════════════════════════════════════════════
     사운드폰트 샘플(FluidR3_GM, MIT) — 멜로디/베이스 피아노 + GM 드럼
     로드 전/오프라인이면 합성 폴백. OFFLINE=true면 fetch 안 함.
     ════════════════════════════════════════════════════════════════════ */
  var SF = { base: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/', instr: 'acoustic_grand_piano', buf: {}, loading: {} };
  var SFNAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  function midiToName(m) { return SFNAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  function freqToMidi(f) { return Math.round(69 + 12 * Math.log2(f / 440)); }
  function loadSample(m) {
    if (SF.buf[m] || SF.loading[m] || !AC || typeof fetch !== 'function' || OFFLINE) return;
    SF.loading[m] = true;
    var url = SF.base + SF.instr + '-mp3/' + midiToName(m) + '.mp3';
    fetch(url).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(function (ab) { return AC.decodeAudioData(ab); })
      .then(function (b) { SF.buf[m] = b; }).catch(function () { SF.loading[m] = false; });
  }
  function preloadSamples(freqs) { var done = {}; for (var i = 0; i < freqs.length; i++) { var f = freqs[i]; if (f > 0) { var m = freqToMidi(f); if (!done[m]) { done[m] = 1; loadSample(m); } } } }
  function samplePlay(freq, time, dur, peak, verb) {
    if (!freq) return true;
    var m = freqToMidi(freq), buf = SF.buf[m];
    if (!buf) { loadSample(m); return false; }
    try {
      var src = AC.createBufferSource(); src.buffer = buf;
      var g = AC.createGain(); src.connect(g); g.connect(out()); sendVerb(g, verb);
      var d = Math.max(0.2, dur), p = peak || 0.5;
      g.gain.setValueAtTime(p, time); g.gain.setValueAtTime(p, time + Math.max(0.04, d - 0.12));
      g.gain.exponentialRampToValueAtTime(0.0001, time + d + 0.14);
      src.start(time); src.stop(time + d + 0.18);
    } catch (e) { return false; } return true;
  }
  /* GM 드럼: 36킥=C2, 38스네어=D2, 42닫은햇=Gb2, 46열린햇=Bb2, 49크래시=Db3 */
  var PERC = { instr: 'percussion', buf: {}, loading: {} };
  var DRUMNOTE = { K: 36, S: 38, H: 42, O: 46, C: 49 };
  var DRUMGAIN = { K: 0.85, S: 0.7, H: 0.33, O: 0.5, C: 0.6 };
  function loadDrumSample(m) {
    if (PERC.buf[m] || PERC.loading[m] || !AC || typeof fetch !== 'function' || OFFLINE) return;
    PERC.loading[m] = true;
    var url = SF.base + PERC.instr + '-mp3/' + midiToName(m) + '.mp3';
    fetch(url).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(function (ab) { return AC.decodeAudioData(ab); })
      .then(function (b) { PERC.buf[m] = b; }).catch(function () { PERC.loading[m] = false; });
  }
  function preloadDrums() { for (var k in DRUMNOTE) loadDrumSample(DRUMNOTE[k]); }
  function drumSample(pc, time) {
    var m = DRUMNOTE[pc]; if (m == null) return false; var buf = PERC.buf[m];
    if (!buf) { loadDrumSample(m); return false; }
    try {
      var src = AC.createBufferSource(); src.buffer = buf;
      var g = AC.createGain(); g.gain.value = DRUMGAIN[pc] || 0.6; src.connect(g); g.connect(out());
      sendVerb(g, pc === 'K' ? SEND.kick : (pc === 'H' ? SEND.hat : SEND.snare));
      src.start(time);
    } catch (e) { return false; } return true;
  }

  /* ───────── 합성 드럼 폴백 (노트북 스피커에서도 들리게 보강) ───────── */
  function synKick(t) {
    var o = AC.createOscillator(), g = AC.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.11);
    o.connect(g); g.connect(out()); sendVerb(g, SEND.kick);
    g.gain.setValueAtTime(0.36, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); o.start(t); o.stop(t + 0.17);
    var c = AC.createOscillator(), cg = AC.createGain(); c.type = 'triangle';
    c.frequency.setValueAtTime(420, t); c.frequency.exponentialRampToValueAtTime(120, t + 0.03);
    c.connect(cg); cg.connect(out()); cg.gain.setValueAtTime(0.12, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05); c.start(t); c.stop(t + 0.06);
  }
  function synSnare(t) {
    try {
      var s = AC.createBufferSource(); s.buffer = noiseBuf(0.11, 1.6);
      var hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
      var g = AC.createGain(); g.gain.setValueAtTime(0.26, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      s.connect(hp); hp.connect(g); g.connect(out()); sendVerb(g, SEND.snare); s.start(t);
    } catch (e) {}
    var o = AC.createOscillator(), og = AC.createGain(); o.type = 'triangle'; o.frequency.value = 200;
    og.gain.setValueAtTime(0.1, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(og); og.connect(out()); o.start(t); o.stop(t + 0.11);
  }
  function synHat(t, open) {
    try {
      var s = AC.createBufferSource(); s.buffer = noiseBuf(open ? 0.2 : 0.03, open ? 0.5 : 1.2);
      var hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = open ? 6500 : 7800;
      var g = AC.createGain(); g.gain.setValueAtTime(open ? 0.08 : 0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.2 : 0.04));
      s.connect(hp); hp.connect(g); g.connect(out()); sendVerb(g, SEND.hat); s.start(t);
    } catch (e) {}
  }
  function playDrum(pc, t) {
    if (drumSample(pc, t)) return;              // 실제 샘플 우선
    if (pc === 'K') synKick(t); else if (pc === 'S') synSnare(t);
    else if (pc === 'H') synHat(t, false); else if (pc === 'O') synHat(t, true);
    else if (pc === 'C') { synHat(t, true); }
  }

  /* ───────── 멜로디/베이스 (샘플 우선 + 오실레이터 폴백) ───────── */
  var PIANOWAVE = null;
  function pianoWave() {
    if (PIANOWAVE) return PIANOWAVE;
    var n = 14, real = new Float32Array(n), imag = new Float32Array(n);
    var amp = [0, 1, 0.55, 0.40, 0.26, 0.17, 0.12, 0.085, 0.06, 0.045, 0.033, 0.024, 0.017, 0.012];
    for (var i = 1; i < n; i++) imag[i] = amp[i];
    try { PIANOWAVE = AC.createPeriodicWave(real, imag, { disableNormalization: false }); } catch (e) { PIANOWAVE = null; }
    return PIANOWAVE;
  }
  function noteVoice(freq, t, dur) {
    if (samplePlay(freq, t, Math.max(0.2, dur * 0.98), 0.44, SEND.note)) return;
    var d = Math.max(0.18, dur * 0.95);
    var o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
    var w = pianoWave(); if (w) o.setPeriodicWave(w); else o.type = 'triangle'; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = Math.min(8500, freq * 7 + 1400); f.Q.value = 0.2;
    o.connect(f); f.connect(g); g.connect(out()); sendVerb(g, SEND.note);
    var pk = 0.15, tail = Math.min(d, 1.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pk, t + 0.006);
    g.gain.exponentialRampToValueAtTime(pk * 0.32, t + tail);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
    o.start(t); o.stop(t + d + 0.22);
  }
  function bassVoice(freq, t, dur) {
    if (samplePlay(freq, t, Math.max(0.2, dur * 0.95), 0.4, SEND.bass)) return;
    while (freq > 175) freq /= 2; while (freq < 55) freq *= 2;
    var d = Math.max(0.12, dur * 0.92);
    var o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = freq; o2.frequency.value = freq / 2;
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.5;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(out()); sendVerb(g, SEND.bass);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.09, t + Math.max(0.05, d - 0.1)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.start(t); o2.start(t); o.stop(t + d + 0.03); o2.stop(t + d + 0.03);
  }

  /* ══════════════════════════════════════════════════════════════════════
     리얼 권총 발사음 — 레이어드 합성 (절대 단순 비프 아님)
       (1) 트랜지언트 클릭  — 하이패스 노이즈 임펄스 ~3ms
       (2) 메인 크랙        — 밴드/하이패스 화이트노이즈 버스트 ~55ms, 빠른 지수감쇠
       (3) 바디 펀치        — 저음 사인/삼각 ~150→60Hz, ~70ms
       (4) 테일             — 로우패스 노이즈 + 리버브 send, ~200ms 공간 울림
       (5) 기계식 슬라이드 틱 — 금속성 짧은 틱
     매 발사마다 피치/레벨/필터 수 % 랜덤. hand로 좌우 패닝.
     ════════════════════════════════════════════════════════════════════ */
  function _shot(t, hand) {
    try {
      var p = panner(hand); p.connect(out());
      var lv = rnd(0.9, 1.05);                        // 전체 레벨 변주

      /* (1) 트랜지언트 클릭 ~3ms */
      var cs = AC.createBufferSource(); cs.buffer = noiseBuf(rnd(0.002, 0.004), 0.3);
      var chp = AC.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = rnd(2600, 3600);
      var cg = AC.createGain(); cg.gain.setValueAtTime(0.42 * lv, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
      cs.connect(chp); chp.connect(cg); cg.connect(p); sendVerb(cg, 0.08); cs.start(t);

      /* (2) 메인 크랙 ~55ms */
      var dur2 = rnd(0.045, 0.075);
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(dur2, 2.4);
      var hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = rnd(900, 1300);
      var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(1900, 2600); bp.Q.value = rnd(0.6, 1.0);
      var ng = AC.createGain();
      ng.gain.setValueAtTime(0.48 * lv, t); ng.gain.exponentialRampToValueAtTime(0.001, t + dur2 + 0.01);
      ns.connect(hp); hp.connect(bp); bp.connect(ng); ng.connect(p); sendVerb(ng, SEND.shot); ns.start(t);

      /* (3) 바디 펀치 ~70ms */
      var f0 = rnd(140, 170), d3 = rnd(0.06, 0.085);
      var ob = AC.createOscillator(), obg = AC.createGain(); ob.type = 'triangle';
      ob.frequency.setValueAtTime(f0, t); ob.frequency.exponentialRampToValueAtTime(rnd(55, 68), t + d3);
      obg.gain.setValueAtTime(0.34 * lv, t); obg.gain.exponentialRampToValueAtTime(0.001, t + d3 + 0.01);
      ob.connect(obg); obg.connect(p); sendVerb(obg, 0.06); ob.start(t); ob.stop(t + d3 + 0.03);
      /* 서브 사인(펀치감 보강) */
      var sb = AC.createOscillator(), sbg = AC.createGain(); sb.type = 'sine';
      sb.frequency.setValueAtTime(f0 * 0.55, t); sb.frequency.exponentialRampToValueAtTime(42, t + d3);
      sbg.gain.setValueAtTime(0.2 * lv, t); sbg.gain.exponentialRampToValueAtTime(0.001, t + d3);
      sb.connect(sbg); sbg.connect(p); sb.start(t); sb.stop(t + d3 + 0.02);

      /* (4) 테일 ~200ms (로우패스 노이즈 + 공간 울림) */
      var d4 = rnd(0.16, 0.24);
      var ts = AC.createBufferSource(); ts.buffer = noiseBuf(d4, 1.4);
      var lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(rnd(2200, 2800), t);
      lp.frequency.exponentialRampToValueAtTime(rnd(500, 750), t + d4);
      var tg = AC.createGain(); tg.gain.setValueAtTime(0.16 * lv, t + 0.01); tg.gain.exponentialRampToValueAtTime(0.001, t + d4);
      ts.connect(lp); lp.connect(tg); tg.connect(p); sendVerb(tg, SEND.shot); ts.start(t);

      /* (5) 기계식 슬라이드 틱 (살짝) */
      var tk = AC.createOscillator(), tkg = AC.createGain(); tk.type = 'square';
      var tkt = t + rnd(0.004, 0.012);
      tk.frequency.setValueAtTime(rnd(3200, 4200), tkt);
      tkg.gain.setValueAtTime(0.05 * lv, tkt); tkg.gain.exponentialRampToValueAtTime(0.0008, tkt + 0.012);
      tk.connect(tkg); tkg.connect(p); tk.start(tkt); tk.stop(tkt + 0.02);
    } catch (e) {}
  }

  /* 빈 탭 / 피드백용 더 약한 클릭 */
  function _dryFire(t) {
    try {
      var p = panner('r'); p.connect(out());
      var cs = AC.createBufferSource(); cs.buffer = noiseBuf(0.004, 0.5);
      var hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
      var g = AC.createGain(); g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      cs.connect(hp); hp.connect(g); g.connect(p); cs.start(t);
      var tk = AC.createOscillator(), tkg = AC.createGain(); tk.type = 'square'; tk.frequency.setValueAtTime(2600, t + 0.006);
      tkg.gain.setValueAtTime(0.04, t + 0.006); tkg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      tk.connect(tkg); tkg.connect(p); tk.start(t + 0.006); tk.stop(t + 0.03);
    } catch (e) {}
  }

  /* "으악" 비명 — 성대(사와투스)+포먼트 밴드패스(모음 '아')+비브라토+약한 디스토션.
     실제 사람 목소리 샘플이 아니라 합성 비명(stylized). strong=더 높고 세게.
     피치 컨투어: '으'(낮게) → '아'(높이 치솟음) → 꺾여 내려감 */
  function _scream(t, strong) {
    try {
      var dur = strong ? 0.5 : 0.42;
      var p0 = strong ? 300 : 260, p1 = strong ? 860 : 700, p2 = strong ? 340 : 280;
      var src = AC.createOscillator(); src.type = 'sawtooth';
      src.frequency.setValueAtTime(p0, t);
      src.frequency.exponentialRampToValueAtTime(p1, t + 0.09);     // 치솟는 비명
      src.frequency.setValueAtTime(p1, t + 0.16);
      src.frequency.exponentialRampToValueAtTime(p2, t + dur);      // 꺾여 내려감
      /* 비브라토(떨림) */
      var lfo = AC.createOscillator(), lg = AC.createGain(); lfo.type = 'sine';
      lfo.frequency.setValueAtTime(14, t); lfo.frequency.linearRampToValueAtTime(22, t + dur); lg.gain.value = strong ? 34 : 26;
      lfo.connect(lg); lg.connect(src.frequency); lfo.start(t); lfo.stop(t + dur + 0.02);
      /* 모음 '아' 포먼트(병렬 밴드패스 3개) */
      var mix = AC.createGain(); mix.gain.value = 1;
      var formants = [[820, 1.0, 9], [1200, 0.65, 10], [2650, 0.33, 12]];
      for (var i = 0; i < formants.length; i++) {
        var bp = AC.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = formants[i][0]; bp.Q.value = formants[i][2];
        var fg = AC.createGain(); fg.gain.value = formants[i][1];
        src.connect(bp); bp.connect(fg); fg.connect(mix);
      }
      /* 숨소리(브레스 노이즈) 살짝 */
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(dur, 0.5);
      var nf = AC.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1600; nf.Q.value = 0.7;
      var ngg = AC.createGain(); ngg.gain.value = 0.07; ns.connect(nf); nf.connect(ngg); ngg.connect(mix);
      /* 거친 질감(약한 디스토션) */
      var ws = AC.createWaveShaper(); ws.curve = screamCurve(); ws.oversample = '2x'; mix.connect(ws);
      var g = AC.createGain(); ws.connect(g); g.connect(out()); sendVerb(g, SEND.hit);
      var pk = strong ? 0.5 : 0.42;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(pk, t + 0.03);           // '으' 빠른 어택
      g.gain.setValueAtTime(pk, t + 0.14);                          // '아' 유지
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);        // 꼬리
      src.start(t); src.stop(t + dur + 0.03); ns.start(t);
    } catch (e) {}
  }
  /* 적 처치 확인음: 짧은 임팩트 틱 + "으악" 비명. onBeat면 더 세고 높게 */
  function _hit(t, onBeat) {
    try {
      /* 임팩트(짧은 노이즈 틱) */
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(0.045, 2.2);
      var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 0.9;
      var ng = AC.createGain(); ng.gain.setValueAtTime(0.16, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      ns.connect(bp); bp.connect(ng); ng.connect(out()); sendVerb(ng, SEND.hit); ns.start(t);
      /* "으악" 비명 */
      _scream(t + 0.004, !!onBeat);
    } catch (e) {}
  }

  /* 플레이어 피격: 둔탁한 저역 thud + 디튠 (reached/피격 공용) */
  function _playerHurt(t) {
    try {
      var o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
      o.type = 'sine'; o2.type = 'triangle';
      o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.2);
      o2.frequency.setValueAtTime(101, t); o2.frequency.exponentialRampToValueAtTime(47, t + 0.2);   // 살짝 디튠
      f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 0.6;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(out()); sendVerb(g, SEND.hurt);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.start(t); o2.start(t); o.stop(t + 0.3); o2.stop(t + 0.3);
      /* 둔탁한 노이즈 바디 */
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf(0.12, 1.8);
      var lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      var ng = AC.createGain(); ng.gain.setValueAtTime(0.18, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      ns.connect(lp); lp.connect(ng); ng.connect(out()); sendVerb(ng, SEND.hurt); ns.start(t);
    } catch (e) {}
  }

  /* 재장전 랙 소리(간단): 금속 틱 두 번 + 슬라이드 */
  function _reload(t) {
    try {
      var p = panner('r'); p.connect(out());
      [0, 0.1].forEach(function (off, idx) {
        var tt = t + off;
        var ns = AC.createBufferSource(); ns.buffer = noiseBuf(0.03, 1.5);
        var hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        var g = AC.createGain(); g.gain.setValueAtTime(0.14, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.035);
        ns.connect(hp); hp.connect(g); g.connect(p); ns.start(tt);
        var mk = AC.createOscillator(), mg = AC.createGain(); mk.type = 'square'; mk.frequency.setValueAtTime(idx ? 520 : 360, tt);
        mg.gain.setValueAtTime(0.06, tt); mg.gain.exponentialRampToValueAtTime(0.001, tt + 0.03);
        mk.connect(mg); mg.connect(p); mk.start(tt); mk.stop(tt + 0.04);
      });
      /* 슬라이드 스윕 */
      var ss = AC.createBufferSource(); ss.buffer = noiseBuf(0.08, 1.0);
      var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(900, t + 0.04);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.11); bp.Q.value = 1.2;
      var sg = AC.createGain(); sg.gain.setValueAtTime(0.08, t + 0.04); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      ss.connect(bp); bp.connect(sg); sg.connect(p); ss.start(t + 0.04);
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════
     음악 리듬 베드 — 120BPM, 16스텝 루프, A단조 펜타토닉(어둡고 그루비)
     킥(0,4,8,12) 스네어(4,12) 하이햇(8분) 오픈햇(14) + 베이스 + 멜로디 모티프
     ════════════════════════════════════════════════════════════════════ */
  /* 각 16스텝: 1=울림 */
  var PAT_K = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
  var PAT_S = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
  var PAT_H = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];   // 8분(홀/오프)
  var PAT_O = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0];   // 오픈햇 step14
  /* 베이스(A단조 펜타토닉, 저역) — 구동감 있는 리프. 0=쉼 */
  var A2=110, C3=130.81, D3=146.83, E3=164.81, G3=196.00;
  var PAT_B = [A2,0,0,A2, 0,0,C3,0, E3,0,0,A2, 0,G3,0,0];
  /* 멜로디 모티프(A단조 펜타토닉: A C D E G) — 어둡고 또렷하게 */
  var A3=220, C4=261.63, D4=293.66, E4=329.63, G4=392.00;
  var PAT_M = [A3,0,C4,0, E4,0,D4,0, C4,0,A3,0, G3*2,0,A3,0]; // G3*2=G4 근사(392)

  var BPM = 120, sixteenthSec = (60 / 120) / 4;
  var nextT = 0, stepClock = 0, schT = null, playing = false, beatAnchor = 0;

  function stepAudio(step, t) {
    if (PAT_K[step]) playDrum('K', t);
    if (PAT_S[step]) playDrum('S', t);
    if (PAT_H[step]) playDrum('H', t);
    if (PAT_O[step]) playDrum('O', t);
    var bf = PAT_B[step]; if (bf) bassVoice(bf, t, sixteenthSec * 2);
    var mf = PAT_M[step]; if (mf) noteVoice(mf, t, sixteenthSec * 2);
  }
  function fireBeatCallback(step, t) {
    var cb = global.GUNAUDIO && global.GUNAUDIO.onBeat;
    if (typeof cb !== 'function') return;
    var totalBeats = Math.round((t - beatAnchor) / (60 / BPM));
    var info = { step: step, bar: Math.floor(totalBeats / 4), downbeat: (step === 0) };
    var delay = Math.max(0, (t - AC.currentTime) * 1000);
    setTimeout(function () { try { cb(info); } catch (e) {} }, delay);
  }
  function scheduler() {
    if (!AC || OFFLINE || !playing) return;
    var now = AC.currentTime;
    while (nextT < now + 0.10) {                 // 0.1s 선행
      var step = stepClock % 16;
      stepAudio(step, nextT);
      if (step % 4 === 0) fireBeatCallback(step, nextT);
      nextT += sixteenthSec; stepClock++;
    }
    schT = setTimeout(scheduler, 25);            // 25ms 룩어헤드
  }
  function startMusic(bpm) {
    ensure();
    if (!AC) return;
    BPM = bpm || 120; sixteenthSec = (60 / BPM) / 4;
    var melFreqs = PAT_M.concat(PAT_B).filter(function (f) { return f > 0; });
    preloadSamples(melFreqs); preloadDrums();
    stepClock = 0; playing = true;
    nextT = AC.currentTime + 0.1; beatAnchor = nextT;
    clearTimeout(schT); scheduler();
  }
  function stopMusic() { playing = false; clearTimeout(schT); schT = null; }

  function beatInfo() {
    var beatSec = 60 / BPM, beatMs = beatSec * 1000;
    if (!AC || !playing) return { sinceBeatMs: 0, beatMs: beatMs, onBeat: false };
    var el = AC.currentTime - beatAnchor;
    if (el < 0) return { sinceBeatMs: 0, beatMs: beatMs, onBeat: false };
    var sinceBeatMs = (el - Math.floor(el / beatSec) * beatSec) * 1000;
    var ob = (sinceBeatMs <= 130) || ((beatMs - sinceBeatMs) <= 130);
    return { sinceBeatMs: sinceBeatMs, beatMs: beatMs, onBeat: ob };
  }

  /* ───────── 컨텍스트 수명 ───────── */
  function ensure() {
    try {
      if (!AC) { AC = new (global.AudioContext || global.webkitAudioContext)(); buildMaster(); }
      if (AC.state === 'suspended' && AC.resume) AC.resume();
    } catch (e) {}
    return AC;
  }

  /* ══════════════════════════════════════════════════════════════════════
     오프라인 렌더 검증 (폴백 경로) — 헤드리스에서 실제 PCM 분석
     ════════════════════════════════════════════════════════════════════ */
  function renderOfflineTest(seconds) {
    seconds = seconds || 4;
    var sr = 44100;
    return new Promise(function (resolve, reject) {
      var OfflineCtor = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!OfflineCtor) { reject(new Error('no OfflineAudioContext')); return; }
      var oac = new OfflineCtor(2, Math.ceil(sr * seconds), sr);
      /* 상태 스왑 */
      var sAC = AC, sM = MASTER, sMG = MASTERGAIN, sLM = LIMITER, sR = REVERB, sO = OFFLINE, sBPM = BPM, sSix = sixteenthSec, sPW = PIANOWAVE;
      AC = oac; OFFLINE = true; MASTER = null; REVERB = null; PIANOWAVE = null;
      buildMaster();
      BPM = 120; sixteenthSec = (60 / 120) / 4;
      /* 음악: 전 구간 스텝 예약 */
      var t = 0.08, step = 0, end = seconds - 0.05;
      while (t < end) { stepAudio(step % 16, t); t += sixteenthSec; step++; }
      /* 총성 몇 발(연사 포함) */
      var shots = [0.30, 0.70, 1.02, 1.90, 2.38, 2.40, 3.10, 3.55];
      for (var i = 0; i < shots.length; i++) if (shots[i] < end) _shot(shots[i], i % 2 ? 'l' : 'r');
      /* 처치음/피격 */
      _hit(1.5, false); _hit(2.9, true); _playerHurt(3.3);

      oac.startRendering().then(function (buf) {
        AC = sAC; MASTER = sM; MASTERGAIN = sMG; LIMITER = sLM; REVERB = sR; OFFLINE = sO; BPM = sBPM; sixteenthSec = sSix; PIANOWAVE = sPW;
        var L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
        var n = L.length, peak = 0, sum = 0, pcm = new Array(n);
        for (var j = 0; j < n; j++) {
          var m = (L[j] + R[j]) * 0.5; pcm[j] = m;
          var al = Math.abs(L[j]); if (al > peak) peak = al;
          var ar = Math.abs(R[j]); if (ar > peak) peak = ar;
          sum += m * m;
        }
        var rms = Math.sqrt(sum / n);
        /* 온셋: 10ms 윈도 RMS 엔벨로프의 상승 에지 */
        var win = Math.floor(sr * 0.01), prev = 0, onsets = 0, refractory = 0;
        for (var w = 0; w + win <= n; w += win) {
          var e = 0; for (var k = 0; k < win; k++) { var v = pcm[w + k]; e += v * v; }
          e = Math.sqrt(e / win);
          if (refractory > 0) refractory--;
          if (e > 0.02 && e > prev * 1.8 && refractory === 0) { onsets++; refractory = 3; }
          prev = e;
        }
        resolve({ sr: sr, pcm: pcm, peak: peak, rms: rms, clipped: peak >= 1.0, onsets: onsets });
      }).catch(function (err) {
        AC = sAC; MASTER = sM; MASTERGAIN = sMG; LIMITER = sLM; REVERB = sR; OFFLINE = sO; BPM = sBPM; sixteenthSec = sSix; PIANOWAVE = sPW;
        reject(err);
      });
    });
  }

  /* 단일 총성만 오프라인 렌더(스펙트럴 "비프 아님" 검증용) */
  function renderShotOffline(seconds) {
    seconds = seconds || 0.35;
    var sr = 44100;
    return new Promise(function (resolve, reject) {
      var OfflineCtor = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!OfflineCtor) { reject(new Error('no OfflineAudioContext')); return; }
      var oac = new OfflineCtor(1, Math.ceil(sr * seconds), sr);
      var sAC = AC, sM = MASTER, sMG = MASTERGAIN, sLM = LIMITER, sR = REVERB, sO = OFFLINE;
      AC = oac; OFFLINE = true; MASTER = null; REVERB = null; buildMaster();
      _shot(0.01, 'r');
      oac.startRendering().then(function (buf) {
        AC = sAC; MASTER = sM; MASTERGAIN = sMG; LIMITER = sLM; REVERB = sR; OFFLINE = sO;
        resolve({ sr: sr, pcm: Array.prototype.slice.call(buf.getChannelData(0)) });
      }).catch(function (err) { AC = sAC; MASTER = sM; MASTERGAIN = sMG; REVERB = sR; OFFLINE = sO; reject(err); });
    });
  }

  /* ───────── 공개 API ───────── */
  global.GUNAUDIO = {
    ensure: ensure,
    shot: function (hand) { ensure(); if (AC) _shot(AC.currentTime + 0.001, hand === 'l' ? 'l' : 'r'); },
    dryFire: function () { ensure(); if (AC) _dryFire(AC.currentTime + 0.001); },
    hit: function (onBeat) { ensure(); if (AC) _hit(AC.currentTime + 0.001, !!onBeat); },
    playerHurt: function () { ensure(); if (AC) _playerHurt(AC.currentTime + 0.001); },
    reload: function () { ensure(); if (AC) _reload(AC.currentTime + 0.001); },
    music: { start: function (bpm) { startMusic(bpm); }, stop: function () { stopMusic(); } },
    onBeat: null,
    beatInfo: beatInfo,
    renderOfflineTest: renderOfflineTest,
    renderShotOffline: renderShotOffline
  };

})(typeof window !== 'undefined' ? window : this);
