# 데일리 이슈 · 질문 → 관점 선택 → 토론 — 구현 요약

## 2026-08-05 업데이트 (반응 성향 연결)

- 사용자 댓글·대댓글 좋아요/싫어요는 **LEGACY_LOCAL 즉시 경로** `applyReactionScoresWithMult`를 일반 게시판과 동일하게 사용한다.
- 서버 05:00/17:00 배치·`board_reactions` event 저장은 아직 데일리/게시판 모두 운영 미연결이다.
- empathy·열람·체류·선택·댓글 작성은 성향 미반영.

## 2026-08-04 업데이트

- 데일리 이슈의 관점 선택/선택 기반 성향 가중은 제거됐다.
- 데일리 이슈 열람/체류/본문 클릭/댓글 작성 자체는 성향 점수에 반영되지 않는다.
- 데일리 이슈 댓글 반응은 선택 선행 조건 없이 동작한다.
- 사용자 댓글·대댓글 반응의 기존 커뮤니티 반응 배치 집계는 그대로 유지한다.
- 아래 문서의 선택지·선택 가중 설명은 레거시 이력이며, 최신 런타임 기준은 자유 토론 흐름이다.

다른 도구/AI와 상의용. 구현 위치: **`public/index.html`** (게시판 스크립트), **`public/alignment-scoring.js`**.

역할 기반 생성·프롬프트 계약은 **`docs/DAILY_ISSUE_AI_ROLE_GENERATION.md`** 참고.

## 철학

- **질문 = 가치 충돌 무대**: 이슈마다 `topic` / `aiQuestion`(화면 질문) + 카드 성격용 내부 `issue.lean`(UI 비표시, 풀 메타).
- **선택 = 관점(1순위)**: 네 가지 `choices`는 각각 `type`(`progressive` | `centrist` | `conservative` | `unsure`) + `label`만 유저에게 노출. **성향 이동은 고른 `type`에 매핑된 벡터**로만 계산 — 댓글 본문을 진영으로 판별하지 않음.
- **댓글 = 토론·활동·XP**: 작성 시 **관점 선택 필수**. 본문 앞에 `[선택 라벨]`만 표시. **댓글 텍스트로 축을 움직이지 않음.**
- **공감·좋아요·싫어요 = 2순위**: 이슈 `issue.lean`(동조) / 반대 분포 — **같은 카드에서 관점을 먼저 선택한 뒤에만** 사용 가능.
- **체류·스레드 열기 = 3순위(매우 약함)**: 이슈 `issue.lean`에 미세 가중.
- **관점 버튼 순서**: 렌더마다 **무작위 셔플** — 슬롯으로 역할을 유추하기 어렵게 함.

## 데이터 모델

- `localStorage` **번들 키**: `sc_centrist_daily_issue_v4` (`CENTRIST_ISSUE_KEY`)
- **레거시**: `sc_centrist_daily_issue_v3`가 있으면 같은 날짜면 자동으로 v4로 마이그레이션(`choices` 보강 후 v4 저장, v3 삭제).
- 이슈 객체:

```text
topic, aiQuestion, axis?, lean, meta, choices[], comments[], choiceGenVersion?
```

- `choices[]` 항목: `{ type, id, label, lean }`
  - `type` / `id`: 역할 키(내부·저장용). UI에는 **라벨만**.
  - `lean`: **항상** `AlignmentScoring.leanForDailyIssueRoleType(type)` 결과로 덮어씀(저장/로드 시 `hydrateDailyIssueChoiceleans`). AI가 lean을 넣어도 무시됨.
  - **라벨 정화**: 로드 시 `label`에 진보·보수·중도·진영 등이 섞여 있으면(레거시 번들·AI 실수) 역할별 안전 문구(`DEFAULT_DAILY_ISSUE_ROLE_LABELS`)로 자동 교체 후 `localStorage`에 다시 저장. 입장(`sc_daily_issue_stance_v1`)·댓글 표시는 가능하면 현재 선택지 라벨을 사용.
  - **`choiceGenVersion`**: 자동 생성 답변 문구 규칙 버전(`DAILY_ISSUE_CHOICE_GEN_VERSION`). 올리면 **검증을 통과하지 못한 구버전 자동 문구**는 재생성된다. 풀에 넣은 수기 `choices`는 형이 맞고 검증을 통과하면 유지되며, 버전만 올릴 수 있다.
- 풀 항목(`CENTRIST_THEME_POOLS`)에 `choices`를 넣으면 `isValidIssueRoleChoicesShape` 통과 시 그대로 사용(이후 hydrate). 없으면 **`axis`(또는 질문 인용·제목에서 추론한 축) 기반으로 같은 질문에 대한 네 가지 직접 답**을 합성한다(`buildContextualRoleChoicesForPick` → `buildAxisAwareChoiceRows`). 풀에 `directAnswers`가 있으면 `validateIssueChoices(..., axis)` 통과 시 우선 사용.

## 관점 선택 저장 (클라이언트)

- 키: `sc_daily_issue_stance_v1`
- 구조: `{ byUser: { [userId]: { [compoundKey]: { choiceId, label, at } } } } }`
- `compoundKey` = `calendarDayKey() + '|' + categoryId + '|' + issueId`
- `choiceId`는 역할 키 문자열(`progressive` 등)과 동일하게 저장.

## 소비 이벤트 · 가중치 (본인만, 데일리 이슈)

| 우선순위 | 이벤트 | mult / 비고 |
|----------|--------|-------------|
| 1 | **관점 선택** | `CONTENT_LEAN_MULT_CHOICE_SELECT` (**0.12**) × 선택지 `lean`. 변경 시 이전 선택만큼 되돌린 뒤 새 선택 적용. |
| 2 | 공감 / 좋아요 | `CONTENT_LEAN_MULT_EMPATHY_LIKE` (0.2) — 이슈 `lean` |
| 2 | 싫어요 | 동일 mult — `oppositeContentLeanForDisagree(issue.lean)` |
| 3 | 스레드 열기 | `CONTENT_LEAN_MULT_CLICK` (0.005) |
| 3 | 체류 20초 / 60초 | `0.01` / `0.015` |
| 4 | 댓글 작성 | **축 이동 없음** |

- 하루 가중치 합 상한: `ALIGN_CONTENT_GRAVITY_DAILY_MAX`, 키 `sc_align_content_gravity_v1`.
- `clampAlignmentDeltaForDailyPctCap` 유지.

## API (`alignment-scoring.js`)

- `normalizeContentLean`, `isValidContentLean`, `oppositeContentLeanForDisagree`, `deltaContentGravityRaw`
- `DAILY_ISSUE_ROLE_LEAN`, `leanForDailyIssueRoleType` — 역할 → 내부 3축 분포

## 질문 품질(기획)

- 가치 충돌형·유보 선택지를 기본 포함 — 극단 찬반만 강요하지 않도록 카피 조정 가능(`CENTRIST_THEME_POOLS` 또는 AI JSON).
