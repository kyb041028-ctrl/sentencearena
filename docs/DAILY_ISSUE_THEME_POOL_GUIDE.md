> 수집 READY 후보는 검수 대기열을 거쳐 APPROVED→PUBLISHED된 항목만 사용자 번들에 포함한다.
> 저장소가 JSON이든 DB이든 번들 계약(PUBLISHED만 · choices/stance 없음)은 동일하다.
> 실 PostgreSQL(`daily_issue_test`) 통합 검증 PASS. 운영 public schema는 미적용.
> 공개 HTTP API(`/api/daily-issues`)도 동일 계약. 관리자 UI·스케줄러·자동 게시 없음.

> 수집 후보가 READY가 되려면 **품질 게이트 + freshness 게이트**를 모두 통과해야 한다. 정적 풀은 게시 대상이 아니다.

# CENTRIST_THEME_POOLS — 이슈 데이터 품질 가이드

## 2026-08-05 — 수집 2차와 정적 풀

- 교차 출처 READY가 생겨도 정적 풀에 가짜 출처를 끼워 넣지 않는다.
- 운영 노출은 READY 후보 번들 변환 경로만 사용(기본 dry-run, localStorage 자동 주입 없음).

## 2026-08-05 — 수집 파이프라인과 정적 풀

- 외부 수집 결과는 정적 풀 topic과 키워드로 강제 결합하지 않는다. 별도 cluster/candidate로만 생성한다.
- 정적 풀은 레거시·템플릿 자료이며 운영 게시 자료가 아니다.
- 수집 dry-run이 READY 0이어도 정상일 수 있다(교차 출처·본문 부족).

## 2026-08-05 — claim/evidence 게이트와 정적 풀

- 현재 정적 테마 풀(~58)에는 기사별 실출처·evidence가 없다. **전부 QUARANTINED가 정상**이다.
- 금지: 카테고리 홈 URL을 기사 원문으로 취급 · 오늘 날짜를 `publishedAt`으로 위조 · 가짜 제목/evidence 생성 · 테스트 통과용 Mock을 운영 풀에 삽입 · 기준 완화
- READY가 되려면 수집기가 `buildDailyIssueCandidate`에 실 `sources`+`evidences`+`candidateClaims`를 넘겨야 한다.
- 통과 이슈 0개면 기존 "이슈 준비 중" 안내를 유지한다.

## 2026-08-04 정책 반영

- 현재 데일리 이슈는 선택지 생성 품질보다 출처 품질 검증이 우선이다.
- `sourceRefs` 필수 필드 누락, 독립 출처 부족, 유도 문구 탐지 시 `QUARANTINED` 처리된다.
- 카테고리에서 통과 이슈가 없으면 임시 이슈를 생성하지 않고 "준비 중" 상태를 노출한다.
- `directAnswers/choices`는 런타임 게시 판단 기준으로 사용하지 않는다(레거시 호환 목적만 유지).

구현 위치: `public/index.html`의 `CENTRIST_THEME_POOLS`, `CENTRIST_ISSUES_PER_CATEGORY`, `pickThemesForCategory`, `finalizePicksForFatigueRules`, `validateBundleDiversity` + `shared/daily-issue-quality-core.js`.

## 최소 규모

- **풀 길이:** `CENTRIST_THEME_POOLS[catId].length`는 **`CENTRIST_ISSUES_PER_CATEGORY`보다 충분히 크게** 둔다(권장 **10개 이상**). 슬롯·분야 시드 셔플로 같은 날에도 이슈 조합이 바뀌도록 여유를 둔다.
- **분야당 노출:** `CENTRIST_ISSUES_PER_CATEGORY`만큼만 번들에 올라간다(현재 **6**).

## 항목 필드 권장 순서

`topic` → `summary` → `axis` → `question` → `directAnswers` → (선택) `factSummary` / `articleTitleRaw` / `sourceRefs` / `primarySourceType` / `articleKind` → (선택) `axisGroup` / `temperature` / `emotionTone` → (선택) `lean` / `meta`

선택 필드는 **질문 피로도 방지**(`docs/DAILY_ISSUE_QUESTION_FATIGUE.md`)와 **팩트 정제**(`docs/DAILY_ISSUE_FACT_SANITIZATION.md`)에 쓰이며, 없으면 본문·분야로 추론한다.

## 필드 규칙 요약

| 필드 | 역할 |
|------|------|
| `summary` | 뉴스 핵심 논점을 **1~2문장** 사실 서술. 감정적 표현·낚시체 지양. |
| `factSummary` | (선택·RSS 권장) **팩트층만** 분리한 요지. 없으면 `summary`를 정제해 동일 계층으로 쓴다. |
| `articleTitleRaw` | (선택) 원문 헤드라인 — **UI에 노출하지 않음**. `topic`과 같게 두면 `topic`은 fact 기반으로 **대체**된다. |
| `sourceRefs` | (선택) `{ label, url, sourceType?, emotionalRisk?, articleKind? }[]` 다중 출처. |
| `primarySourceType` / `articleKind` | (선택) 출처 유형·기사 형태(칼럼 등) — 감정 위험도 추정에 사용. |
| `axis` | **짧은 가치 충돌** 두 축 `sideA` / `sideB`. 진영 명칭·지나친 추상 단일어 금지. |
| `question` | 앵커 질문. **`axis`와 동일한 문구**를 유니코드 따옴표 `‘’`로 두 안 넣어 `extractQuotedOptionsFromDailyQuestion`과 맞출 것. |
| `directAnswers` | 선택지 4문장. **검증 통과**가 목표(`validateIssueChoices`). progressive=sideA, centrist=A+B, conservative=sideB, unsure=상황·검토. |
| `axisGroup` | (선택) 같은 근본 갈등을 묶는 id. 없으면 키워드·해시로 추론. 슬롯 내 중복 억제에 사용. |
| `temperature` | (선택) `heavy` / `medium` / `light` / `viral`. 없으면 본문·분야로 추론. |
| `emotionTone` | (선택) `conflict` / `empathy` / `curiosity` / `humor` / `lifestyle`. 없으면 추론. |

## 선택지 생성 우선순위 (코드와 동일)

1. 풀 `directAnswers` — `validateIssueChoices(..., axis)` 통과 시 그대로 사용  
2. `axis` 기반 합성 — `buildAxisAwareChoiceRows`  
3. (축 추론 실패 등) `normalizePickAxis` + 재시도 루프

## 연예·세계 탭

정치·경제·사회와 **동일 스키마**를 적용한다. 풀 항목 수가 `CENTRIST_ISSUES_PER_CATEGORY`에 가깝지 않으면 날짜별 다양성이 줄어든다.

## LLM·백엔드 연동

문장 규칙·검증 목표는 `docs/DAILY_ISSUE_DIRECT_ANSWERS_RULES.md`와 본 문서를 함께 따른다.
