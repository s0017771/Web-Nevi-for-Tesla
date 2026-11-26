/* ════════════════════════════════════════════════════════════════════════
   vr-drums-music.js  —  리듬세이버 실제 곡(멜로디 + 반주) 재생 자립형 모듈
   ---------------------------------------------------------------------------
   멜로디:
   · ABC 악보(V:1 treble 보이스)를 16분음표 격자 멜로디로 파싱(parseMelody)
   · 피아노 샘플(FluidR3_GM, 기기에서만) 프리로드(preload) — CDN 차단 시 조용히 폴백
   · 한 음 재생(playNote) — 샘플 있으면 BufferSource, 없으면 리얼 피아노 합성 폴백
   반주:
   · parseAccomp — V:2(bass) 최저음 베이스 라인 + V:1 코드심볼("Am" 등)을 코드톤으로
   · playBass  — 저음 베이스 톤(기본+배음+플럭)
   · playChord — 부드러운 코드 패드(다중음, 음수로 게인 정규화)
   ---------------------------------------------------------------------------
   · ES5 바닐라(var/function), 외부 라이브러리 없음. AudioContext/목적지/리버브는
     호스트(vr-drums.html)가 넘겨주므로 모듈은 자체 컨텍스트를 만들지 않는다.
   · vr-saber.html 의 parseABC 로직을 이식해 16분 스텝 API로 노출.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  var NAMES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  function midiName(m){ return NAMES[((m%12)+12)%12]+(Math.floor(m/12)-1); }   // midi→샘플 파일명(옥타브 -1 보정)
  function midiFreq(m){ return 440*Math.pow(2,(m-69)/12); }                    // A4(midi69)=440Hz
  function freqMidi(f){ return Math.round(69+12*Math.log(f/440)/Math.LN2); }
  function clamp(v,lo,hi,def){ return (v==null)?def:Math.max(lo,Math.min(hi,v)); }

  var SFBASE='https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/';
  var SAMPLE={ buf:{}, loading:{} };   // midi → AudioBuffer 캐시(기기용)

  /* ─────────── 코드 심볼 → 코드톤 주파수 ─────────── */
  function chordFreqs(name){
    if(!name) return null;
    var m=name.match(/^([A-G])([#b]?)(.*)$/); if(!m) return null;
    var PC={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
    var root=PC[m[1]]; if(root==null) return null;
    if(m[2]==='#') root+=1; else if(m[2]==='b') root-=1;
    var rest=m[3];
    var slash=rest.indexOf('/'); if(slash>=0) rest=rest.slice(0,slash);   // 슬래시 베이스음은 bass 담당 → 상부 트라이어드만
    var low=rest.toLowerCase();

    var quality;
    if(low.indexOf('maj')>=0 || low.indexOf('ma7')>=0) quality='maj';     // maj7 먼저(그 안의 'm' 오인 방지)
    else if(low.indexOf('dim')>=0 || low.charAt(0)==='o') quality='dim';
    else if(low.indexOf('aug')>=0 || low.indexOf('+')>=0) quality='aug';
    else if(low.charAt(0)==='m') quality='min';                           // m, m7, min
    else quality='maj';

    var third, fifth;
    if(quality==='maj'){ third=4; fifth=7; }
    else if(quality==='min'){ third=3; fifth=7; }
    else if(quality==='dim'){ third=3; fifth=6; }
    else { third=4; fifth=8; }                                            // aug

    if(low.indexOf('sus4')>=0) third=5;                                   // 서스펜디드 → 3도 치환
    else if(low.indexOf('sus2')>=0) third=2;
    else if(low.indexOf('sus')>=0) third=5;

    var offs=[0, third, fifth];
    if(low.indexOf('maj7')>=0 || low.indexOf('ma7')>=0) offs.push(11);    // 장7도
    else if(low.indexOf('7')>=0) offs.push(quality==='dim'?9:10);         // 감7 or 단7
    else if(low.indexOf('6')>=0) offs.push(9);                            // 6th

    var rootMidi=48+root;                                                 // C3대(130~) 중간 보이싱
    var fr=[]; for(var i=0;i<offs.length;i++) fr.push(midiFreq(rootMidi+offs[i]));
    return fr;
  }

  /* ─────────── 공통 보이스 파서 (ABC → 16분 격자 음표) ───────────
     voice: 1=treble(멜로디) 2=bass. pick: 'top'=화음 최고음 'bottom'=최저음.
     collectChords: V:1의 "..." 코드심볼 수집(on 위치 포함). */
  function parseVoice(abc, voice, pick, collectChords){
    var res={ notes:[], tempo:100, meterNum:4, meterDen:4, stepsPerBar:16, totalSteps:0, tempoMap:[{on:0,tempo:100}], chordSyms:[] };
    if(!abc||!abc.trim()) return res;
    var lines=abc.replace(/\r/g,'').split('\n'), L=null, meterNum=4, meterDen=4, tempo=0, keySig={}, inBody=false, bodyLines=[];
    var SH={'C':[],'G':['F'],'D':['F','C'],'A':['F','C','G'],'E':['F','C','G','D'],'B':['F','C','G','D','A'],'F#':['F','C','G','D','A','E'],'C#':['F','C','G','D','A','E','B']};
    var FL={'F':['B'],'Bb':['B','E'],'Eb':['B','E','A'],'Ab':['B','E','A','D'],'Db':['B','E','A','D','G'],'Gb':['B','E','A','D','G','C'],'Cb':['B','E','A','D','G','C','F']};
    function key(k){ keySig={}; var kk=(k||'C').trim().replace(/\s.*$/,''); if(!kk) return; kk=kk.charAt(0).toUpperCase()+kk.slice(1);
      if(SH[kk]) SH[kk].forEach(function(n){keySig[n]=1;}); else if(FL[kk]) FL[kk].forEach(function(n){keySig[n]=-1;}); }

    for(var i=0;i<lines.length;i++){ var ln=lines[i];
      if(!inBody){ var mh=ln.match(/^([A-Za-z]):\s*(.*)$/);
        if(mh){ var f=mh[1], v=mh[2];
          if(f==='L'){ var p=v.match(/(\d+)\s*\/\s*(\d+)/); if(p) L=+p[1]/+p[2]; }
          else if(f==='Q'){ var q=v.match(/=\s*(\d+)/); if(q) tempo=+q[1]; }
          else if(f==='M'){ var mo=v.match(/(\d+)\s*\/\s*(\d+)/); if(mo){ meterNum=+mo[1]; meterDen=+mo[2]; } }
          else if(f==='K'){ key(v); inBody=true; } continue; }
        continue; }
      else bodyLines.push(ln); }

    // 해당 보이스만 추려 이어붙임
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
    var SEMI={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}, rawNotes=[], chordSyms=[], on=0, barAcc={}, j=0;

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
        // 화음 [..]N : 안쪽 음 모으고 ']' 뒤 길이 적용, 대표음(top=최고, bottom=최저)
        j++; var cf=[]; while(j<body.length && body[j]!==']'){
          if(body[j]==='"'){ j++; while(j<body.length&&body[j]!=='"') j++; j++; continue; }
          var pb=readPitch(); if(pb){ if(!pb.rest) cf.push(pb.midi); while(/[\d\/]/.test(body[j])) j++; } else j++; }
        if(body[j]===']') j++;
        var cs=readLen(); if(cf.length){ var mm=(pick==='bottom'?Math.min:Math.max).apply(null,cf); rawNotes.push({midi:mm, on:on, dur:cs}); on+=cs; }
        continue; }
      if(ch==='|'){ barAcc={}; j++; continue; }
      if(ch===' '||ch==='\t'||ch==='-'||ch==='('||ch===')'||ch===':'||ch==='>'||ch==='<'||ch===']'){ j++; continue; }
      if(ch==='{'){ while(j<body.length&&body[j]!=='}') j++; j++; continue; }   // 꾸밈음 무시
      if(ch==='"'){ j++; var txt=''; while(j<body.length&&body[j]!=='"'){ txt+=body[j]; j++; } j++;   // 코드기호/주석
        if(collectChords && /^[A-G]/.test(txt)) chordSyms.push({on:on, name:txt}); continue; }       // "^..."주석은 제외
      if(ch==='!'){ j++; while(j<body.length&&body[j]!=='!') j++; j++; continue; } // 장식기호
      var pp=readPitch(); if(pp){ var st=readLen(); if(!pp.rest){ rawNotes.push({midi:pp.midi, on:on, dur:st}); } on+=st; continue; } // 쉼표는 on만 진행
      j++; }

    var notes=[];
    for(var k=0;k<rawNotes.length;k++){ var rn=rawNotes[k]; notes.push({ on:rn.on, dur:rn.dur, midi:rn.midi, freq:midiFreq(rn.midi) }); }

    res.notes=notes; res.tempo=tempo; res.meterNum=meterNum; res.meterDen=meterDen;
    res.stepsPerBar=Math.round(16*meter); res.totalSteps=on; res.tempoMap=tempoMap; res.chordSyms=chordSyms;
    return res;
  }

  /* ─────────── 멜로디(V:1) ─────────── */
  function parseMelody(abc){
    var r=parseVoice(abc, 1, 'top', false);
    return { tempo:r.tempo, meterNum:r.meterNum, meterDen:r.meterDen, stepsPerBar:r.stepsPerBar,
             notes:r.notes, totalSteps:r.totalSteps, tempoMap:r.tempoMap };
  }

  /* ─────────── 반주(베이스 V:2 + 코드 V:1) ─────────── */
  function parseAccomp(abc){
    var bassR=parseVoice(abc, 2, 'bottom', false);          // V:2 최저음 → 베이스
    var melR =parseVoice(abc, 1, 'top',    true);           // V:1 코드심볼 수집
    var spb=melR.stepsPerBar, total=melR.totalSteps;

    var bass=bassR.notes;                                   // [{on,dur,midi,freq}]

    // 코드심볼 → 코드톤 + dur(다음 코드까지, 없으면 마디 끝/1마디)
    var syms=melR.chordSyms, tmp=[];
    for(var i=0;i<syms.length;i++){ var fr=chordFreqs(syms[i].name); if(fr&&fr.length) tmp.push({on:syms[i].on, freqs:fr}); }
    var chords=[];
    for(i=0;i<tmp.length;i++){
      var j2=i+1; while(j2<tmp.length && tmp[j2].on<=tmp[i].on) j2++;   // 같은 스텝 중복은 건너뛰고 다음 스텝까지
      var dur;
      if(j2<tmp.length) dur=tmp[j2].on-tmp[i].on;
      else dur=Math.max(spb, total-tmp[i].on);
      if(dur<=0) dur=spb;
      chords.push({on:tmp[i].on, dur:dur, freqs:tmp[i].freqs});
    }
    return { bass:bass, chords:chords, stepsPerBar:spb };   // stepsPerBar는 참고용 부가정보
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

  /* ─────────── 멜로디 한 음 재생 ─────────── */
  function playNote(ctx, out, sendVerb, freq, when, durSec, vel){
    if(!ctx||!freq) return;
    out=out||ctx.destination; vel=clamp(vel,0.05,1,0.8);
    when=(when==null?ctx.currentTime:when); durSec=Math.max(0.05, durSec==null?0.4:durSec);
    var velGain=0.3+0.7*vel;
    var midi=freqMidi(freq);

    // (1) 샘플이 있으면 BufferSource
    var buf=SAMPLE.buf[midi];
    if(buf){ try{
      var src=ctx.createBufferSource(); src.buffer=buf;
      src.playbackRate.value=freq/midiFreq(midi)*(1+(Math.random()*2-1)*0.004);
      var sg=ctx.createGain(); sg.gain.value=velGain*0.9;
      src.connect(sg); sg.connect(out);
      if(typeof sendVerb==='function') sendVerb(sg,0.12);
      src.start(when); return;
    }catch(e){} }

    // (2) 리얼 피아노 합성 폴백
    var soundDur=durSec+0.6;
    var voice=ctx.createGain(); voice.connect(out);
    if(typeof sendVerb==='function') sendVerb(voice,0.12);
    var bright=0.3+1.5*vel;
    var amps=[1.0, 0.55*bright, 0.34*bright, 0.22*bright, 0.13*bright];
    var sum=0, a; for(a=0;a<amps.length;a++) sum+=amps[a]; for(a=0;a<amps.length;a++) amps[a]/=sum;
    var base=0.5*velGain;
    for(var h=0;h<amps.length;h++){
      var o=ctx.createOscillator(); o.type='sine';
      o.frequency.value=freq*(h+1)*(1+(Math.random()*2-1)*0.0016);
      var pg=ctx.createGain(); pg.gain.value=amps[h]*base;
      o.connect(pg); pg.connect(voice);
      o.start(when); o.stop(when+soundDur+0.05);
    }
    var g=voice.gain;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(1.0, when+0.004);
    g.exponentialRampToValueAtTime(0.3, when+Math.min(0.14, durSec*0.5+0.05));
    g.exponentialRampToValueAtTime(0.0001, when+soundDur);
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

  /* ─────────── 베이스 한 음 재생 ───────────
     저음 삼각+사인 기본 + 약한 2·3차 배음 + 짧은 플럭 어택, 서스테인·감쇠. */
  function playBass(ctx, out, sendVerb, freq, when, durSec, vel){
    if(!ctx||!freq) return;
    out=out||ctx.destination; vel=clamp(vel,0.05,1,0.6);
    when=(when==null?ctx.currentTime:when); durSec=Math.max(0.08, durSec==null?0.4:durSec);
    var velGain=0.3+0.7*vel;
    var voice=ctx.createGain(); voice.connect(out);
    if(typeof sendVerb==='function') sendVerb(voice,0.04);
    var base=0.55*velGain;
    var amps=[1.0, 0.24, 0.09], types=['triangle','sine','sine'];     // 기본음 + 약한 상위배음
    var sum=0, a; for(a=0;a<amps.length;a++) sum+=amps[a]; for(a=0;a<amps.length;a++) amps[a]/=sum;
    for(var h=0;h<amps.length;h++){
      var o=ctx.createOscillator(); o.type=types[h];
      o.frequency.value=freq*(h+1)*(1+(Math.random()*2-1)*0.001);
      var pg=ctx.createGain(); pg.gain.value=amps[h]*base;
      o.connect(pg); pg.connect(voice);
      o.start(when); o.stop(when+durSec+0.22);
    }
    var g=voice.gain, sus=0.7;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(1.0, when+0.006);                   // 플럭 어택
    g.exponentialRampToValueAtTime(sus, when+0.08);                    // 서스테인으로 안정
    g.setValueAtTime(sus, when+Math.max(0.09, durSec*0.6));
    g.exponentialRampToValueAtTime(0.0001, when+durSec+0.18);          // 릴리스
    // 짧은 플럭 클릭(저역)
    try{
      var n=Math.floor(ctx.sampleRate*0.012), nb=ctx.createBuffer(1,n,ctx.sampleRate), d=nb.getChannelData(0);
      for(var s=0;s<n;s++) d[s]=(Math.random()*2-1)*Math.pow(1-s/n,2);
      var ns=ctx.createBufferSource(); ns.buffer=nb;
      var lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=Math.min(1800,freq*4);
      var ng=ctx.createGain(); ng.gain.value=0.05*velGain;
      ns.connect(lp); lp.connect(ng); ng.connect(out);
      ns.start(when); ns.stop(when+0.02);
    }catch(e){}
  }

  /* ─────────── 코드 패드 재생 ───────────
     여러 음 동시 · 부드러운 어택/서스테인 · 음수로 게인 정규화(클리핑 방지). */
  function playChord(ctx, out, sendVerb, freqs, when, durSec, vel){
    if(!ctx||!freqs||!freqs.length) return;
    out=out||ctx.destination; vel=clamp(vel,0.05,1,0.35);
    when=(when==null?ctx.currentTime:when); durSec=Math.max(0.1, durSec==null?0.8:durSec);
    var velGain=0.3+0.7*vel, nN=freqs.length;
    var voice=ctx.createGain(); voice.connect(out);
    if(typeof sendVerb==='function') sendVerb(voice,0.18);
    var base=0.5*velGain/nN;                                           // 음 수로 정규화 → 최악 피크 ≤ 0.5*velGain
    for(var i=0;i<nN;i++){
      var f=freqs[i];
      var pAmps=[1.0, 0.3], pMul=[1,2], ps=1.3;                        // 음마다 기본음+약한 옥타브
      for(var k=0;k<pAmps.length;k++){
        var o=ctx.createOscillator(); o.type='sine';
        o.frequency.value=f*pMul[k]*(1+(Math.random()*2-1)*0.0015);
        var pg=ctx.createGain(); pg.gain.value=(pAmps[k]/ps)*base;
        o.connect(pg); pg.connect(voice);
        o.start(when); o.stop(when+durSec+0.3);
      }
    }
    var g=voice.gain;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(1.0, when+0.02);                    // 부드러운 어택
    g.setValueAtTime(1.0, when+Math.max(0.03, durSec*0.55));           // 서스테인
    g.exponentialRampToValueAtTime(0.0001, when+durSec+0.28);          // 완만한 릴리스
  }

  window.DrumMusic={
    parseMelody: parseMelody,
    parseAccomp: parseAccomp,
    preload: preload,
    playNote: playNote,
    playBass: playBass,
    playChord: playChord,
    _midiName: midiName,     // 디버그/검증용
    _midiFreq: midiFreq,
    _chordFreqs: chordFreqs
  };
})();
