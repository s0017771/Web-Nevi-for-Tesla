/*! ==========================================================================
 *  powers-viz.js — 초능력 체험(염력) "에너지/힘" 비주얼 전담 모듈
 *  vr-powers.html (A-Frame 1.6.0 WebXR) 그래픽 전담.
 *
 *  전부 Canvas 2D 로 그린 '오리지널 아트' 텍스처(PNG data URL, 투명 배경).
 *  3D 모델/외부 자산/저작권 자산 없음. additive(발광) 블렌딩용으로 검은-투명
 *  바탕에 사이킥 에너지(바이올렛/시안/플라즈마)를 그려 2D 평면(billboard)만으로
 *  염력 '힘'을 반실사처럼 연출한다.
 *
 *  전역: window.POWERSVIZ = {
 *    VERSION,
 *    // ── 텍스처 (각 {src,w,h} 반환, 내부 캐시) ──
 *    handAura(variant), fieldTexture(), chargeTexture(level0to2),
 *    burstTexture(), dustTexture(variant), strandTexture(),
 *    skyTexture(), floorTexture(), coreTexture(),
 *    // ── 캐시/프리로드 ──
 *    preload(), clearCache(),
 *    // ── A-Frame 이펙트 헬퍼 (headless-safe; AFRAME/THREE 없으면 no-op) ──
 *    makeSprite(tex, size, opts)->el, spawnBurst(scene,pos,opts),
 *    spawnDust(scene,pos,strength), makeFieldHalo(size)->el,
 *    makeAura(size)->el, updateLink(planeEl, a, b, color),
 *    // ── 헤드리스 검증 ──
 *    selfTest()
 *  }
 *
 *  통합 요약(상세 스니펫은 파일 하단 주석):
 *   0) <head>:  <script src="vr-powers-viz.js"></script>  → 시작 시 POWERSVIZ.preload()
 *   1) 손: 오른손/카메라 앞에 makeAura() 평면을 자식으로 붙여 염력 오라.
 *   2) 끌기/잡기: 든 물건에 makeFieldHalo() 자식 부착(염력 필드).
 *   3) 조준 하이라이트: coreTexture 스프라이트를 겨냥 사물에 잠깐.
 *   4) 차징: 든 물건 halo 를 chargeTexture(level) 로 교체(강도 상승).
 *   5) 던지기: spawnBurst(손 앞) 충격파.
 *   6) 바닥 충돌: spawnDust(사물 위치) 먼지.
 *   7) 손↔물건 빔: a-plane + strandTexture, updateLink 로 매 프레임 연결.
 *   8) 분위기: a-sky=skyTexture, 바닥=floorTexture(repeat).
 * ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ───────────── 공통 유틸 ───────────── */
  function mkCanvas(w, h) {
    var c;
    if (typeof document !== 'undefined' && document.createElement) c = document.createElement('canvas');
    else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
    else throw new Error('POWERSVIZ: no canvas available');
    c.width = w; c.height = h; return c;
  }
  function out(canvas, w, h) { return { src: canvas.toDataURL('image/png'), w: w, h: h }; }
  function rng(seed) { var s = (seed * 2654435761) >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function rgba(c, a) { if (typeof c === 'string') return 'rgba(' + c + ',' + a + ')';
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  // 부드러운 방사 글로우
  function glow(ctx, x, y, r, color, inner) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, inner == null ? 1 : inner));
    g.addColorStop(0.45, rgba(color, (inner == null ? 1 : inner) * 0.3));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // 미세 그레인(반실사 질감)
  function grain(ctx, w, h, amount, alpha) {
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (var i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) continue;
      var n = (Math.random() - 0.5) * amount; d[i] = clamp255(d[i] + n); d[i + 1] = clamp255(d[i + 1] + n); d[i + 2] = clamp255(d[i + 2] + n); }
    ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.putImageData(img, 0, 0); ctx.globalAlpha = 1;
  }

  /* ───────────── 사이킥 팔레트 ───────────── */
  var PAL = {
    violet:  [150, 90, 255],
    amethyst:[186, 120, 255],
    cyan:    [90, 200, 255],
    plasma:  [230, 120, 255],
    white:   [238, 236, 255],
    deep:    [12, 10, 28],
    dust:    [150, 142, 124],
    dustDk:  [92, 84, 70]
  };

  /* ───────────── 텍스처 드로잉 ───────────── */

  // 손바닥 에너지 오라 — 맥동 코어 + 링 + 방사 필라멘트 + 스파크
  function handAura(variant) {
    var W = 256, H = 256, c = mkCanvas(W, H), ctx = c.getContext('2d');
    var cx = W / 2, cy = H / 2, R = rng(variant + 7);
    glow(ctx, cx, cy, 120, PAL.violet, 0.55);          // 넓은 바탕 오라
    glow(ctx, cx, cy, 54, PAL.amethyst, 0.9);          // 코어
    // 발광 링
    ctx.save(); ctx.strokeStyle = rgba(PAL.cyan, 0.85); ctx.lineWidth = 3;
    ctx.shadowColor = rgba(PAL.cyan, 1); ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(cx, cy, 72, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    // 방사 필라멘트
    var spokes = 10;
    for (var i = 0; i < spokes; i++) {
      var a = (i / spokes) * Math.PI * 2 + R() * 0.4;
      var r0 = 46, r1 = 86 + R() * 26;
      ctx.save(); ctx.strokeStyle = rgba(PAL.amethyst, 0.5 + R() * 0.3);
      ctx.lineWidth = 1.5 + R() * 1.5; ctx.shadowColor = rgba(PAL.violet, 1); ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke(); ctx.restore();
    }
    // 스파크
    for (var s = 0; s < 14; s++) {
      var sa = R() * Math.PI * 2, sr = 40 + R() * 80;
      glow(ctx, cx + Math.cos(sa) * sr, cy + Math.sin(sa) * sr, 5 + R() * 6, PAL.white, 0.9);
    }
    glow(ctx, cx, cy, 20, PAL.white, 1);               // 핫 코어
    return out(c, W, H);
  }

  // 염력 필드 — 든 물건을 감싸는 맥동 링/스월(중앙은 비워 사물이 보이게)
  function fieldTexture() {
    var W = 256, H = 256, c = mkCanvas(W, H), ctx = c.getContext('2d');
    var cx = W / 2, cy = H / 2, R = rng(31);
    // 중앙 투명, 중간 반경에 에너지 띠
    var g = ctx.createRadialGradient(cx, cy, 34, cx, cy, 120);
    g.addColorStop(0, rgba(PAL.violet, 0));
    g.addColorStop(0.42, rgba(PAL.violet, 0.42));
    g.addColorStop(0.62, rgba(PAL.cyan, 0.30));
    g.addColorStop(1, rgba(PAL.violet, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 120, 0, Math.PI * 2); ctx.fill();
    // 스월 아크
    for (var i = 0; i < 5; i++) {
      var rr = 58 + i * 11, a0 = R() * Math.PI * 2, sweep = 1.0 + R() * 1.6;
      ctx.save(); ctx.strokeStyle = rgba(i % 2 ? PAL.cyan : PAL.amethyst, 0.5);
      ctx.lineWidth = 2 + R() * 2; ctx.shadowColor = rgba(PAL.violet, 1); ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + sweep); ctx.stroke(); ctx.restore();
    }
    // 궤도 스파크
    for (var s = 0; s < 10; s++) { var sa = R() * Math.PI * 2, sr = 56 + R() * 56;
      glow(ctx, cx + Math.cos(sa) * sr, cy + Math.sin(sa) * sr, 4 + R() * 5, PAL.white, 0.85); }
    return out(c, W, H);
  }

  // 차징 축적 — level 0~2(저/중/고). 안쪽으로 모이는 스트릭 + 조여드는 밝은 링 + 핫코어
  function chargeTexture(level) {
    level = Math.max(0, Math.min(2, level | 0));
    var W = 256, H = 256, c = mkCanvas(W, H), ctx = c.getContext('2d');
    var cx = W / 2, cy = H / 2, R = rng(level + 3);
    var intensity = 0.4 + level * 0.3;                 // 0.4/0.7/1.0
    var ringR = 96 - level * 24;                        // 조여듦
    glow(ctx, cx, cy, 120, PAL.violet, 0.3 + level * 0.18);
    // 수렴 스트릭(바깥→안쪽)
    var n = 12 + level * 8;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + R() * 0.3;
      var rOut = ringR + 24 + R() * 20, rIn = ringR - 6;
      ctx.save(); ctx.strokeStyle = rgba(PAL.cyan, intensity * (0.5 + R() * 0.4));
      ctx.lineWidth = 1.5 + level * 0.8; ctx.shadowColor = rgba(PAL.cyan, 1); ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
      ctx.lineTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn); ctx.stroke(); ctx.restore();
    }
    // 조여드는 링
    ctx.save(); ctx.strokeStyle = rgba(PAL.amethyst, intensity); ctx.lineWidth = 2 + level * 1.5;
    ctx.shadowColor = rgba(PAL.violet, 1); ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    // 핫 코어(레벨 비례)
    glow(ctx, cx, cy, 26 + level * 16, PAL.white, 0.6 + level * 0.2);
    return out(c, W, H);
  }

  // 던지기 발산 — 핫코어 + 날카로운 충격파 링 + 방사 스파이크
  function burstTexture() {
    var W = 256, H = 256, c = mkCanvas(W, H), ctx = c.getContext('2d');
    var cx = W / 2, cy = H / 2, R = rng(91);
    glow(ctx, cx, cy, 70, PAL.white, 0.95);            // 코어 플래시
    glow(ctx, cx, cy, 120, PAL.violet, 0.5);
    // 날카로운 링
    ctx.save(); ctx.strokeStyle = rgba(PAL.cyan, 0.95); ctx.lineWidth = 4;
    ctx.shadowColor = rgba(PAL.cyan, 1); ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(cx, cy, 86, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    // 방사 스파이크
    var spikes = 14;
    for (var i = 0; i < spikes; i++) {
      var a = (i / spikes) * Math.PI * 2 + R() * 0.2, r0 = 70, r1 = 118 + R() * 14, wdt = 0.05;
      ctx.save(); ctx.fillStyle = rgba(PAL.amethyst, 0.7); ctx.shadowColor = rgba(PAL.violet, 1); ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - wdt) * r0, cy + Math.sin(a - wdt) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a + wdt) * r0, cy + Math.sin(a + wdt) * r0);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    return out(c, W, H);
  }

  // 바닥 충돌 먼지 — 부드러운 흙먼지 덩이 + 파편 알갱이(발광 아님, 일반 블렌딩)
  function dustTexture(variant) {
    var W = 256, H = 256, c = mkCanvas(W, H), ctx = c.getContext('2d');
    var cx = W / 2, cy = H * 0.62, R = rng(variant + 17);
    // 흙먼지 덩이(겹치는 부드러운 원)
    for (var i = 0; i < 9; i++) {
      var ox = cx + (R() - 0.5) * 150, oy = cy - R() * 70, rr = 26 + R() * 44;
      var col = R() < 0.5 ? PAL.dust : PAL.dustDk;
      var g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
      g.addColorStop(0, rgba(col, 0.32 + R() * 0.2)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, rr, 0, Math.PI * 2); ctx.fill();
    }
    // 파편 알갱이
    for (var s = 0; s < 16; s++) {
      var px = cx + (R() - 0.5) * 170, py = cy - R() * 90, sz = 1.5 + R() * 3.5;
      ctx.fillStyle = rgba(PAL.dustDk, 0.55 + R() * 0.3);
      ctx.fillRect(px, py, sz, sz);
    }
    grain(ctx, W, H, 10, 0.5);
    return out(c, W, H);
  }

  // 손↔물건 에너지 가닥(가로로 늘여 평면에 입힘) — 밝은 코어 + 글로우 + 떨리는 실
  function strandTexture() {
    var W = 256, H = 64, c = mkCanvas(W, H), ctx = c.getContext('2d');
    var midY = H / 2, R = rng(55);
    // 글로우 바탕(세로 그라데)
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(PAL.violet, 0)); g.addColorStop(0.5, rgba(PAL.violet, 0.5)); g.addColorStop(1, rgba(PAL.violet, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 밝은 코어 라인
    ctx.save(); ctx.strokeStyle = rgba(PAL.white, 0.95); ctx.lineWidth = 3;
    ctx.shadowColor = rgba(PAL.cyan, 1); ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke(); ctx.restore();
    // 떨리는 실 2가닥
    for (var k = 0; k < 2; k++) {
      ctx.save(); ctx.strokeStyle = rgba(k ? PAL.cyan : PAL.amethyst, 0.6); ctx.lineWidth = 1.5;
      ctx.shadowColor = rgba(PAL.violet, 1); ctx.shadowBlur = 6; ctx.beginPath();
      for (var x = 0; x <= W; x += 8) {
        var y = midY + Math.sin(x * 0.08 + k * 2 + R()) * (6 + k * 4);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    }
    // 끝단 소프트 페이드
    var eg = ctx.createLinearGradient(0, 0, W, 0);
    eg.addColorStop(0, 'rgba(0,0,0,1)'); eg.addColorStop(0.08, 'rgba(0,0,0,0)');
    eg.addColorStop(0.92, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    return out(c, W, H);
  }

  // 조준/하이라이트용 발광 코어(사물 위 오버레이)
  function coreTexture() {
    var W = 128, H = 128, c = mkCanvas(W, H), ctx = c.getContext('2d');
    var cx = W / 2, cy = H / 2;
    glow(ctx, cx, cy, 60, PAL.cyan, 0.55); glow(ctx, cx, cy, 28, PAL.white, 0.9);
    ctx.save(); ctx.strokeStyle = rgba(PAL.cyan, 0.9); ctx.lineWidth = 2;
    ctx.shadowColor = rgba(PAL.cyan, 1); ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(cx, cy, 44, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    return out(c, W, H);
  }

  // 분위기 스카이(세로 그라데 + 별 스펙 + 지평 바이올렛 글로우)
  function skyTexture() {
    var W = 256, H = 256, c = mkCanvas(W, H), ctx = c.getContext('2d'), R = rng(123);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgb(8,7,20)'); g.addColorStop(0.6, 'rgb(14,11,34)'); g.addColorStop(1, 'rgb(26,16,52)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    glow(ctx, W / 2, H, 160, PAL.violet, 0.35);        // 지평선 글로우
    for (var i = 0; i < 70; i++) { var x = R() * W, y = R() * H * 0.7, a = 0.2 + R() * 0.6;
      ctx.fillStyle = rgba(PAL.white, a); ctx.fillRect(x, y, 1, 1); }
    return out(c, W, H);
  }

  // 분위기 바닥 타일(어두운 바탕 + 바이올렛 그리드 글로우 + 비네트, repeat 가능)
  function floorTexture() {
    var W = 256, H = 256, c = mkCanvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(16,15,30)'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.strokeStyle = rgba(PAL.violet, 0.5); ctx.lineWidth = 2;
    ctx.shadowColor = rgba(PAL.cyan, 0.9); ctx.shadowBlur = 8;
    ctx.strokeRect(1, 1, W - 2, H - 2);                 // 타일 경계(이어짐)
    ctx.restore();
    // 중앙 미세 교차
    ctx.strokeStyle = rgba(PAL.cyan, 0.12); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    var vg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    return out(c, W, H);
  }

  /* ───────────── 캐시 + 공개 텍스처 API ───────────── */
  var cache = {};
  function memo(key, fn) { return cache[key] || (cache[key] = fn()); }

  /* ───────────── A-Frame 이펙트 헬퍼 (headless-safe) ───────────── */
  // additive 발광 스프라이트 평면 생성(항상 카메라 향함). AFRAME 없으면 inert 엘리먼트.
  function makeSprite(tex, size, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return null;
    var p = document.createElement('a-plane');
    p.setAttribute('width', size); p.setAttribute('height', size);
    p.setAttribute('material', 'shader:flat; src:' + tex.src + '; transparent:true; alphaTest:0.003; ' +
      'blending:' + (opts.blend || 'additive') + '; opacity:' + (opts.opacity == null ? 1 : opts.opacity) + '; side:double; depthTest:' + (opts.depthTest === false ? 'false' : 'true'));
    if (opts.billboard !== false) p.setAttribute('billboard', '');
    if (opts.class) p.setAttribute('class', opts.class);
    return p;
  }
  function posStr(p) { return (p.x != null) ? (p.x + ' ' + p.y + ' ' + p.z) : p; }
  // 일시적 이펙트(팽창+페이드) 스폰
  function spawnFx(scene, tex, pos, o) {
    if (!scene || typeof document === 'undefined') return null;
    o = o || {};
    var el = makeSprite(tex, o.size || 0.6, { blend: o.blend || 'additive', opacity: 1 });
    if (!el) return null;
    el.setAttribute('position', posStr(pos));
    var from = o.from || 0.4, to = o.to || 2.2, dur = o.dur || 280;
    el.setAttribute('animation__s', 'property:scale; from:' + from + ' ' + from + ' 1; to:' + to + ' ' + to + ' 1; dur:' + dur + '; easing:easeOutCubic');
    el.setAttribute('animation__o', 'property:material.opacity; from:1; to:0; dur:' + (dur + 60) + '; easing:easeInQuad');
    scene.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, dur + 140);
    return el;
  }
  function spawnBurst(scene, pos, opts) { opts = opts || {};
    return spawnFx(scene, POWERSVIZ.burstTexture(), pos, { size: opts.size || 0.7, from: 0.3, to: opts.to || 2.6, dur: 260 }); }
  function spawnDust(scene, pos, strength) { strength = strength == null ? 1 : strength;
    return spawnFx(scene, POWERSVIZ.dustTexture((Math.random() * 2) | 0), pos,
      { size: 0.5 + strength * 0.5, from: 0.5, to: 1.4 + strength * 0.8, dur: 420, blend: 'normal' }); }
  // 손 오라 평면(손 엔티티의 자식으로 append). 맥동 애니메이션 포함.
  function makeAura(size) {
    var el = makeSprite(POWERSVIZ.handAura(0), size || 0.34, { depthTest: false });
    if (el) { el.setAttribute('animation__p', 'property:scale; dir:alternate; loop:true; dur:700; from:0.9 0.9 1; to:1.1 1.1 1; easing:easeInOutSine'); }
    return el;
  }
  // 든 물건 염력 필드 halo(사물의 자식으로 append). 회전+맥동.
  function makeFieldHalo(size) {
    var el = makeSprite(POWERSVIZ.fieldTexture(), size || 0.6, { depthTest: false });
    if (el) { el.setAttribute('animation__r', 'property:rotation; to:0 0 360; loop:true; dur:3400; easing:linear');
      el.setAttribute('animation__p', 'property:scale; dir:alternate; loop:true; dur:620; from:0.92 0.92 1; to:1.08 1.08 1; easing:easeInOutSine'); }
    return el;
  }
  // 두 월드좌표 a,b 사이로 strand 평면을 위치·회전·신축(매 프레임). THREE 필요.
  var _vS, _vE, _vM, _vD, _q, _up;
  function updateLink(planeEl, a, b, color) {
    if (!planeEl || !global.THREE || !planeEl.object3D) return;
    if (!_vS) { _vS = new THREE.Vector3(); _vE = new THREE.Vector3(); _vM = new THREE.Vector3();
      _vD = new THREE.Vector3(); _q = new THREE.Quaternion(); _up = new THREE.Vector3(0, 1, 0); }
    _vS.set(a.x, a.y, a.z); _vE.set(b.x, b.y, b.z);
    _vM.addVectors(_vS, _vE).multiplyScalar(0.5);
    _vD.subVectors(_vE, _vS); var len = _vD.length(); if (len < 1e-4) { planeEl.object3D.visible = false; return; }
    planeEl.object3D.visible = true;
    planeEl.object3D.position.copy(_vM);
    _vD.normalize(); _q.setFromUnitVectors(_up.set(0, 1, 0), _vD);  // 평면 +Y축을 가닥 방향에 맞춤
    planeEl.object3D.quaternion.copy(_q);
    planeEl.object3D.scale.set(1, len, 1);
  }

  var POWERSVIZ = {
    VERSION: VERSION,
    handAura: function (v) { v = v | 0; return memo('aura:' + v, function () { return handAura(v); }); },
    fieldTexture: function () { return memo('field', fieldTexture); },
    chargeTexture: function (l) { l = l | 0; return memo('charge:' + l, function () { return chargeTexture(l); }); },
    burstTexture: function () { return memo('burst', burstTexture); },
    dustTexture: function (v) { v = v | 0; return memo('dust:' + v, function () { return dustTexture(v); }); },
    strandTexture: function () { return memo('strand', strandTexture); },
    coreTexture: function () { return memo('core', coreTexture); },
    skyTexture: function () { return memo('sky', skyTexture); },
    floorTexture: function () { return memo('floor', floorTexture); },
    clearCache: function () { cache = {}; },
    preload: function () {
      this.handAura(0); this.fieldTexture(); this.coreTexture();
      this.chargeTexture(0); this.chargeTexture(1); this.chargeTexture(2);
      this.burstTexture(); this.dustTexture(0); this.dustTexture(1);
      this.strandTexture(); this.skyTexture(); this.floorTexture(); return true;
    },
    makeSprite: makeSprite, spawnBurst: spawnBurst, spawnDust: spawnDust,
    makeAura: makeAura, makeFieldHalo: makeFieldHalo, updateLink: updateLink,
    // 헤드리스 검증: 모든 텍스처 생성 + data URL 유효성
    selfTest: function () {
      var names = [], dims = null, allPng = true, ok = true, err = null;
      try {
        var items = [['handAura', this.handAura(0)], ['field', this.fieldTexture()],
          ['charge0', this.chargeTexture(0)], ['charge1', this.chargeTexture(1)], ['charge2', this.chargeTexture(2)],
          ['burst', this.burstTexture()], ['dust0', this.dustTexture(0)], ['dust1', this.dustTexture(1)],
          ['strand', this.strandTexture()], ['core', this.coreTexture()], ['sky', this.skyTexture()], ['floor', this.floorTexture()]];
        for (var i = 0; i < items.length; i++) { var t = items[i][1]; names.push(items[i][0]);
          if (!t || typeof t.src !== 'string' || t.src.indexOf('data:image/png') !== 0) allPng = false;
          if (!dims) dims = { w: t.w, h: t.h }; }
      } catch (e) { ok = false; err = String(e); }
      return { ok: ok && allPng, names: names, count: names.length, sampleDims: dims, allPng: allPng, error: err, VERSION: VERSION };
    }
  };

  global.POWERSVIZ = POWERSVIZ;
  if (typeof module !== 'undefined' && module.exports) module.exports = POWERSVIZ;

})(typeof window !== 'undefined' ? window : this);

/* ==========================================================================
 *  통합 가이드 (vr-powers.html 에 적용 — 메인 세션에서 배선)
 * --------------------------------------------------------------------------
 *  0) <head> 로드 (vr-common.js 다음, 본문 스크립트 전):
 *       <script src="vr-powers-viz.js"></script>
 *     start() 안에서 1회:  if(window.POWERSVIZ) POWERSVIZ.preload();
 *
 *  1) 분위기(선택): a-sky / 바닥 교체
 *       document.querySelector('a-sky').setAttribute('material','shader:flat; src:'+POWERSVIZ.skyTexture().src);
 *       floorEl.setAttribute('material','shader:flat; src:'+POWERSVIZ.floorTexture().src+'; repeat:8 8');
 *
 *  2) 손 오라: 손 엔티티(#rhand) 또는 카메라 앞 더미에 자식으로
 *       var aura=POWERSVIZ.makeAura(0.34); aura.setAttribute('position','0 0 -0.05'); handEl.appendChild(aura);
 *     (모바일은 카메라 앞 0.3m 더미 엔티티에 부착)
 *
 *  3) 잡기(__onCatch / __pull→held): 든 물건에 필드 halo 부착, 놓을 때 제거
 *       var halo=POWERSVIZ.makeFieldHalo(0.6); halo.setAttribute('data-halo','1'); heldEl.appendChild(halo);
 *       // 해제 시: var h=heldEl.querySelector('[data-halo]'); if(h) h.parentNode.removeChild(h);
 *
 *  4) 조준 하이라이트: 겨냥 사물에 coreTexture 스프라이트를 잠깐(또는 상주 후 제거)
 *       var s=POWERSVIZ.makeSprite(POWERSVIZ.coreTexture(),0.5); aimEl.appendChild(s); // 교체 시 제거
 *
 *  5) 차징(__charge 0..1): halo 를 chargeTexture(level) 스프라이트로 교체/겹침
 *       var lvl = charge<0.34?0 : charge<0.7?1 : 2;
 *       chargeSprite.setAttribute('material','... src:'+POWERSVIZ.chargeTexture(lvl).src+' ...');
 *
 *  6) 던지기(__pushUp): 손 앞 월드좌표에 충격파
 *       POWERSVIZ.spawnBurst(scene, {x:h.p.x+h.d.x*0.5,y:h.p.y+h.d.y*0.5,z:h.p.z+h.d.z*0.5}, {to:2.2+charge*1.5});
 *
 *  7) 바닥 충돌(tkobject free→res.impact>0): 사물 발밑에 먼지
 *       POWERSVIZ.spawnDust(scene, {x:p.x,y:0.02,z:p.z}, Math.min(1,res.impact));
 *
 *  8) 손↔물건 빔: 기존 a-line 대신 strand 평면
 *       빔 평면 1회 생성: var beam=POWERSVIZ.makeSprite(POWERSVIZ.strandTexture(),1,{billboard:false});
 *                        beam.setAttribute('width',0.12); beam.setAttribute('height',1); scene.appendChild(beam);
 *       매 프레임: POWERSVIZ.updateLink(beam, h.p, heldObj.object3D.position);  // 안 들고 있으면 beam.object3D.visible=false
 *
 *  성능: preload() 1회. 매 프레임 텍스처 생성 금지. 캔버스 ≤256px.
 * ========================================================================== */
