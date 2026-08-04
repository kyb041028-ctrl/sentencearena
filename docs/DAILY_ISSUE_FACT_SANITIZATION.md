# 데일리 이슈 — 팩트 정제 계층 (Fact Sanitization Layer)

## 2026-08-04 업데이트

- `sourceRefs`는 `id/publisher/title/url/publishedAt/sourceType/originDomain` 표준 구조를 우선 사용한다.
- 게시 전 `validateDailyIssuePublicationQuality`를 적용해 `READY/PUBLISHED/QUARANTINED` 상태를 기록한다.
- 중립 표현 정적 검사(유도/선동 문구) 실패 시 자동 수정하지 않고 `QUARANTINED` 처리한다.
- 기준 미달 이슈는 수량 확보용 fallback 게시를 하지 않는다.

구현: `public/index.html` (`sanitizeNewsText`, `applyFactSanitizationToPick`, `normalizeDailyIssueSourceRefs`, `buildDailyIssueSourceFactMeta`, 번들 생성 시 적용).

## 목표

외부 뉴스·RSS를 붙이더라도 **정치 프레이밍·감정 유도·낚시형 헤드라인**을 걷어내고, 카드에는 **사회 의제(사실 요지 + 가치 축)**만 남긴다. 기사 제목을 그대로 쓰지 않는다.

## 데이터 레이어

| 레이어 | 필드 | 설명 |
|--------|------|------|
| Fact | `factSummary` | 사건·발표·통계·정책 방향 등 **사실 서술**만. 감정 유도어는 `sanitizeNewsText`로 완화. |
| Axis | `axis` | **가치 축** `sideA` / `sideB` (정당 대립 문구 금지 — 기존 `normalizePickAxis`·검증과 동일 목표). |
| Question | `aiQuestion` | 앵커 질문(정제 후 4지선다와 연결). |
| Choices | `choices` / `directAnswers` | 축에 맞는 네 답(정제 후 생성·검증). |

정적 풀에서는 `summary`가 요지 본문이며, `factSummary`가 없으면 `summary`를 팩트층으로 복사해 정제한다. `articleTitleRaw`를 풀에 넣고 `topic`과 동일하게 두면, **topic은 `factSummary`에서 파생**된 중립형으로 바뀐다.

## `sanitizeNewsText(text)`

- 공백 정리, `DAILY_ISSUE_FACT_SANITIZE_REPLACEMENTS`에 정의된 **과장·자극 표현**을 완화·삭제한다.
- RSS/크롤러에서 들어온 문자열에 **선처리**로 호출하고, 번들 생성 시에도 **항상** 한 번 더 통과시킨다.

## 출처·감정 위험도 (편향 점수가 아님)

- `sourceType`: `government` | `statistics` | `central_bank` | `legislature` | `wire` | `media` | `community` | `editorial` | `unknown`
- URL 접두로 `inferDailyIssueSourceTypeFromUrl` 추론(`.go.kr`, `bok.kr`, `yna`, `bbc` 등).
- **`emotionalRisk`**: 0~1에 가까운 **감정 유도 위험도** 가정치. `DAILY_ISSUE_SOURCE_TYPE_EMOTIONAL_RISK` 기본값 + 풀의 `articleKind`(칼럼·커뮤니티 등)에 따른 가산.
- **`trustRank`**: 숫자가 작을수록 **신뢰 우선순위**가 높음(`DAILY_ISSUE_SOURCE_TRUST_RANK`). 정부·통계·중앙은행·국회·통신사 계열을 상단에 둔다.

번들 이슈에는 `sourceRefs`(배열)와 `sourceFactMeta`(`primarySourceType`, `emotionalRisk`, `trustRank`, `sourceCount`)가 붙을 수 있다.

### 풀 확장 예: 다중 출처

```js
sourceRefs: [
  { label: '통계청 보도자료', url: 'https://kostat.go.kr/...', sourceType: 'statistics', emotionalRisk: 0.1 },
  { label: '연합뉴스', url: 'https://www.yna.co.kr/...', sourceType: 'wire', emotionalRisk: 0.28 },
],
primarySourceType: 'statistics',
articleKind: 'news',
```

## UI

- 카드 요약 줄은 **`factSummary` 우선**, 없으면 `summary`.
- 허브 상단에 **가치 축 논의** 안내 문구(한 번).
- `sourceRefs.length > 1`이면 카드에 **교차 참고** 한 줄.

## 관련 문서

- `docs/DAILY_ISSUE_AND_FREE_BOARD_SPEC.md`
- `docs/DAILY_ISSUE_THEME_POOL_GUIDE.md`
- `docs/DAILY_ISSUE_QUESTION_FATIGUE.md`
