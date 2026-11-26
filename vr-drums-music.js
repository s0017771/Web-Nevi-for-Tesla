/* ════════════════════════════════════════════════════════════════════════
   vr-drums-music.js  —  리듬세이버 실제 곡(멜로디) 재생 자립형 모듈
   ---------------------------------------------------------------------------
   · ABC 악보(V:1 treble 보이스)를 16분음표 격자 멜로디로 파싱(parseMelody)
   · 피아노 샘플(FluidR3_GM, 기기에서만) 프리로드(preload) — CDN 차단 시 조용히 폴백
   · 한 음 재생(playNote) — 샘플 있으면 BufferSource, 없으면 리얼 피아노 합성 폴백
   · ES5 바닐라(var/function), 외부 라이브러리 없음. AudioContext/목적지/리버브는
     호스트(vr-drums.html)가 넘겨주므로 모듈은 자체 컨텍스트를 만들지 않는다.
   ·  vr-saber.html 의 parseABC(멜로디 V:1) 로직을 이식해 16분 스텝 API로 노출.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  var NAMES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  function midiName(m){ return NAMES[((m%12)+12)%12]+(Math.floor(m/12)-1); }   // midi→샘플 파일명(옥타브 -1 보정)
  function midiFreq(m){ return 440*Math.pow(2,(m-69)/12); }                    // A4(midi69)=440Hz
  function freqMidi(f){ return Math.round(69+12*Math.log(f/440)/Math.LN2); }

  var SFBASE='https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/';
  var SAMPLE={ buf:{}, loading:{} };   // midi → AudioBuffer 캐시(기기용)

  /* ─────────── ABC → 멜로디(16분 격자) 파서 ─────────── */
  function parseMelody(abc){
    var out={ tempo:100, meterNum:4, meterDen:4, stepsPerBar:16, notes:[], totalSteps:0, tempoMap:[{on:0,tempo:100}] };
    if(!abc||!abc.trim()) return out;
    var voice=1, pick='top';
    var lines=abc.replace(/\r/g,'').split('\n'), L=null, meterNum=4, meterDen=4, tempo=0, keySig={}, inBody=false, bodyLines=[];
    var SH={'C':[],'G':['F'],'D':['F','C'],'A':['F','C','G'],'E':['F','C','G','D'],'B':['F','C','G','D','A'],'F#':['F','C','G','D','A','E'],'C#':['F','C','G','D','A','E','B']};
    var FL={'F':['B'],'Bb':['B','E'],'Eb':['B','E','A'],'Ab':['B','E','A','D'],'Db':['B','E','A','D','G'],'Gb':['B','E','A','D','G','C'],'Cb':['B','E','A','D','G','C','F']};
    function key(k){ keySig={}; var kk=(k||'C').trim().replace(/\s.*$/,''); if(!kk) return; kk=kk.charAt(0).toUpperCase()+kk.slice(1);
      if(SH[kk]) SH[kk].forEach(function(n){keySig[n]=1;}); else if(FL[kk]) FL[kk].forEach(function(n){keySig[n]=-1;}); }

    for(var i=0;i<lines.length;i++){ var ln=lines[i];
      if(!inBody){ var m=ln.match(/^([A-Za-z]):\s*(.*)$/);
        if(m){ var f=m[1], v=m[2];
          if(f==='L'){ var p=v.match(/(\d+)\s*\/\s*(\d+)/); if(p) L=+p[1]/+p[2]; }
          else if(f==='Q'){ var q=v.match(/=\s*(\d+)/); if(q) tempo=+q[1]; }
          else if(f==='M'){ var mo=v.match(/(\d+)\s*\/\s*(\d+)/); if(mo){ meterNum=+mo[1]; meterDen=+mo[2]; } }
          else if(f==='K'){ key(v); inBody=true; } continue; }
        continue; }
      else bodyLines.push(ln); }

    // 멜로디(V:1)만 추려 이어붙임
    var parts=[];
    for(var b=0;b<bodyLines.length;b++){ var t=bodyLines[b].replace(/^\s+/,''); if(!t||t.charAt(0)==='%') continue;
      var vm=t.match(/^\[V:\s*(\w+)[^\]]*\]\s*(.*)$/); var vn, content;
      if(vm){ vn=parseInt(vm[1],10)||1; content=vm[2]; } else { vn=1; content=t; }
      if(vn===voice) parts.push(content); }
    var body=parts.join(' ');
    // 반복 |: ... :| 펼침
    var guard=0; while(/\|:[\s\S]*?:\|/.test(body) && guard++<30){ body=body.replace(/\|:([\s\S]*?):\|/, function(_,inner){ return ' | '+inner+' | '+inner+' | '; }); }

    var meter=meterNum/meterDen;
    if(L==null) L = meter<0.75 ? 1/16 : 1/8;
    tempo=tempo||100;
    var tempoMap=[{on:0, tempo:tempo}];
    var SEMI={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}, rawNotes=[], on=0, barAcc={}, j=0;

    function readLen(){ var num=''; while(/\d/.test(body[j])){ num+=body[j]; j++; }
      var den=1; if(body[j]==='/'){ j++; var ds=''; while(/\d/.test(body[j])){ ds+=body[j]; j++; } den=ds?+ds:2; }
      return Math.max(1, Math.round((num?+num:1)/den * L * 16)); }   // 16분음표 스텝으로 환산
    function readPitch(){ var acc=null, am=body.slice(j).match(/^(\^\^|\^|__|_|=)/); if(am){ acc=am[1]; j+=acc.length; }
      var c=body[j]; if(!c || !/[A-Ga-gzxZ]/.test(c)) return null; j++;
      var oct=''; while(body[j]===','||body[j]==="'"){ oct+=body[j]; j++; }
      if(c==='z'||c==='x'||c==='Z') return {rest:true};
      var up=c.toUpperCase(), baseOct=(c===up)?4:5, octShift=(oct.match(/'/g)||[]).length-(oct.match(/,/g)||[]).length;
      var av; if(acc){ av=(acc==='='?0:acc==='^'?1:acc==='^^'?2:acc==='_'?-1:-2); barAcc[up]=av; }
        else if(up in barAcc) av=barAcc[up]; else av=keySig[up]||0;
      var midi=60+SEMI[up]+av+12*((baseOct+octShift)-4);
      return {midi:midi}; }

    while(j<body.length){ var ch=body[j];
      if(ch==='['){ var fm=body.slice(j).match(/^\[([A-Za-z]):([^\]]*)\]/);   // 중간 필드 [K:][L:][Q:]
        if(fm){ if(fm[1]==='K'){ key(fm[2]); barAcc={}; } else if(fm[1]==='L'){ var lp=fm[2].match(/(\d+)\s*\/\s*(\d+)/); if(lp) L=+lp[1]/+lp[2]; }
          else if(fm[1]==='Q'){ var qq=fm[2].match(/=\s*(\d+)/); if(qq) tempoMap.push({on:on, tempo:+qq[1]}); } j+=fm[0].length; continue; }
        // 화음 [..]N : 안쪽 음 모으고 ']' 뒤 길이 적용, 멜로디는 대표음(top=최고, bottom=최저)
        j++; var cf=[]; while(j<body.length && body[j]!==']'){
          if(body[j]==='"'){ j++; while(j<body.length&&body[j]!=='"') j++; j++; continue; }
          var pb=readPitch(); if(pb){ if(!pb.rest) cf.push(pb.midi); while(/[\d\/]/.test(body[j])) j++; } else j++; }
        if(body[j]===']') j++;
        var cs=readLen(); if(cf.length){ var mm=(pick==='bottom'?Math.min:Math.max).apply(null,cf); rawNotes.push({midi:mm, on:on, dur:cs}); on+=cs; }
        continue; }
      if(ch==='|'){ barAcc={}; j++; continue; }
      if(ch===' '||ch==='\t'||ch==='-'||ch==='('||ch===')'||ch===':'||ch==='>'||ch==='<'||ch===']'){ j++; continue; }
      if(ch==='{'){ while(j<body.length&&body[j]!=='}') j++; j++; continue; }   // 꾸밈음 무시
      if(ch==='"'){ j++; while(j<body.length&&body[j]!=='"') j++; j++; continue; } // 코드기호
      if(ch==='!'){ j++; while(j<body.length&&body[j]!=='!') j++; j++; continue; } // 장식기호
      var p=readPitch(); if(p){ var st=readLen(); if(!p.rest){ rawNotes.push({midi:p.midi, on:on, dur:st}); } on+=st; continue; } // 쉼표는 on만 진행
      j++; }

    var notes=[];
    for(var k=0;k<rawNotes.length;k++){ var rn=rawNotes[k]; notes.push({ on:rn.on, dur:rn.dur, midi:rn.midi, freq:midiFreq(rn.midi) }); }

    out.tempo=tempo; out.meterNum=meterNum; out.meterDen=meterDen;
    out.stepsPerBar=Math.round(16*meter);   // 4/4→16, 3/4→12
    out.notes=notes; out.totalSteps=on; out.tempoMap=tempoMap;
    return out;
  }

  /* ─────────── 피아노 샘플 프리로드(기기) ─────────── */
  function preload(ctx, midis){
    if(!ctx || typeof fetch!=='function' || !midis) return;
    for(var i=0;i<midis.length;i++){ (function(m){
      if(SAMPLE.buf[m]||SAMPLE.loading[m]) return; SAMPLE.loading[m]=true;
      try{
        fetch(SFBASE+midiName(m)+'.mp3').then(function(r){ if(!r.ok) throw 0; return r.arrayBuffer(); })
          .then(function(a){ return ctx.decodeAudioData(a); })
          .then(function(buf){ SAMPLE.buf[m]=buf; SAMPLE.loading[m]=false; })
          .catch(function(){ SAMPLE.loading[m]=false; });   // 차단/실패 → 조용히 폴백
      }catch(e){ SAMPLE.loading[m]=false; }
    })(midis[i]); }
  }

  /* ─────────── 한 음 재생 ─────────── */
  function playNote(ctx, out, sendVerb, freq, when, durSec, vel){
    if(!ctx||!freq) return;
    out=out||ctx.destination; vel=(vel==null?0.8:Math.max(0.05,Math.min(1,vel)));
    when=(when==null?ctx.currentTime:when); durSec=Math.max(0.05, durSec==null?0.4:durSec);
    var velGain=0.3+0.7*vel;                       // 벨로시티 → 음량
    var midi=freqMidi(freq);

    // (1) 샘플이 있으면 BufferSource (피치=playbackRate, 벨로시티=게인)
    var buf=SAMPLE.buf[midi];
    if(buf){ try{
      var src=ctx.createBufferSource(); src.buffer=buf;
      src.playbackRate.value=freq/midiFreq(midi)*(1+(Math.random()*2-1)*0.004);
      var sg=ctx.createGain(); sg.gain.value=velGain*0.9;
      src.connect(sg); sg.connect(out);
      if(typeof sendVerb==='function') sendVerb(sg,0.12);
      src.start(when); return;
    }catch(e){} }

    // (2) 리얼 피아노 합성 폴백 ── 기본음+배음 가산 · 빠른 어택/지수 감쇠 · 해머 노이즈 · 디튠
    var soundDur=durSec+0.6;                        // 음표 길이보다 길게 울리는 꼬리
    var voice=ctx.createGain();                      // 공통 엔벨로프(피아노 damped)
    voice.connect(out);
    if(typeof sendVerb==='function') sendVerb(voice,0.12);

    // 배음비(벨로시티 클수록 상위 배음↑ = 밝기↑), 합=1 로 정규화 → 클리핑 억제
    var bright=0.3+1.5*vel;                           // 벨로시티에 따른 밝기(상위 배음 가중)
    var amps=[1.0, 0.55*bright, 0.34*bright, 0.22*bright, 0.13*bright];
    var sum=0, a; for(a=0;a<amps.length;a++) sum+=amps[a]; for(a=0;a<amps.length;a++) amps[a]/=sum;
    var base=0.5*velGain;                            // 최악(동위상) 피크 ≤ 0.5*0.93 ≈ 0.47 < 1

    var oscs=[];
    for(var h=0;h<amps.length;h++){
      var o=ctx.createOscillator();
      o.type='sine';
      o.frequency.value=freq*(h+1)*(1+(Math.random()*2-1)*0.0016);  // 미세 디튠
      var pg=ctx.createGain(); pg.gain.value=amps[h]*base;
      o.connect(pg); pg.connect(voice);
      o.start(when); o.stop(when+soundDur+0.05); oscs.push(o);
    }
    // 피아노 엔벨로프: 빠른 어택 → 초기 급감 → 긴 지수 꼬리
    var g=voice.gain, pk=1.0;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(pk, when+0.004);
    g.exponentialRampToValueAtTime(pk*0.3, when+Math.min(0.14, durSec*0.5+0.05));
    g.exponentialRampToValueAtTime(0.0001, when+soundDur);

    // 해머(어택) 노이즈 — 짧고 약하게, 상위 대역
    try{
      var n=Math.floor(ctx.sampleRate*0.03), nb=ctx.createBuffer(1,n,ctx.sampleRate), d=nb.getChannelData(0);
      for(var s=0;s<n;s++) d[s]=(Math.random()*2-1)*Math.pow(1-s/n,2);
      var ns=ctx.createBufferSource(); ns.buffer=nb;
      var bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=Math.min(6000,freq*3); bp.Q.value=0.7;
      var ng=ctx.createGain(); ng.gain.value=0.08*velGain;
      ns.connect(bp); bp.connect(ng); ng.connect(out);
      if(typeof sendVerb==='function') sendVerb(ng,0.05);
      ns.start(when); ns.stop(when+0.04);
    }catch(e){}
  }

  window.DrumMusic={
    parseMelody: parseMelody,
    preload: preload,
    playNote: playNote,
    _midiName: midiName,   // 디버그/검증용
    _midiFreq: midiFreq
  };
})();
