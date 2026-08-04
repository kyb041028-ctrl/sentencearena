# 데일리 이슈 4답변 — LLM·백엔드 연동 시 규칙 (프론트와 동일 UX 목표)

## Deprecated (2026-08-04)

- 데일리 이슈 런타임은 답변 선택형 UI를 더 이상 사용하지 않는다.
- 이 문서는 과거 `choices/directAnswers` 생성 정책 기록용으로만 유지한다.
- 현재 정책은 출처 기반 자유 토론이며, 게시 노출 여부는 품질 게이트로 결정된다.

클라이언트(`public/index.html`)는 **`axis`(논점 축)**을 정한 뒤 그 축 위에서 네 답을 합성한다(`normalizePickAxis` → `buildAxisAwareChoiceRows`). 서버에서 LLM으로 생성할 때는 아래 규칙을 맞추면 동일한 UX를 유지할 수 있다.

## 입력

- `catId` (politics | economy | society | entertainment | world)
- `topic` (짧은 헤드라인)
- `aiQuestion` (앵커 질문, 가능하면 `'선택지A'와 '선택지B'` 형태로 두 안을 따옴표에 넣을 것 — 클라이언트는 이를 **`axis.sideA` / `axis.sideB` 후보**로도 사용)
- `summary` (선택, 기사 요약 한 줄)
- **`axis`** (권장, 직접 지정 시 LLM이 축을 고정): `{ sideA: string, sideB: string }` — 예: 표현의 자유 vs 공공 안전

## 출력 스키마

- 이슈(또는 생성 단위)에 **`axis`** 포함.
- 길이 4의 `choices` 배열. 각 원소:

- `type`: 반드시 `progressive` | `centrist` | `conservative` | `unsure` (UI에 표시 금지, lean 매핑 전용)
- `label`: 한국어 한 문장, **28~55자 권장**, 말끝은 `~해야 한다`, `~이 필요하다`, `~라고 본다`, `~가 더 현실적이다` 등 **역할별로 문체를 섞을 것**

## 내용 규칙

1. **같은 질문·같은 `axis`에 대한 서로 다른 답**이어야 한다. 추상 슬로건(예: 재정 지속성만 강조, 도덕적 해이, 정보가 더 필요하다만 반복) 금지.
2. 네 갈래는 **한 축에서 비교 가능**해야 한다: **progressive** → `sideA` 우선, **centrist** → A와 B 조율, **conservative** → `sideB` 우선, **unsure** → 상황 판단·추가 검토.
3. UI 라벨에 **진보·보수·중도** 등 진영어 금지.
4. 감정적 비난·선동 표현 금지.

## 검증 (서버에서도 권장)

- 네 `label` 서로 중복 없음, 길이 하한·상한
- 금지 부분 문자열 목록(클라이언트 `DAILY_ISSUE_CHOICE_BAN_SNIPPETS` 참고) 미포함
- 각 `label`이 `topic`, `aiQuestion`에서 뽑은 인용 문자열, 또는 `summary`와 **최소 3글자 이상 부분 일치**할 것 (연결성)
- **`axis`가 있으면:** 네 답 전체에 `sideA`·`sideB`가 각각 최소 한 번 이상 반영되고, 위 역할별 A/B 터치 규칙을 만족할 것(클라이언트 `validateIssueChoices`와 동일 목표)

## lean

생성 후 `AlignmentScoring.leanForDailyIssueRoleType(type)`과 동일 규칙으로 내부 벡터를 붙인다. 클라이언트는 `hydrateDailyIssueChoiceleans`를 사용한다.

## 풀 수동 오버라이드

`CENTRIST_THEME_POOLS` 항목에 `axis: { sideA, sideB }`를 두면 추론 축을 고정할 수 있다. `directAnswers: { progressive, centrist, conservative, unsure }`를 두면, `normalizePickAxis`로 정한 축에 대해 `validateIssueChoices(..., axis)`를 통과하는 한 그 문자열이 우선 사용된다.
