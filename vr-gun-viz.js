/*! ==========================================================================
 *  gun-viz.js  —  "2D 반실사(semi-photorealistic)" 스프라이트 생성기
 *  리듬 건(vr-gun.html / A-Frame 1.6.0 WebXR) 그래픽 전담 모듈.
 *
 *  전부 Canvas 2D 로 그린 '오리지널 아트' 텍스처(PNG data URL, 투명 배경).
 *  3D 모델/외부 자산/저작권 자산 없음. 모든 텍스처는 a-plane + billboard
 *  (항상 카메라를 바라봄, vr-common.js 제공)에 입혀 2D 지만 입체·반실사처럼.
 *
 *  전역: window.GUNVIZ = { enemyTexture, enemyHurtTexture, muzzleTexture,
 *                         bulletTexture, burstTexture, skyTexture,
 *                         floorTexture, pileTexture, trimTexture,
 *                         preload, clearCache, VERSION }
 *  각 텍스처 함수는 { src, w, h } 반환 (src = 'data:image/png;base64,...').
 *  결과는 내부 캐시(이름+variant). 게임 시작 시 GUNVIZ.preload() 1회 권장.
 *
 * ---------------------------------------------------------------------------
 *  통합 가이드 (vr-gun.html 적용) — 상세 스니펫은 파일 하단 주석 블록 참고
 * ---------------------------------------------------------------------------
 *  0) <head> 에 로드:  <script src="scratchpad/viz/gun-viz.js"></script>
 *     게임 시작 전 1회:  GUNVIZ.preload();
 *
 *  1) 적(플랫 박스 → 빌보드 평면). spawnEnemy() 안의 geometry/material/innerHTML
 *     부분만 교체. 히트박스/.enemy.clickable/approach 는 그대로 유지:
 *
 *       var e=document.createElement('a-entity');
 *       e.setAttribute('class','enemy clickable');
 *       var tex=GUNVIZ.enemyTexture(Math.floor(Math.random()*3));   // 0~2 변주
 *       e.setAttribute('geometry','primitive: plane; width:0.9; height:1.35');
 *       e.setAttribute('material',
 *         'shader:flat; src:'+tex.src+'; transparent:true; alphaTest:0.5; side:double');
 *       e.setAttribute('billboard','');                             // 항상 카메라 향함
 *       e.setAttribute('position', lane+' 1.0 -18');
 *       e.setAttribute('approach','speed: '+rand(3.8,5.4).toFixed(1));
 *       e.dataset.shooter = Math.random()<0.4 ? '1':'0';
 *       // 레이캐스트 히트박스: 투명 평면은 alphaTest 로 구멍이 뚫리므로,
 *       // 안정적 클릭을 위해 눈에 안 보이는 박스 콜라이더를 자식으로 둔다:
 *       e.innerHTML =
 *         '<a-box class="clickable" width="0.5" height="1.1" depth="0.3" '+
 *         'material="shader:flat; opacity:0; transparent:true" '+
 *         'data-hitbox="1"></a-box>';
 *       field.appendChild(e);
 *     ※ killEnemy 연출: 아래 4) 버스트를 적 위치에 띄우고 평면을 축소/페이드.
 *
 *  2) 총구 섬광(발사 시):  카메라/총구 앞 0.4~0.6m 에 짧게 띄우고 팽창·페이드.
 *       function muzzleFlash(worldPos){
 *         var t=GUNVIZ.muzzleTexture();
 *         var p=document.createElement('a-plane');
 *         p.setAttribute('width',0.5); p.setAttribute('height',0.5);
 *         p.setAttribute('material','shader:flat; src:'+t.src+'; transparent:true; '+
 *           'alphaTest:0.01; blending:additive; opacity:1');  // additive=발광
 *         p.setAttribute('billboard','');
 *         p.setAttribute('position', worldPos);  // 예: 총구 월드좌표
 *         p.setAttribute('animation__s','property:scale; from:0.4 0.4 1; to:1.3 1.3 1; dur:120; easing:easeOutQuad');
 *         p.setAttribute('animation__o','property:material.opacity; from:1; to:0; dur:140; easing:easeInQuad');
 *         field.appendChild(p); setTimeout(function(){p.parentNode&&p.parentNode.removeChild(p);},180);
 *       }
 *
 *  3) 적 탄환(__gunEnemyShoot 의 a-sphere → 발광 빌보드 평면):
 *       var t=GUNVIZ.bulletTexture();
 *       var b=document.createElement('a-plane');
 *       b.setAttribute('class','bullet'); b.setAttribute('width',0.5); b.setAttribute('height',0.5);
 *       b.setAttribute('material','shader:flat; src:'+t.src+'; transparent:true; '+
 *         'alphaTest:0.01; blending:additive');
 *       b.setAttribute('billboard','');
 *       b.setAttribute('position', ep.x+' '+ep.y+' '+ep.z);
 *       b.setAttribute('incoming','dx:..; dy:..; dz:..; speed:5.5');   // 기존 그대로
 *       field.appendChild(b);
 *
 *  4) 처치 버스트(killEnemy):  적 월드좌표에 팽창 링 평면.
 *       function burstAt(worldPos){
 *         var t=GUNVIZ.burstTexture();
 *         var p=document.createElement('a-plane');
 *         p.setAttribute('width',0.6); p.setAttribute('height',0.6);
 *         p.setAttribute('material','shader:flat; src:'+t.src+'; transparent:true; '+
 *           'alphaTest:0.01; blending:additive; opacity:1');
 *         p.setAttribute('billboard',''); p.setAttribute('position', worldPos);
 *         p.setAttribute('animation__s','property:scale; from:0.3 0.3 1; to:2.4 2.4 1; dur:260; easing:easeOutCubic');
 *         p.setAttribute('animation__o','property:material.opacity; from:1; to:0; dur:300; easing:easeInQuad');
 *         field.appendChild(p); setTimeout(function(){p.parentNode&&p.parentNode.removeChild(p);},340);
 *       }
 *
 *  5) 배경/바닥/안개/라이팅:
 *       <a-sky> 교체:
 *         document.querySelector('a-sky').setAttribute('material',
 *           'shader:flat; src:'+GUNVIZ.skyTexture().src);      // 또는 a-sky[src]
 *       바닥 a-plane:
 *         floorEl.setAttribute('material','shader:flat; src:'+GUNVIZ.floorTexture().src+
 *           '; repeat:4 16; transparent:true');                // 타일 반복
 *       a-scene 에 원근 안개/톤:
 *         <a-scene fog="type:exponential; color:#0a0520; density:0.028" ...>
 *       라이팅(저채도 앰비언트 + 네온 포인트):
 *         <a-entity light="type:ambient; color:#241038; intensity:0.6"></a-entity>
 *         <a-entity light="type:point; color:#ff2a6d; intensity:0.8" position="0 3 -6"></a-entity>
 *         <a-entity light="type:point; color:#05d9e8; intensity:0.7" position="0 2 2"></a-entity>
 *       ※ 스프라이트는 shader:flat 라 광원 영향을 안 받음(셰이딩이 텍스처에 구워져 있음) —
 *         안개는 평면에도 적용되어 원근 페이드를 만들어 준다.
 *
 *  6) 성능: 모든 텍스처는 preload() 로 1회 생성·캐시. 매 프레임 생성 금지.
 *     캔버스 ≤512px, 적은 256x384. 퀘스트/모바일 고려해 variant 소수만 사용.
 * ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* --------------------------------------------------------------------- */
  /* 공통 유틸                                                              */
  /* --------------------------------------------------------------------- */

  function mkCanvas(w, h) {
    // 브라우저 캔버스. (OffscreenCanvas 가 있으면 toDataURL 불가 → HTMLCanvas 선호)
    var c;
    if (typeof document !== 'undefined' && document.createElement) {
      c = document.createElement('canvas');
    } else if (typeof OffscreenCanvas !== 'undefined') {
      c = new OffscreenCanvas(w, h);
    } else {
      throw new Error('GUNVIZ: no canvas available');
    }
    c.width = w; c.height = h;
    return c;
  }

  function out(canvas, w, h) {
    return { src: canvas.toDataURL('image/png'), w: w, h: h };
  }

  // 작은 결정적 PRNG (variant 기반 변주)
  function rng(seed) {
    var s = (seed * 2654435761) >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // 미세 노이즈/그레인 오버레이 (반실사 질감)
  function grain(ctx, w, h, amount, alpha) {
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;             // 투명 영역은 건드리지 않음
      var n = (Math.random() - 0.5) * amount;
      d[i]     = clamp255(d[i] + n);
      d[i + 1] = clamp255(d[i + 1] + n);
      d[i + 2] = clamp255(d[i + 2] + n);
    }
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.putImageData(img, 0, 0);
    ctx.globalAlpha = 1;
  }

  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  // 방사형 글로우 스탬프 (additive 느낌의 부드러운 발광)
  function glow(ctx, x, y, r, color, inner) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, inner == null ? 1 : inner));
    g.addColorStop(0.4, rgba(color, 0.35));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // 'r,g,b' 또는 [r,g,b] → rgba 문자열
  function rgba(c, a) {
    if (typeof c === 'string') return 'rgba(' + c + ',' + a + ')';
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // 네온 팔레트 (딥 네이비/마젠타/시안/앰버)
  var PAL = {
    magenta: [255, 42, 109],
    cyan:    [5, 217, 232],
    amber:   [255, 210, 63],
    violet:  [177, 75, 255],
    navy:    [10, 5, 32],
    steel:   [120, 135, 165]
  };

  // 적 variant 색 구성 (2~3종)
  var ENEMY_VARIANTS = [
    { body: [34, 40, 66], edge: PAL.magenta, core: PAL.cyan,  name: 'magenta-droid' },
    { body: [26, 48, 58], edge: PAL.cyan,    core: PAL.amber, name: 'cyan-trooper' },
    { body: [44, 30, 60], edge: PAL.violet,  core: PAL.magenta, name: 'violet-sentinel' }
  ];

  /* --------------------------------------------------------------------- */
  /* 적 실루엣 패스 (반실사 드로이드/병사)                                   */
  /* --------------------------------------------------------------------- */
  // 세로형 캔버스에 중앙 정렬된 휴머노이드 실루엣 path 를 그린다.
  function enemyBodyPath(ctx, w, h, R) {
    var cx = w / 2;
    var headR = w * (0.15 + R() * 0.03);
    var headY = h * 0.17;
    var shoulderY = h * 0.30;
    var shoulderW = w * (0.34 + R() * 0.04);
    var waistY = h * 0.60;
    var waistW = w * 0.18;
    var hipY = h * 0.66;
    var footY = h * 0.95;
    var legW = w * 0.09;

    ctx.beginPath();
    // 머리 (헬멧형)
    ctx.moveTo(cx - headR, headY);
    ctx.quadraticCurveTo(cx - headR, headY - headR * 1.25, cx, headY - headR * 1.3);
    ctx.quadraticCurveTo(cx + headR, headY - headR * 1.25, cx + headR, headY);
    // 목 → 어깨 우
    ctx.quadraticCurveTo(cx + headR * 0.9, shoulderY - h * 0.03, cx + shoulderW, shoulderY);
    // 팔 우측 바깥 라인
    ctx.quadraticCurveTo(cx + shoulderW * 1.12, shoulderY + h * 0.14, cx + shoulderW * 0.78, waistY);
    ctx.quadraticCurveTo(cx + waistW * 1.4, hipY, cx + waistW + legW, hipY);
    // 다리 우
    ctx.lineTo(cx + legW * 1.8, footY);
    ctx.lineTo(cx + legW * 0.4, footY);
    ctx.lineTo(cx + legW * 0.2, hipY + h * 0.02);
    // 가랑이
    ctx.lineTo(cx - legW * 0.2, hipY + h * 0.02);
    // 다리 좌
    ctx.lineTo(cx - legW * 0.4, footY);
    ctx.lineTo(cx - legW * 1.8, footY);
    ctx.lineTo(cx - waistW - legW, hipY);
    ctx.quadraticCurveTo(cx - waistW * 1.4, hipY, cx - shoulderW * 0.78, waistY);
    ctx.quadraticCurveTo(cx - shoulderW * 1.12, shoulderY + h * 0.14, cx - shoulderW, shoulderY);
    ctx.quadraticCurveTo(cx - headR * 0.9, shoulderY - h * 0.03, cx - headR, headY);
    ctx.closePath();
    return { cx: cx, headY: headY, headR: headR, shoulderY: shoulderY, waistY: waistY };
  }

  function drawEnemy(variant, hurt) {
    var w = 256, h = 384;
    var v = ENEMY_VARIANTS[((variant | 0) % ENEMY_VARIANTS.length + ENEMY_VARIANTS.length) % ENEMY_VARIANTS.length];
    var R = rng((variant | 0) + 1);
    var c = mkCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // --- 접지 그림자 (바닥에 드리운 타원) ---
    ctx.save();
    var sg = ctx.createRadialGradient(w / 2, h * 0.95, 2, w / 2, h * 0.95, w * 0.42);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.95, w * 0.34, h * 0.035, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // --- 바깥 림라이트 글로우 (실루엣 뒤 발광) ---
    var meta = (function () {
      ctx.save();
      enemyBodyPath(ctx, w, h, rng((variant | 0) + 1));
      ctx.restore();
      // 좌표만 다시 계산용
      return null;
    })();

    // 본체 path 를 한 번만 만들어 재사용
    ctx.save();
    var info = enemyBodyPath(ctx, w, h, R);

    // 림라이트: path 를 두껍게 그려 발광 테두리
    ctx.save();
    ctx.clip();
    // 바디 그라디언트(금속 셰이딩: 좌상 하이라이트 → 우하 음영)
    var bg = ctx.createLinearGradient(w * 0.2, 0, w * 0.85, h);
    bg.addColorStop(0, rgba([v.body[0] + 55, v.body[1] + 60, v.body[2] + 70], 1));
    bg.addColorStop(0.35, rgba(v.body, 1));
    bg.addColorStop(1, rgba([Math.max(0, v.body[0] - 18), Math.max(0, v.body[1] - 18), Math.max(0, v.body[2] - 14)], 1));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 금속 수직 하이라이트 밴드
    var hb = ctx.createLinearGradient(w * 0.3, 0, w * 0.6, 0);
    hb.addColorStop(0, 'rgba(255,255,255,0)');
    hb.addColorStop(0.5, 'rgba(230,240,255,0.18)');
    hb.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hb;
    ctx.fillRect(0, 0, w, h);

    // 가슴 코어 (발광 원)
    var coreX = info.cx, coreY = h * 0.40, coreR = w * 0.085;
    glow(ctx, coreX, coreY, coreR * 2.6, v.core, hurt ? 1 : 0.85);
    var cg = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreR);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.5, rgba(v.core, 1));
    cg.addColorStop(1, rgba(v.core, 0.1));
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(coreX, coreY, coreR, 0, Math.PI * 2); ctx.fill();

    // 패널 라인 (디테일) — 얇은 발광 선
    ctx.strokeStyle = rgba(v.edge, 0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(info.cx - w * 0.12, h * 0.34); ctx.lineTo(info.cx + w * 0.12, h * 0.34);
    ctx.moveTo(info.cx, h * 0.46); ctx.lineTo(info.cx, h * 0.58);
    ctx.moveTo(info.cx - w * 0.14, h * 0.72); ctx.lineTo(info.cx + w * 0.14, h * 0.72);
    ctx.stroke();

    // 어깨 발광 포인트
    glow(ctx, info.cx - w * 0.30, info.shoulderY + h * 0.02, w * 0.09, v.edge, 0.6);
    glow(ctx, info.cx + w * 0.30, info.shoulderY + h * 0.02, w * 0.09, v.edge, 0.6);

    ctx.restore(); // clip 해제

    // 눈 (발광 바이저/듀얼 아이) — clip 밖에서 또렷하게
    var eyeY = info.headY - info.headR * 0.15;
    glow(ctx, info.cx, eyeY, info.headR * 1.2, v.edge, hurt ? 0.9 : 0.55);
    ctx.fillStyle = hurt ? '#ffffff' : rgba(v.edge, 1);
    ctx.beginPath();
    ctx.ellipse(info.cx - info.headR * 0.42, eyeY, info.headR * 0.22, info.headR * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(info.cx + info.headR * 0.42, eyeY, info.headR * 0.22, info.headR * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // 눈 하이라이트
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(info.cx - info.headR * 0.42, eyeY - info.headR * 0.08, info.headR * 0.07, 0, Math.PI * 2);
    ctx.arc(info.cx + info.headR * 0.42, eyeY - info.headR * 0.08, info.headR * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- 림라이트 재강조: 실루엣 가장자리 발광 스트로크 ---
    ctx.save();
    enemyBodyPath(ctx, w, h, rng((variant | 0) + 1));
    ctx.lineJoin = 'round';
    ctx.shadowColor = rgba(v.edge, 0.9);
    ctx.shadowBlur = hurt ? 26 : 16;
    ctx.strokeStyle = rgba(hurt ? [255, 255, 255] : v.edge, hurt ? 1 : 0.9);
    ctx.lineWidth = hurt ? 4 : 2.5;
    ctx.stroke();
    ctx.restore();

    if (hurt) {
      // 피격: 하얀 플래시 오버레이 + 균열
      ctx.save();
      enemyBodyPath(ctx, w, h, rng((variant | 0) + 1));
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(0, 0, w, h);
      // 균열 선
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      var cxk = info.cx, cyk = h * 0.42;
      for (var k = 0; k < 7; k++) {
        var ang = (k / 7) * Math.PI * 2 + R();
        ctx.beginPath();
        ctx.moveTo(cxk, cyk);
        var px = cxk, py = cyk;
        for (var seg = 0; seg < 3; seg++) {
          px += Math.cos(ang) * w * 0.08 + (R() - 0.5) * 20;
          py += Math.sin(ang) * w * 0.08 + (R() - 0.5) * 20;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 미세 그레인으로 플랫함 제거
    grain(ctx, w, h, hurt ? 10 : 18, 1);

    return out(c, w, h);
  }

  /* --------------------------------------------------------------------- */
  /* 총구 섬광                                                              */
  /* --------------------------------------------------------------------- */
  function muzzle() {
    var w = 256, h = 256, cx = w / 2, cy = h / 2;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // 연기 베이스 (옅은 회보라)
    var sm = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.48);
    sm.addColorStop(0, 'rgba(180,170,210,0.18)');
    sm.addColorStop(0.6, 'rgba(90,80,120,0.08)');
    sm.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sm; ctx.fillRect(0, 0, w, h);

    // 외곽 앰버 글로우 → 코어 백색
    glow(ctx, cx, cy, w * 0.42, PAL.amber, 0.8);
    glow(ctx, cx, cy, w * 0.22, [255, 240, 200], 1);
    var core = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.12);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, w * 0.12, 0, Math.PI * 2); ctx.fill();

    // 방사형 스파크 (길이 다른 빛살)
    ctx.save();
    ctx.translate(cx, cy);
    var R = rng(7);
    var spikes = 14;
    for (var i = 0; i < spikes; i++) {
      var a = (i / spikes) * Math.PI * 2 + R() * 0.3;
      var len = w * (0.22 + R() * 0.24);
      var wdt = 2 + R() * 5;
      var g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.3, rgba(PAL.amber, 0.8));
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = wdt; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    // 작은 파편 점
    for (var p = 0; p < 18; p++) {
      var pa = R() * Math.PI * 2, pr = w * (0.2 + R() * 0.26);
      ctx.fillStyle = 'rgba(255,' + (180 + ((R() * 60) | 0)) + ',120,' + (0.5 + R() * 0.5) + ')';
      ctx.beginPath(); ctx.arc(Math.cos(pa) * pr, Math.sin(pa) * pr, 1 + R() * 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    return out(c, w, h);
  }

  /* --------------------------------------------------------------------- */
  /* 적 탄환 (발광 코어 + 트레일/글로우 구체)                                */
  /* --------------------------------------------------------------------- */
  function bullet() {
    var w = 128, h = 128, cx = w / 2, cy = h / 2;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // 외곽 앰버/마젠타 글로우
    glow(ctx, cx, cy, w * 0.46, PAL.amber, 0.9);
    glow(ctx, cx, cy, w * 0.30, PAL.magenta, 0.5);
    // 코어 구체 (3D 느낌: 좌상 하이라이트)
    var g = ctx.createRadialGradient(cx - w * 0.08, cy - h * 0.08, 1, cx, cy, w * 0.20);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, rgba(PAL.amber, 1));
    g.addColorStop(1, rgba([255, 120, 40], 0.1));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, w * 0.20, 0, Math.PI * 2); ctx.fill();
    // 하이라이트 점
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(cx - w * 0.07, cy - h * 0.07, w * 0.045, 0, Math.PI * 2); ctx.fill();

    return out(c, w, h);
  }

  /* --------------------------------------------------------------------- */
  /* 처치 버스트 (팽창 링 + 파편 + 빛)                                       */
  /* --------------------------------------------------------------------- */
  function burst() {
    var w = 256, h = 256, cx = w / 2, cy = h / 2;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    var R = rng(11);

    // 중심 섬광
    glow(ctx, cx, cy, w * 0.26, [255, 255, 255], 1);
    glow(ctx, cx, cy, w * 0.44, PAL.cyan, 0.5);

    // 팽창 링 (두 겹)
    function ring(rr, lw, col, a) {
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = rgba(PAL.cyan, 0.9); ctx.shadowBlur = 18;
    ring(w * 0.30, 6, PAL.cyan, 0.9);
    ctx.shadowColor = rgba(PAL.magenta, 0.9);
    ring(w * 0.40, 3, PAL.magenta, 0.7);
    ctx.restore();

    // 방사 파편 (쐐기)
    ctx.save(); ctx.translate(cx, cy);
    var n = 16;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + R() * 0.2;
      var r0 = w * (0.18 + R() * 0.06), r1 = w * (0.30 + R() * 0.16);
      var col = R() < 0.5 ? PAL.cyan : PAL.magenta;
      var g = ctx.createLinearGradient(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
      g.addColorStop(0, rgba(col, 0.95));
      g.addColorStop(1, rgba(col, 0));
      ctx.strokeStyle = g; ctx.lineCap = 'round';
      ctx.lineWidth = 2 + R() * 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    // 반짝 점 파편
    for (var p = 0; p < 22; p++) {
      var pa = R() * Math.PI * 2, pr = w * (0.2 + R() * 0.22);
      ctx.fillStyle = (R() < 0.5 ? rgba(PAL.cyan, 0.9) : rgba(PAL.amber, 0.9));
      ctx.beginPath(); ctx.arc(Math.cos(pa) * pr, Math.sin(pa) * pr, 1 + R() * 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    return out(c, w, h);
  }

  /* --------------------------------------------------------------------- */
  /* 스카이 (수직 그라디언트 + 비네트 + 소실점 글로우)                        */
  /* --------------------------------------------------------------------- */
  function sky() {
    var w = 512, h = 512;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');

    // 상단 어두운 보라 → 하단 네온 지평선
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.0, '#05030e');
    g.addColorStop(0.45, '#0c0624');
    g.addColorStop(0.72, '#1a0a3a');
    g.addColorStop(0.88, '#3a1056');
    g.addColorStop(1.0, '#5e1766');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // 지평선 네온 밴드
    var hb = ctx.createLinearGradient(0, h * 0.82, 0, h);
    hb.addColorStop(0, 'rgba(255,42,109,0)');
    hb.addColorStop(0.6, 'rgba(255,42,109,0.25)');
    hb.addColorStop(1, 'rgba(5,217,232,0.35)');
    ctx.fillStyle = hb; ctx.fillRect(0, h * 0.82, w, h * 0.18);

    // 소실점 글로우 (중앙 하단)
    glow(ctx, w / 2, h * 0.86, w * 0.42, PAL.cyan, 0.4);
    glow(ctx, w / 2, h * 0.82, w * 0.26, PAL.magenta, 0.35);

    // 성긴 별/파티클 (상단)
    var R = rng(23);
    for (var i = 0; i < 90; i++) {
      var x = R() * w, y = R() * h * 0.6;
      var a = 0.2 + R() * 0.6;
      ctx.fillStyle = 'rgba(200,210,255,' + a + ')';
      ctx.beginPath(); ctx.arc(x, y, R() * 1.2, 0, Math.PI * 2); ctx.fill();
    }

    // 비네트
    var vg = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h * 0.5, h * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

    grain(ctx, w, h, 8, 1);
    return out(c, w, h);
  }

  /* --------------------------------------------------------------------- */
  /* 바닥 (원근 네온 그리드 + 반사 + 포그 페이드, 세로 타일)                  */
  /* --------------------------------------------------------------------- */
  function floor() {
    var w = 512, h = 512;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');

    // 베이스: 어두운 네이비 (상단=먼 쪽 더 어둡게)
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#06030f');
    g.addColorStop(0.5, '#0a0520');
    g.addColorStop(1, '#0e0828');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // 세로 라인 (타일 경계 일치: x=0 과 x=w 가 이어지도록 대칭 배치)
    ctx.lineWidth = 2;
    for (var vx = 0; vx <= w; vx += w / 8) {
      var em = 0.12 + 0.10 * Math.sin((vx / w) * Math.PI); // 중앙 밝게
      ctx.strokeStyle = rgba(PAL.cyan, em);
      ctx.beginPath(); ctx.moveTo(vx + 0.5, 0); ctx.lineTo(vx + 0.5, h); ctx.stroke();
    }
    // 가로 라인 (타일 반복 시 끊김 없게 균등)
    for (var hy = 0; hy <= h; hy += h / 8) {
      ctx.strokeStyle = rgba(PAL.magenta, 0.14);
      ctx.beginPath(); ctx.moveTo(0, hy + 0.5); ctx.lineTo(w, hy + 0.5); ctx.stroke();
    }

    // 교차점 발광 노드
    var R = rng(31);
    for (var gx = 0; gx <= w; gx += w / 8) {
      for (var gy = 0; gy <= h; gy += h / 8) {
        if (R() < 0.35) glow(ctx, gx, gy, 10 + R() * 10, R() < 0.5 ? PAL.cyan : PAL.magenta, 0.5);
      }
    }

    // 반사 하이라이트 밴드 (바닥 젖은 반사 느낌, 세로 그라디언트)
    var rf = ctx.createLinearGradient(0, h * 0.3, 0, h);
    rf.addColorStop(0, 'rgba(5,217,232,0)');
    rf.addColorStop(1, 'rgba(5,217,232,0.08)');
    ctx.fillStyle = rf; ctx.fillRect(0, 0, w, h);

    grain(ctx, w, h, 10, 1);
    return out(c, w, h);
  }

  /* --------------------------------------------------------------------- */
  /* 선택: 복도 기둥(pile) / 네온 트림(trim)                                 */
  /* --------------------------------------------------------------------- */
  function pile() {
    var w = 128, h = 384;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // 금속 기둥 본체 (원통 셰이딩)
    var g = ctx.createLinearGradient(w * 0.25, 0, w * 0.75, 0);
    g.addColorStop(0, '#16102a');
    g.addColorStop(0.5, '#3a3156');
    g.addColorStop(0.55, '#4a4068');
    g.addColorStop(1, '#0e0a1e');
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.28, 0, w * 0.44, h);
    // 세로 네온 트림 (양쪽)
    ctx.save();
    ctx.shadowColor = rgba(PAL.cyan, 0.9); ctx.shadowBlur = 14;
    ctx.strokeStyle = rgba(PAL.cyan, 0.9); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.30, h * 0.04); ctx.lineTo(w * 0.30, h * 0.96); ctx.stroke();
    ctx.shadowColor = rgba(PAL.magenta, 0.9);
    ctx.strokeStyle = rgba(PAL.magenta, 0.9);
    ctx.beginPath(); ctx.moveTo(w * 0.70, h * 0.04); ctx.lineTo(w * 0.70, h * 0.96); ctx.stroke();
    ctx.restore();
    // 가로 밴드 (발광 링)
    var R = rng(5);
    for (var i = 0; i < 5; i++) {
      var y = h * (0.12 + i * 0.18);
      glow(ctx, w * 0.5, y, w * 0.26, R() < 0.5 ? PAL.cyan : PAL.magenta, 0.4);
      ctx.strokeStyle = rgba(PAL.amber, 0.5); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w * 0.28, y); ctx.lineTo(w * 0.72, y); ctx.stroke();
    }
    grain(ctx, w, h, 12, 1);
    return out(c, w, h);
  }

  function trim() {
    var w = 256, h = 48;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // 수평 발광 바 (상하 페이드 → 세로로 타일/반복 가능, 좌우 연속)
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(5,217,232,0)');
    g.addColorStop(0.5, rgba(PAL.cyan, 0.95));
    g.addColorStop(1, 'rgba(5,217,232,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.30, w, h * 0.4);
    // 코어 백색 라인 (hot core)
    ctx.save();
    ctx.shadowColor = rgba(PAL.cyan, 1); ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(230,255,255,0.9)';
    ctx.fillRect(0, h * 0.46, w, h * 0.08);
    ctx.restore();
    // 균등 간격 발광 노드 (좌우 타일 경계 일치하도록 w/8 간격)
    for (var x = 0; x <= w; x += w / 8) {
      glow(ctx, x, h * 0.5, h * 0.42, PAL.cyan, 0.7);
    }
    // 가는 앰버 하이라이트 스캔라인
    ctx.strokeStyle = rgba(PAL.amber, 0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h * 0.40); ctx.lineTo(w, h * 0.40); ctx.stroke();
    grain(ctx, w, h, 8, 1);
    return out(c, w, h);
  }

  /* --------------------------------------------------------------------- */
  /* 캐시 래퍼 + 공개 API                                                   */
  /* --------------------------------------------------------------------- */
  var cache = {};
  function memo(key, fn) {
    if (cache[key]) return cache[key];
    return (cache[key] = fn());
  }

  var GUNVIZ = {
    VERSION: VERSION,
    enemyTexture: function (variant) {
      variant = variant | 0;
      return memo('enemy:' + variant, function () { return drawEnemy(variant, false); });
    },
    enemyHurtTexture: function (variant) {
      variant = variant | 0;
      return memo('enemyHurt:' + variant, function () { return drawEnemy(variant, true); });
    },
    muzzleTexture: function () { return memo('muzzle', muzzle); },
    bulletTexture: function () { return memo('bullet', bullet); },
    burstTexture: function () { return memo('burst', burst); },
    skyTexture: function () { return memo('sky', sky); },
    floorTexture: function () { return memo('floor', floor); },
    pileTexture: function () { return memo('pile', pile); },
    trimTexture: function () { return memo('trim', trim); },
    clearCache: function () { cache = {}; },
    // 게임 시작 시 1회 호출 → 모든 텍스처 미리 생성/캐시
    preload: function () {
      for (var i = 0; i < 3; i++) { this.enemyTexture(i); this.enemyHurtTexture(i); }
      this.muzzleTexture(); this.bulletTexture(); this.burstTexture();
      this.skyTexture(); this.floorTexture(); this.pileTexture(); this.trimTexture();
      return true;
    }
  };

  global.GUNVIZ = GUNVIZ;
  if (typeof module !== 'undefined' && module.exports) module.exports = GUNVIZ;

})(typeof window !== 'undefined' ? window : this);
