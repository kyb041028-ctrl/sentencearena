# CENTRIST_THEME_POOLS — 이슈 데이터 품질 가이드

## 2026-08-04 정책 반영

- 현재 데일리 이슈는 선택지 생성 품질보다 출처 품질 검증이 우선이다.
- `sourceRefs` 필수 필드 누락, 독립 출처 부족, 유도 문구 탐지 시 `QUARANTINED` 처리된다.
- 카테고리에서 통과 이슈가 없으면 임시 이슈를 생성하지 않고 "준비 중" 상태를 노출한다.
- `directAnswers/choices`는 런타임 게시 판단 기준으로 사용하지 않는다(레거시 호환 목적만 유지).

구현 위치: `public/index.html`의 `CENTRIST_THEME_POOLS`, `CENTRIST_ISSUES_PER_CATEGORY`, `pickThemesForCategory`, `finalizePicksForFatigueRules`, `validateBundleDiversity`.

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
