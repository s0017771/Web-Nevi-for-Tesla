# 🔫 리듬 건 (vr-gun.html) — 작업 지침

> 먼저 `HANDOFF/CONTEXT.md`. 네온 복도를 전진하며 비트에 맞춰 적을 사격하고 날아오는 총알을 몸으로 피하는 리듬 슈터(피스톨 휩 느낌, 오리지널).

## 현재 상태 (~70%)
- **구조**: `vr-gun.html` + 전용 모듈 2개 — `vr-gun-audio.js`(GUNAUDIO), `vr-gun-viz.js`(GUNVIZ). 둘 다 자체완결·오리지널 자산·외부 라이브러리 0.
- **사운드(GUNAUDIO)**: 기계음 비프 제거. 리얼 권총 발사음 = 5레이어 합성(트랜지언트 클릭·밴드/하이패스 크랙·저역 바디펀치·로우패스 테일·슬라이드 틱), 매 발사 피치/레벨/필터 랜덤 + 좌우 패닝(연사해도 로봇감 X). 120BPM A단조 펜타토닉 **음악 리듬 베드**(킥/스네어/햇/베이스/멜로디) — FluidR3_GM 샘플 우선, 로드 전/오프라인이면 합성 폴백. 마스터 = 리버브 send + 컴프(보통 프리셋) + 세이프티 리미터.
  - API: `GUNAUDIO.shot('r'|'l')`, `.dryFire()`, `.hit(onBeat)`, `.playerHurt()`, `.reload()`, `.music.start(120)/.stop()`, `.onBeat=fn`, `.beatInfo()`, `.renderOfflineTest(s)`.
  - **비트가 게임을 구동**: `GUNAUDIO.onBeat`가 스폰·비트닷 연출 호출. 오디오 막히면 `setInterval` 폴백(1.4s 후). 온비트 채점은 오디오 클럭 `beatInfo().onBeat`(±130ms).
- **비주얼(GUNVIZ)**: 캔버스로 그린 2D 반실사 네온 스프라이트. 적 = 빌보드 평면 드로이드 3변주(림라이트/발광 코어/듀얼 아이), 투명평면 레이캐스트 누수 방지용 숨은 박스 콜라이더 자식. 머즐플래시·탄환·처치 버스트 = additive 빌보드 스프라이트(팽창·페이드). 배경 = 그라디언트 스카이+별+비네트, 바닥 = 네온 그리드(repeat), 지수 포그 + 네온 포인트라이트.
  - API: `GUNVIZ.enemyTexture(v)`, `enemyHurtTexture(v)`, `muzzleTexture()`, `bulletTexture()`, `burstTexture()`, `skyTexture()`, `floorTexture()`, `pileTexture()`, `trimTexture()`, `preload()`.
- **테스트**: `tests/gun.e2e.mjs`(Playwright, A-Frame abort + `__GUN_TEST__`) 19/19 통과 — 로직(스폰/처치/도달/피격/점수·콤보·생명) + 오디오 오프라인 렌더(peak<1 무클리핑, 온셋 다수). 모듈 자가검증: `scratchpad` 외부라 리포엔 없음, 모듈별 로직은 e2e가 커버.

## ⚠️ 기기(퀘스트/폰)에서 사용자 확인 필요 (코드로 100% 검증 불가)
- A-Frame 렌더 자체(샌드박스 CDN 차단). 적 빌보드가 카메라를 정확히 바라보는지, 측면에서 평면임이 들키지 않는지.
- 실제 FluidR3_GM 샘플 로드(Vercel/기기 fetch) → 피아노/드럼이 합성음이 아닌 실제 녹음 음색으로 바뀌는지. 총성 리얼감·좌우 패닝·리버브 공간감(스피커/헤드폰 주관).
- 적 투명평면 alphaTest 경계로 레이캐스트가 새지 않는지(숨은 박스 콜라이더 + `closest('.enemy')`로 보완했으나 실측).
- additive 머즐/탄환/버스트가 과노출되지 않는지, 포그 density 0.028 원근감, 퀘스트 성능(동시 적 최대 7 + 스프라이트 다수 시 fill-rate, preload 순간 프레임드랍).
- 모바일 발사→소리 레이턴시, 첫 제스처 autoplay 해제.

## 가능한 다음 작업 (70% 이후, 사소/선택)
- 난이도 곡선/패턴 다양화(웨이브·엄폐·리로드 구간), 점수 연출 강화.
- 복도 기둥/네온 막대를 `pileTexture`/`trimTexture`로 교체해 복도 반실사 강화.
- 음악을 뮤직랩 곡(세이버 ABC 파서)과 동기화, 적 발사 전용 경고음.
- 모바일 조준 보조(가까운 적 스냅).

## 파일
- `vr-gun.html` (+ `vr-gun-audio.js`, `vr-gun-viz.js`). 런처 키 `vrgun`. 테스트 `tests/gun.e2e.mjs`.
