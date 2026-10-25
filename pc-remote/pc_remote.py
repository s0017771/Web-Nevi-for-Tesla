#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
브로가드 PC 리모컨
==================
폰/태블릿에서 같은 와이파이의 Windows PC를 다룹니다.
  • 화면 보기(미러링)  — PC 화면을 폰에서 실시간으로 (설치: mss, pillow)
  • 파일 열람(뷰어)    — 지정한 폴더의 파일을 폰에서 미리보기만 (추가 설치 없음)

[설치]  (화면 기능을 쓸 때만)
    pip install mss pillow
[실행]
    python pc_remote.py                       # 파일 폴더 기본값 = 바탕화면
    python pc_remote.py --root "D:\\공유폴더"   # 파일로 열어줄 폴더 지정
접속 주소(http://192.168.x.x:8787)와 PIN이 터미널에 뜹니다.
폰 브라우저에서 그 주소를 열고 PIN 입력 → [화면] 또는 [파일] 선택.

옵션:
    --port 9000     포트 변경(기본 8787)
    --pin 2580      PIN 직접 지정
    --no-pin        PIN 없이
    --root PATH     파일로 열어줄 폴더(이 폴더 밖은 접근 불가)
    --fps 15        화면 초당 프레임(기본 12)
    --demo          화면을 가짜(데모)로 — 테스트용

실행하면 '윈도우 방화벽' 창이 뜰 수 있어요 → '액세스 허용'(개인 네트워크).
종료: 이 창에서 Ctrl+C.  같은 와이파이 안에서만 쓰세요(PIN 권장).
"""
import sys, os, io, json, time, threading, random, socket, argparse, math, mimetypes
from datetime import datetime

AP = argparse.ArgumentParser(add_help=False)
AP.add_argument('--port', type=int, default=8787)
AP.add_argument('--pin', default=None)
AP.add_argument('--no-pin', action='store_true')
AP.add_argument('--root', default=None)
AP.add_argument('--demo', action='store_true')
AP.add_argument('--fps', type=int, default=12)
ARGS, _ = AP.parse_known_args()

# ---------------- Pillow (화면 기능 전용, 선택) ----------------
try:
    from PIL import Image, ImageDraw
    HAVE_PIL = True
except Exception:
    HAVE_PIL = False

# ---------------- 화면 백엔드 결정 ----------------
# SCREEN_MODE: 'real'(실제 캡처) | 'demo'(가짜) | 'off'(불가)
SCREEN_MODE = 'off'
SCREEN_W, SCREEN_H = 1280, 720
_MON = None
if HAVE_PIL:
    if ARGS.demo:
        SCREEN_MODE = 'demo'
    else:
        try:
            import mss
            with mss.mss() as _s:
                _m = _s.monitors[1]
                SCREEN_W, SCREEN_H = _m['width'], _m['height']
                _MON = dict(_m)
            SCREEN_MODE = 'real'
        except Exception as e:
            SCREEN_MODE = 'demo'
            print('[알림] mss 없음 → 화면은 데모로 표시됩니다. (실제 화면: pip install mss)')

# ---------------- 파일 루트 결정 ----------------
def default_root():
    home = os.path.expanduser('~')
    for cand in (os.path.join(home, 'Desktop'),
                 os.path.join(home, 'OneDrive', 'Desktop'),
                 os.path.join(home, '바탕 화면')):
        if os.path.isdir(cand):
            return cand
    return home

ROOT = os.path.realpath(ARGS.root) if ARGS.root else os.path.realpath(default_root())
ROOT_NAME = os.path.basename(ROOT.rstrip(os.sep)) or ROOT

PIN = None if ARGS.no_pin else (str(ARGS.pin) if ARGS.pin else ('%04d' % random.randint(0, 9999)))

# ---------------- 파일 헬퍼 ----------------
IMG = {'png','jpg','jpeg','gif','webp','bmp','svg','ico','avif'}
VID = {'mp4','webm','m4v','mov','ogv'}
AUD = {'mp3','wav','ogg','m4a','aac','flac','opus'}
PDF = {'pdf'}
TXT = {'txt','md','markdown','csv','tsv','log','json','js','mjs','ts','tsx','jsx','py','html','htm',
       'css','java','c','cpp','cc','h','hpp','cs','go','rs','rb','php','sh','bat','ps1','yml','yaml',
       'ini','cfg','conf','xml','sql','r','kt','swift','dart','vue','toml','env','gitignore','properties'}

def kind_of(name):
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if ext in IMG: return 'image'
    if ext in VID: return 'video'
    if ext in AUD: return 'audio'
    if ext in PDF: return 'pdf'
    if ext in TXT: return 'text'
    return 'other'

def safe_path(rel):
    rel = (rel or '').replace('\\', '/').lstrip('/')
    full = os.path.realpath(os.path.join(ROOT, rel))
    if full != ROOT and not full.startswith(ROOT + os.sep):
        return None
    return full

def human_size(n):
    for u in ('B','KB','MB','GB','TB'):
        if n < 1024 or u == 'TB':
            return ('%d %s' % (n, u)) if u == 'B' else ('%.1f %s' % (n, u))
        n /= 1024.0

CTYPE = {'svg':'image/svg+xml','mp4':'video/mp4','webm':'video/webm','mov':'video/quicktime',
         'm4v':'video/x-m4v','ogv':'video/ogg','mp3':'audio/mpeg','wav':'audio/wav','ogg':'audio/ogg',
         'm4a':'audio/mp4','aac':'audio/aac','flac':'audio/flac','opus':'audio/opus','pdf':'application/pdf'}
def ctype_of(name):
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if ext in CTYPE: return CTYPE[ext]
    if ext in TXT: return 'text/plain; charset=utf-8'
    g = mimetypes.guess_type(name)[0]
    return g or 'application/octet-stream'

# ---------------- 화면 캡처 ----------------
_t0 = time.time()
_tl = threading.local()
def _demo_frame():
    img = Image.new('RGB', (SCREEN_W, SCREEN_H), (24, 30, 42))
    d = ImageDraw.Draw(img)
    for gx in range(0, SCREEN_W, 80): d.line([(gx,0),(gx,SCREEN_H)], fill=(38,46,62))
    for gy in range(0, SCREEN_H, 80): d.line([(0,gy),(SCREEN_W,gy)], fill=(38,46,62))
    el = time.time() - _t0
    bx = int((0.5+0.38*math.sin(el))*SCREEN_W); by = int((0.5+0.38*math.cos(el*0.7))*SCREEN_H)
    d.rectangle([bx-45,by-45,bx+45,by+45], outline=(90,160,255), width=5)
    d.text((28,22), 'DEMO 화면 (미러링 테스트)  %.1fs' % el, fill=(222,232,246))
    d.text((28,46), '%d x %d' % (SCREEN_W, SCREEN_H), fill=(150,200,255))
    return img
def _capture():
    if SCREEN_MODE == 'real':
        s = getattr(_tl, 'mss', None)
        if s is None: s = _tl.mss = mss.mss()
        raw = s.grab(_MON)
        return Image.frombytes('RGB', raw.size, raw.bgra, 'raw', 'BGRX')
    return _demo_frame()
def grab_jpeg(quality=55, max_w=960):
    img = _capture()
    if max_w and img.width > max_w:
        r = max_w/img.width; img = img.resize((int(max_w), int(img.height*r)))
    buf = io.BytesIO(); img.save(buf, 'JPEG', quality=int(quality)); return buf.getvalue()

# ---------------- HTTP ----------------
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(('8.8.8.8',80)); ip = s.getsockname()[0]
    except Exception: ip = '127.0.0.1'
    finally: s.close()
    return ip

def auth_ok(q, headers):
    if PIN is None: return True
    return ((q.get('pin',[None])[0]) or headers.get('X-PIN')) == PIN

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass

    def _send(self, code, ctype, body, extra=None):
        if isinstance(body, str): body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k,v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError): pass

    def do_GET(self):
        u = urlparse(self.path); path = u.path; q = parse_qs(u.query)
        # pages
        if path in ('/','/index.html'): return self._send(200,'text/html; charset=utf-8', MENU_PAGE)
        if path == '/screen': return self._send(200,'text/html; charset=utf-8', SCREEN_PAGE)
        if path == '/files':  return self._send(200,'text/html; charset=utf-8', FILES_PAGE)
        # auth-gated API
        if path == '/ping':
            ok = auth_ok(q,self.headers); return self._send(200 if ok else 401,'application/json',json.dumps({'ok':ok}))
        if not auth_ok(q,self.headers):
            return self._send(401,'application/json','{"ok":false}')
        if path == '/info':
            return self._send(200,'application/json', json.dumps({'ok':True,'w':SCREEN_W,'h':SCREEN_H,
                'screen':SCREEN_MODE,'pinRequired':PIN is not None,'rootName':ROOT_NAME}))
        if path == '/frame.jpg':
            if SCREEN_MODE=='off': return self._send(503,'text/plain','no-screen')
            return self._send(200,'image/jpeg', grab_jpeg(int(q.get('q',['55'])[0]), int(q.get('w',['960'])[0])))
        if path == '/stream.mjpg':
            if SCREEN_MODE=='off': return self._send(503,'text/plain','no-screen')
            return self._stream(int(q.get('q',['55'])[0]), int(q.get('w',['960'])[0]))
        if path == '/ls':   return self._ls(q.get('path',[''])[0])
        if path == '/view': return self._view(q.get('path',[''])[0])
        return self._send(404,'text/plain','not found')

    # ---- screen stream ----
    def _stream(self, quality, max_w):
        self.send_response(200)
        self.send_header('Content-Type','multipart/x-mixed-replace; boundary=frame')
        self.send_header('Cache-Control','no-store'); self.end_headers()
        delay = 1.0/max(1,min(30,ARGS.fps))
        try:
            while True:
                jpg = grab_jpeg(quality, max_w)
                self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n')
                self.wfile.write(('Content-Length: %d\r\n\r\n'%len(jpg)).encode())
                self.wfile.write(jpg); self.wfile.write(b'\r\n')
                time.sleep(delay)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    # ---- file list ----
    def _ls(self, rel):
        full = safe_path(rel)
        if not full or not os.path.isdir(full):
            return self._send(404,'application/json','{"ok":false,"err":"폴더 없음"}')
        dirs, files = [], []
        try:
            names = os.listdir(full)
        except Exception as e:
            return self._send(403,'application/json', json.dumps({'ok':False,'err':str(e)}))
        for name in names:
            fp = os.path.join(full, name)
            try: st = os.stat(fp); isdir = os.path.isdir(fp)
            except Exception: continue
            item = {'name':name,'isDir':isdir,
                    'size':0 if isdir else st.st_size,
                    'sizeh':'' if isdir else human_size(st.st_size),
                    'mtime':datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M'),
                    'kind':'dir' if isdir else kind_of(name)}
            (dirs if isdir else files).append(item)
        dirs.sort(key=lambda x:x['name'].lower()); files.sort(key=lambda x:x['name'].lower())
        here = os.path.relpath(full, ROOT); here = '' if here=='.' else here.replace('\\','/')
        parent = '' if not here else os.path.dirname(here).replace('\\','/')
        return self._send(200,'application/json', json.dumps({'ok':True,'path':here,'parent':parent,
            'rootName':ROOT_NAME,'canUp':full!=ROOT,'entries':dirs+files}))

    # ---- file view (inline, Range 지원) ----
    def _view(self, rel):
        full = safe_path(rel)
        if not full or not os.path.isfile(full):
            return self._send(404,'text/plain','파일 없음')
        size = os.path.getsize(full)
        name = os.path.basename(full)
        ctype = ctype_of(name)
        start, end, partial = 0, size-1, False
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            try:
                s,e = rng[6:].split('-'); start = int(s) if s else 0
                end = int(e) if e else size-1; partial = True
            except Exception: partial = False
        end = min(end, size-1); start = max(0, min(start, end)); length = end-start+1
        self.send_response(206 if partial else 200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store')
        # 다운로드 버튼은 두지 않지만, 브라우저가 띄울 수 있게 inline
        self.send_header('Content-Disposition', "inline; filename*=UTF-8''%s" % quote(name))
        if partial:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start,end,size))
        self.end_headers()
        try:
            with open(full,'rb') as f:
                f.seek(start); remain = length
                while remain>0:
                    chunk = f.read(min(65536, remain))
                    if not chunk: break
                    self.wfile.write(chunk); remain -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

# ================= 공통 로그인 스니펫 =================
LOGIN_CSS = r"""
  :root{--bg:#0c111a;--panel:#161f2e;--panel2:#1d2a3e;--line:#2a394f;--text:#e9f0f7;--muted:#8fa0b5;--accent:#4b9bff;--good:#37e0a6;--bad:#ff7a7a}
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{height:100%}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",Roboto,"Noto Sans KR",sans-serif;display:flex;flex-direction:column;height:100dvh;overflow:hidden}
  #login{position:fixed;inset:0;background:#0c111af2;display:flex;align-items:center;justify-content:center;z-index:50;padding:24px}
  #login .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px 22px;max-width:340px;width:100%;text-align:center}
  #login h1{font-size:1.2rem;font-weight:800;margin-bottom:4px}
  #login p{color:var(--muted);font-size:.85rem;margin-bottom:16px;line-height:1.5}
  #login input{width:100%;font-size:1.5rem;text-align:center;letter-spacing:.3em;padding:12px;border-radius:12px;border:1px solid var(--line);background:#0f1826;color:var(--text);font-family:inherit}
  #login button{margin-top:14px;width:100%;font-family:inherit;font-weight:800;font-size:1rem;padding:14px;border-radius:12px;border:none;background:linear-gradient(180deg,#4b9bff,#2f6fe0);color:#fff;cursor:pointer}
  #login .err{color:var(--bad);font-size:.82rem;min-height:1.1em;margin-top:8px}
"""

# ================= 메뉴 페이지 =================
MENU_PAGE = r"""<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>브로가드 PC 리모컨</title><style>__CSS__
  main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px}
  main h1{font-size:1.3rem;font-weight:800}
  main .sub{color:var(--muted);font-size:.85rem;margin-top:-8px}
  a.tile{width:100%;max-width:340px;display:flex;align-items:center;gap:16px;text-decoration:none;color:var(--text);
    background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:18px;padding:22px 20px}
  a.tile .ic{font-size:2rem;flex:0 0 48px;text-align:center}
  a.tile h2{font-size:1.1rem;font-weight:800}
  a.tile p{font-size:.82rem;color:var(--muted);margin-top:3px}
  a.tile.off{opacity:.5;pointer-events:none}
</style></head><body>
<div id="login"><div class="card">
  <h1>&#128241; PC 리모컨</h1>
  <p>PC 터미널에 표시된 <b>PIN</b>을 입력하세요.<br>PC와 같은 와이파이여야 해요.</p>
  <input id="pinInput" type="tel" inputmode="numeric" placeholder="PIN" autocomplete="off">
  <div class="err" id="loginErr"></div><button id="loginBtn">접속</button>
</div></div>
<main>
  <h1>무엇을 할까요?</h1>
  <div class="sub" id="sub"></div>
  <a class="tile" id="tScreen" href="/screen"><div class="ic">&#128421;&#65039;</div><div><h2>화면 보기</h2><p>PC 화면을 폰에서 실시간으로</p></div></a>
  <a class="tile" id="tFiles" href="/files"><div class="ic">&#128193;</div><div><h2>파일 열람</h2><p id="filesDesc">지정 폴더의 파일 미리보기</p></div></a>
</main>
<script>
const $=s=>document.querySelector(s); let PIN=localStorage.getItem('pcremote_pin')||'';
function api(p){return p+(p.includes('?')?'&':'?')+'pin='+encodeURIComponent(PIN);}
async function connect(){ try{ const r=await fetch(api('/ping')); if(!r.ok) throw 0;
  const inf=await (await fetch(api('/info'))).json(); $('#login').style.display='none';
  $('#filesDesc').textContent='"'+inf.rootName+'" 폴더 미리보기';
  if(inf.screen==='off'){ $('#tScreen').classList.add('off'); $('#sub').textContent='(화면 기능은 pip install mss pillow 필요)'; }
  return true; }catch(e){ return false; } }
$('#loginBtn').onclick=async()=>{ PIN=$('#pinInput').value.trim();
  if(await connect()) localStorage.setItem('pcremote_pin',PIN); else $('#loginErr').textContent='PIN이 틀렸거나 연결이 안 돼요.'; };
$('#pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
if(PIN){ $('#pinInput').value=PIN; connect(); }
window.__MENU_TEST__={connect};
</script></body></html>""".replace('__CSS__', LOGIN_CSS)

# ================= 화면 페이지 =================
SCREEN_PAGE = r"""<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>PC 화면</title><style>__CSS__
  header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 13px;flex:0 0 auto;font-size:.82rem}
  header a{color:#b9d6ff;text-decoration:none}
  header .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--bad);margin-right:6px;vertical-align:middle}
  header .dot.on{background:var(--good)}
  .stage{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;padding:4px;background:#05080d}
  #screen{max-width:100%;max-height:100%;display:block;border-radius:6px;background:#05080d}
  .bar{flex:0 0 auto;display:flex;gap:8px;padding:9px 12px calc(10px + env(safe-area-inset-bottom))}
  .bar button{flex:1;font-family:inherit;font-weight:700;font-size:.86rem;padding:13px 8px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer}
  .note{text-align:center;font-size:.72rem;color:var(--muted);padding:0 12px 8px}
</style></head><body>
<div id="login"><div class="card"><h1>&#128421;&#65039; PC 화면</h1>
  <p>PIN을 입력하세요.</p><input id="pinInput" type="tel" inputmode="numeric" placeholder="PIN">
  <div class="err" id="loginErr"></div><button id="loginBtn">접속</button></div></div>
<header><span><a href="/">&larr; 메뉴</a></span>
  <span><span class="dot" id="dot"></span><span id="statusText">연결 중…</span></span>
  <span id="resInfo" style="color:var(--muted)"></span></header>
<div class="stage"><img id="screen" alt="PC 화면"></div>
<div class="bar"><button id="btnQ">&#128444;&#65039; 화질: 보통</button><button id="btnReload">&#128260; 다시 연결</button><button id="btnFull">&#9974; 전체화면</button></div>
<div class="note">보기 전용 — 다음 단계에서 터치 조작이 추가됩니다</div>
<script>
const $=s=>document.querySelector(s); let PIN=localStorage.getItem('pcremote_pin')||'';
let QLV=1; const QS=[{w:640,q:45,n:'낮음'},{w:960,q:55,n:'보통'},{w:1280,q:68,n:'높음'}];
function api(p){return p+(p.includes('?')?'&':'?')+'pin='+encodeURIComponent(PIN);}
function setStatus(on){$('#dot').classList.toggle('on',on);$('#statusText').textContent=on?'연결됨':'연결 끊김';}
async function connect(){ try{ const r=await fetch(api('/ping')); if(!r.ok) throw 0;
  const inf=await (await fetch(api('/info'))).json();
  if(inf.screen==='off'){ $('#statusText').textContent='화면 기능 꺼짐'; $('#login').style.display='none'; $('#resInfo').textContent='pip install mss pillow 필요'; return true; }
  $('#resInfo').textContent=inf.w+'×'+inf.h+(inf.screen==='demo'?' (데모)':'');
  $('#login').style.display='none'; startStream(); setStatus(true); return true; }catch(e){ return false; } }
function startStream(){const q=QS[QLV];$('#screen').src=api('/stream.mjpg')+'&w='+q.w+'&q='+q.q+'&t='+Date.now();}
$('#screen').addEventListener('load',()=>setStatus(true));
$('#screen').addEventListener('error',()=>{setStatus(false);setTimeout(startStream,1500);});
$('#loginBtn').onclick=async()=>{PIN=$('#pinInput').value.trim(); if(await connect())localStorage.setItem('pcremote_pin',PIN); else $('#loginErr').textContent='PIN이 틀렸거나 연결이 안 돼요.';};
$('#pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
$('#btnQ').onclick=()=>{QLV=(QLV+1)%QS.length;$('#btnQ').textContent='🖼️ 화질: '+QS[QLV].n;startStream();};
$('#btnReload').onclick=startStream;
$('#btnFull').onclick=()=>{const el=document.documentElement; if(!document.fullscreenElement){(el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el);}else{(document.exitFullscreen||function(){}).call(document);}};
if(PIN){$('#pinInput').value=PIN;connect();}
window.__REMOTE_TEST__={connect,startStream};
</script></body></html>""".replace('__CSS__', LOGIN_CSS)

# ================= 파일 페이지 =================
FILES_PAGE = r"""<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PC 파일 열람</title><style>__CSS__
  header{display:flex;align-items:center;gap:10px;padding:10px 13px;flex:0 0 auto;font-size:.85rem;border-bottom:1px solid var(--line)}
  header a{color:#b9d6ff;text-decoration:none;white-space:nowrap}
  header .crumb{flex:1;color:var(--muted);font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
  .list{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch}
  .row{display:flex;align-items:center;gap:13px;padding:14px 15px;border-bottom:1px solid #1b2636;cursor:pointer}
  .row:active{background:var(--panel2)}
  .row .ic{font-size:1.5rem;flex:0 0 30px;text-align:center}
  .row .meta{flex:1;min-width:0}
  .row .nm{font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .sub{font-size:.74rem;color:var(--muted);margin-top:2px}
  .row.up .nm{color:#b9d6ff}
  .empty{color:var(--muted);text-align:center;padding:40px 20px;font-size:.88rem}
  .note{text-align:center;font-size:.72rem;color:var(--muted);padding:8px 12px calc(8px + env(safe-area-inset-bottom))}
  /* preview */
  #pv{position:fixed;inset:0;background:#05080de8;display:none;flex-direction:column;z-index:30}
  #pv.show{display:flex}
  #pv .pvhead{display:flex;align-items:center;gap:10px;padding:12px 14px;font-size:.9rem}
  #pv .pvhead .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #pv .pvhead button{font-family:inherit;font-weight:800;font-size:1rem;padding:8px 16px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer}
  #pv .pvbody{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:8px}
  #pv img,#pv video{max-width:100%;max-height:100%;object-fit:contain}
  #pv iframe{width:100%;height:100%;border:0;background:#fff;border-radius:6px}
  #pv pre{white-space:pre-wrap;word-break:break-word;font-size:.82rem;line-height:1.5;color:#dbe6f4;width:100%;height:100%;overflow:auto;padding:12px;font-family:ui-monospace,Menlo,Consolas,monospace}
  #pv .msg{color:var(--muted);font-size:.9rem;text-align:center;padding:30px}
  #toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#161f2ef5;border:1px solid var(--line);border-radius:12px;padding:11px 18px;font-size:.88rem;display:none;z-index:60}
  #toast.show{display:block}
</style></head><body>
<div id="login"><div class="card"><h1>&#128193; PC 파일</h1>
  <p>PIN을 입력하세요.</p><input id="pinInput" type="tel" inputmode="numeric" placeholder="PIN">
  <div class="err" id="loginErr"></div><button id="loginBtn">접속</button></div></div>
<header><a href="/">&larr; 메뉴</a><a id="up" href="#" style="display:none">&#8593; 상위</a>
  <span class="crumb" id="crumb"></span></header>
<div class="list" id="list"></div>
<div class="note">열람 전용 — 파일을 폰에 저장하지 않고 미리보기만 합니다</div>

<div id="pv"><div class="pvhead"><span class="nm" id="pvName"></span><button id="pvClose">닫기</button></div>
  <div class="pvbody" id="pvBody"></div></div>
<div id="toast"></div>

<script>
'use strict';
const $=s=>document.querySelector(s); let PIN=localStorage.getItem('pcremote_pin')||'';
let cur='';
function api(p){return p+(p.includes('?')?'&':'?')+'pin='+encodeURIComponent(PIN);}
function vurl(path){return '/view?path='+encodeURIComponent(path)+'&pin='+encodeURIComponent(PIN);}
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2200);}
const ICON={dir:'📁',image:'🖼️',video:'🎬',audio:'🎵',pdf:'📕',text:'📄',other:'📦'};

async function connect(){ try{ const r=await fetch(api('/ping')); if(!r.ok) throw 0;
  $('#login').style.display='none'; await load(''); return true; }catch(e){ return false; } }
async function load(path){
  let d; try{ d=await (await fetch(api('/ls?path='+encodeURIComponent(path)))).json(); }catch(e){ toast('연결 오류'); return; }
  if(!d.ok){ toast(d.err||'폴더를 열 수 없어요'); return; }
  cur=d.path;
  $('#crumb').textContent='/'+(d.rootName)+(d.path?'/'+d.path:'');
  $('#up').style.display = d.canUp?'inline':'none';
  $('#up').onclick=(e)=>{e.preventDefault(); load(d.parent);};
  const list=$('#list'); list.innerHTML='';
  if(!d.entries.length){ list.innerHTML='<div class="empty">빈 폴더예요</div>'; return; }
  for(const it of d.entries){
    const row=document.createElement('div'); row.className='row';
    const full=(d.path?d.path+'/':'')+it.name;
    row.innerHTML='<div class="ic">'+(ICON[it.kind]||'📦')+'</div><div class="meta"><div class="nm"></div>'+
      '<div class="sub">'+(it.isDir?'폴더':(it.sizeh+' · '+it.kind))+' · '+it.mtime+'</div></div>'+
      (it.isDir?'<div class="ic" style="flex:0 0 18px;font-size:1rem;color:#8fa0b5">›</div>':'');
    row.querySelector('.nm').textContent=it.name;
    row.onclick=()=> it.isDir ? load(full) : preview(full, it);
    list.appendChild(row);
  }
  $('#list').scrollTop=0;
}
async function preview(path, it){
  const body=$('#pvBody'); $('#pvName').textContent=it.name; body.innerHTML='';
  if(it.kind==='image'){ const im=new Image(); im.src=vurl(path); body.appendChild(im); }
  else if(it.kind==='video'){ const v=document.createElement('video'); v.src=vurl(path); v.controls=true; v.autoplay=true; v.playsInline=true; body.appendChild(v); }
  else if(it.kind==='audio'){ const a=document.createElement('audio'); a.src=vurl(path); a.controls=true; a.autoplay=true; a.style.width='90%'; body.appendChild(a); }
  else if(it.kind==='pdf'){ const f=document.createElement('iframe'); f.src=vurl(path); body.appendChild(f); }
  else if(it.kind==='text'){ body.innerHTML='<div class="msg">불러오는 중…</div>';
    try{ let t=await (await fetch(vurl(path))).text(); if(t.length>500000) t=t.slice(0,500000)+'\n\n…(이하 생략)'; const pre=document.createElement('pre'); pre.textContent=t; body.innerHTML=''; body.appendChild(pre); }
    catch(e){ body.innerHTML='<div class="msg">열 수 없어요</div>'; } }
  else { body.innerHTML='<div class="msg">이 형식은 미리보기를 지원하지 않아요.<br>('+it.name+')</div>'; }
  $('#pv').classList.add('show');
}
$('#pvClose').onclick=()=>{ $('#pv').classList.remove('show'); $('#pvBody').innerHTML=''; };
$('#loginBtn').onclick=async()=>{PIN=$('#pinInput').value.trim(); if(await connect())localStorage.setItem('pcremote_pin',PIN); else $('#loginErr').textContent='PIN이 틀렸거나 연결이 안 돼요.';};
$('#pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
if(PIN){$('#pinInput').value=PIN;connect();}
window.__FILES_TEST__={connect,load,preview,cur:()=>cur};
</script></body></html>""".replace('__CSS__', LOGIN_CSS)

def main():
    ip = lan_ip()
    srv = ThreadingHTTPServer(('0.0.0.0', ARGS.port), H); srv.daemon_threads = True
    print('='*56)
    print('  브로가드 PC 리모컨')
    print('='*56)
    print('  폰/태블릿 브라우저에서 아래 주소를 여세요:')
    print('      http://%s:%d' % (ip, ARGS.port))
    print('  PIN:  %s' % (PIN if PIN is not None else '(없음)'))
    print('  화면: %s%s' % ({'real':'실제 캡처','demo':'데모','off':'꺼짐(pip install mss pillow)'}[SCREEN_MODE],
                           ('  %dx%d'%(SCREEN_W,SCREEN_H)) if SCREEN_MODE!='off' else ''))
    print('  파일 폴더:  %s' % ROOT)
    print('  (같은 와이파이 /  종료: Ctrl+C /  방화벽 "액세스 허용" 필요)')
    print('='*56)
    try: srv.serve_forever()
    except KeyboardInterrupt: print('\n종료합니다.'); srv.shutdown()

if __name__ == '__main__':
    main()
