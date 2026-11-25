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
import sys, os, io, json, time, threading, random, socket, argparse, math, mimetypes, shutil, subprocess, base64
import email.utils
import warnings
warnings.filterwarnings('ignore')   # mss 등의 DeprecationWarning 숨김(동작엔 영향 없음)
from datetime import datetime

AP = argparse.ArgumentParser(add_help=False)
AP.add_argument('--port', type=int, default=8787)
AP.add_argument('--pin', default=None)
AP.add_argument('--no-pin', action='store_true')
AP.add_argument('--root', default=None)
AP.add_argument('--demo', action='store_true')
AP.add_argument('--fps', type=int, default=12)
AP.add_argument('--ffmpeg', default=None)
AP.add_argument('--bind', default='auto')   # 'auto'=Tailscale 있으면 그 주소로만(보안), 없으면 전체
ARGS, _ = AP.parse_known_args()

# ffmpeg: 폰이 못 여는 코덱(mkv/avi/HEVC 등)을 실시간 변환해 보낼 때 사용(선택)
FFMPEG = ARGS.ffmpeg or shutil.which('ffmpeg')
HAVE_FFMPEG = bool(FFMPEG) and (os.path.isfile(FFMPEG) or shutil.which(FFMPEG) is not None)

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

# ---------------- 마우스 입력 백엔드 (pyautogui, 선택) ----------------
HAVE_INPUT = False
if not ARGS.demo:
    try:
        import pyautogui
        pyautogui.FAILSAFE = False; pyautogui.PAUSE = 0
        HAVE_INPUT = True
    except Exception:
        HAVE_INPUT = False     # 설치 안됨/디스플레이 없음 → 마우스 기능 꺼짐
INPUT_AVAIL = HAVE_INPUT or SCREEN_MODE == 'demo'   # 데모는 가상 커서로 시뮬레이션
LAST_POS = [SCREEN_W // 2, SCREEN_H // 2]
CMD_LOG = []
def _clampi(v, lo, hi): return max(lo, min(hi, int(v)))
def do_cmd(c):
    t = c.get('t')
    if c.get('x') is not None and c.get('y') is not None:
        LAST_POS[0] = _clampi(c['x'], 0, SCREEN_W-1); LAST_POS[1] = _clampi(c['y'], 0, SCREEN_H-1)
    CMD_LOG.append({'t':t,'x':c.get('x'),'y':c.get('y'),'button':c.get('button'),'amount':c.get('amount'),
                    'key':c.get('key'),'text':c.get('text'),'ts':time.time()})
    if len(CMD_LOG) > 100: del CMD_LOG[:50]
    if not HAVE_INPUT: return          # 데모/미설치: 기록만(가상 커서)
    bx, by = LAST_POS
    if   t=='move':      pyautogui.moveTo(bx,by,_pause=False)
    elif t=='click':     pyautogui.click(bx,by,button=c.get('button','left'),_pause=False)
    elif t=='dblclick':  pyautogui.doubleClick(bx,by,_pause=False)
    elif t=='rightclick':pyautogui.click(bx,by,button='right',_pause=False)
    elif t=='down':      pyautogui.moveTo(bx,by,_pause=False); pyautogui.mouseDown(_pause=False)
    elif t=='up':        pyautogui.moveTo(bx,by,_pause=False); pyautogui.mouseUp(_pause=False)
    elif t=='scroll':    pyautogui.scroll(int(c.get('amount',0)),_pause=False)
    elif t=='key':
        k = str(c.get('key','') or '')
        if '+' in k:   pyautogui.hotkey(*[s.strip() for s in k.split('+') if s.strip()], _pause=False)
        elif k:        pyautogui.press(k, _pause=False)
    elif t=='text':
        txt = c.get('text','') or ''
        if txt.isascii():
            pyautogui.typewrite(txt, interval=0, _pause=False)
        else:
            _set_clipboard(txt); pyautogui.hotkey('ctrl','v', _pause=False)   # 한글 등은 붙여넣기

def _set_clipboard(text):
    # 윈도우: PowerShell Set-Clipboard (유니코드 안전). 실패해도 조용히 넘어감.
    try:
        subprocess.run(['powershell', '-NoProfile', '-Command',
                        '$in=[Console]::In.ReadToEnd(); Set-Clipboard -Value $in'],
                       input=text.encode('utf-8'), check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print('[클립보드 오류]', e)

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
if not os.path.isdir(ROOT):
    print('[알림] 지정한 폴더를 찾지 못했어요: %s' % ROOT)
    ROOT = os.path.realpath(default_root())
    print('       -> 대신 기본 폴더를 엽니다: %s' % ROOT)
    print('       (폴더를 바꾸려면 pc-remote.bat 의 ROOT 경로가 실제 존재하는지 확인하세요)')
ROOT_NAME = os.path.basename(ROOT.rstrip(os.sep)) or ROOT

PIN = None if ARGS.no_pin else (str(ARGS.pin) if ARGS.pin else ('%04d' % random.randint(0, 9999)))

# ---------------- 파일 헬퍼 ----------------
IMG = {'png','jpg','jpeg','gif','webp','bmp','svg','ico','avif'}
# 브라우저가 바로 못 여는 컨테이너(mkv/avi/wmv/...)도 '동영상'으로 분류 → 변환 재생 대상
VID = {'mp4','webm','m4v','mov','ogv','mkv','avi','wmv','flv','ts','m2ts','mts','mpg','mpeg',
       'mpe','3gp','3g2','vob','divx','f4v','ogm','rm','rmvb','asf'}
AUD = {'mp3','wav','ogg','m4a','aac','flac','opus','wma','aiff','aif'}
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
    if CMD_LOG:
        d.text((28,70), '마지막: %s' % CMD_LOG[-1]['t'], fill=(255,200,120))
    # 가상 커서(마우스 명령 확인용)
    cx, cy = LAST_POS
    d.line([(cx-18,cy),(cx+18,cy)], fill=(255,90,90), width=3)
    d.line([(cx,cy-18),(cx,cy+18)], fill=(255,90,90), width=3)
    d.ellipse([cx-7,cy-7,cx+7,cy+7], outline=(255,90,90), width=3)
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
from urllib.parse import urlparse, parse_qs, quote, unquote

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(('8.8.8.8',80)); ip = s.getsockname()[0]
    except Exception: ip = '127.0.0.1'
    finally: s.close()
    return ip

def is_private(a):
    if a.startswith('192.168.') or a.startswith('10.'): return True
    if a.startswith('172.'):
        try: return 16 <= int(a.split('.')[1]) <= 31
        except Exception: return False
    return False

def is_tailscale(a):
    # Tailscale 는 100.64.0.0/10 (CGNAT) 대역을 씁니다
    if not a.startswith('100.'): return False
    try: return 64 <= int(a.split('.')[1]) <= 127
    except Exception: return False

def list_ips():
    ips = []
    try:
        for r in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            a = r[4][0]
            if a not in ips and not a.startswith('127.'): ips.append(a)
    except Exception: pass
    eg = lan_ip()
    if eg not in ips and not eg.startswith('127.'): ips.append(eg)
    def rank(a):
        if is_tailscale(a): return 0    # Tailscale(밖에서도) 먼저
        if is_private(a):   return 1    # 집 안 LAN
        return 2                        # 공용(인터넷)
    ips.sort(key=rank)
    return ips or ['127.0.0.1']

def auth_ok(q, headers):
    if PIN is None: return True
    return ((q.get('pin',[None])[0]) or headers.get('X-PIN')) == PIN

def xml_escape(s):
    return str(s).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass

    # 모든 응답에 CORS 허용 — VR 영화관 등 다른 주소(https)에서 영상을 불러올 수 있게
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Range, X-PIN')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
        super().end_headers()
    def do_OPTIONS(self):
        if urlparse(self.path).path.startswith('/dav'): print('[WebDAV] OPTIONS %s' % self.path)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, POST, PROPFIND')
        self.send_header('Allow', 'OPTIONS, GET, HEAD, POST, PROPFIND')
        self.send_header('DAV', '1')               # WebDAV(읽기 전용) — 4X Player 등 VR 플레이어가 폴더 탐색
        self.send_header('Content-Length', '0')
        self.end_headers()

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
        # WebDAV 클라이언트(4X Player 등)의 파일 요청 — /dav 접두사 유무와 무관하게
        # Basic 인증 헤더가 있으면 WebDAV 파일로 처리(루트 기준 경로 지원). 브라우저는 Basic 안 보냄.
        if path == '/dav' or path.startswith('/dav/') or self.headers.get('Authorization','').startswith('Basic '):
            return self._dav_get(path)
        # pages
        if path in ('/','/index.html'): return self._send(200,'text/html; charset=utf-8', MENU_PAGE)
        if path == '/screen': return self._send(200,'text/html; charset=utf-8', SCREEN_PAGE)
        if path == '/files':  return self._send(200,'text/html; charset=utf-8', FILES_PAGE)
        if path == '/cinema': return self._send(200,'text/html; charset=utf-8', CINEMA_PAGE)
        if path == '/vrmon':  return self._send(200,'text/html; charset=utf-8', VRMON_PAGE)
        # auth-gated API
        if path == '/ping':
            ok = auth_ok(q,self.headers); return self._send(200 if ok else 401,'application/json',json.dumps({'ok':ok}))
        if not auth_ok(q,self.headers):
            return self._send(401,'application/json','{"ok":false}')
        if path == '/info':
            return self._send(200,'application/json', json.dumps({'ok':True,'w':SCREEN_W,'h':SCREEN_H,
                'screen':SCREEN_MODE,'pinRequired':PIN is not None,'rootName':ROOT_NAME,
                'ffmpeg':HAVE_FFMPEG,'input':INPUT_AVAIL}))
        if path == '/log':   # 테스트용 (명령 기록)
            return self._send(200,'application/json', json.dumps(CMD_LOG[-30:]))
        if path == '/frame.jpg':
            if SCREEN_MODE=='off': return self._send(503,'text/plain','no-screen')
            return self._send(200,'image/jpeg', grab_jpeg(int(q.get('q',['55'])[0]), int(q.get('w',['960'])[0])))
        if path == '/stream.mjpg':
            if SCREEN_MODE=='off': return self._send(503,'text/plain','no-screen')
            return self._stream(int(q.get('q',['55'])[0]), int(q.get('w',['960'])[0]))
        if path == '/ls':   return self._ls(q.get('path',[''])[0])
        if path == '/view': return self._view(q.get('path',[''])[0])
        if path == '/transcode': return self._transcode(q.get('path',[''])[0])
        return self._send(404,'text/plain','not found')

    def do_POST(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path != '/cmd':
            return self._send(404,'text/plain','not found')
        if not auth_ok(q,self.headers):
            return self._send(401,'application/json','{"ok":false}')
        try:
            n = int(self.headers.get('Content-Length','0'))
            data = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return self._send(400,'application/json','{"ok":false}')
        for c in (data if isinstance(data,list) else [data]):
            try: do_cmd(c)
            except Exception as e: print('[명령 오류]', e)
        return self._send(200,'application/json','{"ok":true}')

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
        return self._serve_file(full)

    def _serve_file(self, full, head=False):
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
        if head: return
        try:
            with open(full,'rb') as f:
                f.seek(start); remain = length
                while remain>0:
                    chunk = f.read(min(65536, remain))
                    if not chunk: break
                    self.wfile.write(chunk); remain -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    # ---- WebDAV (읽기 전용): VR 플레이어(4X Player 등)가 폴더 탐색 + 영상 재생 ----
    # 인증: HTTP Basic (아이디 아무거나, 비번 = PIN). /dav/ 아래가 공유 폴더(ROOT).
    def _dav_auth_ok(self):
        if PIN is None: return True
        h = self.headers.get('Authorization','')
        if h.startswith('Basic '):
            try:
                dec = base64.b64decode(h[6:]).decode('utf-8','replace')
                return dec.partition(':')[2] == str(PIN)
            except Exception: return False
        return False
    def _dav_unauth(self):
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="PC Remote"')
        self.send_header('Content-Length', '0')
        self.end_headers()
    def _dav_rel(self, path):
        if path.startswith('/dav'): path = path[4:]
        return unquote(path).strip('/')
    def do_HEAD(self):
        path = urlparse(self.path).path
        if path == '/dav' or path.startswith('/dav/') or self.headers.get('Authorization','').startswith('Basic '):
            return self._dav_get(path, head=True)
        return self._send(404,'text/plain','not found')
    def _dav_get(self, path, head=False):
        m = 'HEAD' if head else 'GET'
        if not self._dav_auth_ok():
            print('[WebDAV] %s %s  인증=401(비번확인)' % (m, path)); return self._dav_unauth()
        full = safe_path(self._dav_rel(path))
        if not full or not os.path.isfile(full):
            print('[WebDAV] %s %s  -> 파일 없음' % (m, path)); return self._send(404,'text/plain','not found')
        if head or not self.headers.get('Range'): print('[WebDAV] %s %s  OK' % (m, path))
        return self._serve_file(full, head=head)
    def do_PROPFIND(self):
        path = urlparse(self.path).path
        try:
            n = int(self.headers.get('Content-Length','0') or 0)
            if n: self.rfile.read(n)      # 요청 본문은 버림(요청 속성 무시)
        except Exception: pass
        authok = self._dav_auth_ok()
        print('[WebDAV] PROPFIND %s  Depth=%s  인증=%s' % (path, self.headers.get('Depth','?'),
              'OK' if authok else '401(비번확인)'))
        if not authok: return self._dav_unauth()
        rel = self._dav_rel(path)
        full = safe_path(rel)
        if not full or not os.path.exists(full):
            print('[WebDAV]   -> 경로 없음: %r' % rel); return self._send(404,'text/plain','not found')
        depth = str(self.headers.get('Depth','1'))
        items = [self._dav_entry(full, rel)]
        if os.path.isdir(full) and depth != '0':
            try:
                for nm in sorted(os.listdir(full), key=lambda x:x.lower()):
                    cp = os.path.join(full, nm)
                    items.append(self._dav_entry(cp, (rel+'/'+nm) if rel else nm))
            except Exception as e: print('[WebDAV]   목록 오류:', e)
        print('[WebDAV]   -> %d개 항목 응답 (폴더=%r)' % (len(items), rel or '(루트)'))
        self._send(207, 'application/xml; charset="utf-8"', self._dav_xml(items))
    def _dav_entry(self, full, rel):
        isdir = os.path.isdir(full)
        href = '/' + quote(rel)       # 루트 기준 href (4X Player가 루트 경로로 GET)
        if isdir and not href.endswith('/'): href += '/'
        name = os.path.basename(rel.rstrip('/')) or ROOT_NAME
        try: st = os.stat(full)
        except Exception: st = None
        size = 0 if (isdir or not st) else st.st_size
        mtime = email.utils.formatdate(st.st_mtime, usegmt=True) if st else ''
        ctype = 'httpd/unix-directory' if isdir else ctype_of(name)
        return {'href':href,'isdir':isdir,'size':size,'mtime':mtime,'name':name,'ctype':ctype}
    def _dav_xml(self, items):
        out = ['<?xml version="1.0" encoding="utf-8"?>', '<D:multistatus xmlns:D="DAV:">']
        for it in items:
            rt = '<D:collection/>' if it['isdir'] else ''
            out.append('<D:response><D:href>%s</D:href><D:propstat><D:prop>'
                '<D:resourcetype>%s</D:resourcetype>'
                '<D:getcontentlength>%d</D:getcontentlength>'
                '<D:getlastmodified>%s</D:getlastmodified>'
                '<D:getcontenttype>%s</D:getcontenttype>'
                '<D:displayname>%s</D:displayname>'
                '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
                % (xml_escape(it['href']), rt, it['size'], it['mtime'],
                   xml_escape(it['ctype']), xml_escape(it['name'])))
        out.append('</D:multistatus>')
        return '\n'.join(out)

    # ---- 실시간 변환 재생 (폰이 못 여는 코덱 → H.264/AAC fMP4 스트림) ----
    def _transcode(self, rel):
        if not HAVE_FFMPEG:
            return self._send(503, 'text/plain', 'ffmpeg 없음')
        full = safe_path(rel)
        if not full or not os.path.isfile(full):
            return self._send(404, 'text/plain', '파일 없음')
        cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', full,
               '-vf', 'scale=w=-2:h=min(720\\,ih)',     # 720p 이하로(업스케일 안 함)
               '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
               '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
               '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
               '-f', 'mp4', 'pipe:1']
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    bufsize=0)
        except Exception as e:
            return self._send(500, 'text/plain', 'ffmpeg 실행 실패: %s' % e)
        self.send_response(200)
        self.send_header('Content-Type', 'video/mp4')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                self.wfile.write(('%X\r\n' % len(chunk)).encode()); self.wfile.write(chunk); self.wfile.write(b'\r\n')
            self.wfile.write(b'0\r\n\r\n')
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            try: proc.kill()
            except Exception: pass
            try: proc.stdout.close()
            except Exception: pass

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
  <a class="tile" id="tVrmon" href="/vrmon"><div class="ic">&#129405;</div><div><h2>VR 모니터</h2><p>PC 화면을 VR 큰 화면으로 (메타 퀘스트)</p></div></a>
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
  .stage{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;padding:4px;background:#05080d;overflow:hidden}
  #screen{max-width:100%;max-height:100%;display:block;border-radius:6px;background:#05080d;touch-action:none}
  .hint{text-align:center;font-size:.76rem;color:#cfe0f5;padding:4px 12px 2px;min-height:1.05em}
  .bar{flex:0 0 auto;display:flex;gap:7px;padding:8px 10px calc(10px + env(safe-area-inset-bottom));overflow-x:auto}
  .bar button{flex:0 0 auto;min-width:56px;font-family:inherit;font-weight:700;font-size:.82rem;padding:12px 11px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}
  .bar button.sel{background:var(--accent);color:#fff;border-color:var(--accent)}
  .bar button.mouse{display:none}
  body.hasmouse .bar button.mouse{display:inline-block}
  .note{text-align:center;font-size:.72rem;color:var(--muted);padding:0 12px 8px}
  #kb{position:fixed;left:0;right:0;bottom:0;background:var(--panel);border-top:1px solid var(--line);padding:10px 10px calc(10px + env(safe-area-inset-bottom));z-index:30;display:none;flex-direction:column;gap:7px}
  #kb.show{display:flex}
  #kb .krow{display:flex;gap:6px;flex-wrap:wrap}
  #kb input{flex:1;min-width:120px;font-size:1rem;padding:11px;border-radius:10px;border:1px solid var(--line);background:#0f1826;color:var(--text);font-family:inherit}
  #kb button{font-family:inherit;font-weight:700;font-size:.85rem;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;min-width:44px}
  #kb button.send{background:var(--accent);color:#fff;border-color:var(--accent)}
  #kb .close{margin-left:auto;color:var(--muted)}
</style></head><body>
<div id="login"><div class="card"><h1>&#128421;&#65039; PC 화면</h1>
  <p>PIN을 입력하세요.</p><input id="pinInput" type="tel" inputmode="numeric" placeholder="PIN">
  <div class="err" id="loginErr"></div><button id="loginBtn">접속</button></div></div>
<header><span><a href="/">&larr; 메뉴</a></span>
  <span><span class="dot" id="dot"></span><span id="statusText">연결 중…</span></span>
  <span id="resInfo" style="color:var(--muted)"></span></header>
<div class="stage"><img id="screen" alt="PC 화면"></div>
<div class="hint" id="hint"></div>
<div class="bar">
  <button id="btnZoom">&#128269; 확대</button>
  <button class="mouse" id="btnKb">&#9000;&#65039; 키보드</button>
  <button class="mouse" id="btnRight">&#128433;&#65039; 우클릭</button>
  <button class="mouse" id="btnDbl">더블클릭</button>
  <button class="mouse" id="btnDrag">&#9995; 드래그</button>
  <button class="mouse" id="btnSU">&#9650; 스크롤</button>
  <button class="mouse" id="btnSD">&#9660; 스크롤</button>
  <button id="btnQ">&#128444;&#65039; 보통</button>
  <button id="btnFull">&#9974; 전체</button>
  <button id="btnReload">&#128260; 재연결</button>
</div>
<div class="note" id="note"></div>

<div id="kb">
  <div class="krow">
    <input id="kbText" type="text" placeholder="입력 후 전송 (한글 OK)" autocomplete="off" autocapitalize="off">
    <button class="send" id="kbSend">전송</button>
    <button class="close" id="kbClose">닫기</button>
  </div>
  <div class="krow">
    <button data-key="enter">Enter</button><button data-key="backspace">&#9003;</button>
    <button data-key="space">Space</button><button data-key="tab">Tab</button><button data-key="esc">Esc</button>
    <button data-key="up">&#8593;</button><button data-key="down">&#8595;</button><button data-key="left">&#8592;</button><button data-key="right">&#8594;</button>
  </div>
  <div class="krow">
    <button data-key="win">Win</button><button data-key="ctrl+c">Ctrl+C</button><button data-key="ctrl+v">Ctrl+V</button>
    <button data-key="ctrl+z">Ctrl+Z</button><button data-key="ctrl+a">Ctrl+A</button><button data-key="alt+tab">Alt+Tab</button><button data-key="f5">F5</button>
  </div>
  <div class="krow">
    <button data-key="volumeup">&#128266;+</button><button data-key="volumedown">&#128264;&minus;</button><button data-key="volumemute">&#128263;</button>
    <button data-key="playpause">&#9199;</button><button data-key="pageup">발표&#9664;</button><button data-key="pagedown">발표&#9654;</button>
  </div>
</div>

<script>
const $=s=>document.querySelector(s); let PIN=localStorage.getItem('pcremote_pin')||'';
let QLV=1; const QS=[{w:640,q:45,n:'낮음'},{w:960,q:55,n:'보통'},{w:1280,q:68,n:'높음'}];
function api(p){return p+(p.includes('?')?'&':'?')+'pin='+encodeURIComponent(PIN);}
function setStatus(on){$('#dot').classList.toggle('on',on);$('#statusText').textContent=on?'연결됨':'연결 끊김';}
let SW=1280,SH=720,INPUT=false;
let dragMode=false,rightArmed=false,dblArmed=false,zoomMode=false;
function setHint(){
  if(zoomMode){ $('#hint').textContent='확대 모드: 두 손가락=확대/축소 · 끌기=이동 · 두 번 탭=원래대로'; return; }
  $('#hint').textContent = !INPUT ? '' : (dragMode?'드래그 모드: 끌어서 이동/선택'
    : (rightArmed?'다음 탭 = 우클릭' : (dblArmed?'다음 탭 = 더블클릭' : '탭=클릭 · 끌기=커서이동 · 두 손가락=스크롤'))); }
async function connect(){ try{ const r=await fetch(api('/ping')); if(!r.ok) throw 0;
  const inf=await (await fetch(api('/info'))).json();
  if(inf.screen==='off'){ $('#statusText').textContent='화면 기능 꺼짐'; $('#login').style.display='none'; $('#resInfo').textContent='pip install mss pillow 필요'; $('#note').textContent='화면 기능엔  pip install mss pillow  가 필요해요'; return true; }
  SW=inf.w; SH=inf.h; INPUT=!!inf.input;
  $('#resInfo').textContent=inf.w+'×'+inf.h+(inf.screen==='demo'?' (데모)':'');
  $('#login').style.display='none'; startStream(); setStatus(true);
  if(INPUT){ document.body.classList.add('hasmouse'); setHint(); }
  else { $('#note').textContent='보기 전용 — 마우스를 쓰려면 PC에서  pip install pyautogui'; }
  return true; }catch(e){ return false; } }
function startStream(){const q=QS[QLV];$('#screen').src=api('/stream.mjpg')+'&w='+q.w+'&q='+q.q+'&t='+Date.now();}
$('#screen').addEventListener('load',()=>setStatus(true));
$('#screen').addEventListener('error',()=>{setStatus(false);setTimeout(startStream,1500);});
$('#loginBtn').onclick=async()=>{PIN=$('#pinInput').value.trim(); if(await connect())localStorage.setItem('pcremote_pin',PIN); else $('#loginErr').textContent='PIN이 틀렸거나 연결이 안 돼요.';};
$('#pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
$('#btnQ').onclick=()=>{QLV=(QLV+1)%QS.length;$('#btnQ').textContent='🖼️ '+QS[QLV].n;startStream();};
$('#btnReload').onclick=startStream;
$('#btnFull').onclick=()=>{const el=document.documentElement; if(!document.fullscreenElement){(el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el);}else{(document.exitFullscreen||function(){}).call(document);}};

/* ---- 마우스 조작 ---- */
const img=$('#screen');
function cmd(o){ fetch(api('/cmd'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}).catch(()=>setStatus(false)); }
function toScreen(e){ const r=img.getBoundingClientRect();
  const px=(e.clientX-r.left)/r.width, py=(e.clientY-r.top)/r.height;
  return {x:Math.round(Math.max(0,Math.min(1,px))*(SW-1)), y:Math.round(Math.max(0,Math.min(1,py))*(SH-1))}; }
let pdown=null,moved=false,downT=0,lastMove=0,downC=null;
const pts=new Map(); let scrollBase=null;
function avgY(){let s=0,n=0;for(const v of pts.values()){s+=v;n++;}return n?s/n:0;}

/* ---- 확대/축소(핀치 줌 + 이동) ---- */
const stageEl=document.querySelector('.stage');
let zoom=1, zx=0, zy=0;
const zpts=new Map(); let pinchD=0, panPrev=null, lastTap=0;
function applyZoom(){ img.style.transform='translate('+zx+'px,'+zy+'px) scale('+zoom+')'; img.style.transformOrigin='center center'; }
function clampPan(){ const w=img.clientWidth*zoom, h=img.clientHeight*zoom;
  const mx=Math.max(0,(w-stageEl.clientWidth)/2+24), my=Math.max(0,(h-stageEl.clientHeight)/2+24);
  zx=Math.max(-mx,Math.min(mx,zx)); zy=Math.max(-my,Math.min(my,zy)); }
function resetZoom(){ zoom=1; zx=0; zy=0; applyZoom(); }

img.addEventListener('pointerdown',e=>{
  if(zoomMode){ e.preventDefault(); try{img.setPointerCapture(e.pointerId);}catch(_){}
    zpts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(zpts.size===2){ const a=[...zpts.values()]; pinchD=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y); panPrev=null; }
    else { panPrev={x:e.clientX,y:e.clientY}; const t=Date.now(); if(t-lastTap<300) resetZoom(); lastTap=t; }
    return; }
  if(!INPUT) return; e.preventDefault(); try{img.setPointerCapture(e.pointerId);}catch(_){}
  pts.set(e.pointerId,e.clientY);
  if(pts.size===2){ scrollBase=avgY(); pdown=null; return; }
  const p=toScreen(e); pdown=p; moved=false; downT=Date.now(); downC={x:e.clientX,y:e.clientY};
  if(dragMode) cmd({t:'down',x:p.x,y:p.y}); else cmd({t:'move',x:p.x,y:p.y}); });
img.addEventListener('pointermove',e=>{
  if(zoomMode){ if(!zpts.has(e.pointerId)) return; e.preventDefault(); zpts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const a=[...zpts.values()];
    if(a.length>=2){ const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y); if(pinchD>0) zoom=Math.max(1,Math.min(5,zoom*(d/pinchD))); pinchD=d; if(zoom<=1){zx=0;zy=0;} clampPan(); applyZoom(); }
    else if(panPrev){ zx+=e.clientX-panPrev.x; zy+=e.clientY-panPrev.y; panPrev={x:e.clientX,y:e.clientY}; clampPan(); applyZoom(); }
    return; }
  if(!INPUT||!pts.has(e.pointerId)) return; pts.set(e.pointerId,e.clientY);
  if(pts.size>=2){ const y=avgY(); if(scrollBase!=null){ const dy=y-scrollBase; if(Math.abs(dy)>4){ cmd({t:'scroll',amount:Math.round(dy/1.5)}); scrollBase=y; } } return; }
  if(!pdown) return; if(downC && Math.hypot(e.clientX-downC.x,e.clientY-downC.y)>8) moved=true;
  const now=Date.now(); if(now-lastMove>45){ lastMove=now; const p=toScreen(e); cmd({t:'move',x:p.x,y:p.y}); } });
function up(e){
  if(zoomMode){ zpts.delete(e.pointerId); if(zpts.size<2) pinchD=0; panPrev = zpts.size? [...zpts.values()][0] : null; return; }
  if(!INPUT) return; const was2=pts.size>=2; pts.delete(e.pointerId); if(pts.size<2) scrollBase=null;
  if(was2||!pdown) { pdown=null; return; }
  const p=toScreen(e), quick=(Date.now()-downT)<400;
  if(dragMode){ cmd({t:'up',x:p.x,y:p.y}); }
  else if(!moved && quick){
    if(rightArmed){ cmd({t:'rightclick',x:p.x,y:p.y}); rightArmed=false; $('#btnRight').classList.remove('sel'); }
    else if(dblArmed){ cmd({t:'dblclick',x:p.x,y:p.y}); dblArmed=false; $('#btnDbl').classList.remove('sel'); }
    else cmd({t:'click',x:p.x,y:p.y,button:'left'});
    setHint();
  }
  pdown=null; }
img.addEventListener('pointerup',up);
img.addEventListener('pointercancel',e=>{ if(zoomMode){ zpts.delete(e.pointerId); if(zpts.size<2)pinchD=0; panPrev=null; return; } pts.delete(e.pointerId); pdown=null; scrollBase=null; });
$('#btnZoom').onclick=()=>{ zoomMode=!zoomMode; $('#btnZoom').classList.toggle('sel',zoomMode); img.style.cursor=zoomMode?'grab':''; setHint(); };
$('#btnDrag').onclick=()=>{ dragMode=!dragMode; rightArmed=dblArmed=false; $('#btnRight').classList.remove('sel'); $('#btnDbl').classList.remove('sel'); $('#btnDrag').classList.toggle('sel',dragMode); setHint(); };
$('#btnRight').onclick=()=>{ rightArmed=!rightArmed; dblArmed=false; $('#btnDbl').classList.remove('sel'); $('#btnRight').classList.toggle('sel',rightArmed); setHint(); };
$('#btnDbl').onclick=()=>{ dblArmed=!dblArmed; rightArmed=false; $('#btnRight').classList.remove('sel'); $('#btnDbl').classList.toggle('sel',dblArmed); setHint(); };
$('#btnSU').onclick=()=>cmd({t:'scroll',amount:6});
$('#btnSD').onclick=()=>cmd({t:'scroll',amount:-6});

/* ---- 키보드 ---- */
function sendText(){ const t=$('#kbText').value; if(t){ cmd({t:'text',text:t}); $('#kbText').value=''; } }
$('#btnKb').onclick=()=>{ $('#kb').classList.toggle('show'); if($('#kb').classList.contains('show')) $('#kbText').focus(); };
$('#kbClose').onclick=()=>$('#kb').classList.remove('show');
$('#kbSend').onclick=sendText;
$('#kbText').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); sendText(); cmd({t:'key',key:'enter'}); } });
document.querySelectorAll('#kb [data-key]').forEach(b=> b.onclick=()=>cmd({t:'key',key:b.dataset.key}) );

if(PIN){$('#pinInput').value=PIN;connect();}
window.__REMOTE_TEST__={connect,startStream,toScreen,cmd,get sw(){return SW},get sh(){return SH},get input(){return INPUT}};
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
  #pv .pvhead button{flex:0 0 auto;font-family:inherit;font-weight:800;font-size:1rem;padding:8px 16px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer}
  /* 세로(포트레이트): 조작 버튼을 왼쪽 상단으로 모으고 파일명은 오른쪽을 채움 */
  @media (orientation:portrait){
    #pv .pvhead #pvClose{order:-4} #pv .pvhead #pvCopy{order:-3} #pv .pvhead #pvVR{order:-2} #pv .pvhead #pvTrans{order:-1}
    #pv .pvhead button{padding:8px 12px;font-size:.92rem}
  }
  #pv .pvbody{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:8px}
  #pv img,#pv video{max-width:100%;max-height:100%;object-fit:contain}
  #pv .pvwrap{position:relative;display:inline-flex;max-width:100%;max-height:100%}
  #pv .pvwrap video{display:block;max-width:100%;max-height:100%}
  #pv .pvwrap .gest{position:absolute;left:0;right:0;top:0;bottom:56px;z-index:3;touch-action:none;cursor:pointer}
  #pv .pvwrap:fullscreen{width:100vw;height:100vh;align-items:center;justify-content:center;background:#000}
  #pv .pvwrap:-webkit-full-screen{width:100vw;height:100vh;align-items:center;justify-content:center;background:#000}
  #pv iframe{width:100%;height:100%;border:0;background:#fff;border-radius:6px}
  #pv pre{white-space:pre-wrap;word-break:break-word;font-size:.82rem;line-height:1.5;color:#dbe6f4;width:100%;height:100%;overflow:auto;padding:12px;font-family:ui-monospace,Menlo,Consolas,monospace}
  #pv .msg{color:var(--muted);font-size:.9rem;text-align:center;padding:30px}
  #pv .nav{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:64px;border-radius:12px;
    background:#161f2ecc;border:1px solid var(--line);color:var(--text);font-size:1.7rem;font-weight:800;
    display:none;align-items:center;justify-content:center;cursor:pointer;z-index:2}
  #pv .nav.show{display:flex}
  #pvPrev{left:8px} #pvNext{right:8px}
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

<div id="pv"><div class="pvhead"><span class="nm" id="pvName"></span><button id="pvVR" style="display:none">&#129405; VR</button><button id="pvCopy" style="display:none">&#128279; 링크</button><button id="pvTrans" style="display:none">&#9881;&#65039; 변환</button><button id="pvClose">닫기</button></div>
  <button class="nav" id="pvPrev">&#8249;</button><button class="nav" id="pvNext">&#8250;</button>
  <div class="pvbody" id="pvBody"></div></div>
<div id="toast"></div>

<script>
'use strict';
const $=s=>document.querySelector(s); let PIN=localStorage.getItem('pcremote_pin')||'';
let cur=''; let curParent=''; let canUp=false; let pvOpen=false; let FF=false; let curFiles=[]; let curIdx=-1;
function api(p){return p+(p.includes('?')?'&':'?')+'pin='+encodeURIComponent(PIN);}
function vurl(path){return '/view?path='+encodeURIComponent(path)+'&pin='+encodeURIComponent(PIN);}
function turl(path){return '/transcode?path='+encodeURIComponent(path)+'&pin='+encodeURIComponent(PIN);}
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2600);}
function copyText(s){
  // http 환경에선 navigator.clipboard 가 막히므로 execCommand 를 먼저 시도
  try{ const ta=document.createElement('textarea'); ta.value=s; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); const ok=document.execCommand('copy'); document.body.removeChild(ta); if(ok) return true; }catch(e){}
  try{ if(navigator.clipboard){ navigator.clipboard.writeText(s).catch(()=>{}); return true; } }catch(e){}
  return false;
}
const ICON={dir:'📁',image:'🖼️',video:'🎬',audio:'🎵',pdf:'📕',text:'📄',other:'📦'};

async function connect(){ try{ const r=await fetch(api('/ping')); if(!r.ok) throw 0;
  try{ const inf=await (await fetch(api('/info'))).json(); FF=!!inf.ffmpeg; }catch(e){}
  $('#login').style.display='none'; await load(''); return true; }catch(e){ return false; } }
async function load(path){
  let d; try{ d=await (await fetch(api('/ls?path='+encodeURIComponent(path)))).json(); }catch(e){ toast('연결 오류'); return; }
  if(!d.ok){ toast(d.err||'폴더를 열 수 없어요'); return; }
  cur=d.path; curParent=d.parent; canUp=d.canUp;
  $('#crumb').textContent='/'+(d.rootName)+(d.path?'/'+d.path:'');
  $('#up').style.display = d.canUp?'inline':'none';
  $('#up').onclick=(e)=>{e.preventDefault(); history.back();};
  curFiles = d.entries.filter(e=>!e.isDir).map(e=>({name:e.name, kind:e.kind, full:(d.path?d.path+'/':'')+e.name}));
  const list=$('#list'); list.innerHTML='';
  if(!d.entries.length){ list.innerHTML='<div class="empty">빈 폴더예요</div>'; return; }
  for(const it of d.entries){
    const row=document.createElement('div'); row.className='row';
    const full=(d.path?d.path+'/':'')+it.name;
    row.innerHTML='<div class="ic">'+(ICON[it.kind]||'📦')+'</div><div class="meta"><div class="nm"></div>'+
      '<div class="sub">'+(it.isDir?'폴더':(it.sizeh+' · '+it.kind))+' · '+it.mtime+'</div></div>'+
      (it.isDir?'<div class="ic" style="flex:0 0 18px;font-size:1rem;color:#8fa0b5">›</div>':'');
    row.querySelector('.nm').textContent=it.name;
    row.onclick=()=> it.isDir ? navFolder(full) : openPreview(full, it);
    list.appendChild(row);
  }
  $('#list').scrollTop=0;
}
// 같은 종류(사진/영상)의 형제 파일 인덱스 찾기
function siblingIdx(from, step, kind){
  for(let i=from+step; i>=0 && i<curFiles.length; i+=step){ if(curFiles[i].kind===kind) return i; }
  return -1;
}
function gotoSibling(step, kind){
  const j=siblingIdx(curIdx, step, kind);
  if(j<0){ toast(step>0?('마지막 '+(kind==='video'?'영상':'사진')+'이에요'):('처음 '+(kind==='video'?'영상':'사진')+'이에요')); return false; }
  const f=curFiles[j]; preview(f.full, f); return true;
}
// ---- 뒤로가기(브라우저/폰 back) = 한 단계씩: 전체화면 → 미리보기 → 하위폴더 → … → 메뉴 ----
function fsEl(){ return document.fullscreenElement||document.webkitFullscreenElement||null; }
function exitFs(){ const x=document.exitFullscreen||document.webkitExitFullscreen; if(fsEl()&&x){ try{x.call(document);}catch(e){} } }
function navFolder(p){ history.pushState({pcr:1},''); load(p); }
function openPreview(path, it){ if(!pvOpen){ pvOpen=true; history.pushState({pcr:1},''); } preview(path, it); }
function closePreview(){ exitFs(); pvOpen=false; $('#pv').classList.remove('show'); $('#pvBody').innerHTML=''; }
window.addEventListener('popstate', ()=>{
  if(pvOpen){ closePreview(); return; }   // 미리보기 열려 있으면 닫고 폴더로
  if(canUp){ load(curParent); return; }    // 하위 폴더면 상위 폴더로
  location.href='/';                       // 루트 폴더면 메뉴로
});
async function preview(path, it){
  const body=$('#pvBody'); body.innerHTML='';
  curIdx = curFiles.findIndex(f=>f.full===path);
  const tbtn=$('#pvTrans'); tbtn.style.display='none'; tbtn.onclick=null;
  const cbtn=$('#pvCopy'); cbtn.style.display='none'; cbtn.onclick=null;
  const vrb=$('#pvVR'); vrb.style.display='none'; vrb.onclick=null;
  const prevB=$('#pvPrev'), nextB=$('#pvNext'); prevB.classList.remove('show'); nextB.classList.remove('show'); prevB.onclick=null; nextB.onclick=null;
  // 같은 종류 몇 번째인지 표시
  const sameKind = curFiles.filter(f=>f.kind===it.kind);
  const posInKind = sameKind.findIndex(f=>f.full===path)+1;
  $('#pvName').textContent = it.name + ((it.kind==='image'||it.kind==='video') && sameKind.length>1 ? '  ('+posInKind+'/'+sameKind.length+')' : '');
  if(it.kind==='video'||it.kind==='audio'){
    cbtn.style.display='inline';
    cbtn.onclick=()=>{ const url=location.origin+vurl(path);
      if(copyText(url)) toast('링크 복사됨! 외부 플레이어(VLC·MX 등)의 "네트워크 스트림 열기"에 붙여넣으세요.');
      else { prompt('이 링크를 복사해 외부 플레이어에 붙여넣으세요:', url); } };
    if(it.kind==='video'){ vrb.style.display='inline';
      vrb.onclick=()=> location.href='/cinema?src='+encodeURIComponent(vurl(path))+'&name='+encodeURIComponent(it.name); }
  }
  if(it.kind==='image'){
    const im=new Image(); im.src=vurl(path); body.appendChild(im);
    // 좌우 스와이프로 사진 넘기기
    let sx=0,sy=0,st=0,sdown=false;
    im.addEventListener('pointerdown',e=>{sdown=true;sx=e.clientX;sy=e.clientY;st=Date.now();});
    im.addEventListener('pointerup',e=>{ if(!sdown)return; sdown=false; const dx=e.clientX-sx,dy=e.clientY-sy;
      if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*1.3 && Date.now()-st<700){ gotoSibling(dx<0?1:-1,'image'); } });
    // 화살표 버튼 (사진이 2장 이상일 때)
    if(sameKind.length>1){
      if(siblingIdx(curIdx,-1,'image')>=0){ prevB.classList.add('show'); prevB.onclick=()=>gotoSibling(-1,'image'); }
      if(siblingIdx(curIdx, 1,'image')>=0){ nextB.classList.add('show'); nextB.onclick=()=>gotoSibling( 1,'image'); }
    }
  }
  else if(it.kind==='video'){
    const v=document.createElement('video'); v.controls=true; v.autoplay=true; v.playsInline=true; v.src=vurl(path);
    const wrap=document.createElement('div'); wrap.className='pvwrap';
    const gest=document.createElement('div'); gest.className='gest';
    wrap.appendChild(v); wrap.appendChild(gest); body.appendChild(wrap);
    // 영상 위 제스처 레이어 (아래 컨트롤바 영역은 비워둠):
    //   • 꾹 누르기 → 2배속(손 떼면 원래 속도)   • 짧은 탭 → 재생/일시정지
    //   • 오른쪽 절반 위로 쓸기 → 전체화면 / 아래로 쓸기 → 전체화면 해제
    let gDown=null, gMoved=false, ffT=null, ffPrev=1, ffOn=false;
    function enterFs(){ const r=wrap.requestFullscreen||wrap.webkitRequestFullscreen; if(r&&!fsEl()){ try{ const p=r.call(wrap); if(p&&p.catch) p.catch(()=>{}); }catch(e){} } }
    gest.addEventListener('pointerdown',e=>{
      gDown={x:e.clientX,y:e.clientY,t:Date.now(),right:(e.clientX-gest.getBoundingClientRect().left)>gest.clientWidth/2}; gMoved=false;
      ffT=setTimeout(()=>{ if(gMoved)return; ffPrev=v.playbackRate; v.playbackRate=2; ffOn=true; toast('▶▶ 2배속 — 손 떼면 원래 속도'); },450); });
    gest.addEventListener('pointermove',e=>{ if(!gDown)return;
      if(Math.hypot(e.clientX-gDown.x,e.clientY-gDown.y)>12){ gMoved=true; if(ffT){clearTimeout(ffT);ffT=null;} } });
    function gUp(e){ if(ffT){clearTimeout(ffT);ffT=null;}
      if(ffOn){ v.playbackRate=ffPrev; ffOn=false; gDown=null; return; }     // 2배속 해제
      if(!gDown) return; const dx=e.clientX-gDown.x, dy=e.clientY-gDown.y, dt=Date.now()-gDown.t, right=gDown.right; gDown=null;
      if(!gMoved && dt<350){ if(v.paused) v.play(); else v.pause(); return; } // 짧은 탭 = 재생/정지
      if(right && Math.abs(dy)>50 && Math.abs(dy)>Math.abs(dx)*1.3){ if(dy<0) enterFs(); else exitFs(); } } // 오른쪽 세로쓸기 = 전체화면
    gest.addEventListener('pointerup',gUp);
    gest.addEventListener('pointercancel',()=>{ if(ffT){clearTimeout(ffT);ffT=null;} if(ffOn){v.playbackRate=ffPrev;ffOn=false;} gDown=null; });
    // 끝나면 다음 영상 자동 재생(이어보기)
    v.addEventListener('ended',()=>{ const j=siblingIdx(curIdx,1,'video'); if(j>=0){ toast('다음 영상 재생…'); const f=curFiles[j]; preview(f.full,f); } });
    let transcoding=false;
    function toTranscode(auto){
      if(transcoding||!FF) return; transcoding=true;
      v.src=turl(path); v.load(); const p=v.play&&v.play(); if(p&&p.catch) p.catch(()=>{});
      tbtn.textContent='⚙️ 변환 중';
      toast(auto?'폰이 못 여는 형식 → 변환 재생으로 전환':'변환 재생 (되감기는 제한될 수 있어요)');
    }
    v.addEventListener('error',()=>{
      if(FF && !transcoding) toTranscode(true);
      else if(!FF) body.insertAdjacentHTML('beforeend','<div class="msg">폰이 못 여는 형식이에요.<br>PC에 ffmpeg를 설치하면 변환 재생이 됩니다.</div>');
    });
    if(FF){ tbtn.style.display='inline'; tbtn.textContent='⚙️ 변환'; tbtn.onclick=()=>toTranscode(false); }
  }
  else if(it.kind==='audio'){ const a=document.createElement('audio'); a.src=vurl(path); a.controls=true; a.autoplay=true; a.style.width='90%'; body.appendChild(a); }
  else if(it.kind==='pdf'){ const f=document.createElement('iframe'); f.src=vurl(path); body.appendChild(f); }
  else if(it.kind==='text'){ body.innerHTML='<div class="msg">불러오는 중…</div>';
    try{ let t=await (await fetch(vurl(path))).text(); if(t.length>500000) t=t.slice(0,500000)+'\n\n…(이하 생략)'; const pre=document.createElement('pre'); pre.textContent=t; body.innerHTML=''; body.appendChild(pre); }
    catch(e){ body.innerHTML='<div class="msg">열 수 없어요</div>'; } }
  else { body.innerHTML='<div class="msg">이 형식은 미리보기를 지원하지 않아요.<br>('+it.name+')</div>'; }
  $('#pv').classList.add('show');
}
$('#pvClose').onclick=()=> history.back();
$('#loginBtn').onclick=async()=>{PIN=$('#pinInput').value.trim(); if(await connect())localStorage.setItem('pcremote_pin',PIN); else $('#loginErr').textContent='PIN이 틀렸거나 연결이 안 돼요.';};
$('#pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click();});
if(PIN){$('#pinInput').value=PIN;connect();}
window.__FILES_TEST__={connect,load,preview,cur:()=>cur,ff:()=>FF};
</script></body></html>""".replace('__CSS__', LOGIN_CSS)

# ================= VR 영화관 (WebXR, 메타 퀘스트) =================
# PC 리모컨 파일뷰어의 🥽 VR 버튼이 /cinema?src=<영상주소>&name=<이름> 으로 열어줍니다.
# 같은 출처(같은 http/https 주소)라서 CORS·혼합콘텐츠 문제가 없습니다.
# VR '입장'은 https(보안) 접속에서만 됩니다 → PC에서 tailscale serve 로 https 열기.
CINEMA_PAGE = r"""<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>VR 영화관</title>
<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{height:100%;background:#07090e;color:#e8edf2;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",Roboto,"Noto Sans KR",sans-serif;overflow:hidden}
  a.back{position:fixed;top:12px;left:12px;z-index:11;color:#b9d6ff;text-decoration:none;font-size:.9rem;background:#0b0f17cc;border:1px solid #2a3545;border-radius:10px;padding:8px 12px}
  #panel{position:fixed;left:0;right:0;bottom:0;z-index:10;background:linear-gradient(0deg,#0b0f17f7,#0b0f17cc);border-top:1px solid #2a3545;padding:12px 12px calc(12px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;transition:transform .2s}
  #panel.hide{transform:translateY(calc(100% - 42px))}
  #panel h1{font-size:1rem;font-weight:800;display:flex;align-items:center;gap:8px;min-width:0}
  #panel h1 #title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #panel h1 .fold{margin-left:auto;flex:0 0 auto;font-size:.78rem;color:#8ea0b4;background:#0e1724;border:1px solid #2a3545;border-radius:8px;padding:5px 10px;cursor:pointer;font-weight:700}
  .row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
  .btn{font-family:inherit;font-weight:700;font-size:.85rem;padding:10px 12px;border-radius:11px;border:1px solid #2a3545;background:#131b26;color:#e8edf2;cursor:pointer;white-space:nowrap}
  .btn.primary{background:#4b9bff;border-color:#4b9bff;color:#fff}
  #status{font-size:.8rem;color:#37e0a6;min-height:1.1em}
  #warn{font-size:.82rem;color:#ffcf5c;line-height:1.5;display:none}
</style></head><body>
<a-scene background="color:#05070b" vr-mode-ui="enabled:true" device-orientation-permission-ui="enabled:false">
  <a-assets><video id="vid" loop playsinline webkit-playsinline preload="auto"></video></a-assets>
  <a-sky color="#05070b"></a-sky>
  <a-plane rotation="-90 0 0" width="60" height="60" material="color:#0a1018;shader:standard;roughness:0.95"></a-plane>
  <a-circle rotation="-90 0 0" radius="2.6" position="0 0.01 0" material="color:#101a28;shader:flat;opacity:0.9"></a-circle>
  <a-entity id="screenGrp" position="0 2.7 -8">
    <a-plane id="glow" width="9" height="5.4" position="0 0 -0.06" material="color:#1b2f52;shader:flat;opacity:0.55"></a-plane>
    <a-plane id="frame" width="8.5" height="4.9" position="0 0 -0.03" material="color:#000;shader:flat"></a-plane>
    <a-video id="scr" class="clickable" src="#vid" width="8" height="4.5"></a-video>
    <a-entity id="playBtn" class="clickable" position="0 -2.9 0">
      <a-plane width="1.5" height="0.6" material="color:#16233a;shader:flat"></a-plane>
      <a-text id="playTxt" value="▶ 재생" align="center" position="0 0 0.01" width="4" color="#e8edf2"></a-text>
    </a-entity>
  </a-entity>
  <a-entity light="type:ambient;color:#9fb4d0;intensity:0.4"></a-entity>
  <a-entity light="type:point;intensity:0.5;distance:40" position="0 7 -2"></a-entity>
  <a-entity id="rig">
    <a-camera position="0 1.6 0" wasd-controls="enabled:true">
      <a-entity cursor="fuse:false;rayOrigin:mouse" raycaster="objects:.clickable;far:30"></a-entity>
    </a-camera>
    <a-entity laser-controls="hand:right" raycaster="objects:.clickable;far:30;lineColor:#4b9bff"></a-entity>
    <a-entity laser-controls="hand:left"  raycaster="objects:.clickable;far:30;lineColor:#4b9bff"></a-entity>
  </a-entity>
</a-scene>
<a href="/files" class="back">&larr; 파일</a>
<div id="panel">
  <h1>&#127916; <span id="title">VR 영화관</span> <span class="fold" id="fold">접기</span></h1>
  <div class="row">
    <button class="btn primary" id="play">&#9199; 재생/정지</button>
    <button class="btn" id="smaller">&minus; 작게</button>
    <button class="btn" id="bigger">&plus; 크게</button>
    <button class="btn" id="nearer">&larr; 가까이</button>
    <button class="btn" id="farther">&rarr; 멀리</button>
  </div>
  <div id="status"></div>
  <div id="warn"></div>
</div>
<script>
'use strict';
var vid=document.getElementById('vid'), scr=document.getElementById('scr'),
    frame=document.getElementById('frame'), glow=document.getElementById('glow'),
    grp=document.getElementById('screenGrp'), playTxt=document.getElementById('playTxt');
var W=8, aspect=9/16, dist=8;
function layout(){ var h=W*aspect;
  scr.setAttribute('width',W); scr.setAttribute('height',h);
  frame.setAttribute('width',W+0.5); frame.setAttribute('height',h+0.4);
  glow.setAttribute('width',W+1.0); glow.setAttribute('height',h+0.9);
  grp.setAttribute('position','0 '+(1.6+h/2-0.3)+' '+(-dist)); }
layout();
function status(m){ document.getElementById('status').textContent=m; }
vid.addEventListener('loadedmetadata',function(){ if(vid.videoWidth>0){ aspect=vid.videoHeight/vid.videoWidth; layout(); } });
vid.addEventListener('playing',function(){ playTxt.setAttribute('value','⏸ 일시정지'); });
vid.addEventListener('pause',function(){ playTxt.setAttribute('value','▶ 재생'); });
vid.addEventListener('error',function(){ status('영상을 열 수 없어요. (주소/형식 확인)'); });
function toggle(){ if(vid.paused){ var p=vid.play(); if(p&&p.catch)p.catch(function(){}); } else { vid.pause(); } }
document.getElementById('play').onclick=toggle;
scr.addEventListener('click',toggle);
document.getElementById('playBtn').addEventListener('click',toggle);
document.getElementById('bigger').onclick=function(){ W=Math.min(16,W+1); layout(); };
document.getElementById('smaller').onclick=function(){ W=Math.max(3,W-1); layout(); };
document.getElementById('nearer').onclick=function(){ dist=Math.max(4,dist-1); layout(); };
document.getElementById('farther').onclick=function(){ dist=Math.min(16,dist+1); layout(); };
var panel=document.getElementById('panel');
document.getElementById('fold').onclick=function(){ panel.classList.toggle('hide');
  document.getElementById('fold').textContent=panel.classList.contains('hide')?'펼치기':'접기'; };
// ?src= 로 전달된 영상 자동 로드 (PC 리모컨 파일뷰어의 🥽 VR 버튼)
var qs=new URLSearchParams(location.search), src=qs.get('src'), nm=qs.get('name');
if(nm) document.getElementById('title').textContent=nm;
if(src){ vid.src=src; vid.load(); var pp=vid.play(); if(pp&&pp.catch)pp.catch(function(){});
  status('재생 준비됨 — 오른쪽 아래 🥽 로 VR 입장! (소리가 안 나면 ⏯ 한 번)'); }
else { status('영상이 지정되지 않았어요. 파일에서 영상을 열고 🥽 VR 로 들어오세요.'); }
if(!window.isSecureContext || !navigator.xr){
  var w=document.getElementById('warn'); w.style.display='block';
  w.innerHTML='⚠️ VR 입장은 <b>https 접속</b>에서만 돼요. 지금은 3D 미리보기만 가능.<br>PC에서 <b>tailscale serve</b> 로 https 주소를 열고 접속하면 VR이 열려요.';
}
var scene=document.querySelector('a-scene');
scene.addEventListener('enter-vr',function(){ if(vid.src){ var p=vid.play(); if(p&&p.catch)p.catch(function(){}); } });
window.__CINEMA_TEST__={layout,toggle,get w(){return W},get dist(){return dist},src:function(){return vid.src}};
</script>
</body></html>"""

# ================= VR 모니터 (WebXR, 메타 퀘스트) =================
# PC 화면(MJPEG /stream.mjpg)을 VR 안 거대한 스크린에 실시간 표시.
# 같은 출처라 CORS/혼합콘텐츠 문제 없음. VR '입장'은 https(tailscale serve)에서.
VRMON_PAGE = r"""<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>VR 모니터</title>
<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>
<script>
// PC 화면(MJPEG) 을 3D 스크린 텍스처로 — 매 프레임 갱신(자체발광)
if(window.AFRAME){ AFRAME.registerComponent('live-screen',{
  schema:{src:{type:'selector'}},
  init:function(){ var self=this; this.img=this.data.src; this.tex=null;
    var apply=function(){ var m=self.el.getObject3D('mesh'); if(!m) return;
      self.tex=new THREE.Texture(self.img); self.tex.minFilter=THREE.LinearFilter; self.tex.magFilter=THREE.LinearFilter;
      if(THREE.SRGBColorSpace) self.tex.colorSpace=THREE.SRGBColorSpace;
      m.material=new THREE.MeshBasicMaterial({map:self.tex}); };
    if(this.el.getObject3D('mesh')) apply(); else this.el.addEventListener('object3dset',apply); },
  tick:function(){ if(this.tex && this.img && this.img.naturalWidth) this.tex.needsUpdate=true; }
}); }
</script>
<style>
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{height:100%;background:#07090e;color:#e8edf2;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",Roboto,"Noto Sans KR",sans-serif;overflow:hidden}
  a.back{position:fixed;top:12px;left:12px;z-index:11;color:#b9d6ff;text-decoration:none;font-size:.9rem;background:#0b0f17cc;border:1px solid #2a3545;border-radius:10px;padding:8px 12px}
  #login{position:fixed;inset:0;background:#0b0f17f2;display:flex;align-items:center;justify-content:center;z-index:50;padding:24px}
  #login .card{background:#131b26;border:1px solid #2a3545;border-radius:18px;padding:26px 22px;max-width:320px;width:100%;text-align:center}
  #login h1{font-size:1.15rem;font-weight:800;margin-bottom:6px}
  #login p{color:#8ea0b4;font-size:.84rem;margin-bottom:14px;line-height:1.5}
  #login input{width:100%;font-size:1.4rem;text-align:center;letter-spacing:.3em;padding:11px;border-radius:12px;border:1px solid #2a3545;background:#0e1724;color:#e8edf2}
  #login button{margin-top:12px;width:100%;font-weight:800;font-size:1rem;padding:13px;border-radius:12px;border:none;background:#4b9bff;color:#fff;cursor:pointer}
  #login .err{color:#ff8080;font-size:.8rem;min-height:1em;margin-top:6px}
  #panel{position:fixed;left:0;right:0;bottom:0;z-index:10;background:linear-gradient(0deg,#0b0f17f7,#0b0f17cc);border-top:1px solid #2a3545;padding:12px 12px calc(12px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;transition:transform .2s}
  #panel.hide{transform:translateY(calc(100% - 42px))}
  #panel h1{font-size:1rem;font-weight:800;display:flex;align-items:center;gap:8px}
  #panel h1 .fold{margin-left:auto;font-size:.78rem;color:#8ea0b4;background:#0e1724;border:1px solid #2a3545;border-radius:8px;padding:5px 10px;cursor:pointer;font-weight:700}
  .row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
  .btn{font-family:inherit;font-weight:700;font-size:.85rem;padding:10px 12px;border-radius:11px;border:1px solid #2a3545;background:#131b26;color:#e8edf2;cursor:pointer;white-space:nowrap}
  #warn{font-size:.82rem;color:#ffcf5c;line-height:1.5;display:none}
</style></head><body>
<div id="login"><div class="card"><h1>&#129405; VR 모니터</h1>
  <p>PC 터미널의 <b>PIN</b>을 입력하세요.<br>헤드셋에서 PC 화면을 큰 VR 스크린으로.</p>
  <input id="pin" type="tel" inputmode="numeric" placeholder="PIN">
  <div class="err" id="err"></div><button id="go">접속</button></div></div>

<img id="scr" crossorigin="anonymous" style="display:none" alt="">

<a-scene background="color:#05070b" vr-mode-ui="enabled:true" device-orientation-permission-ui="enabled:false">
  <a-sky color="#05070b"></a-sky>
  <a-plane rotation="-90 0 0" width="60" height="60" material="color:#0a1018;shader:standard;roughness:0.95"></a-plane>
  <a-circle rotation="-90 0 0" radius="2.6" position="0 0.01 0" material="color:#101a28;shader:flat;opacity:0.9"></a-circle>
  <a-entity id="screenGrp" position="0 2.4 -7">
    <a-plane id="frame" width="8.5" height="4.9" position="0 0 -0.03" material="color:#000;shader:flat"></a-plane>
    <a-plane id="scrPlane" width="8" height="4.5" live-screen="src:#scr"></a-plane>
  </a-entity>
  <a-entity light="type:ambient;intensity:0.5"></a-entity>
  <a-entity light="type:point;intensity:0.4;distance:40" position="0 7 -2"></a-entity>
  <a-entity id="rig">
    <a-camera position="0 1.6 0" wasd-controls="enabled:true"></a-camera>
    <a-entity laser-controls="hand:right" raycaster="far:30;lineColor:#4b9bff"></a-entity>
    <a-entity laser-controls="hand:left"  raycaster="far:30;lineColor:#4b9bff"></a-entity>
  </a-entity>
</a-scene>

<a href="/" class="back">&larr; 메뉴</a>
<div id="panel">
  <h1>&#129405; VR 모니터 <span class="fold" id="fold">접기</span></h1>
  <div class="row">
    <button class="btn" id="qual">&#128444;&#65039; 화질: 보통</button>
    <button class="btn" id="smaller">&minus; 작게</button>
    <button class="btn" id="bigger">&plus; 크게</button>
    <button class="btn" id="nearer">&larr; 가까이</button>
    <button class="btn" id="farther">&rarr; 멀리</button>
    <button class="btn" id="reload">&#128260; 재연결</button>
  </div>
  <div id="warn"></div>
</div>
<script>
'use strict';
var PIN=''; var scr=document.getElementById('scr');
var scrPlane=document.getElementById('scrPlane'), frame=document.getElementById('frame'), grp=document.getElementById('screenGrp');
var W=8, aspect=9/16, dist=7;
var QL=1, QS=[{w:960,q:52,n:'낮음'},{w:1280,q:66,n:'보통'},{w:1600,q:74,n:'높음'}];
function api(p){return p+(p.includes('?')?'&':'?')+'pin='+encodeURIComponent(PIN);}
function layout(){ var h=W*aspect;
  scrPlane.setAttribute('width',W); scrPlane.setAttribute('height',h);
  frame.setAttribute('width',W+0.5); frame.setAttribute('height',h+0.4);
  grp.setAttribute('position','0 '+(1.6+h/2-0.2)+' '+(-dist)); }
layout();
function startStream(){ var q=QS[QL]; scr.src=api('/stream.mjpg')+'&w='+q.w+'&q='+q.q+'&t='+Date.now(); }
scr.addEventListener('load', function(){ if(scr.naturalWidth>0){ var a=scr.naturalHeight/scr.naturalWidth; if(Math.abs(a-aspect)>0.01){ aspect=a; layout(); } } });
async function connect(){ try{ var r=await fetch(api('/ping')); if(!r.ok) throw 0;
  document.getElementById('login').style.display='none'; startStream(); return true; }catch(e){ return false; } }
document.getElementById('go').onclick=async function(){ PIN=document.getElementById('pin').value.trim();
  if(await connect()){ try{localStorage.setItem('pcremote_pin',PIN);}catch(e){} } else document.getElementById('err').textContent='PIN이 틀렸거나 연결이 안 돼요.'; };
document.getElementById('pin').addEventListener('keydown',function(e){ if(e.key==='Enter') document.getElementById('go').click(); });
document.getElementById('qual').onclick=function(){ QL=(QL+1)%QS.length; this.textContent='🖼️ 화질: '+QS[QL].n; startStream(); };
document.getElementById('reload').onclick=startStream;
document.getElementById('bigger').onclick=function(){ W=Math.min(16,W+1); layout(); };
document.getElementById('smaller').onclick=function(){ W=Math.max(3,W-1); layout(); };
document.getElementById('nearer').onclick=function(){ dist=Math.max(4,dist-1); layout(); };
document.getElementById('farther').onclick=function(){ dist=Math.min(16,dist+1); layout(); };
var panel=document.getElementById('panel');
document.getElementById('fold').onclick=function(){ panel.classList.toggle('hide');
  document.getElementById('fold').textContent=panel.classList.contains('hide')?'펼치기':'접기'; };
if(!window.isSecureContext || !navigator.xr){ var w=document.getElementById('warn'); w.style.display='block';
  w.innerHTML='⚠️ VR 입장은 <b>https 접속</b>에서만 돼요. 지금은 평면 미리보기만 가능.'; }
try{ var sp=localStorage.getItem('pcremote_pin'); if(sp){ document.getElementById('pin').value=sp; PIN=sp; connect(); } }catch(e){}
window.__VRMON_TEST__={connect:connect,startStream:startStream,get w(){return W},src:function(){return scr.src}};
</script>
</body></html>"""

def main():
    ips = list_ips()
    # 바인드 주소 결정: 'auto'면 Tailscale 주소가 있을 때 그 주소로만(인터넷 노출 차단)
    bind = ARGS.bind
    if bind == 'auto':
        ts = [a for a in ips if is_tailscale(a)]
        bind = ts[0] if ts else '0.0.0.0'
    try:
        srv = ThreadingHTTPServer((bind, ARGS.port), H)
    except OSError as e:
        if bind != '0.0.0.0':
            print('[알림] %s 로 수신 실패(%s) → 0.0.0.0 로 대체합니다.' % (bind, e))
            bind = '0.0.0.0'; srv = ThreadingHTTPServer(('0.0.0.0', ARGS.port), H)
        else:
            raise
    srv.daemon_threads = True
    bound_tailscale = is_tailscale(bind)
    print('='*56)
    print('  브로가드 PC 리모컨')
    print('='*56)
    if bind != '0.0.0.0':
        # 특정 주소로만 수신 — 그 주소만 안내
        kind = 'Tailscale 주소 (안 바뀜, 집 밖에서도)' if bound_tailscale else '지정 주소'
        print('  폰/태블릿 브라우저에서 여세요 (이 주소로만 열려 있어 안전):')
        print('      http://%s:%d   <- %s' % (bind, ARGS.port, kind))
    else:
        print('  폰/태블릿 브라우저에서 아래 주소 중 하나를 여세요:')
        for a in ips:
            if is_tailscale(a):   note = '   <- Tailscale 주소 (집 밖에서도 이걸로! 안 바뀜)'
            elif is_private(a):   note = '   <- 집 안 LAN 주소'
            else:                 note = '   <- 공용(인터넷) 주소, 쓰지 마세요(수시로 바뀜)'
            print('      http://%s:%d%s' % (a, ARGS.port, note))
        if any(is_tailscale(a) for a in ips):
            print('  (Tailscale 주소는 안 바뀌니 폰에 북마크 해두세요)')
        elif any(is_private(a) for a in ips):
            print('  (집 안에서는 위 192.168.x.x / 10.x.x.x 주소를 쓰세요)')
        else:
            print('  [참고] 집 안(사설) 주소가 안 보여요. cmd에서 ipconfig 로 확인해 보세요.')
    print('  PIN:  %s' % (PIN if PIN is not None else '(없음)'))
    print('  화면: %s%s' % ({'real':'실제 캡처','demo':'데모','off':'꺼짐(pip install mss pillow)'}[SCREEN_MODE],
                           ('  %dx%d'%(SCREEN_W,SCREEN_H)) if SCREEN_MODE!='off' else ''))
    print('  파일 폴더:  %s' % ROOT)
    print('  변환 재생:  %s' % ('사용 가능(ffmpeg)' if HAVE_FFMPEG else '꺼짐 (ffmpeg 설치 시 mkv/avi 등도 재생)'))
    print('  마우스:    %s' % ('사용 가능(pyautogui)' if HAVE_INPUT else ('데모 시뮬레이션' if SCREEN_MODE=='demo' else '꺼짐 (pip install pyautogui)')))
    print('  (같은 와이파이 /  종료: Ctrl+C /  방화벽 "액세스 허용" 필요)')
    print('='*56)
    try: srv.serve_forever()
    except KeyboardInterrupt: print('\n종료합니다.'); srv.shutdown()

if __name__ == '__main__':
    main()
