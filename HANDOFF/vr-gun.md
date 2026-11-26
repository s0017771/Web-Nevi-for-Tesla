# 🚀 리듬 스타건 (vr-gun.html) — 작업 지침

> 먼저 `HANDOFF/CONTEXT.md`. **우주선 1인칭(갤러그 풍)** 리듬 슈터: 네온 게이트 터널을 지나며 비트에 맞춰 다가오는 외계 함선을 격추하고, 날아오는 적탄을 몸·방향키로 회피(오리지널).

## 현재 상태
- **구조**: `vr-gun.html` + 전용 모듈 `vr-gun-audio.js`(GUNAUDIO), `vr-gun-viz.js`(GUNVIZ). 오리지널 자산·외부 라이브러리 0.
- **테마=우주선 3D**: 적 = `enemy-ship` A-Frame 컴포넌트가 THREE로 만든 실제 3D 셰이딩 외계 함선(금속 MeshStandard 동체/윙/엔진 + 이미시브 캐노피·윙팁 포드 + additive 글로우 할로, 롤/보브, 변주 3색). 코 방향 +Z(플레이어). 틈 누수 방지용 투명 박스 콜라이더 자식 유지.
- **배경**: 바닥 없음(순수 우주). `warp-stars`(하이퍼스페이스 스트릭) + 네온 게이트 링 터널(`buildWorld`의 a-torus + `scroll`) + 스타필드 스카이(GUNVIZ.skyTexture) + 지수 포그 + 소프트 조명(hemisphere + 약한 directional, 과노출 방지).
- **코크핏 HUD(DOM)**: 중앙 레티클(발사 시 `pulseReticle`) + 모서리 프레임 → 1인칭 조종석. `showCockpit(on)`.
- **사운드(GUNAUDIO)**: 발사=레이어드 리얼 캐넌/총성(`shot`), **처치=레이어드 폭발음**(`hit`→`_explosion`: 트랜지언트 크랙+저역 붐+노이즈 바디 스윕+크래클, onBeat 강화), 피격/도달=`playerHurt`(저역 thud). 120BPM A단조 펜타토닉 음악 리듬 베드(샘플 우선+합성 폴백), 리버브/컴프/리미터 버스. 비트가 스폰·연출 구동(`onBeat`), 온비트 채점=오디오 클럭(`beatInfo`).
- **레벨(10단계)**: 적 10기 격추=승급(`KILLS_PER`). 레벨별 `LV[]` 테이블(속도/동시수 maxE/슈터확률/동시2기 dbl/탄속 bull/스폰간격 every) 점증. L1~2 적탄 없음·느린 적으로 쉬운 시작, L3 적탄 등장… L10 최종. 승급 시 생명 +1(최대 6)·점수 보너스·배너로 기능 안내. HUD에 'LV n  k/10'. 75초 타이머 없음 → 생명 소진 또는 L10 클리어로 종료(`endGame(win)`/`winGame`).
- **모바일 이동**: 카메라 터치 회전 끔(`look-controls touchEnabled:false`). **아날로그 조이스틱**(좌하단 base+knob 드래그, `joyVec`로 비례 이동) + 중앙정렬 버튼 + 화면 쓸기(스와이프)로 리그 이동 → 적탄 회피. 오버레이 터치는 사격 레이캐스트로 안 샘.
- **버그 수정**: 투명 시작버튼이 레이캐스트에 잡혀 빈 곳 탭이 리셋되던 문제 → 플레이 중 `startBtn visible=false` + 핸들러 `!playing` 가드.

## 테스트
- 로직 e2e: `tests/gun.e2e.mjs`(Playwright, A-Frame abort + `__GUN_TEST__`) **34/34** — 스폰/처치/도달/피격/점수·콤보·생명, 오디오 오프라인 렌더(무클리핑/온셋), 조이스틱·이동 훅, 리셋 방지, 레벨 승급(10기→LV2·생명+1).
- **실 렌더 스모크(선택, 강력)**: 샌드박스는 A-Frame CDN을 막지만 `npm pack aframe@1.6.0`로 받은 `aframe.min.js`를 헤드리스 Chromium에 `page.route('**/aframe*.js', fulfill)`로 주입하면 **SwiftShader WebGL로 실제 씬 초기화·메시 생성까지 검증**되고 스크린샷도 가능. (이번 작업에서 함선 object3D·머티리얼·워프·육안 스크린샷 11/11 검증에 사용. 리포엔 미포함—1.4MB. 재현: scratch에서 vendor 후 라우팅.)

## ⚠️ 기기(퀘스트/폰)에서 사용자 확인 필요
- 실제 금속 셰이딩 질감/반사(헤드리스는 SwiftShader라 소프트 렌더; envMap 반사 없음 — 기기에선 더 풍부). 함선이 과노출 없이 보기 좋은지.
- 실제 FluidR3_GM 샘플 로드(피아노/드럼 실제 음색), 폭발음/발사음 체감, 리버브, 리듬 맞춤 난이도.
- 모바일 방향키/스와이프 회피 반응성, 레티클/프레임 가독성, 레이캐스트가 오버레이로 안 새는지.
- 퀘스트 성능(동시 함선 7 + 워프 64 스트릭 + 글로우 할로 fill-rate).

## 가능한 다음 작업 (선택)
- 갤러그 편대 웨이브(열 지어 등장→강하) 패턴, 보스 함선.
- 코크핏에서 타깃으로 레이저 볼트(발사 연출), envMap로 금속 반사 강화, 포스트 블룸.
- 적탄을 플라스마 볼트 트레일로, 피격 시 쉴드 연출.

## 파일
- `vr-gun.html` (+ `vr-gun-audio.js`, `vr-gun-viz.js`). 런처 키 `vrgun`. 테스트 `tests/gun.e2e.mjs`.
