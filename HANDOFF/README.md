# 게임별 작업 방(세션) 지침 모음

각 게임을 **별도의 방(세션)**에서 단일 모드로 작업하기 위한 지침. 새 방은 이 저장소(`s0017771/Web-Nevi-for-Tesla`)를 클론하므로, 방을 열고 아래 **여는 말**을 붙여넣으면 된다.

## 방 여는 말(복사용 템플릿)
> 이 저장소의 `HANDOFF/CONTEXT.md`와 `HANDOFF/<게임>.md`를 먼저 읽고, 해당 게임 파일만 작업해줘. 샌드박스에선 A-Frame CDN이 막히니 로직/오디오는 헤드리스로 검증하고, 기기(퀘스트·폰) 확인이 필요한 부분은 내게 알려줘. 변경은 `main`에 커밋·푸시.

`<게임>` 자리에 아래 파일명을 넣는다:

| 게임 | 지침 | 파일 |
|---|---|---|
| 🏹 VR 석궁 (대규모 진행중) | `HANDOFF/vr-shooter.md` | `vr-shooter.html` |
| 🗡️ 리듬 세이버 | `HANDOFF/vr-saber.md` | `vr-saber.html` (+`vr-songs.js`,`songs/`) |
| 🔫 리듬 건 | `HANDOFF/vr-gun.md` | `vr-gun.html` |
| ⏱️ 시간정지 슈터 | `HANDOFF/vr-timeshot.md` | `vr-timeshot.html` |
| 🥁 VR 드럼 | `HANDOFF/vr-drums.md` | `vr-drums.html` |
| 🪐 천문관 / 🎬 영화관 | `HANDOFF/vr-viewers.md` | `vr-planetarium.html` / `vr-cinema.html` |

## 공통(모든 방)
- `HANDOFF/CONTEXT.md` = 저장소/배포, A-Frame·vr-common 패턴, 사운드 사양서(FluidR3_GM 샘플+리버브/컴프), 테스트 방법, 제약.
- 공용 파일(`vr-common.js`, `index.html` 런처)을 바꿀 땐 다른 게임에 영향 주니 주의(여러 방이 동시에 건드리면 충돌 가능).
- 충돌 방지: 가능하면 한 방은 한 게임 파일만. 런처 타일 추가 등 `index.html` 변경은 작게.

## 우선순위(사용자 요청 기준)
1. **VR 석궁** — 모바일 터치/원거리/대전/검증을 70%까지(가장 큰 작업). `vr-shooter.md` 참조.
2. 나머지는 사용자가 방을 열어 개별 요청.
