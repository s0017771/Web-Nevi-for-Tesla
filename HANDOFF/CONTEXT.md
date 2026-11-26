# 공통 컨텍스트 (모든 방에서 먼저 읽기)

브로가드 VR/웹 게임 모음. 각 게임은 단일 HTML 파일(A-Frame WebXR)이고, 런처(`index.html`)에서 링크된다.
새 방(세션)은 이 저장소를 클론하므로 `HANDOFF/<게임>.md`를 함께 읽고 해당 게임 파일만 작업하면 된다.

## 저장소/배포
- GitHub: `s0017771/Web-Nevi-for-Tesla` — `main`에 push하면 Vercel 자동 배포(퀘스트/폰 브라우저에서 접속).
- 커밋 작성자: `git -c user.email="s0017771@gmail.com" -c user.name="s0017771" commit`.
- 런처 등록: `index.html`의 `LINKS`(주소)와 `APPS` 배열(타일, VR이면 `cat:"vr"`)에 추가.

## 기술 스택 / 패턴
- **A-Frame 1.6.0** (`https://aframe.io/releases/1.6.0/aframe.min.js`). 컴포넌트는 반드시 `if(window.AFRAME){ AFRAME.registerComponent(...) }`로 감쌀 것.
- **vr-common.js** (aframe 다음에 로드):
  - `ktext` — A-Frame 기본 글꼴이 한글 미지원이라 캔버스로 한글/이모지 렌더. 사용: `<a-entity ktext="value: 점수 0; color:#fff; size:0.3">`, 동적 변경 `el.setAttribute('ktext','value', '점수 '+n)` (3-인자 형태).
  - `billboard` — 항상 카메라를 바라봄.
  - **모바일 터치**: 탭 → 카메라 레이캐스트 → `.clickable`이면 `click` 발생(메뉴 버튼 작동). 버튼을 못 맞힌 탭은 `window.__vrTapAt(x,y,ndc,cam,ray)`로 전달(게임이 발사/타격에 사용). A-Frame 없으면 전체 비활성.
- 컨트롤러: `laser-controls` + `cursor="fuse:false; downEvents:triggerdown; upEvents:triggerup"`. 커스텀 입력은 `triggerdown`/`triggerup`/`gripdown`/`thumbstickmoved` 리스닝.

## 사운드 (뮤직랩 원장 사양서 반영)
- **실제 샘플 우선 + 오실레이터 폴백**: FluidR3_GM(MIT) 사운드폰트.
  - 멜로디/피아노: `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/<음이름>.mp3` (예 `C4.mp3`, 플랫 표기 `Db4`).
  - 드럼: `.../FluidR3_GM/percussion-mp3/<음>.mp3` (GM: 36킥=C2, 38스네어=D2, 42닫은햇=Gb2, 46열린햇=Bb2, 47탐=B2, 49크래시=Db3, 51라이드=Eb3).
  - 음→MIDI: `round(69+12*log2(f/440))`, MIDI→이름: `['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][m%12] + (floor(m/12)-1)`.
  - 곡 시작 시 사용 음만 `fetch→decodeAudioData→버퍼` 프리로드, 없으면 합성 폴백(끊김 없음).
- **공간감(리버브) + 마스터 컴프레서** — 사양서 '보통' 프리셋:
  - 리버브 IR: 길이 tail=**1.6s**, 감쇠곡선 `(1 - t/tail)^2.8`, wet **0.22** send 버스.
  - 컴프레서: threshold **−16dB**, knee **12**, ratio **2.5**, attack **10ms**, release **250ms**, makeup ~0.9.
  - 참고 전체 사양서(방안 A 사전렌더 vs 방안 B 실시간): 리듬 게임은 인터랙티브라 **방안 B(실시간 합성)+샘플**이 맞음.
- 참고 구현: `vr-saber.html`(피아노+드럼 샘플, 리버브/컴프), `vr-drums.html`(드럼 샘플).

## 테스트 (중요: 샌드박스에선 CDN 차단 → A-Frame 렌더 불가)
- Playwright headless + **A-Frame abort**: `await p.route('**/aframe*', r=>r.abort())`.
- 게임마다 `window.__XXX_TEST__` 훅으로 **순수 로직** 검증(물리/상태/점수). A-Frame 컴포넌트(이동/충돌 tick)는 기기에서만 동작.
- **오디오 검증**: 헤드리스 Chromium의 `OfflineAudioContext`로 실제 synth 경로를 렌더 → 자기상관 음정검출/온셋/클리핑 분석. (예: `vr-saber.html`의 `__SABER_TEST__.renderOffline`.)
- 샘플 로드 검증: `p.route('**/midi-js-soundfonts/**', r=>r.fulfill({...WAV...}))`로 목(mock)해 fetch→decode→재생 체인 확인.
- **A-Frame 렌더/모바일 자이로/실제 샘플 소리/비주얼은 기기(퀘스트·폰)에서 사용자가 확인**. 이 부분은 코드로 100% 검증 불가 — 완성도 점검 시 사용자 확인 필요.

## 제약
- UI는 한국어. 저작권 자산/상용곡 금지 — 오리지널 아트/사운드만.
- 작성한 변경은 `main`에 push(또는 방의 harness가 지정한 브랜치).
