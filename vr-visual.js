/* ════════════════════════════════════════════════════════════════════════
   vr-visual.js — 브로가드 공용 "반실사" 비주얼 부품 (PBR + 캔버스 텍스처 + 조명)
   ---------------------------------------------------------------------------
   목표: shader:flat 단색 대신 PBR standard 재질 + 절차적 캔버스 텍스처 + 조명으로
         2D(폰/테슬라)에서도 반실사처럼 보이게.  aframe 다음에 로드.  window.VRVisual.
   제공:
     · 텍스처 생성기(캔버스, 키로 캐시): coatedHead / wrap / brushedMetal /
       darkPanel / radialPool / vGradient / noisePlate
     · applyTex(el, canvas, opts) : CanvasTexture를 엔티티 메시 재질 map에 적용(메시 대기)
     · mkPart(parent, geo, pos, rot, mat) : standard 재질 자식 엔티티 생성
     · pbr(color, metal, rough, extra) : 재질 문자열 빌더
     · CHROME : 크롬 재질 문자열
     · addLights(sceneEl, preset) : 반실사 조명 리그 주입(stage|soft)
     · RENDERER : 권장 <a-scene renderer="..."> 문자열
   순수 캔버스/THREE만 사용(게임 로직 없음). 다른 게임에서도 그대로 재사용 가능.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  var TEX={};
  function cvs(w,h){ var c=document.createElement('canvas'); c.width=w; c.height=h; return c; }

  /* 코티드(흰) 표면 — 드럼 헤드/무광 디스크. 미세 스펙클 + 동심원 + 엣지 음영 */
  function coatedHead(key,tint){ if(TEX[key])return TEX[key]; var c=cvs(256,256),x=c.getContext('2d');
    var g=x.createRadialGradient(118,112,8,128,128,132); g.addColorStop(0,'#fefefc'); g.addColorStop(.7,tint||'#eef0ee'); g.addColorStop(1,'#cacdc9');
    x.fillStyle=g; x.fillRect(0,0,256,256);
    for(var i=0;i<14000;i++){ var a=Math.random()*0.05; x.fillStyle=(Math.random()<0.5?'rgba(255,255,255,':'rgba(90,90,90,')+a+')'; x.fillRect(Math.random()*256,Math.random()*256,1,1); }
    x.strokeStyle='rgba(130,130,130,0.06)'; for(var r=16;r<126;r+=13){ x.beginPath(); x.arc(128,128,r,0,7); x.stroke(); }
    var v=x.createRadialGradient(128,128,86,128,128,130); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,0.4)'); x.fillStyle=v; x.fillRect(0,0,256,256);
    x.strokeStyle='rgba(40,40,40,0.5)'; x.lineWidth=5; x.beginPath(); x.arc(128,128,126,0,7); x.stroke();
    return TEX[key]=c; }

  /* 원통 랩(가로 반복): 세로 나뭇결/스파클 + 상하 음영 + (선택)크롬 러그 */
  function wrap(key,c1,c2,sparkle,lugs){ if(TEX[key])return TEX[key]; if(lugs==null) lugs=true; var W=512,H=160,c=cvs(W,H),x=c.getContext('2d');
    var g=x.createLinearGradient(0,0,0,H); g.addColorStop(0,c2); g.addColorStop(.12,c1); g.addColorStop(.5,c2); g.addColorStop(.88,c1); g.addColorStop(1,c2);
    x.fillStyle=g; x.fillRect(0,0,W,H);
    if(sparkle){ for(var i=0;i<4200;i++){ var b=120+Math.random()*135|0; x.fillStyle='rgba('+b+','+b+','+(b+10)+','+(Math.random()*0.5)+')'; x.fillRect(Math.random()*W,Math.random()*H,1.4,1.4); } }
    else { x.globalAlpha=0.5; for(var k=0;k<90;k++){ x.strokeStyle='rgba(0,0,0,'+(Math.random()*0.12)+')'; x.lineWidth=0.5+Math.random(); var xx=Math.random()*W; x.beginPath(); x.moveTo(xx,0); x.bezierCurveTo(xx+6,H*.3,xx-6,H*.6,xx+3,H); x.stroke(); } x.globalAlpha=1; }
    var hl=x.createLinearGradient(0,0,W,0); hl.addColorStop(0,'rgba(255,255,255,0)'); hl.addColorStop(.22,'rgba(255,255,255,0.22)'); hl.addColorStop(.3,'rgba(255,255,255,0)'); hl.addColorStop(.72,'rgba(0,0,0,0.18)'); hl.addColorStop(1,'rgba(0,0,0,0.28)');
    x.fillStyle=hl; x.fillRect(0,0,W,H);
    if(lugs){ for(var L=0;L<8;L++){ var lx=(L+0.5)*W/8; [20,H-20].forEach(function(ly){ var lg=x.createLinearGradient(lx-9,ly-9,lx+9,ly+9); lg.addColorStop(0,'#f4f7fb'); lg.addColorStop(.5,'#8f98a6'); lg.addColorStop(1,'#d7dde6'); x.fillStyle=lg; x.beginPath(); x.ellipse(lx,ly,6,11,0,0,7); x.fill(); x.strokeStyle='rgba(0,0,0,0.35)'; x.lineWidth=1; x.stroke(); }); } }
    return TEX[key]=c; }

  /* 브러시드 금속(동심 선반결 + 벨 + 키라이트 하이라이트) — 심벌/금속판 */
  function brushedMetal(key,inner,mid,edge){ if(TEX[key])return TEX[key]; var c=cvs(256,256),x=c.getContext('2d');
    var g=x.createRadialGradient(128,128,4,128,128,128); g.addColorStop(0,inner); g.addColorStop(.18,mid); g.addColorStop(.6,edge); g.addColorStop(1,mid);
    x.fillStyle=g; x.fillRect(0,0,256,256);
    for(var r=3;r<128;r+=1.4){ x.strokeStyle='rgba('+(Math.random()<.5?'255,250,225':'70,55,25')+','+(Math.random()*0.16)+')'; x.lineWidth=Math.random()*1.3; x.beginPath(); x.arc(128,128,r,0,7); x.stroke(); }
    var bell=x.createRadialGradient(122,120,2,128,128,26); bell.addColorStop(0,'#fff6df'); bell.addColorStop(.6,inner); bell.addColorStop(1,'rgba(0,0,0,0.15)'); x.fillStyle=bell; x.beginPath(); x.arc(128,128,26,0,7); x.fill();
    var kl=x.createRadialGradient(92,86,6,96,90,120); kl.addColorStop(0,'rgba(255,255,255,0.5)'); kl.addColorStop(.3,'rgba(255,255,255,0.12)'); kl.addColorStop(1,'rgba(255,255,255,0)'); x.fillStyle=kl; x.beginPath(); x.arc(128,128,127,0,7); x.fill();
    x.strokeStyle='rgba(60,45,15,0.55)'; x.lineWidth=3; x.beginPath(); x.arc(128,128,126,0,7); x.stroke();
    return TEX[key]=c; }

  /* 어두운 패널 + 링(킥 정면 등). ring=링 색 */
  function darkPanel(key,ring){ if(TEX[key])return TEX[key]; ring=ring||'#8aa0ff'; var c=cvs(256,256),x=c.getContext('2d');
    var g=x.createRadialGradient(118,112,10,128,128,134); g.addColorStop(0,'#15161f'); g.addColorStop(.7,'#0e0f17'); g.addColorStop(1,'#05060a'); x.fillStyle=g; x.fillRect(0,0,256,256);
    for(var i=0;i<9000;i++){ x.fillStyle='rgba(120,130,170,'+(Math.random()*0.05)+')'; x.fillRect(Math.random()*256,Math.random()*256,1,1); }
    x.strokeStyle=ring; x.globalAlpha=0.5; x.lineWidth=4; x.beginPath(); x.arc(128,128,78,0,7); x.stroke(); x.globalAlpha=1;
    x.strokeStyle='rgba(200,215,255,0.18)'; x.lineWidth=2; x.beginPath(); x.arc(128,128,70,0,7); x.stroke();
    var v=x.createRadialGradient(128,128,70,128,128,132); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,0.55)'); x.fillStyle=v; x.fillRect(0,0,256,256);
    x.strokeStyle='rgba(30,30,40,0.7)'; x.lineWidth=7; x.beginPath(); x.arc(128,128,124,0,7); x.stroke();
    return TEX[key]=c; }

  /* 바닥 스포트라이트 풀(라디얼) */
  function radialPool(key,base,glow){ if(TEX[key])return TEX[key]; base=base||'#0c0e16'; glow=glow||'#2a2f45'; var c=cvs(512,512),x=c.getContext('2d'); x.fillStyle=base; x.fillRect(0,0,512,512);
    var g=x.createRadialGradient(256,232,20,256,256,250); g.addColorStop(0,glow); g.addColorStop(.35,'#1a1e30'); g.addColorStop(1,'#0a0c13'); x.fillStyle=g; x.fillRect(0,0,512,512);
    for(var i=0;i<22000;i++){ x.fillStyle='rgba(120,130,170,'+(Math.random()*0.04)+')'; x.fillRect(Math.random()*512,Math.random()*512,1,1); } return TEX[key]=c; }

  /* 세로 그라데이션 + 중앙 글로우(배경) */
  function vGradient(key,c0,c1,c2){ if(TEX[key])return TEX[key]; c0=c0||'#05060b'; c1=c1||'#10131f'; c2=c2||'#171b2b'; var c=cvs(256,256),x=c.getContext('2d');
    var g=x.createLinearGradient(0,0,0,256); g.addColorStop(0,c0); g.addColorStop(.5,c1); g.addColorStop(1,c2); x.fillStyle=g; x.fillRect(0,0,256,256);
    var v=x.createRadialGradient(128,170,10,128,170,180); v.addColorStop(0,'rgba(70,84,140,0.25)'); v.addColorStop(1,'rgba(0,0,0,0)'); x.fillStyle=v; x.fillRect(0,0,256,256); return TEX[key]=c; }

  /* 범용 노이즈 플레이트(천/콘크리트 등) */
  function noisePlate(key,baseColor,amt){ if(TEX[key])return TEX[key]; amt=amt==null?0.08:amt; var c=cvs(256,256),x=c.getContext('2d'); x.fillStyle=baseColor||'#777'; x.fillRect(0,0,256,256);
    for(var i=0;i<30000;i++){ x.fillStyle='rgba('+(Math.random()<.5?'255,255,255,':'0,0,0,')+(Math.random()*amt)+')'; x.fillRect(Math.random()*256,Math.random()*256,1,1); } return TEX[key]=c; }

  /* CanvasTexture를 엔티티 메시 재질 map에 적용(메시 준비 대기) */
  function applyTex(el, canvas, o){ o=o||{}; if(!el || (!el.getObject3D && !el.object3D)) return;
    var go=function(){ var m=el.getObject3D&&el.getObject3D('mesh'); if(!m){ el.addEventListener&&el.addEventListener('object3dset',go,{once:true}); return; }
      try{ var t=new THREE.CanvasTexture(canvas); t.anisotropy=8; if(THREE.SRGBColorSpace)t.colorSpace=THREE.SRGBColorSpace;
        if(o.repeat){ t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(o.repeat[0],o.repeat[1]); } t.needsUpdate=true;
        var mat=m.material; if(mat&&mat.length)mat=mat[0]; mat.map=t; if(o.color)mat.color.set(o.color);
        if(o.metalness!=null)mat.metalness=o.metalness; if(o.roughness!=null)mat.roughness=o.roughness; mat.needsUpdate=true; }catch(e){} };
    go(); }

  function pbr(color,metal,rough,extra){ return 'shader:standard; color:'+(color||'#ccc')+'; metalness:'+(metal==null?0.2:metal)+'; roughness:'+(rough==null?0.6:rough)+(extra?('; '+extra):''); }
  function mkPart(parent,geo,pos,rot,mat){ var e=document.createElement('a-entity'); e.setAttribute('geometry',geo); e.setAttribute('position',pos); if(rot)e.setAttribute('rotation',rot); e.setAttribute('material',mat||pbr('#cfd3da',0.2,0.6)); parent.appendChild(e); return e; }
  var CHROME=pbr('#e9edf4',0.92,0.26);

  /* 반실사 조명 리그 주입. preset: 'stage'(기본, 무대) | 'soft'(은은) */
  function addLights(sceneEl, preset){ if(!sceneEl) return; preset=preset||'stage';
    var defs = preset==='soft' ? [
      {light:'type:hemisphere; intensity:0.65; color:#cfd8ff; groundColor:#20222c'},
      {light:'type:ambient; intensity:0.3'},
      {light:'type:directional; intensity:0.7; color:#fff4e2', position:'-1 3 1.5'}
    ] : [
      {light:'type:hemisphere; intensity:0.5; color:#cbd6ff; groundColor:#241521'},
      {light:'type:ambient; intensity:0.22; color:#8894c8'},
      {light:'type:directional; intensity:1.0; color:#fff2dc', position:'-1.6 3.4 1.4'},
      {light:'type:point; intensity:0.7; distance:9; decay:2; color:#ffd7a2', position:'0.9 2.5 0.5'},
      {light:'type:point; intensity:0.5; distance:9; decay:2; color:#a6bcff', position:'-1.6 2.1 -1.0'},
      {light:'type:spot; intensity:0.5; angle:55; penumbra:0.6; distance:8; color:#fff', position:'0 3.6 0.2', rotation:'-70 0 0'}
    ];
    defs.forEach(function(d){ var e=document.createElement('a-entity'); e.setAttribute('light', d.light); if(d.position) e.setAttribute('position', d.position); if(d.rotation) e.setAttribute('rotation', d.rotation); sceneEl.appendChild(e); }); }

  var RENDERER='colorManagement:true; physicallyCorrectLights:true; toneMapping:ACESFilmic; exposure:1.05; antialias:true; highRefreshRate:true';

  window.VRVisual={ cvs:cvs, coatedHead:coatedHead, wrap:wrap, brushedMetal:brushedMetal, darkPanel:darkPanel,
    radialPool:radialPool, vGradient:vGradient, noisePlate:noisePlate, applyTex:applyTex, mkPart:mkPart,
    pbr:pbr, CHROME:CHROME, addLights:addLights, RENDERER:RENDERER };
})();
