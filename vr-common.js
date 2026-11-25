/* 브로가드 VR 공용 부품
 * - ktext: A-Frame 기본 글꼴이 한글을 지원하지 않는 문제 해결.
 *   캔버스에 시스템 글꼴로 글자를 그려 텍스처로 입힘(한글·이모지 OK).
 *   사용: <a-entity ktext="value: 점수 0; color:#fff; size:0.3"></a-entity>
 *   동적 변경: el.setAttribute('ktext','value', '점수 '+n)
 * - billboard: 항상 카메라를 바라보게.
 */
(function(){
  if(!window.AFRAME) return;
  function roundRect(c,x,y,w,h,r){ r=Math.min(r,w/2,h/2); c.beginPath(); c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }

  if(!AFRAME.components.ktext){
    AFRAME.registerComponent('ktext',{
      schema:{ value:{default:''}, color:{default:'#ffffff'}, size:{type:'number', default:0.3},
               bg:{default:''}, weight:{default:'bold'}, opacity:{type:'number', default:1} },
      init:function(){ this.cv=document.createElement('canvas'); this.cx=this.cv.getContext('2d'); this.mesh=null; this.draw(); },
      update:function(){ this.draw(); },
      remove:function(){ if(this.mesh){ this.el.removeObject3D('ktext'); this.mesh=null; } },
      draw:function(){
        var d=this.data, FS=72, pad=20, lh=FS+16;
        var font=d.weight+' '+FS+'px "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Segoe UI",sans-serif';
        var cx=this.cx; cx.font=font; var lines=String(d.value).split('\n'); var tw=1;
        for(var i=0;i<lines.length;i++) tw=Math.max(tw, cx.measureText(lines[i]).width);
        var cw=Math.ceil(tw)+pad*2, ch=lines.length*lh+pad*2;
        this.cv.width=cw; this.cv.height=ch; cx=this.cx; cx.clearRect(0,0,cw,ch);
        if(d.bg){ cx.fillStyle=d.bg; roundRect(cx,0,0,cw,ch,28); cx.fill(); }
        cx.font=font; cx.fillStyle=d.color; cx.textAlign='center'; cx.textBaseline='middle';
        for(var j=0;j<lines.length;j++){ cx.fillText(lines[j], cw/2, pad+(j+0.5)*lh); }
        var tex=new THREE.CanvasTexture(this.cv); tex.minFilter=THREE.LinearFilter; tex.anisotropy=4;
        if(THREE.SRGBColorSpace) tex.colorSpace=THREE.SRGBColorSpace;
        if(!this.mesh){ this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
          new THREE.MeshBasicMaterial({transparent:true, depthWrite:false})); this.el.setObject3D('ktext', this.mesh); }
        if(this.mesh.material.map) this.mesh.material.map.dispose();
        this.mesh.material.map=tex; this.mesh.material.opacity=d.opacity; this.mesh.material.needsUpdate=true;
        var perLine=d.size, h=perLine*lines.length, w=h*(cw/ch); this.mesh.scale.set(w,h,1);
      }
    });
  }
  if(!AFRAME.components.billboard){
    AFRAME.registerComponent('billboard',{ init:function(){ this._v=new THREE.Vector3(); },
      tick:function(){ var cam=this.el.sceneEl && this.el.sceneEl.camera; if(cam){ cam.getWorldPosition(this._v); this.el.object3D.lookAt(this._v); } } });
  }
})();
