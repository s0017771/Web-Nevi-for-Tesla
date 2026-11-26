# ⏱️ 시간정지 슈터 (vr-timeshot.html) — 작업 지침

> 먼저 `HANDOFF/CONTEXT.md`. 내가 움직일 때만 시간이 흐르는 액션(슈퍼핫 느낌, 오리지널). 총알을 피하고 적을 처치.

## 현재 상태
- `motion-time` 컴포넌트: 플레이어 이동량으로 `window.__timeScale` 산출 → 적/총알 속도·BGM이 그에 반응(움직이면 시간 흐름, 멈추면 거의 정지).
- 적(`enemy`), 총알(`bullet` mine:true=내 것/false=적). 방아쇠→`__playerShoot`로 내 총알 발사(날아가는 모양).
- 적응형 긴장 BGM(필터/게인/심박이 timeScale로 스케일).
- **VR에선 날아가는 총알로만 적 처치**(포인터 클릭 처치는 데스크톱 전용: `!scene.is('vr-mode')` 가드).
- 한글 ktext. 모바일 터치는 vr-common `__vrTapAt` 추가 필요 시 배선.

## 가능한 다음 작업
- 모바일 조작(탭=사격) 배선(`__vrTapAt`), 난이도/웨이브, 슬로모 연출·파티클.
- 사운드 공간감(사양서 리버브/컴프) 적용(vr-gun 참고).
- 무기/엄폐/점수 밸런스.

## 파일
- `vr-timeshot.html`. 런처 키 `vrtimeshot`.
