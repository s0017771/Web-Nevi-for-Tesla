# 🧠 초능력 체험 (vr-powers.html) — 작업 지침

> 먼저 `HANDOFF/CONTEXT.md`. 1인칭 초능력 체험. 1단계=염력(telekinesis). 최대한 물리법칙 안에서.

## 콘셉트
주변에 사물들이 있고, 손(컨트롤러/폰)으로 조준해서 **착**=손으로 끌어오기, **탈**=손에서 밀어 던지기. 전기·물·불 등 여러 초능력으로 확장.

## 현재 상태(3차 염력 — 손맛 세게 튜닝 + 리얼 사운드·비주얼 모듈)
- **순수 물리 코어 `window.__TKPHYS`**(THREE/A-Frame 비의존, `.x/.y/.z`만 조작 → THREE.Vector3에도 그대로 적용). 염력 로직을 전부 이리로 분리해 **헤드리스에서 검증**. 상수/함수(세게 튜닝됨): `G 9.8, REST 0.48(반발), FRICT 0.68, HELD_DIST 0.6, THROW_MIN/MAX 7.5~24, THROW_UP 2.3, CATCH_DIST 0.36, CHARGE_FULL 0.75s`; `pullSpeed(m)=11/√m`, `FOLLOW_BASE 26`, `followLerp(m,k)`, `throwSpeed(charge,m)`, `throwVel(dir,charge,m,out)`, `pullStep/heldStep/freeStep`, `aim(p,d,objs,pad)`(레이-구).
- **물리 사물** `tkobject`(schema `r`,`m`): rest/pulling/held/free. tick이 `__TKPHYS`에 위임(기기에서만 tick 동작).
- **무게감(질량 m)**: 무거울수록 느리게 끌리고(√m), 손 추종 둔하고(관성), 약하게 날아감. 중력은 질량 독립(올바른 물리). 6번째 도형=무거운 돌덩이(m 2.4, 크고 회색).
- **던지기 힘 충전(차징)**: 탈을 **꾹 누르면** 모았다가(0.75s 만충) **떼면 세게**. 차징 중 물건이 살짝 수축+글로우, 화면 게이지/버튼 빛, 허밍 음정 상승, 햅틱. 손에 든 게 없을 땐 즉시 밀어내기.
- **조준**: 하이라이트 글로우=정조준 `aimPick()`(`__TKPHYS.aim`). **착/밀기는 관대한 조준 `aimGrab()`=`__TKPHYS.pickFront`** — 정조준 실패 시 손 앞쪽 콘(±72°) 가장 가까운 사물을 잡음(정밀 조준 없이도 당겨짐). 크로스헤어 lock·우상단 `#dbg` 상태(모드/손 OK/조준 ✓)는 관대한 조준 기준.
- **방어 가드**: `el.components && el.components.tkobject`로 접근(컴포넌트 미초기화 시 착/탈 크래시 방지).
- **손 자세** `window.__handPose()`: VR=오른손 컨트롤러, 모바일/PC=카메라 전방 살짝 아래. `handsys`가 매 프레임 `window.__HAND` 갱신.
- **입력**: VR 트리거=착 / 그립 누름=차징·떼면 던지기(`powerhand`, gripdown/gripup). 모바일 🧲착(click)/💥탈(pointerdown~up=차징). PC f=착, g 꾹=차징. 손↔든 물건 빔(차징 중 주황).
- **🔊 리얼 사운드 모듈 `vr-powers-audio.js`(`window.POWERSAUDIO`)**: 순수 WebAudio 오리지널 합성(비프 아님 — 노이즈+바이쿼드 필터 스윕+엔벨로프 레이어드). API: `pull/grab/chargeStart/chargeUpdate(c)/chargeStop/throw(power)/impact(v)/ambientStart/ambientStop/resume/renderOfflineTest`. 마스터 버스=컴프(-16/12/2.5/10ms/250ms/0.9)+리버브 send(1.6s·0.22)+리미터(CONTEXT 사양). vr-powers.html은 `PA()` 래퍼로 호출(모듈 없으면 오실레이터 폴백).
- **🎨 비주얼 모듈 `vr-powers-viz.js`(`window.POWERSVIZ`)**: Canvas2D 반실사 에너지 이펙트(텍스처 12종 + A-Frame 헬퍼). ⚠️ **현재 vr-powers.html 에 미연결**(롤백됨). 1차 통합 시 실기기에서 **흰색 평면이 화면/사물을 덮고 착이 안 되는 문제** 발생 → 비주얼 와이어링만 dbfc79b 로 되돌림. 원인 후보: 모바일 손 오라가 카메라 앞을 덮음, 사물에 붙인 additive 평면(조준 코어/필드 halo)이 흰 사각으로 보임, 스카이/바닥 텍스처. 모듈 파일·API는 저장소에 남아있음. 재도입 시 카메라 가리지 않게(오라는 손에만/작게), additive 대신 보수적 블렌딩, 하나씩 켜며 **실기기 확인** 필요. (참고: `vr-gun.html`은 같은 data-URL material 패턴으로 정상 작동 → 텍스처 방식 자체는 문제 아님)
- 테스트 훅 `window.__POWERS_TEST__`: start, setMode/mode, playing, nObjs, held, charging/charge, pull, pushDown, pushUp, stateOf, massOf, setHandAhead, `phys`(=__TKPHYS).
- **헤드리스 검증**: `tests/powers.e2e.mjs`(28 통과, pickFront 포함) — `__TKPHYS` 손맛 직접 검증 + 앱 로드/스폰/입력 무크래시 + **사운드 모듈 로드/오디오 오프라인 렌더(clipped false·rms>0.01)**. 모듈은 로컬 파일이라 CDN 차단과 무관하게 로드됨. 실행: `NODE_PATH=/opt/node22/lib/node_modules node tests/powers.e2e.mjs`.
- **기기에서만 확인 가능(코드로 100% 불가)**: A-Frame 렌더/컨트롤러 tick(실제 이동·충돌·회전), 비주얼이 **실제로 보기 좋은지**(오라/필드/차징/버스트/먼지/strand/스카이·바닥 — additive 블렌딩·맥동·strand 방향정렬), 실제 **스피커 효과음 체감**(끌림 흡인감·차징 긴장감·던지기 묵직함·충돌 질감)·햅틱, VR 그립 차징 손맛, 모바일 폰 움직임 조준·자이로. 레벨/색/리버브는 실기기 미세조정 여지.

## 다음 작업(제안)
- 염력 더 다듬기: 여러 개 동시 끌기, 손/팔 모델·제스처, 선반에서 떨어뜨려 쌓기, 사물 간 충돌(질량·관성 이미 있음).
- **파워 확장**(같은 틀 `__TKPHYS` 재사용 가능):
  - ⚡ 전기: 손에서 전기 아크 → 맞은 사물/표적에 스파크·연쇄.
  - 💧 물 생성/분사: 입자(물줄기)로 밀어내기(물리 힘), 젖음 효과.
  - 🔥 불 던지기: 포물선 불덩이(중력)·명중 시 폭발/파티클.
  - 파워 선택 UI(메뉴/썸스틱), 각 파워별 사운드.
- 물리 정교화: 사물 간 충돌, 질량·관성, 선반에서 떨어뜨리기.
- 모바일 자이로 조준/권한 실기기 검증.

## 파일
- `vr-powers.html`. 런처 키 `vrpowers`. **물리 상수/함수는 전부 `window.__TKPHYS`**(파일 상단, A-Frame 가드 밖). `tkobject` tick은 이를 호출만 함. 던지기는 `__pushDown`(차징 시작)/`__pushUp`(발사), 끌기는 `__pull`. 사운드는 `PA()`→`window.POWERSAUDIO`, 비주얼은 `VZ()`→`window.POWERSVIZ` 래퍼(둘 다 없어도 폴백/무크래시).
- `vr-powers-audio.js`(사운드), `vr-powers-viz.js`(비주얼) — 각각 독립 전역 모듈. `<head>`에서 aframe·vr-common.js 다음에 로드.
- 테스트: `tests/powers.e2e.mjs`.
