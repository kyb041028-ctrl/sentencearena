## 검수·게시 (2026-08-05)

- 관리자 승인이 quality/freshness 실패를 우회하지 않는다. override 없음.
- 검수 명령은 claim/evidence/출처 원본을 임의 수정하지 않는다.
- 만료 후보를 최신성 재검증 없이 게시하지 않는다.
- DB/JSON 저장소도 claim·evidence 원문을 생성·변형하지 않는다. 직렬화만 한다.
- PostgreSQL document jsonb·연결 테이블은 원문 publishedAt을 created_at으로 대체하지 않는다.
- **서버 API 1차:** HTTP 상태 변경도 동일 정책. 공개 API는 PUBLISHED만 · rawText/audit/choices/stance 비노출.



## 최신성·시의성 (2026-08-05)

- 날짜를 보정하거나 현재 시각으로 채우지 않는다. 원문에 없는 사건일을 생성하지 않는다.
- novelty signal은 evidenceIds 필수. 근거 없는 신규성 금지.
- 품질 게이트 기준(독립 출처·CONFIRMED_FACT)은 최신성 때문에 완화하지 않는다.# 데일리 이슈 — 팩트 정제 계층 (Fact Sanitization Layer)

## 2026-08-05 — 공식 원문 allowlist

- `config/daily-issue-fulltext-allowlist.js` + `server/daily-issue-official-page-extractor.js`
- BOK 게시 페이지 `#board`/`#content`만 추출. PDF/hwp/download path 금지.
- selector 실패·추출 과단문 → evidence 미생성(제목만으로 승격 금지).

## 2026-08-05 — 외부 수집과 evidence

- evidence는 수집된 `rawText`의 **실제 substring**만 허용한다(offset 검증). 창작·요약 재작성 금지.
- 피드 description/content 우선. NEWS는 `allowFullTextFetch:false`. 제목만 있는 문서는 핵심 evidence 출처 불가.
- 수집 실패·원문 부족·독립 출처 부족은 READY로 승격하지 않는다(fail-closed).
- 외부 AI 요약·유료 API·로그인/유료벽 우회는 미구현.

## 2026-08-05 — claim·evidence 검증 계층 (품질 게이트 v2)

- 시스템은 절대적 진실을 판정하지 않는다. 출처 근거 범위만 분류한다.
- 순수 모듈: `shared/daily-issue-source-core.js` · `claim-core.js` · `quality-core.js`
- 출처 필수: `publisher`, `title`, `url`, `publishedAt` — 허위 필드 자동 보완 금지
- evidence: 원문 문장 단위 · claim은 `evidenceIds`로 연결 · 숫자/날짜/기관 불일치·과도 단정 시 REJECTED
- CONFIRMED_FACT 최소: (A) 1차 공식/통계 + 독립 NEWS/RESEARCH 1곳 또는 (B) 독립 NEWS/RESEARCH/STATISTICS 2곳 이상
- OPINION/SOCIAL만으로 CONFIRMED_FACT 불가 · 출처 불일치는 평균/대표값 선택 금지
- 핵심 UNVERIFIED·숨긴 불일치·유도 `discussionPrompt` → 전체 QUARANTINED (fail-closed)
- `buildDailyIssueCandidate`로 후보 생성. evidence 없는 레거시 summary만으로는 READY 불가.
- 표시 금지: “팩트체크 완료”, “진실로 확인됨”, “AI 검증 완료” 등

## 2026-08-04 업데이트

- `sourceRefs`는 `id/publisher/title/url/publishedAt/sourceType/originDomain` 표준 구조를 우선 사용한다.
- 게시 전 `validateDailyIssuePublicationQuality`를 적용해 `READY/PUBLISHED/QUARANTINED` 상태를 기록한다.
- 중립 표현 정적 검사(유도/선동 문구) 실패 시 자동 수정하지 않고 `QUARANTINED` 처리한다.
- 기준 미달 이슈는 수량 확보용 fallback 게시를 하지 않는다.

구현: `shared/daily-issue-*-core.js` + `public/index.html` (`sanitizeNewsText`, `applyFactSanitizationToPick`, `normalizeDailyIssueSourceRefs`, `buildDailyIssueSourceFactMeta`, 번들 생성 시 적용).

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
