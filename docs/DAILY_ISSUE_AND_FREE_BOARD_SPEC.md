### 실 PostgreSQL adapter 6차 (2026-08-05)

- SQL repository는 `pg` + `DAILY_ISSUE_DATABASE_URL` (운영 DATABASE_URL 자동 사용 금지).
- 상태 변경과 audit log는 동일 DB transaction. lockVersion 조건부 UPDATE.
- 개발 schema `daily_issue_test` migration·실 contract PASS. 운영 public schema 미적용.
- **서버 API 1차(7차):** 관리자/공개 HTTP. 임시 토큰 가드.
- **관리자 검수 화면 1차(8차):** `/admin/daily-issues` · sessionStorage 토큰 · 사용자 UI 미연결. 정식 인증·스케줄러·자동 게시는 후속.

### 검수 저장소 추상화 5차 (2026-08-05)

- 정책(상태 전환·quality·freshness·duplicate)은 shared core. 저장소는 읽기/쓰기/transaction/version/감사만.
- JSON repository = 현재 수동 운영. DB repository = 동일 계약의 다음 운영 저장소.
- 상태 변경과 감사 로그는 동일 transaction. lockVersion optimistic concurrency.
- `DAILY_ISSUE_REPOSITORY=json|db` (기본 json). db 실패 시 JSON 자동 fallback 금지.
- migration 파일만 추가 · 운영 DB 미적용. 서버 API·관리자 인증/UI·스케줄러·자동 게시 후속.
- 브라우저 번들 계약 불변: PUBLISHED만 · choices/stance/reviewerId/rawText/audit 제외.

### 검수·게시 생명주기 4차 (2026-08-05)

- READY는 게시 상태가 아니라 **검수 대기 가능** 상태다. APPROVED와 PUBLISHED는 분리된다.
- 관리자 승인 없는 자동 게시는 금지한다. READY→PUBLISHED 직접 전환 금지.
- 보류(HELD)·반려(REJECTED)·만료(EXPIRED)·종료(RETIRED/SUPERSEDED) 규칙을 따른다.
- 동일 사건 중복 게시 차단. 실제 신규 변화는 UPDATE_PENDING으로 분리한다.
- 후보가 없으면 오래된 RETIRED/EXPIRED/REJECTED를 재게시하지 않는다. 빈 상태 허용.
- 현재 기본 운영은 JSON(`.cache/daily-issue/review/`). DB 스키마·adapter는 5차에서 추가(운영 미연결).
- 답변 선택 제거 유지. 데일리 이슈 자체는 정치 성향 설문이 아니다. 가입 초기 성향 설문은 후속.

### 최신성(freshness) 게이트 (품질과 별도, 2026-08-05)

- 품질 검증과 최신성 검증은 **별도 단계**다. quality READY라도 freshness 실패 시 게시 불가.
- 시간 필드: publishedAt(최초 발행) · updatedAt(수정) · feedSeenAt(피드 확인) · retrievedAt(수집) · sourceEventDate(명시 사건일) — 상호 대체 금지.
- 재노출된 과거 기사·배경·회고는 RECIRCULATED_OLD_EVENT / BACKGROUND_CONTEXT / STALE로 차단.
- 장기 진행 사건은 실제 신규 변화(noveltySignals + evidence)가 있을 때만 ONGOING_WITH_NEW_DEVELOPMENT로 READY 가능.
- 오늘 게시 가능 후보만 `--fresh-only` 번들로 분리. 자동 PUBLISHED·스케줄러·실 DB는 아직 없음.
- 정적 풀 58개는 계속 게시 대상 아님. 답변 선택 제거·가입 초기 성향 설문은 후속.

# 데일리 이슈 탭 · 자유게시글 · 4관점(댓글) 로직 스펙

## 2026-08-05 — 외부 출처 수집 2차

- 교차 확인 가능한 출처 조합을 우선한다(동일 사건 가능 출처).
- 공식기관 원문 fetch는 allowlist origin/path + content selector만 허용. selector 실패 시 body fallback 금지.
- NEWS는 FEED_CONTENT_ONLY. 품질 게이트 완화 금지. READY 목표는 fail-closed보다 후순위.
- 정적 풀 58개는 계속 운영 게시 대상이 아니다.

## 2026-08-05 — 외부 출처 수집 파이프라인 1차

- Node에서만 RSS/Atom 수집. 브라우저는 외부 피드를 직접 fetch하지 않는다.
- 레지스트리: `config/daily-issue-source-registry.js` (검증된 feed만 enabled)
- 파이프라인: fetch → parse → Source 정규화 → 중복 제거 → 보수 군집화 → evidence substring → `buildDailyIssueCandidate`
- 기본 dry-run · READY 후보 생성 · 자동 PUBLISHED/localStorage 주입 없음
- 기사 본문 무단 대량 크롤·유료벽·외부 AI 요약 금지
- 정적 풀 58개는 운영 게시 자료가 아니며 계속 QUARANTINED

## 2026-08-05 — 출처·claim 분류·품질 게이트 v2

- 시스템은 절대적 진실을 판정하지 않는다. 출처가 뒷받침하는 범위만 표시한다.
- 순수 모듈: `shared/daily-issue-source-core.js` · `daily-issue-claim-core.js` · `daily-issue-quality-core.js`
- claim 분류: CONFIRMED_FACT / ATTRIBUTED_CLAIM / SOURCE_DISAGREEMENT / UNVERIFIED / ANALYSIS_FORECAST / CONTEXT / REJECTED
- 핵심 문장은 evidence 필수. 근거 없는 문장·숨긴 불일치·유도 토론 질문은 QUARANTINED(fail-closed).
- UI 구획: 현재 확인된 내용 → 각 측의 설명 → 출처마다 다른 내용 → 아직 확인되지 않은 부분 → 분석·전망 → 배경 → 참고 출처 → 갱신 시각 → 자유 토론 질문 → 댓글
- REJECTED는 사용자 화면에 표시하지 않는다. “팩트체크 완료/진실로 확인됨” 등 절대 판정 문구 금지.
- `buildDailyIssueCandidate({ title, discussionPrompt, sources, evidences, candidateClaims, retrievedAt })` — 수집기 연결 인터페이스.
- 답변 선택·가입 초기 성향 설문은 이번 범위 밖.

## 2026-08-05 — 댓글 반응 성향 (과도기)

- 데일리 사용자 댓글·대댓글 좋아요/싫어요 → `applyReactionScoresWithMult` (게시판과 동일 LEGACY_LOCAL 즉시 반영)
- 서버 배치 미연결. 향후 게시판·데일리를 함께 reaction event + 05:00/17:00 배치로 전환한다.
- empathy는 성향 미반영.

## 2026-08-04 정책 변경 (성향 선택형 → 출처 기반 자유 토론)

- 데일리 이슈는 더 이상 성향 설문이 아니다.
- `progressive/centrist/conservative/unsure` 선택 UI와 선택 게이트를 런타임에서 제거했다.
- 댓글/대댓글/반응은 로그인·moderation·기존 게시판 권한만으로 동작한다.
- 데일리 이슈 본문/열람/체류/댓글 작성 자체는 정치 성향 축을 이동시키지 않는다.
- 사용자 댓글·대댓글 반응의 기존 커뮤니티 성향 배치 규칙은 유지한다.
- 이슈는 `publicationStatus` 품질 게이트(`READY/PUBLISHED/QUARANTINED`)를 통과한 항목만 노출한다.
- 구 `choices`, `sc_daily_issue_stance_v1` 데이터는 호환 목적으로 남기되 데일리 이슈 성향 경로에는 재사용하지 않는다.

다른 플랫폼·기획과 공유할 때 그대로 복사해 쓰기 위한 정리입니다. 구현 기준은 `public/index.html` (및 `public/alignment-scoring.js`의 역할 lean)입니다.

---

## 1. 데일리 이슈 탭(정치·경제·사회·연예·세계)이 하는 일

- 탭 정의는 `CENTRIST_CATEGORY_DEFS`에 고정된 5개 `id`입니다: `politics`, `economy`, `society`, `entertainment`, `world`.
- 탭 클릭 시 `sessionStorage` 키 `CENTRIST_TAB_KEY`(`sc_centrist_issue_tab_v1`)만 갱신하고, `renderCentristHub()`가 **같은 날짜·슬롯 번들**의 `bundle.categories[activeId].issues`만 다시 렌더합니다.
- 이슈 카드의 **제목(`topic`)·앵커 질문(`aiQuestion`)**은 `CENTRIST_THEME_POOLS[catId]`에서 **슬롯·분야·(재시도)시드**로 `CENTRIST_ISSUES_PER_CATEGORY`(현재 6)개를 고릅니다. `pickThemesForCategory`·질문 피로도·다양성 규칙은 `docs/DAILY_ISSUE_QUESTION_FATIGUE.md`를 참고합니다. **5개 탭**은 `summary`·`axis`·`directAnswers`를 갖춘 풀을 쓰며, 풀 문장 규칙은 `docs/DAILY_ISSUE_THEME_POOL_GUIDE.md`입니다.
- 번들 생성: `buildFreshCentristBundle(slotDesc)` → `pickThemesForCategory`(질문 피로도·히스토리 반영) 후 `finalizePicksForFatigueRules`로 온도·톤 보정 → `validateBundleDiversity`를 최대 N회까지 통과시도. 이슈마다 `id`, `topic`, `aiQuestion`, **`summary`**, **`axis`**, **`directAnswers`**(풀에 있을 때만), **`axisGroup`**, **`temperature`**, **`emotionTone`**(풀 또는 추론), `lean`, `choices`, `comments`, `slotKey`, `sourceNote`, `choiceGenVersion` 등.
- **저장:** `localStorage` `sc_centrist_daily_issue_v5` 등. 과거 회차는 `sc_centrist_daily_issue_history_v1` 등 별도 흐름.

---

## 2. “관련된 게시물 작성”과 자유게시판의 관계

### 2-1 자유글(일반 게시판 글)

- 영토 `COMMON`, 스테이지 1 등 기존 게시판 파이프라인과 동일합니다.
- 글 객체의 **`category` 필드**에는 `FREE_SUBCATEGORY_DEFS`의 `id`가 들어갑니다. 예: `politics_free`, `money`, `society_free`, `world_free`, `culture`, `games_free`, `meetup_free`, `free`, …

### 2-2 목록·중앙광장 “최신글” 필터

- 활성 값은 `getActiveFreeCategoryId()` → 내부적으로 **메가 탭** id(`all`, `mega_affairs`, `mega_life`, `mega_culture`, `mega_tech`) 또는 레거시 세부·구 메가 id를 `legacyMegaFromStoredTabId`로 환산합니다.
- `postMatchesFreeCategory(post, megaId)`로 `FREE_MEGA_DEFS[mega].subIds`에 `post.category`가 포함되는지 봅니다.
- `renderCentristFreeFeed()`도 **동일하게** `getActiveFreeCategoryId()`만 사용합니다.

### 2-3 「자유글 글쓰기」버튼

- 데일리 이슈 전용 API가 아니라 **`openModal()`**만 호출합니다 (`#centrist-open-write`).
- 모달을 열 때 **기본 대분류(`elCategoryInput`)**는 `getActiveFreeCategoryId()`로 고른 메가의 `subIds[0]`입니다. **`getActiveCentristCategoryId()`(데일리 5탭)는 여기서 사용되지 않습니다.**

### 2-4 다른 플랫폼에 전달할 표

| 구분 | 저장/상태 키 | 역할 |
|------|----------------|------|
| 데일리 5탭 | `CENTRIST_TAB_KEY` | 번들의 `categories.{politics|…}` **이슈 카드 UI만** 전환 |
| 자유글 필터·글쓰기 기본값 | `FREE_CATEGORY_TAB_KEY` → 메가 `mega_affairs` 등 | **게시글 목록·허브 최신글·모달 기본 category** |

**중요:** 코드상으로는 **정치 데일리 탭을 보는 중**이라고 해서 자동으로 `politics_free` 글이 되지 않습니다. UI 안내상 “대분류를 맞춘다”는 **사용자가 두 탭을 같이 맞추라는 기획 의도**에 가깝습니다. `world`(세계) 데일리와 대응하는 세부 글 분류는 `world_free`로 글쓰기에서 고를 수 있고, 메가 탭 **시사**에 묶입니다.

---

## 3. 댓글을 달기 위한 “4가지 답변(선택지)” 생성 과정

### 3-1 생성 시점

1. **새 번들:** 풀 항목에 유효한 `choices`가 없으면 `directAnswers` 검증 통과 시 그대로, 아니면 `axis` 기반 합성(`buildAxisAwareChoiceRows`)으로 네 선택지를 만든 뒤 이슈에 저장.
2. **로드 후:** `normalizeBundleIssueChoices` → `ensureIssueChoices`로 형 검사, **`DAILY_ISSUE_CHOICE_GEN_VERSION` 미만이면 재생성**, 검증 실패 시에도 재생성.
3. **스레드 렌더:** `renderCentristIssueThread`에서도 `ensureIssueChoices` 호출.

### 3-2 알고리즘 요약 (논점 축 axis → 질문 → 네 답)

- **목표:** 이슈마다 **핵심 갈등 축** `axis: { sideA, sideB }`를 먼저 정한 뒤, 같은 앵커 질문에 대한 **그 축 위에서 비교 가능한 네 가지 답**을 만든다. 투표 가능한 문장 길이(약 16~58자). UI에는 `progressive` 등 **역할 id를 노출하지 않으며**, `hydrateDailyIssueChoiceleans`으로 내부 lean만 붙인다.
- **입력:** `catId`, `topic`, `aiQuestion`, (선택) `summary`, (선택) 풀의 **`axis`** 또는 `directAnswers` 객체.
- **축(`axis`) 결정:** 풀에 `axis.sideA` / `axis.sideB`가 있으면 그대로 사용. 없으면 `normalizePickAxis`: 질문 **인용**이 둘 이상이면 첫째·둘째 인용을 축으로 쓰고, 하나면 인용 + 제목 보조, 없으면 제목에서 짧은 대립 축을 추론한다.
- **우선순위:** 풀 항목에 `directAnswers`가 있고 `validateIssueChoices(..., axis)`를 통과하면 그대로 사용.
- **기본 합성:** `buildAxisAwareChoiceRows` — **progressive**는 `sideA` 우선 문체, **centrist**는 A+B 조율, **conservative**는 `sideB` 우선, **unsure**는 상황·추가 검토. 문체 꼬리는 배열에서 슬롯·시드로 골라 `~해야 한다`만 반복되지 않게 한다.
- **시드:** `hashDayString(catId + '\n' + topic + '\n' + summary + '\n' + question + '\n' + sideA + '\n' + sideB + '\n' + attempt)` — 재시도 시 `attempt`만 바꿔 변형을 시도한다.
- **검증:** `validateIssueChoices` — 길이·중복·금칙어·진영어 노출 금지, 각 라벨이 **질문 인용·제목·요약**과의 연결(`dailyIssueLabelTouchesSources`), 그리고 **`axis`가 있으면** 네 답 전체에 `sideA`·`sideB` 언급이 각각 최소 한 번 이상 있고, 역할별로 progressive는 A, conservative는 B, centrist·unsure는 A와 B를 모두 짚는지 검사한다.

### 3-3 댓글 게이트

- `submitCentristIssueComment`: `getDailyIssueStance(...)`로 답변 선택이 없으면 알림 후 return.
- 선택 저장: `localStorage` `sc_daily_issue_stance_v1`, 키는 **슬롯·분야·이슈 id** 복합(`dailyIssueStanceCompoundKey`).

---

## 4. 관련 함수·상수 위치 (검색 키워드)

| 내용 | 파일 | 심볼/키 |
|------|------|---------|
| 5탭 정의 | `public/index.html` | `CENTRIST_CATEGORY_DEFS`, `CENTRIST_TAB_KEY` |
| 질문 풀 | `public/index.html` | `CENTRIST_THEME_POOLS` — 항목에 `topic`, `question`, `summary?`, `axis?`, `directAnswers?`, `lean?` 등 |
| 풀 품질·최소 개수 | `docs/DAILY_ISSUE_THEME_POOL_GUIDE.md` | 필드 순서, `axis`/`directAnswers` 규칙, 풀 깊이 |
| 번들 생성 | `public/index.html` | `buildFreshCentristBundle`, `buildFreshCentristBundleBody`, `pickThemesForCategory`, `finalizePicksForFatigueRules` |
| 질문 피로도·다양성 | `public/index.html` | `validateBundleDiversity`, `inferThemeFatigueMetaFromPick`, 상수 `DAILY_ISSUE_FATIGUE_*` |
| 팩트 정제·출처 메타 | `public/index.html` | `sanitizeNewsText`, `applyFactSanitizationToPick`, `normalizeDailyIssueSourceRefs`, `buildDailyIssueSourceFactMeta` — `docs/DAILY_ISSUE_FACT_SANITIZATION.md` |
| 개인 노출 로그(확장용) | `localStorage` `sc_daily_issue_question_fatigue_v1` | `recordPersonalQuestionFatigueExposure`, `ensureDailyIssueQuestionFatigueRecorded` |
| 4답변 생성·검증 | `public/index.html` | `buildContextualRoleChoicesForPick`, `buildAxisAwareChoiceRows`, `normalizePickAxis`, `validateIssueChoices`, `extractQuotedOptionsFromDailyQuestion`, `ensureIssueChoices`, `DAILY_ISSUE_CHOICE_GEN_VERSION` |
| 자유글 대분류 | `public/index.html` | `FREE_SUBCATEGORY_DEFS`, `FREE_MEGA_DEFS`, `FREE_CATEGORY_TAB_KEY` |
| 광장 실시간 정렬 탭 | `public/index.html` | `CENTRIST_LIVE_TAB_KEY`, `CENTRIST_LIVE_TAB_DEFS`, `renderCentristLiveSection` |
| 글쓰기 모달 기본 category | `public/index.html` | `openModal` 내 `getActiveFreeCategoryId` |
| 역할 lean | `public/alignment-scoring.js` | `leanForDailyIssueRoleType`, `normalizeContentLean`, … |
| 데일리 번들 저장 | `public/index.html` | `CENTRIST_ISSUE_KEY` (`sc_centrist_daily_issue_v5`) |
| 백엔드/LLM 연동 시 참고 문구 규칙 | `docs/DAILY_ISSUE_DIRECT_ANSWERS_RULES.md` | (프롬프트·금지어 가이드) |

---

## 5. 한 줄 요약 (외부 공유용)

- **데일리 이슈:** 슬롯 단위 로컬 번들 + 분야별 정적 풀에서 결정론적 샘플링; **스레드 댓글은 이슈 객체의 `comments`에만** 저장되며 일반 `post`와 스키마가 분리되어 있습니다.
- **자유 게시글:** `post.category`(세부 id) + 메가 탭 필터; **글쓰기 기본값은 메가 탭만** 반영하고 데일리 5탭과는 **자동 매핑 없음**.
- **4답변:** **`axis`(핵심 갈등 축)**을 정한 뒤 질문과 연결된 **네 가지 직접 답**(A 우선 / A+B 조율 / B 우선 / 상황·검토)을 합성·검증한다. 서버 LLM을 붙일 때는 `docs/DAILY_ISSUE_DIRECT_ANSWERS_RULES.md`를 따른다.

---

## 6. 중앙광장 허브 화면 순서 (`#centrist-hub-wrap`)

위에서 아래로 **세계 펄스(진보·보수 핫 스트립)** → **광장 펄스(내 성향 스냅)** → **데일리 이슈** → **실시간 흐름(인기/최신/논쟁/공감)** → **글쓰기 안내** → **자유 커뮤니티 최신글** 순으로 배치합니다. 데일리 이슈 카드는 기본 4개만 펼치고 나머지는 `#centrist-issues-more`로 확장합니다.
