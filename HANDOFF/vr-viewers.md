# 🪐 VR 천문관 (vr-planetarium.html) · 🎬 VR 영화관 (vr-cinema.html)

> 먼저 `HANDOFF/CONTEXT.md`.

## VR 천문관 (vr-planetarium.html)
- 우주 한가운데서 태양계 행성·토성 고리·별자리 감상. 공전/속도 조절, 행성 정보. 한글 UI는 ktext.
- 가능한 작업: 행성 텍스처/스케일 사실감, 더 많은 천체·별자리 해설, 시간 배속·궤도 토글, 모바일 조작(`__vrTapAt`), 사운드(앰비언트).
- 런처 키 `vrplanet`.

## VR 영화관 (vr-cinema.html)
- 거대한 스크린으로 영상 감상(파일/URL). 브라우저 WebXR.
- 참고: 퀘스트에서 PC 영상 스트리밍은 `pc-remote`(WebDAV) + 4X Player 조합으로 별도 처리(테일스케일 HTTPS). 이 파일은 자체 플레이어.
- 가능한 작업: 환경(극장/야외) 선택, 화면 곡률/크기 조절, 자막, 모바일 조작.
- 런처 키 `vrcinema`.

## 공통
- A-Frame 1.6 + vr-common(ktext/billboard/모바일 탭). 저작권 자산 금지(오리지널만).
