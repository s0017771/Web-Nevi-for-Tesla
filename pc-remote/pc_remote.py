#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
브로가드 PC 리모컨 — 1단계: 화면 미러링 (보기 전용)
=====================================================
PC(윈도우) 화면을 같은 와이파이의 폰/태블릿 브라우저에서 실시간으로 봅니다.
※ 이 단계는 '보기'만 합니다. 마우스/키보드 조작은 다음 단계에서 추가해요.

[설치]  (PC에서 한 번만)
    pip install mss pillow
[실행]
    python pc_remote.py
그러면 접속 주소(http://192.168.x.x:8787)와 PIN이 터미널에 뜹니다.
폰 브라우저에서 그 주소를 열고 PIN을 입력하세요. (PC와 같은 와이파이)

옵션:
    python pc_remote.py --port 9000     # 포트 변경
    python pc_remote.py --pin 2580      # PIN 직접 지정
    python pc_remote.py --no-pin        # PIN 없이
    python pc_remote.py --fps 15        # 초당 프레임(기본 12)
    python pc_remote.py --demo          # 데모(가짜 화면) — 테스트용

실행하면 '윈도우 방화벽' 창이 뜰 수 있어요 → '액세스 허용'(개인 네트워크)을 눌러야
폰이 접속됩니다. 끝나면 이 창에서 Ctrl+C 로 종료하세요.
"""
import sys, io, json, time, threading, random, socket, argparse, math

from PIL import Image, ImageDraw   # 데모 프레임 + JPEG 인코딩에 필요

AP = argparse.ArgumentParser(add_help=False)
AP.add_argument('--port', type=int, default=8787)
AP.add_argument('--pin', default=None)
AP.add_argument('--no-pin', action='store_true')
AP.add_argument('--demo', action='store_true')
AP.add_argument('--fps', type=int, default=12)
ARGS, _ = AP.parse_known_args()

# ---------------- 화면 캡처 백엔드 (mss) / 데모 ----------------
REAL = False
if not ARGS.demo:
    try:
        import mss
        with mss.mss() as _s:
            _m = _s.monitors[1]
            SCREEN_W, SCREEN_H = _m['width'], _m['height']
            _MON = dict(_m)
        REAL = True
    except Exception as e:
        print('[알림] mss 를 찾지 못해 데모 모드로 실행합니다.')
        print('       실제 화면을 보려면:  pip install mss pillow')
        print('       (자세한 오류: %s)' % e)

if not REAL:
    SCREEN_W, SCREEN_H = 1280, 720

PIN = None if ARGS.no_pin else (str(ARGS.pin) if ARGS.pin else ('%04d' % random.randint(0, 9999)))

# ---------------- 프레임 생성 ----------------
_t0 = time.time()
_thread_local = threading.local()

def _demo_frame():
    img = Image.new('RGB', (SCREEN_W, SCREEN_H), (24, 30, 42))
    d = ImageDraw.Draw(img)
    for gx in range(0, SCREEN_W, 80):
        d.line([(gx, 0), (gx, SCREEN_H)], fill=(38, 46, 62))
    for gy in range(0, SCREEN_H, 80):
        d.line([(0, gy), (SCREEN_W, gy)], fill=(38, 46, 62))
    el = time.time() - _t0
    bx = int((0.5 + 0.38 * math.sin(el)) * SCREEN_W)
    by = int((0.5 + 0.38 * math.cos(el * 0.7)) * SCREEN_H)
    d.rectangle([bx - 45, by - 45, bx + 45, by + 45], outline=(90, 160, 255), width=5)
    d.text((28, 22), 'DEMO 화면 (미러링 테스트)  %.1fs' % el, fill=(222, 232, 246))
    d.text((28, 46), '%d x %d' % (SCREEN_W, SCREEN_H), fill=(150, 200, 255))
    return img

def _capture():
    if not REAL:
        return _demo_frame()
    s = getattr(_thread_local, 'mss', None)
    if s is None:
        s = _thread_local.mss = mss.mss()
    raw = s.grab(_MON)
    return Image.frombytes('RGB', raw.size, raw.bgra, 'raw', 'BGRX')

def grab_jpeg(quality=55, max_w=960):
    img = _capture()
    if max_w and img.width > max_w:
        r = max_w / img.width
        img = img.resize((int(max_w), int(img.height * r)))
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=int(quality))
    return buf.getvalue()

# ---------------- HTTP 서버 ----------------
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80)); ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def auth_ok(q, headers):
    if PIN is None:
        return True
    return ((q.get('pin', [None])[0]) or headers.get('X-PIN')) == PIN

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        u = urlparse(self.path); path = u.path; q = parse_qs(u.query)
        if path in ('/', '/index.html'):
            return self._send(200, 'text/html; charset=utf-8', PAGE)
        if path == '/ping':
            ok = auth_ok(q, self.headers)
            return self._send(200 if ok else 401, 'application/json', json.dumps({'ok': ok}))
        if path == '/info':
            if not auth_ok(q, self.headers):
                return self._send(401, 'application/json', '{"ok":false}')
            return self._send(200, 'application/json', json.dumps(
                {'ok': True, 'w': SCREEN_W, 'h': SCREEN_H, 'real': REAL, 'pinRequired': PIN is not None}))
        if path == '/frame.jpg':
            if not auth_ok(q, self.headers):
                return self._send(401, 'text/plain', 'pin')
            return self._send(200, 'image/jpeg',
                              grab_jpeg(int(q.get('q', ['55'])[0]), int(q.get('w', ['960'])[0])))
        if path == '/stream.mjpg':
            if not auth_ok(q, self.headers):
                return self._send(401, 'text/plain', 'pin')
            return self._stream(int(q.get('q', ['55'])[0]), int(q.get('w', ['960'])[0]))
        return self._send(404, 'text/plain', 'not found')

    def _stream(self, quality, max_w):
        self.send_response(200)
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        delay = 1.0 / max(1, min(30, ARGS.fps))
        try:
            while True:
                jpg = grab_jpeg(quality, max_w)
                self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n')
                self.wfile.write(('Content-Length: %d\r\n\r\n' % len(jpg)).encode())
                self.wfile.write(jpg)
                self.wfile.write(b'\r\n')
                time.sleep(delay)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

# ---------------- 폰 UI (보기 전용) ----------------
PAGE = r"""<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>브로가드 PC 리모컨 · 화면</title>
<style>
  :root{--bg:#0c111a;--panel:#161f2e;--panel2:#1d2a3e;--line:#2a394f;--text:#e9f0f7;--muted:#8fa0b5;--accent:#4b9bff;--good:#37e0a6;--bad:#ff7a7a}
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
  html,body{height:100%}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",Roboto,"Noto Sans KR",sans-serif;display:flex;flex-direction:column;height:100dvh;overflow:hidden}
  #login{position:fixed;inset:0;background:#0c111af2;display:flex;align-items:center;justify-content:center;z-index:40;padding:24px}
  #login .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px 22px;max-width:340px;width:100%;text-align:center}
  #login h1{font-size:1.2rem;font-weight:800;margin-bottom:4px}
  #login p{color:var(--muted);font-size:.85rem;margin-bottom:16px;line-height:1.5}
  #login input{width:100%;font-size:1.5rem;text-align:center;letter-spacing:.3em;padding:12px;border-radius:12px;border:1px solid var(--line);background:#0f1826;color:var(--text);font-family:inherit}
  #login button{margin-top:14px;width:100%;font-family:inherit;font-weight:800;font-size:1rem;padding:14px;border-radius:12px;border:none;background:linear-gradient(180deg,#4b9bff,#2f6fe0);color:#fff;cursor:pointer}
  #login .err{color:var(--bad);font-size:.82rem;min-height:1.1em;margin-top:8px}
  header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 13px;flex:0 0 auto;font-size:.82rem}
  header .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--bad);margin-right:6px;vertical-align:middle}
  header .dot.on{background:var(--good)}
  header .right{color:var(--muted)}
  .stage{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;padding:4px;background:#05080d}
  #screen{max-width:100%;max-height:100%;display:block;border-radius:6px;background:#05080d}
  .bar{flex:0 0 auto;display:flex;gap:8px;padding:9px 12px calc(10px + env(safe-area-inset-bottom))}
  .bar button{flex:1;font-family:inherit;font-weight:700;font-size:.86rem;padding:13px 8px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer}
  .note{text-align:center;font-size:.72rem;color:var(--muted);padding:0 12px 8px}
</style></head>
<body>
<div id="login"><div class="card">
  <h1>&#128421;&#65039; PC 화면 보기</h1>
  <p>PC 화면(터미널)에 표시된 <b>PIN</b>을 입력하세요.<br>PC와 같은 와이파이여야 해요.</p>
  <input id="pinInput" type="tel" inputmode="numeric" placeholder="PIN" autocomplete="off">
  <div class="err" id="loginErr"></div>
  <button id="loginBtn">접속</button>
</div></div>

<header>
  <span><span class="dot" id="dot"></span><span id="statusText">연결 중…</span></span>
  <span class="right" id="resInfo"></span>
</header>
<div class="stage"><img id="screen" alt="PC 화면"></div>
<div class="bar">
  <button id="btnQ">&#128444;&#65039; 화질: 보통</button>
  <button id="btnReload">&#128260; 다시 연결</button>
  <button id="btnFull">&#9974; 전체화면</button>
</div>
<div class="note">1단계 · 보기 전용 — 다음 단계에서 터치 조작이 추가됩니다</div>

<script>
'use strict';
const $=s=>document.querySelector(s);
let PIN=localStorage.getItem('pcremote_pin')||'';
let QLV=1; const QS=[{w:640,q:45,n:'낮음'},{w:960,q:55,n:'보통'},{w:1280,q:68,n:'높음'}];
function api(p){ return p+(p.includes('?')?'&':'?')+'pin='+encodeURIComponent(PIN); }
function setStatus(on){ $('#dot').classList.toggle('on',on); $('#statusText').textContent=on?'연결됨':'연결 끊김'; }

async function connect(){
  try{
    const r=await fetch(api('/ping')); if(!r.ok) throw 0;
    const inf=await (await fetch(api('/info'))).json();
    $('#resInfo').textContent = inf.w+'×'+inf.h+(inf.real?'':'  (데모)');
    $('#login').style.display='none';
    startStream(); setStatus(true); return true;
  }catch(e){ return false; }
}
function startStream(){ const q=QS[QLV]; $('#screen').src=api('/stream.mjpg')+'&w='+q.w+'&q='+q.q+'&t='+Date.now(); }
$('#screen').addEventListener('load',()=>setStatus(true));
$('#screen').addEventListener('error',()=>{ setStatus(false); setTimeout(startStream,1500); });

$('#loginBtn').onclick=async()=>{
  PIN=$('#pinInput').value.trim();
  if(await connect()){ localStorage.setItem('pcremote_pin',PIN); }
  else $('#loginErr').textContent='PIN이 틀렸거나 연결이 안 돼요.';
};
$('#pinInput').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#loginBtn').click(); });
$('#btnQ').onclick=()=>{ QLV=(QLV+1)%QS.length; $('#btnQ').textContent='🖼️ 화질: '+QS[QLV].n; startStream(); };
$('#btnReload').onclick=startStream;
$('#btnFull').onclick=()=>{ const el=document.documentElement; if(!document.fullscreenElement){ (el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el); } else { (document.exitFullscreen||function(){}).call(document); } };

if(PIN){ $('#pinInput').value=PIN; connect(); }
window.__REMOTE_TEST__={ connect, startStream, get pin(){return PIN}, setPin(p){PIN=p}, qlv(){return QLV} };
</script>
</body></html>"""

def main():
    ip = lan_ip()
    srv = ThreadingHTTPServer(('0.0.0.0', ARGS.port), H)
    srv.daemon_threads = True
    print('=' * 54)
    print('  브로가드 PC 리모컨 · 1단계 화면 미러링  %s' % ('' if REAL else '(데모)'))
    print('=' * 54)
    print('  폰/태블릿 브라우저에서 아래 주소를 여세요:')
    print('      http://%s:%d' % (ip, ARGS.port))
    print('  PIN:  %s' % (PIN if PIN is not None else '(없음)'))
    print('  화면: %d x %d' % (SCREEN_W, SCREEN_H))
    print('  (PC와 폰이 같은 와이파이 /  종료: Ctrl+C)')
    print('  * 방화벽 창이 뜨면 "액세스 허용"(개인 네트워크)을 눌러주세요.')
    print('=' * 54)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n종료합니다.')
        srv.shutdown()

if __name__ == '__main__':
    main()
