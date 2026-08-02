# 진영 전황 깃발 애니메이션

업로드된 PNG 4장을 기반으로 만든 정적 레이어와 독립 실행형 웹 프리뷰입니다. 이미지 생성이나 문양 재작업 없이 자홍색 제거, 공간 마스크 분리, CSS 애니메이션만 적용했습니다.

## 실행

이 폴더에서 정적 웹 서버를 실행합니다.

```bash
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다. ES module을 사용하므로 `index.html`을 파일로 직접 열지 말고 정적 서버로 실행해야 합니다.

## 상태 매핑

- `pioneer`: 파랑 / 개척영토
- `central`: 초록 / 중앙광장
- `guardian`: 빨강 / 수호영토
- `balanced`: 분리된 단독 3종을 동일 크기로 재배치

## 구현 파일

- `src/faction-flag-effect.js`: 단독 공통 컴포넌트
- `src/balanced-faction-flags-effect.js`: 박빙 컴포넌트
- `src/faction-flag-assets.js`: 자산 manifest와 공통 좌표
- `src/battle-status-flag.js`: DOMINANT·LEADING·BALANCED·INSUFFICIENT UI 매핑
- `inspection-report.json`: 원본 및 처리 결과 검사값
- `scripts/process_flags.py`: 동일 방식으로 레이어를 재생성하는 스크립트

`prefers-reduced-motion: reduce`에서는 낙하·충돌·파편·펄럭임을 모두 정지하고 최종 상태를 즉시 표시합니다.
