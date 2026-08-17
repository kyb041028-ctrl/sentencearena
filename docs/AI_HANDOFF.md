# 센텐스아레나 — AI 세션 인수인계 문서

> **새 Cursor/AI 세션 시작 시 이 문서를 먼저 읽으세요.**  
> 마지막 업데이트: 2026-08-17 (board alignment score snapshot SSOT)

---

### [checkpoint] BOARD ALIGNMENT SCORE SNAPSHOT REAL DATA (2026-08-17)

1. SSOT = `public.user_alignment_state.score`. profiles에 score 복제 없음
2. canonical adapter `getUserAlignmentScore(userId)` → `getCanonicalUserAlignmentScore`. missing row = 0. read error fail-closed
3. board LIKE/DISLIKE INSERT는 반응 시점 actor/author snapshot. 이후 score 변경해도 기존 row 불변. live RPC도 같은 SSOT lookup
4. 공식/cap/Daily Issue/외계/auth 미변경. migration 없음
5. commit: `fix: persist real alignment score snapshots for board reactions`

### [checkpoint] ALIEN MODERATION V1 DEVELOPMENT ON (2026-08-17)

1. development `ALIEN_MODERATION_V1` 기본 ON. production unset/empty = OFF (자동 ON 금지)
2. persist: `user_moderation_state` / `user_moderation_events` / `user_moderation_notifications` + `profiles.citizenship_status` / `exile_strike_count`. `profiles.territory` 미변경
3. canonical `board_reports` SSOT. SIMPLE 1 경고 / 2 유지 / 3 `KANTAPBIYA_RESIDENT`. OTHER는 admin IMMEDIATE_ALIEN
4. 복귀 7/15/30 · 4회+ SEASON_END 운영자만. trip count 유지. simple cycle 복귀 후 0
5. ALIEN HUD = live citizenship count. Mock 310 미사용. Earth count에서 외계 제외
6. production DB/scheduler/회원 미변경. production 활성화는 별도 결정

### [checkpoint] ALIEN MODERATION V1 (2026-08-17)

1. 외계 판정 = 신고만. 정치성향 score 미사용
2. SIMPLE 1회 경고 / 2회 유지 / 3회 `KANTAPBIYA_RESIDENT`. OTHER는 admin NONE/NORMAL/IMMEDIATE_ALIEN
3. 유효 단순신고만 count (중복·REJECTED·자기신고·fixture 제외). cycle은 복귀 후 0, trip count는 유지
4. 복귀 7/15/30일 · 4회+ SEASON_END 운영자만. `profiles.territory` 보존
5. ALIEN 인원 = citizenship KANTAPBIYA_RESIDENT. Earth count에서 제외. `ALIEN_MODERATION_V1` 기본 OFF
6. SEASON_SYSTEM = NOT_IMPLEMENTED

### [진행] TERRITORY EVOLUTION REAL POPULATION (Earth + Alien citizenship, 2026-08-17)

1. PIONEER/GUARDIAN = `profiles.territory` count AND citizenship != KANTAPBIYA_RESIDENT. CENTRAL = C+P+G Earth
2. ALIEN = citizenship_status KANTAPBIYA_RESIDENT count
3. GET `/api/territories/evolution` 재사용. 개발 Earth+Alien count. production 기본 503 유지
4. hover는 API 1회 hydrate. cache 30s
5. CENTRAL_AGGREGATION_MODE = EARTH_TOTAL. profiles CHECK/ALIEN territory 저장 금지 유지

### [checkpoint] BETA DAILY ISSUE ALIGNMENT SEED V1 (2026-08-17)

1. **DAILY_ISSUE_CANONICAL_ALIGNMENT = ACTIVE_SEED** — 실제 수집 Daily Issue LIKE/DISLIKE만 사용. 4지선다/stance/directAnswers 없음
2. 내부 metadata `alignment_direction` = PIONEER|GUARDIAN|NEUTRAL. 선정/quota/생성과 무관. public 비노출
3. 분류: trusted AI 단계 없음 → admin enum. 불확실/기존 row = NEUTRAL. 키워드 분류기 없음
4. PIONEER LIKE +60 / DISLIKE −60 · GUARDIAN 반대 · NEUTRAL 0. ACTOR_SELF만. daily cap ±180 (community ±240과 별개) → 99/30 → batch ±500
5. 반응 시점 direction snapshot. 브라우저 숫자/방향 무시
6. Cursor 최종 검증 PASS (browser automation + localhost HTTP + regression). production scheduler/DB 미변경
7. commit message: `feat: add daily issue alignment seed reactions`

### [checkpoint] community alignment / territory (2026-08-17)

1. community 경로 연결: CENTRAL/score0 · ACTOR_SELF + AUTHOR_RECEIVED · 80/120 · gradual deadzone40/full200 · community ±240 · pair7d 120 · 99/30 50/50 · batch ±500 · EXIT ±360 · RETURN ±160 · 2 consecutive · stay 48h · 직접 P/G 없음 · Alien 제외
2. **DAILY_ISSUE_CANONICAL_ALIGNMENT = ACTIVE_SEED** (위 checkpoint). 4지선다 option 없음. 전체 V1 완료 아님
3. reaction score snapshot 서버 기록. pending territory는 `user_alignment_state` additive. 실제 이동은 `apply_alignment_score_batch` 내부만
4. persist `TERRITORY_MOVE = SERVER_INTERNAL_BATCH` · scheduler **READY_DISABLED** · production scheduler 켜지 않음
5. Chrome community: 사용자 확인 "별다른 이상 없음"

### [미커밋] FAST 1–4일 정렬 SIMULATION_CANDIDATE (2026-08-17)

1. 기존 gradual simulator 확장. 오프라인 비교용으로 유지
2. 당시 CURRENT_LIVE는 AUTHOR_RECEIVED_MODEL 이었음. 이후 BETA V1이 live로 양방향 연결
3. NEW_FAST 시뮬 숫자(consistency 0.85 · unique 4 등)는 **SIMULATION_CANDIDATE**. BETA V1 live에 넣지 않음
4. 파일 유지: `tools/run-fast-alignment-simulation.js` · `shared/political-alignment-gradual-sim-core.js`
5. **커밋/push 없음**

### [미커밋] 점진적 성향 전파 SIMULATION_CANDIDATE (2026-08-17)

1. **다음 단계 = 시뮬레이터** (실서비스 연결 아님). live score/territory/scheduler/TERRITORY_MOVE 미변경
2. CONFIRMED live 점수 주체 = 작성자(target). 옛 브라우저 3축은 actor+author 양방향 LEGACY_LOCAL
3. SIMULATION_CANDIDATE 점수 주체 = actor 본인 선택/반응. Daily Issue ±80/일일 cap ±80 · CENTRAL gradual min(abs/500,1) · PAIR_7D_CAP 120 · EXIT 후보 ±1000/800/600
4. 파일: `shared/political-alignment-gradual-sim-core.js` · `tools/run-gradual-alignment-simulation.js` · `docs/POLITICAL_ALIGNMENT_GRADUAL_SIM.md`
5. **TERRITORY_MOVE = NOT_CONNECTED** · **POLITICAL_BATCH_SCHEDULER = READY_DISABLED** · production scheduler 켜지 않음
6. 5,000명 × seed 3 × 7/14/21/30일 비교 완료. DI 0%는 CENTRAL score 0이라 점화 없음

**NEXT:** candidate 숫자 재조정(특히 DI-only 이동·cluster cap·weak 오분류) 후 별도 결정. live 연결 금지 유지.

### [미커밋] CENTRAL 자동 시작 정책 (2026-08-16)

1. **INITIAL_TERRITORY = CENTRAL** · **INITIAL_ALIGNMENT_SCORE = 0** · **TERRITORY_SELECTION_UI = NOT_APPLICABLE** · **TERRITORY_SELF_WRITE = NOT_ALLOWED**
2. 사용자는 PIONEER/CENTRAL/GUARDIAN을 고르지 않는다. 신규 일반 회원은 CENTRAL + score 0
3. 기존 NULL 42명 CENTRAL backfill. profiles row 수 42 유지. score/previous_signal 미변경
4. 잘못된 미커밋 선택 UI / POST /api/me/territory 제거. 지도 클릭은 게시판 탐색만
5. GET /api/me/profile `territory` read 유지. board adapter `getCanonicalUserTerritory` → profiles.territory
6. **TERRITORY_MOVE = NOT_CONNECTED** (향후 자동 transition은 server-internal)

**온보딩:** AUTH → profile → 활동명(없으면) → CENTRAL canonical 시작 → 지도
**소속:** CENTRAL 시작 → 정치성향 score 활동 → 향후 자동 territory transition

### [checkpoint] canonical Earth membership territory foundation (2026-08-16)

1. **CURRENT_TERRITORY_CANONICAL_SOURCE = profiles.territory**
2. **TERRITORY_MEMBERSHIP_PERSISTENCE = ACTIVE_FOUNDATION**
3. 허용값: PIONEER / CENTRAL / GUARDIAN. ALIEN/KANTAPBIYA 저장 금지
4. HOME membership ≠ 지도/게시판 view
5. 이후 CENTRAL 시작 정책으로 NULL 해소 (아래 미커밋)

### [checkpoint] 정치성향 scheduler foundation + 테스트 exit CLEAN (2026-08-15)

1. **POLITICAL_REACTION_INPUT = ACTIVE_CANONICAL** · **POLITICAL_SIMULATION = ACTIVE_READ_ONLY** · **CENTRAL_SIGN_POLICY = CONFIRMED**
2. **POLITICAL_SCORE_WRITE = ACTIVE_MANUAL** · **POLITICAL_BATCH_SCHEDULER = READY_DISABLED** · **TERRITORY_MOVE = NOT_CONNECTED**
3. **MISSED_BATCH_POLICY = PENDING** · **RETRY_POLICY = PENDING**
4. Scheduler: Asia/Seoul 05:00/17:00 · deterministic `alignment-YYYYMMDD-0500|1700` · env 기본 OFF · startup catch-up 없음
5. Windows 테스트: `process.exit(0)` 제거 · teardown · 정치성향 4 suite + board/XP/fame/achievement exit 0

**NEXT (정치성향):** 점진 전파는 시뮬레이터만 완료. production scheduler 켜지 않음. TERRITORY_MOVE 연결 금지. candidate 숫자 재조정은 별도.

지금은 env를 켜지 않는다. 실제 alignment batch 추가 실행 금지.

### [checkpoint] 정치성향 테스트 teardown (Windows exit CLEAN) (2026-08-15)

1. PASS 후 `process.exit(0)` 가 Windows에서 `UV_HANDLE_CLOSING` abort
2. 테스트 전용 teardown: handle close + `process.exitCode`. 공식/scheduler 정책 미변경
3. LOAD_FAILED 는 계속 FAIL. retry loop 없음. **READY_DISABLED** 유지

### [미커밋] 정치성향 4단계 05:00/17:00 scheduler READY_DISABLED (2026-08-15)

1. **POLITICAL_REACTION_INPUT = ACTIVE_CANONICAL** · **POLITICAL_SIMULATION = ACTIVE_READ_ONLY** · **CENTRAL_SIGN_POLICY = CONFIRMED**
2. **POLITICAL_SCORE_WRITE = ACTIVE_MANUAL** — CLI `--dry-run` / `--apply` 유지. 브라우저 public API 없음
3. **POLITICAL_BATCH_SCHEDULER = READY_DISABLED** — `POLITICAL_ALIGNMENT_SCHEDULER_ENABLED` 기본 off. localhost/prod 자동 실행 안 켬
4. Slot: 매일 Asia/Seoul **05:00 / 17:00**. batch id `alignment-YYYYMMDD-0500` / `-1700`. missed catch-up 없음
5. Tick → 기존 input → simulation → `runPoliticalAlignmentBatch` / `apply_alignment_score_batch`. 공식 미복제
6. **MISSED_BATCH_POLICY = PENDING** · **RETRY_POLICY = PENDING** · **TERRITORY_MOVE = NOT_CONNECTED**
7. 최종 idempotency = `alignment_batches.batch_id` PK + apply RPC. 신규 분산락 없음
8. **다음 금지:** env로 scheduler ACTIVE · 영토 이동 · ProfileFrame 성향 · local score 제거 · catch-up/retry 정책 확정

### [미커밋] 정치성향 3단계 canonical persistence (2026-08-15)

1. **POLITICAL_REACTION_INPUT = ACTIVE_CANONICAL** · **POLITICAL_SIMULATION = ACTIVE_READ_ONLY** · **CENTRAL_SIGN_POLICY = CONFIRMED**
2. **POLITICAL_SCORE_WRITE = ACTIVE_MANUAL** — `apply_alignment_score_batch` RPC + `run-political-alignment-batch.js`. 브라우저 public API 없음
3. **POLITICAL_BATCH_SCHEDULER = NOT_CONNECTED** · **TERRITORY_MOVE = NOT_CONNECTED**
4. signed SSOT = `alignment-batch-core.computeSignedDelta` (CENTRAL 대상영토, CENTRAL→CENTRAL 0). 옛 away 분기 삭제
5. 옛 `migration_alignment_system.sql` 통째 미적용. additive persistence migration만
6. **다음 금지:** 05:00/17:00 scheduler · 영토 이동 · ProfileFrame 성향 · local score 제거

### [미커밋] 정치성향 2단계 COMPLETE — CENTRAL signed 확정 (2026-08-15)

1. **POLITICAL_REACTION_INPUT = ACTIVE_CANONICAL**
2. **POLITICAL_SIMULATION = ACTIVE_READ_ONLY** — SELECT only, 점수 미기록
3. **CENTRAL_SIGN_POLICY = CONFIRMED** — 대상 영토 기준. CENTRAL→PIONEER `+/-`, CENTRAL→GUARDIAN `-/+`, CENTRAL→CENTRAL signed `0`. 현재 score로 부호 결정 안 함
4. Pioneer `+` / Guardian `−` 유지. window `SUM99*0.5 + SUM30*0.5` → `rawDelta = combined - previousSignal`. ±500 preview만
5. **POLITICAL_SCORE_WRITE = NOT_CONNECTED** · **POLITICAL_BATCH_SCHEDULER = NOT_CONNECTED** · **TERRITORY_MOVE = NOT_CONNECTED**
6. **다음 금지:** 점수 UPDATE · 05:00/17:00 · 영토 이동 · threshold 운영 승격 · state migration 적용

### [미커밋] 정치성향 2단계 read-only simulation (2026-08-15)

1. **POLITICAL_REACTION_INPUT = ACTIVE_CANONICAL**
2. **POLITICAL_SIMULATION = ACTIVE_READ_ONLY** *(이후 CENTRAL 부호 확정으로 갱신)*
3. **POLITICAL_SCORE_WRITE = NOT_CONNECTED** · **POLITICAL_BATCH_SCHEDULER = NOT_CONNECTED** · **TERRITORY_MOVE = NOT_CONNECTED**
4. Pioneer/Guardian signed + 99/30 50/50. CENTRAL은 이어서 CONFIRMED
5. **window CONFIRMED:** `SUM99*0.5 + SUM30*0.5` 후 `rawDelta = combined - previousSignal`. ±500 cap은 preview만

### [미커밋] 정치성향 canonical 입력층 1단계 (2026-08-15)

1. **POLITICAL_REACTION_INPUT = ACTIVE_CANONICAL** — `board_reactions` 스냅샷 영토 → read-only 입력. 점수 미기록
2. **POLITICAL_SCORE_WRITE = NOT_CONNECTED** · **POLITICAL_BATCH = NOT_CONNECTED** · **TERRITORY_MOVE = NOT_CONNECTED**
3. **정본:** LIKE/RECOMMEND=POSITIVE · DISLIKE/DOWNVOTE=NEGATIVE. EMPATHY/REPORT 제외. 유효(active) + 99일 창
4. **영토:** `actor_territory_at_reaction` / `target_author_territory_at_reaction` (반응 당시). 현재 profiles 소급 금지. ALIEN 제외
5. **가중치 SSOT:** `alignment-batch-core` 80/120. Guest `applyReactionScoresWithMult` 유지(정본 아님)
6. **다음:** 배치 점수 UPDATE ±500 · 05:00/17:00 · 영토 이동 — 이번 금지

### [checkpoint] 게시판 leftover: LIKE/DISLIKE · 신고 UI canonical (2026-08-15)

1. **조사 후 연결만:** 기존 `board_reactions` + `toggle_board_reaction` + `POST /reactions/toggle` · `board_reports` + `POST /reports`. 신규 테이블/migration 없음
2. **실회원 추천/비추천:** feed hydrate `counts` + viewer row → likes/dislikes · 토글 API · UI exclusive(반대 계열 먼저 cancel). EMPATHY와 합치지 않음
3. **실회원 신고:** canonical UUID 글 → `board_reports` · 새로고침 hydrate `viewerReported`. Guest `sc_reports_v1` 유지
4. **그대로:** feed/create/comment/empathy/XP/fame/업적. 수정·삭제 UI 없음. 검색 localStorage. 정치성향 canonical 아님(기존 local applyReactionScores)
5. **Chrome PASS:** 추천 ON 유지 · 추천→비추천 전환 · 새로고침 반응 유지 · 게시글 신고 · 새로고침 중복 신고 차단

### [미커밋] 회귀 테스트 live snapshot 안정화 + checkpoint (2026-08-15)

1. **원인:** `test-empathy-fame-canonical.js` live가 특정 회원 event=1/fame=1 등 **절대값**을 기대. Chrome 공감으로 N이 늘면 FAIL. 기능 버그 아님
2. **수정:** isolated mock A→B delta(X→X+1) 유지 · live는 UUID/self-금지/fame=event COUNT 불변식. 실데이터 삭제 없음
3. **Chrome 검증은 이미 PASS.** 이번에 새 기능 없음

### [미커밋] ProfileFrame 활동 수치 canonical 연결 (2026-08-15)

1. **표시 항목(기존 5칸+팔로워):** 작성 글 / 댓글 / 받은 공감 / 토론 참여 / 전달한 아우라 · 헤더 팔로워. 신규 지표 없음
2. **ACTIVE_CANONICAL:** POST_COUNT · COMMENT_COUNT · RECEIVED_EMPATHY_COUNT(게시글 EMPATHY_RECEIVED 건수, fame과 별도) · DISCUSSION_COUNT
3. **DATA_NOT_CONNECTED:** FOLLOWER_COUNT (canonical follow 없음 · 실회원 0 · 신규 follow 미구현)
4. **NOT_IMPLEMENTED:** AURA_COUNT (실회원 `--` · Guest Mock)
5. **API:** `GET /api/me/profile` `{ activityStats }` · 서버 COUNT · 클라 계산/POST 금지 · Guest Mock 유지
6. **Chrome:** 새로고침 → 프로필 열기 → 활동 숫자만 확인 (새 글 불필요)

### [미커밋] 실회원 게시판 feed canonical 전환 (2026-08-15)

1. **원인:** 목록 정본이 `getPosts` → `sc_board_bundle_v1` localStorage. 서버 `GET /api/board/posts` 는 있었으나 UI 미연결
2. **실회원:** `listMemberCanonicalBoardPosts` → ACTIVE `board_posts` → 메모리 cache (`source=server_canonical`). Guest는 기존 localStorage
3. **legacy p_ 글:** 실회원 피드에서 제외 · 자동 DB migration 없음. `demo_`/`seed_` 만 display-only
4. **공감 상태:** `EMPATHY_RECEIVED` events hydrate · POST /empathy 기존 경로 유지
5. **Chrome:** 새로고침 → 중앙광장에서 쇠똥구리·sentencearena·영이상점 canonical 글 확인 후 공감

### [미커밋] 공감→명성 계정 불일치 조사 (2026-08-15)

1. **Chrome FAIL 원인:** 피드에서 공감수가 오른 글이 `board_posts` UUID가 아님 → 서버 `POST /empathy` 미호출 → `EMPATHY_RECEIVED` 없음. ProfileFrame hydrate 문제 아님
2. **쇠똥구리 글 `c15ebc3a-…`:** canonical ACTIVE · event 1건 · fame 1 · reactor=`sentencearena` UUID
3. **다른 실회원:** sentencearena canonical 글 3건이 있으나 event 0 / fame 0. 어휴힘들다는 `board_posts` 0건(legacy면 지급 대상 아님)
4. **원칙:** localStorage `authorId`로 fame 지급 금지 · 새 canonical 글은 작성자 identity 무관하게 +1 (A→B, A→C fixture PASS)

### [미커밋] 게시글 공감 → fame +1 (2026-08-15)

1. **원인 A:** Chrome 공감은 localStorage 카운트만 · `board_reactions` 미사용
2. **연결:** 실회원 UUID 글 OFF→ON → `EMPATHY_RECEIVED` RPC · recipient `reputation_score` +1 · XP 불변
3. **Chrome:** A가 B 글 공감 1회 → B 프로필 명성 +1 → 새로고침 유지 (글/댓글 추가 테스트 금지)

### [미커밋] ProfileFrame 명성 canonical (2026-08-15)

1. **정본:** `user_progression.reputation_score` → API `fame` → ProfileFrame `#fameLayer`
2. **정책:** 공감 1=+1 · 마이너스 없음 · 신규 0 · rank 기본 참여자 · **threshold 미확정**
3. **게시글 공감 earning:** 이후 세션에서 ACTIVE (`EMPATHY_RECEIVED` RPC). 시즌 reset / 타인 공개 fame API는 미연결.
4. **Chrome:** 새로고침 → 프로필 열기 → 명성 숫자만 확인

### [미커밋] ProfileFrame LEVEL/EXP hydrate 미반영 수정 (2026-08-15)

1. **원인:** `app-entry` cache가 `/api/me/profile` progression 필드를 버림 + 프로필 열기 prefetch cross-IIFE 스킵
2. **수정:** `sc:auth-user`/세션/프로필 열기 → `__scPrefetchUserProfile` · Mock 미사용 · auth/app-entry 미수정
3. **Chrome:** 새로고침 → 프로필만 (DB Lv2 xp62 EXP44% 회원 = 활동명「쇠똥구리」· 동일 로그인 시)

### [미커밋] XP 재접속 영속성 수정 (2026-08-15)

1. **원인:** 행동 직후 UI 상승 ≠ DB 영속(당시 events 없음) + 실회원 `profile-xp` localStorage 혼선
2. **수정:** RPC 후 SELECT 검증 · ensure non-overwrite · member canonical profile-xp · reconcile dry-run
3. **Chrome:** 재접속 → 프로필만 확인 (테스트 회원 현재 Lv2 xp62 EXP 44% · event history 일치)

### [미커밋] BOARD_COMMENT_CREATED +12 ACTIVE (2026-08-15)

1. 실회원 댓글 → `POST /api/board/posts/:id/comments` → `board_comments` · XP +12 · ProfileFrame 갱신
2. Guest = localStorage 유지 · ISSUE_COMMENT = DATA_NOT_CONNECTED · DELETE_XP_POLICY PENDING
3. first-comment = 타인 글 ACTIVE 댓글만 · 자기 글 댓글은 XP만 · hydrate로 새로고침 유지

### [미커밋] 공식 Lv1~10 XP + POST_CREATED 서버 earning (2026-08-15)

1. **SSOT:** `shared/progression-xp-core.js` — XP_PER_LEVEL `[40,50,60,70,80,120,160,220,300,400]` · MAX 10 · gauge 1500
2. **ACTIVE:** 실회원 게시글 → `apply_user_progression_event` · dedupe `POST_CREATED:{postId}` · +25 · ProfileFrame cache 즉시 갱신
3. **DATA_NOT_CONNECTED:** board/issue 댓글 XP (규칙만 유지)
4. **DELETE_XP_POLICY:** PENDING · Lv5 territory-citizen = progression 후 evaluator
5. **유지:** Guest localStorage · auth/app-entry 미변경 · 테스트계정 임의 XP 미조작

### [블로커 해제] 이전 Lv6~10 INCOMPLETE → 운영 정책으로 확정됨

1. **정본:** `user_progression.xp` = 누적 total XP (DEFAULT 0) · 표시 %는 `config/player-progression.xpProgressInLevel(level, xp)`
2. **표시:** 실회원 EXP text + expGauge = 서버 ensure → `/api/me/profile` `{ xp, expPercent }` → cache → ProfileFrame
3. **정합:** LEVEL·EXP 동일 `user_progression` row · Guest Mock(68%) 유지
4. **미구현:** 활동→서버 XP 지급 · 서버 level-up pipeline · 명성 canonical
5. **다음:** Chrome LEVEL+EXP 확인 · XP earning pipeline · 명성

### [미커밋] ProfileFrame LEVEL canonical (2026-08-15)

1. **정본:** `user_progression.level` (dev migration 적용 · DEFAULT 1)
2. **표시:** 실회원 ProfileFrame LEVEL = 서버 ensure → `/api/me/profile` `level` → cache → `renderProfileData`
3. **정합:** territory-citizen `LEVEL_REACHED` = 동일 ensure 경로
4. **유지:** Guest Mock level · 아바타 placeholder · auth/app-entry 미변경

---

## 0. 30초 요약

| 항목 | 내용 |
|------|------|
| 프로젝트 | 게임형 정치 커뮤니티 SPA — **글·반응 → 성향 변화 → 영토 소속** |
| 정식 영문 브랜드 | **SentenceArena** (한글: 센텐스아레나) |
| npm / API | `sentencearena` · `sentencearena-api` |
| 프론트 | **단일 파일** `public/index.html` + session-controller |
| 백엔드 | `server.js` (Express) + Supabase Auth/DB (일부) |
| 현재 단계 | **공통 session bootstrap · Google/Kakao/Naver 동일 진입** |

---

### [오늘 마감] 업적 persistence · 알람 · RETROACTIVE 기반 (2026-08-13 · `86c8576`)

코드는 origin/master에 반영됨. **다음 세션:** Chrome 실회원 확인 → 나머지 업적 정책 확정(UNSET 유지) → empathy/beta/dialogue/witness canonical.

1. **업적은 정의별로 소급 가능 여부를 갖는다.** `conditionHistoryPolicy`:
   - **RETROACTIVE** — 신뢰 가능한 canonical 과거 기록을 조건에 포함. 기존 회원도 새 행동 없이 소급 지급 가능. **`first-post`만 확정.**
   - **FORWARD_ONLY** — 활성화 이후 행동만 대상. 과거 이력 backfill 금지.
   - **UNSET** — 소급 지급 금지. 나머지 10개는 UNSET.
2. **소급 backfill:** `runAchievementBackfill({ achievementId })` — RETROACTIVE + canonical stats 가능 시만. browser localStorage count·self-grant 금지.
3. **획득 기록** `acquired_at` · `acquisition_sequence` 와 **알람 표시 기록** `acquisition_notified_at` 은 독립. 소급/오프라인 지급도 중앙 알람 사용자당 1회.
4. **실회원 대표 업적:** `user_featured_achievements` + `user_achievements` + definitions만 ProfileFrame 3칸. Guest만 Mock.
5. **유지:** first-post 실시간 canonical grant · browser self-grant 404 · CLIENT_GRANT_FORBIDDEN · auth/app-entry 미변경

---

## ⚠️ AUTH STABLE BASELINE — 2026-08-11 / pipeline 2026-08-12

> **Google/Kakao OAuth 및 쿠키 인증은 유지.** Provider 이후 앱 진입만 공통 pipeline.  
> OAuth/PKCE/callback 임의 수정 금지.

### 공통 회원 진입 (provider-agnostic)

```
Google | Kakao | (향후 Naver) OAuth
→ cookie session
→ GET /api/session/bootstrap  (1회)
→ ScSessionController state
→ UNAUTHENTICATED | PROFILE_INCOMPLETE | READY | GUEST | ERROR
```

| state | 화면 |
|-------|------|
| BOOTING | 짧은 확인 UI (로그인 선표시 금지) |
| UNAUTHENTICATED | 로그인 (Google/Kakao/Naver/Guest) |
| PROFILE_INCOMPLETE | 활동명 설정 |
| READY | 지도/게시판 탐색 (`startSentenceArenaCore`). 소속 영토 선택이 아님 |
| GUEST | 게스트 앱 (버튼 직접 선택만) |
| ERROR | 재시도 (로그인/Guest로 오판 금지) |

식별자: `auth.users.id` · email/provider는 화면 결정에 사용하지 않음.

### 현재 정상 파일 목록

| 파일 | 역할 |
|------|------|
| `server/session-bootstrap-routes.js` | `GET /api/session/bootstrap` |
| `shared/session-bootstrap-core.js` | state 판정 |
| `public/session-controller.js` | 단일 state → 화면 |
| `public/app-bootstrap.js` | controller start 위임 |
| `server.js` | OAuth start · callback · /api/auth/me (유지) |
| `public/auth-v2/auth-client.js` | OAuth 버튼 · logout |

### 재도입 금지 목록

- provider별 post-auth 분기
- `auth-ready` / `app-ready` / `territory-ready`
- sessionStorage token auth
- polling / MutationObserver auth
- profile 오류를 UNAUTHENTICATED로 처리
- OAuth 회원 Guest fallback

### 회귀 테스트

```
node tools/test-session-pipeline.js
node tools/test-auth-cookie.js
node tools/test-auth-v2.js
node tools/test-app-bootstrap.js
node tools/test-activity-name.js
node tools/test-kakao-oauth.js
```

---

### [오늘] 활동명 온보딩 (2026-08-11)

1. **변경:** profile completion UI · unique display_name · cookie profile APIs
2. **유지:** OAuth/PKCE/callback/cookie auth · 로그인 UI · 지도 화면(게시판 탐색). 사용자 소속 영토 직접 선택 없음
3. **구분:** Guest ≠ Authenticated Profile Incomplete

### [오늘] Supabase SSR cookie 인증 (2026-08-11)

1. **변경:** `@supabase/ssr` cookie session · OAuth callback Set-Cookie → redirect · `/api/auth/me` cookie
2. **폐기:** sessionStorage handoff · oauth-bridge active path · Bearer token in browser
3. **유지:** 로그인 UI · redirect URL `auth-v2/callback.html` · 영토/앱 core 분리

### [이전] auth·앱 부팅 분리 (2026-08-11)

1. **변경:** 로그인은 session 저장만 · 앱은 `bootAppEntry()` 즉시 부팅 · auth는 `/me` 후 UI만
2. **제거:** auth-app handshake gate 전부 · OAuth/PKCE/callback **유지**
3. **다음:** Chrome 새로고침 1회

### [이전] 로그인 시스템 독립 재구축 (2026-08-11)

1. **구조:** `ScAuth`(`auth-client.js`)가 세션·`/me`·`sc:auth-ready` 담당 · index는 이벤트 1회 → `enterAppMain`
2. **제거:** `captureOAuthSessionFromUrl` · `refreshAuthUi` · `__scAuth*` handshake · territory-auth 게이트
3. **유지:** 로그인 UI 디자인 · PKCE 서버/bridge · `sc_sb_auth_session` · 앱 본체(영토 등)
4. **다음:** Chrome Google 로그인 1회

### [이전] auth bootstrap 부팅 순서 (2026-08-11)

1. **원인:** `sc-auth-checking`은 head에서 즉시, `/me`·`enterAppMain`은 대형 스크립트 후반 → 확인 중 고정처럼 보임
2. **수정:** head에서 `/api/auth/me` · `__scAuthReady` + `__scTryEnterAppFromAuth` handshake · 로그인 재노출 금지 · OAuth/PKCE **미변경**
3. **다음:** Chrome `localhost:3000` 새로고침 1회

### [이전] auth-checking 멈춤 수정 (2026-08-11)

1. **원인:** 세션 있을 때 `/health` 선대기 · `/me` 실패 시 확인 UI만 유지 → 「로그인 확인 중…」 고정
2. **수정:** 세션 있으면 `/me` 우선(8s·재시도) · 캐시 user면 메인 진입 · boot 후 `sc-auth-checking` 안전망 · OAuth/PKCE **미변경**
3. **다음:** Chrome에서 `localhost:3000` 강력 새로고침 1회

### [이전] Google OAuth PKCE 브리지 확정 (2026-08-11)

1. **원인:** `persistSession:false` 시 auth-js가 커스텀 storage 무시 → PKCE verifier 유실 · 쿠키만 의존 시 교환 실패
2. **수정:** `persistSession:true`+메모리 storage · sid 브리지 · `exchangeCodeForSession` · callback 성공 조건 · `clearAuth` 401만
3. **다음:** Chrome Google 로그인 1회 E2E

### [이전] Google OAuth 복귀 실패·멈춤 2차 (2026-08-11)

1. **세션:** 서버 OAuth 시작에 PKCE `code_challenge`+HttpOnly verifier · callback/`/` 의 `?code=` → `POST /api/auth/oauth/exchange` → `sc_sb_auth_session`
2. **이전 수정 유지:** `/api/auth/me` → `getUser(token)` · hash 토큰 경로 병행
3. **멈춤:** 인트로 `preload=none` · `refreshAuthUi` 단일 비행 · `/api/auth/me` 진단 로그(토큰 값 미출력)
4. **다음:** Chrome에서 Google 로그인 1회 E2E

### [이전] Google OAuth 로컬 점검 (2026-08-09)
| GitHub | `https://github.com/kyb041028-ctrl/sentencearena` |

### [오늘] Google OAuth 로컬 점검 (2026-08-09)

1. 서버 `GET /api/auth/oauth/google` → 302 Supabase authorize 정상 · OAuth 코드/설정 **미수정**
2. Google 버튼 `<a href="/api/auth/oauth/google">` · 전용 preventDefault/overlay 방해 1차 없음
3. **미해결:** 브라우저에서 Google 버튼 클릭 후 계정 화면으로 이동하지 않는 증상 — 원인 미확정
4. 다음: 클릭→navigation만 재현·확정 후 최소 수정 (flowType/callback 대규모 변경 금지)

### [완료 정리] 브랜드 · GitHub (2026-08-09)

1. **표시 브랜드** `SentenceArena` / `센텐스아레나` 통일
2. **GitHub repo** … → `sentencecraft` → **`sentencearena`** (history 유지 rename)
3. **origin** `https://github.com/kyb041028-ctrl/sentencearena.git`
4. **메타** npm `sentencearena` · API `sentencearena-api` · Cursor rule `sentencearena.mdc`
5. **유지** `sc_*` storage · migration SQL checksum · Supabase project/ref/keys
6. **미변경** Auth/OAuth secrets · 운영 DB · Railway 실배포 · 기능/UI 로직 · 로컬 폴더명 `sentence-craft`

### [이전 세션] (2026-08-07) — legacy 기록

#### ★ GitHub repository 하이픈 제거 — sentencecraft (당시)
1. 당시 `sentence-craft` → `sentencecraft` rename (이후 `sentencearena`로 재rename)
2. Auth/Supabase/Railway/기능 코드 **미변경**

#### ★ 브랜드명 교정 — SentenceCraft (당시 legacy 표기)
1. 오타 `SentensCraft` 제거 · 당시 표시명 `SentenceCraft`로 통일 (2026-08-09에 SentenceArena로 교체)
2. `sc_*` storage · migration checksum **유지**
3. Auth/OAuth/Supabase URL/Railway 설정·운영 DB **미변경**

#### ★ Railway 베타 배포 직전 점검 (실배포 없음)
1. Git: master · origin 연결 · 배포 코드 커밋/푸시 대상 정리 · `.gitignore`에 `.env.*` 보강
2. secret: tracked `.env` 없음 · history에 `.env` 추가 흔적 없음 · 테스트 fixture `sb_secret_*` 문자열만(가짜)
3. Railway CLI: 미설치 → 대시보드 인증/프로젝트 생성은 사용자
4. 회귀: stability/API/UI/scheduler/production-migrate/auth-config PASS
5. 첫 배포 정책 고정: scheduler=0 · health=/health · migration/deploy 미실행

#### ★ Railway 베타 배포 준비 (실배포 없음)
1. `server.js`: `HOST=0.0.0.0` + `PORT` (Railway 주입) 바인딩
2. `package.json` engines `20.x` · `railway.json` (Nixpacks · `npm start` · health `/health`) · `nixpacks.toml`
3. `.env.production.example`: Railway Variables A(필수)/B(이후)/C(금지) 정리 · 첫 배포 `MORNING_SCHEDULER_ENABLED=0`
4. persistent disk 불필요(`repository=db`) · Dockerfile 없음 · 비밀값 미포함
5. **실제 Railway 배포·운영 migration 미실행**

#### ★ 베타 배포 전 서버 안정화 1차
1. Graceful shutdown: SIGTERM/SIGINT · HTTP close · scheduler stop · PG pool end · timeout 10s · 중복 안전
2. Production CORS: allowlist만 (`DAILY_ISSUE_API_CORS_ORIGINS`/`APP_PUBLIC_ORIGIN`) · localhost 자동 허용 금지 · `origin:true` 제거
3. Scheduler 단일 기동: 베타=웹 인스턴스 1 + ENABLED=1 · scale-out 전 worker 분리 필수(문서·로그)
4. `GET /ready` — Auth 설정 + `repository=db` health (RSS 미검사) · `GET /health` 유지
5. Production fail-closed: JSON repo · test/public schema · ALLOW_TEST_RESET · RUN_KEY_NAMESPACE · (경고) legacy admin token
6. `test:server-stability` 26 PASS · admin/public/security/morning 회귀 PASS

#### ★ 운영용 데일리 이슈 schema·migration 적용 절차 1차
1. 운영 schema 확정: **`daily_issue`** (`daily_issue_test`/`public` 금지)
2. 도구: `shared/daily-issue-production-migration-core.js` + `tools/run-daily-issue-production-migrate.js`
3. 명령: `daily-issue:production:migrate:{check|dry-run|apply|verify}`
4. 게이트: `NODE_ENV=production` · schema=`daily_issue` · confirm=`APPLY_DAILY_ISSUE_PRODUCTION`
5. 순서: review lifecycle → morning scheduler · transaction · checksum · 구조 검증
6. `.env.production.example` 추가 · **실제 운영 DB 미적용** · 개발 migrate 도구 유지

### [이전 세션] (2026-08-06) — 마무리

#### ★ 정식 관리자 인증 · Auth 정식화
1. `/admin/daily-issues`: 임시 토큰 입력 제거 → Supabase 이메일·비밀번호 로그인 (`sc_sb_auth_session`)
2. 서버: access token 검증 + `app_metadata.role` ∈ `ADMIN`/`OWNER` (USER/MODERATOR 403)
3. Auth 키: `SUPABASE_ANON_KEY` 또는 `SUPABASE_PUBLISHABLE_KEY`만 · **service-role Auth 폴백 제거**
4. service-role은 Admin API(`alignment-supabase-admin` 등) 전용
5. 개발 계정 `sc_craft@naver.com` ADMIN·confirmed · publishable 실로그인/관리자 API/signout 200 확인

#### ★ 제목·RSS 요약 교차출처 confirmed fact
1. `daily-issue-title-fact-core` · 수치 충돌 시 confirmed에서 숫자 제외 · quality 미완화
2. 클러스터 generic(온라인 등) 오병합 차단

#### ★ 아침판 스케줄러·자동게시·공개 UI (동일일 누적)
1. 04:30 collect / 05:00 AUTO publish · `daily_issue_test` · 공개 `GET /api/daily-issues`
2. 운영 `public` schema·운영 migration apply 경로 **아직 없음** (배포 차단 항목)

#### ★ 베타 배포 전 점검 (코드 변경 없음 · 체크리스트만)
- 즉시: 운영 schema 결정 · 운영 migration confirm 경로 · env 분리(test reset/legacy token 금지)
- 위험: test schema 오연결 · 단일 프로세스 스케줄러 · 전역 CORS `origin:true` · 감시 부재
- 후순위: board/alien/user-data operational · cron 워커 분리 · MODERATOR 관리자 권한

### [오늘 세션] (2026-08-06) — 상세 이력

#### ★ 정식 아침판 스케줄러·운영 감시 1차 (A~G PASS)
1. 04:30 collect / 05:00 AUTO publish 분리 · `Asia/Seoul` · 기본 disabled (`DAILY_ISSUE_MORNING_SCHEDULER_ENABLED`)
2. runKey `morning-collect:` / `morning-publish:` · PG unique+advisory lock · catch-up 30m · MISSED/BLOCKED
3. 이력 테이블 `daily_issue_scheduler_runs` · 관리자 status/history/수동 API · UI 운영 패널·사후 검수 큐
4. 판정/lifecycle 미변경 · `daily_issue_test` smoke 13 · unit 32 · `npm start`/public schema 미사용

#### ★ 데일리 이슈 자동 게시 / 수동 검수 2단계
1. `AUTO_PUBLISH_ELIGIBLE` vs `MANUAL_REVIEW_REQUIRED` — 애매하면 MANUAL · AUTO 좁게
2. enqueue 메타: publicationDecision / Reasons / requiresManualReview / autoPublishEligibleAt / BlockedReasons
3. 05:00 KST: AUTO만 READY→APPROVED→PUBLISHED · actor `AUTO_MORNING_EDITORIAL` · audit 근거
4. MANUAL은 READY 유지 → 관리자 approve→publish · HOLD/REJECT/중복 자동 게시 금지 · retire 가능
5. 관리자 UI 게시 판정 표시 · schema `daily_issue_test`만
6. 테스트 24 PASS · PG smoke 12 PASS · quality/freshness 미완화

#### ★ 데일리 이슈 사용자 공개 화면 연결 1차
1. 배치: 중앙광장 `#centrist-hub-wrap` 데일리 이슈 섹션 (live)
2. `GET /api/daily-issues` 목록 · `GET /api/daily-issues/:id` 상세
3. PUBLISHED·미만료만 · 빈 문구 · 로딩/오류 구분 · choices/stance/rawText/reviewer 미표시
4. `daily-issue-public-api-client.js` · `daily-issue-public-ui.js` · 관리자 UI 미수정

#### ★ 한국어 검수 필터 · Quality/Freshness 표시
1. 영어 NPR 후보 제거 · READY 한국어 1건만 (`daily_issue_test`)
2. korea-* 그룹 기본 language=ko · 영문 소스는 world 전용
3. Quality/Freshness undefined → serializer `ok`→`passed` 매핑 · UI 통과/실패 (정책 미변경)

### [이전 세션] (2026-08-05)

#### ★ daily_issue_test fixture 정리 · 한국어 교차 READY 1건
1. schema `daily_issue_test`만 정리 (`api_smoke_`/`ui_smoke_`/`dbg_`/`test_` 삭제) · `public` 미터치
2. 실수집 영문 NPR 후보 유지 + 연합뉴스(ko)+매일경제 교차 후보 1건 enqueue
3. 제목·CONFIRMED claim 한국어 · 승인/게시 안 함 · READY=2 / TOTAL=2
4. `yonhap-ko-economy` 출처 추가 · 고유명사 교차매칭 보강 · claim id 후보 prefix

#### ★ 데일리 이슈 8차 관리자 검수 화면 1차 (완료)
1. 경로 `/admin/daily-issues` — 사용자 UI 링크 없음 · 지도/`index.html` 미수정
2. 개발용 토큰 모달 → `sessionStorage`만 저장 (하드코딩·localStorage·query·쿠키 금지)
3. 목록/상세/history · 승인·보류·반려·게시·종료·재검증 → 기존 관리자 API만
4. expectedStatus+lockVersion 유지 · approve≠publish · 409 재조회 · 401 토큰 모달 복귀
5. prefix `sc-admin-daily-issue-` · rawText 미표시 · 외부링크 noopener
6. 테스트: `test:daily-issue-admin-ui` · `admin-ui-security` · `daily-issue:admin-ui:smoke`
7. 정식 관리자 인증·스케줄러·자동 게시·운영 화면 · `npm start` **미구현/미실행**

#### ★ 데일리 이슈 7차 서버 API 1차 (완료)
1. Express 라우터 `server/daily-issue-routes.js` — 관리자 검수·상태변경 + 공개 PUBLISHED 조회
2. 관리자: `DAILY_ISSUE_ADMIN_API_TOKEN` Bearer 임시 가드 (timing-safe · fail-closed · query 금지 · 정식 인증 아님)
3. 공개: `GET /api/daily-issues` · `GET /api/daily-issues/:id` — PUBLISHED·미만료만 · rawText/reviewer/audit/choices/stance 제외
4. route → validation → auth → review service → repository (SQL 직접 금지)
5. expectedStatus+expectedLockVersion 필수 · approve≠publish · rate limit(memory) · requestId · 표준 오류 매핑
6. 테스트: admin/public/security · `daily-issue:api:smoke` (daily_issue_test)
7. 관리자 UI 1차 완료(8차) · 정식 권한·스케줄러·자동 게시·운영 public schema · `npm start` **미구현/미실행**

#### ★ 데일리 이슈 6차 실 PostgreSQL 통합 검증 (완료)
1. 개발 Supabase pooler 연결 (`daily_issue_test` · NODE_ENV≠production)
2. migration 적용·재실행(idempotent) · 12 tables · FK/unique/index/RLS
3. 실 PG contract 13 · atomicity 18 · migration 9 PASS
4. 직접 `db.*:5432` timeout → pooler 사용 (`.env` URL 갱신)
5. `evidenceRefs` mapper · Supabase TLS · `enabled:false` fail-closed 수정
6. 서버 API·관리자 UI·스케줄러·운영 public schema **미구현/미적용** · A~G PASS → 서버 API 단계 가능

#### ★ 데일리 이슈 실 PostgreSQL adapter 6차
1. `pg` SQL executor + `createSqlDailyIssueReviewRepository` — 상태+audit 동일 transaction
2. `DAILY_ISSUE_DATABASE_URL`만 사용 (운영 `DATABASE_URL`/Supabase 자동 사용 금지)
3. memory-SQL executor로 contract·lockVersion·rollback 단위 검증 (34)
4. migration apply 도구: `tools/apply-daily-issue-review-migration.js --confirm-dev-db`
5. 실 Postgres integration: **완료** (위 통합 검증)
6. JSON 기본 · db 실패 시 JSON fallback 금지 · CLI `--repository=db`
7. 서버 API·관리자 UI·스케줄러·운영 migration **미구현/미실행**

#### ★ 데일리 이슈 DB 스키마·저장소 추상화 5차
1. 검수 저장소 인터페이스 분리 — review service는 repository만 사용
2. JSON repository = 현재 수동 운영 구현체 (원자성 B · history rollback 유지)
3. DB repository = 동일 계약 · fake-db로 계약 검증 · 실 연결 시 fail-closed (JSON 자동 fallback 금지)
4. migration: `supabase/migration_daily_issue_review_lifecycle.sql` (**운영 미적용**)
5. `lockVersion` optimistic concurrency · 상태+감사 동일 transaction
6. 기본값 `DAILY_ISSUE_REPOSITORY=json` · factory `createDailyIssueReviewRepository`
7. 테스트: contract 72 · schema 44 · review 63 · atomicity 17
8. 서버 API·관리자 인증/UI·스케줄러·자동 게시·운영 migration **미구현/미실행**

#### ★ 데일리 이슈 검수·게시 생명주기 4차 (JSON)
1. quality+freshness READY → `READY_FOR_REVIEW` 대기열 (자동 PUBLISHED 금지)
2. 상태 전환: approve / hold / reject / publish / expire / retire (직접 READY→PUBLISHED 금지)
3. `shared/daily-issue-lifecycle-core.js` · `duplicate-core.js` · `review-core.js`
4. `server/daily-issue-review-service.js` — 정책 계층 · 저장은 repository
5. 중복 차단 · 실제 신규 변화는 `UPDATE_PENDING` · 게시 기간 후 RETIRED
6. 번들은 PUBLISHED만 · CLI `daily-issue:review*` · 테스트 63
7. 실 DB 운영 연결·관리자 웹·스케줄러·외부 AI·가입 설문 **미구현**

#### ★ 데일리 이슈 최신성(freshness) 게이트 3차
1. publishedAt/updatedAt/feedSeenAt/retrievedAt/eventDate **분리** — 서로 대체하지 않음
2. `config/daily-issue-freshness-policy.js` + `shared/daily-issue-freshness-core.js`
3. 품질 게이트와 **별도** — quality READY여도 freshness 실패 시 QUARANTINED
4. 게시 가능 class: BREAKING / RECENT_UPDATE / ONGOING_WITH_NEW_DEVELOPMENT
5. 장기 사건: novelty evidence 필수 · 재순환·배경·STALE 차단
6. CLI `--fresh-only` · today bundle은 freshnessReady만
7. 기존 READY 2 재판정: Ceuta·Ukraine → ONGOING_WITH_NEW_DEVELOPMENT (통과)
8. 자동 게시·스케줄러·외부 AI·가입 설문 **미구현** · 정적 풀 58 QUARANTINED 유지

#### ★ 외부 출처 수집 파이프라인 2차 (교차 확인·공식 원문)
1. 교차 가능 출처 확대: Yonhap EN · Guardian · NPR · WHO · UN · Fed · MK · BOK 보도자료
2. 공식 원문 allowlist + `#board` 제한 추출 (`config/daily-issue-fulltext-allowlist.js`)
3. BOK 한국어 description 없음 → 공식 게시 페이지 메타 본문 fetch로 evidence 생성 (조건 A)
4. 제목 수준 보수 군집화 · 교차 evidence 합의 · 부수 UNVERIFIED 비핵심화
5. world dry-run: multiSource 3 · **READY 2** (Ceuta·Ukraine 관련) · 품질 기준 미완화
6. 그룹 CLI: `ingest:daily-issue:world|korea-economy|korea-policy`
7. 테스트: `test:daily-issue-cross-source` (32) · ingest/claim/daily 회귀 통과
8. 뉴스 본문 대량 크롤·유료 API·외부 AI·가입 설문·스케줄러 미구현

#### ★ 외부 출처 수집 파이프라인 1차 (RSS/Atom)
1. 레지스트리 · SSRF fetch · RSS/Atom · dry-run CLI
2. `buildDailyIssueCandidate` 연결 · 정적 풀 게시 미사용

#### ★ 출처 근거 기반 claim 분류·검증 파이프라인
1. 시스템은 **절대적 진실을 판정하지 않음** — 출처가 뒷받침하는 범위만 표시
2. 순수 모듈: `shared/daily-issue-source-core.js` · `claim-core.js` · `quality-core.js`
3. claim 분류: CONFIRMED_FACT / ATTRIBUTED_CLAIM / SOURCE_DISAGREEMENT / UNVERIFIED / ANALYSIS_FORECAST / CONTEXT / REJECTED
4. `buildDailyIssueCandidate` — 수집 파이프라인이 이 인터페이스로 연결됨
5. 품질 게이트 v2 — evidence·CONFIRMED_FACT 필수 · fail-closed · 정적 풀 58개 전부 QUARANTINED
6. UI: 확인된 내용·각 측 설명·불일치·미확인·분석·배경 분리 표시 · REJECTED 미노출
7. 답변 선택·열람/체류 성향·가입 설문 미복원/미구현 유지
8. 테스트: `npm run test:daily-issue-claim` (33) · `npm run test:daily-issue` (31)

#### ★ 데일리 댓글 반응 → LEGACY_LOCAL 즉시 성향 연결
1. 사용자 댓글·대댓글 좋아요/싫어요만 `applyReactionScoresWithMult` 재사용
2. empathy·열람·체류·선택·댓글 작성 자체는 성향 미반영 유지
3. 외계 actor/author·영토 미확인 시 성향 스킵(UID 저장은 유지)
4. 서버 05:00/17:00 배치는 미연결 유지(`schedulerConnected/persistenceConnected: false`)

### [오늘 세션] (2026-08-02)

### [오늘 세션] (2026-08-04)

#### ★ 데일리 이슈 정책 전환
1. 답변 선택 UI/게이트 제거: 댓글·답글·반응을 선택 없이 허용
2. 데일리 이슈 선택/열람/체류 기반 성향 가중 경로 제거
3. `sourceRefs` 표준화(`publisher/url/publishedAt/sourceType/originDomain`)
4. 게시 품질 게이트 추가(`READY/PUBLISHED/QUARANTINED`)
5. 중립 문구 정적 검사 및 fail-closed 검증 적용
6. 기준 미달 시 카테고리 "이슈 준비 중" 상태 노출
7. 가입 초기 성향 설문·회원가입·일반 게시판 흐름은 미변경

#### ★ 오늘 작업 일일 요약
1. **영토 Hover 작전 HUD** — 병렬 L→R 타이핑 공개 · mask/fade · 계산/hit zone 미변경
2. **진영 전황 UI (Mock)** — 중앙·외계만 · 목록 세력 막대 · DOMINANT/LEADING 레이어 깃발 · BALANCED 깃발 미표시
3. **글 성격 카드 · 진영 토론** — `debate`/`light`/`info` · `factionBattleEnabled`(기본 false) · light/meme 강제 OFF
4. **제한형 리치 본문 에디터** — 모달 확대 · sanitize · `body`+`bodyFormat` · 사진 별도 첨부 · DB migration 보류
5. **외계 글쓰기 권한 조사** — 활성 추방·파티션·RETURNED/SUSPENDED (코드 미변경 조사)
6. **외계 submit 파티션 재검사** — 버튼과 동일 규칙으로 모달·등록 우회 차단 · 정책 자체 미변경

#### 오늘 완료 — 외계 submit 파티션 재검사
- 외계 글쓰기 **정책 자체는 변경하지 않음**
- 활성 추방자만 작성 가능 · 자유광장은 모든 활성 외계 사용자 · 출신 전용 구역은 origin 일치
- 명예의 전당 읽기 전용 · RETURNED/SUSPENDED 작성 불가
- **submit에서 반드시** 파티션·상태 재검사 · UI 버튼만 신뢰 금지
- `AlienObservationDataAdapter.resolveAlienSubmitPermission` · `assertAlienCommunityWritePermission`

#### 이전 — 제한형 리치 본문 에디터
- 새 글 모달: 제한형 리치 에디터 (자유 글자크기·글꼴·색상·정렬·표·원본 HTML·임베드 금지)
- 사진은 **기존 별도 첨부** 유지 (본문 삽입 아님)
- 저장: `body` + `bodyFormat`(`plain`|`rich`) · **저장·렌더 모두 sanitization 필수**
- 기존 plain text 게시글 호환 필수 · 실 DB migration 보류
- 전황/글성격/`factionBattleEnabled`와 **분리된** 글쓰기 편집 기능
- 핵심 파일: `shared/board-rich-content-core.js` · `public/board-rich-editor.js`
- 테스트: `npm run test:board-rich-editor`

#### 이전 — 진영 전황 UI (중앙광장·외계행성만)
- 적용: `CENTRAL`/`COMMON`, `ALIEN`/`KANTAPBIYA` · 미적용: 개척·수호
- 목록: `.sc-faction-battle-strip` 색 면적만 (숫자 상시 미표시)
- 상세: DOMINANT/LEADING만 레이어 PNG 단독 깃발 · BALANCED/INSUFFICIENT는 깃발 미표시 · 목록 세력 막대는 유지
- **진입 조건**: 중앙/외계 게시판 + 글의 `factionBattleEnabled===true` (기본 false · 진영 토론 모드)
- 새 글 모달: 글 성격 선택 카드 + 진영 토론 토글 (유머·일상/`light`·외계 `meme`에서는 OFF)
- Mock: `postId` deterministic · `dataStatus:'MOCK'` · **실 reaction 집계·DB/API 미연결**
- 원본 작업 폴더 `faction-flag-animation-assets/` 유지 (프리뷰 전용, 운영 경로와 분리)
- 댓글 입력란: 본문·반응 버튼 바로 아래
- inspect: `__scInspectFactionBattleUi()` · 테스트: `npm run test:faction-battle`

#### 이전 — 영토 Hover 작전 정보 HUD
- `.territory-operation-hud` · 현재 단계 이미지 1장 · mask/fade · 병렬 horizontal reveal
- 전·현재·다음 비교는 `buildDetailStageCompare`로 보존 · 계산·hit zone 미변경

#### 다음 세션 우선
- [ ] 작성자별 posts/comments 실 API·RLS
- [ ] 댓글 anchor·외계 관측 route 실연결
- [ ] 대표 업적 서버 저장·시즌 히스토리 실이동
- [ ] 외계/user-event migration 적용 정책
- [ ] 진영 전황 실 participant 집계 연결
- [ ] 본문 rich content DB migration

#### 이전 — 세계 활동 영토맵 전용 · 좌표 에디터 기본 숨김

### [이전] 외계 split UI (2026-07-31)

#### 완료
- 외계행성 메인 좌우 split (지구 관측 / 외계 커뮤니티)
- `alienOriginTerritory` + 자유/개척/수호 파티션 권한
- 관측 원문 참조형 · board-service 파티션 차단
- 사용자 이벤트 파이프라인 운영 기반

### [사용자 이벤트 파이프라인] (2026-07-30)

#### 완료 (코드만)
- domain event contract · policy table · orchestrator dry-run
- 명성등급(reputation grade) vs 시민등급(citizen rank) 분리 — 시민등급 규칙 미확정
- progression plan (확정 XP만) · achievement evaluation engine · notification/activity 분리
- board/alignment/alien/evolution adapter (plan only)
- SQL 초안 (`migration_user_event_pipeline.sql` **미적용**)
- `npm run test:user-event` — 93 PASS (alignment 1회)
- **실 XP/명성/업적/알림/활동 write 금지** · **localStorage UI 유지**

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/user-domain-event-core.js` | 이벤트 계약·dedupe·sanitize |
| `shared/user-rank-core.js` | 명성등급 vs 시민등급 |
| `shared/user-progression-event-core.js` | XP/reputation plan |
| `shared/achievement-evaluation-core.js` | 업적 조건 판정 |
| `shared/user-notification-core.js` · `user-activity-core.js` | 알림·활동 plan |
| `server/user-event-orchestrator.js` | 이벤트→plan 파이프라인 |
| `server/*-user-event-adapter.js` | 게시판/alignment/외계/발전 adapter |
| `public/user-event-data-adapter.js` | legacy↔contract |
| `supabase/migration_user_event_pipeline.sql` | domain event log·RPC |

#### 다음 세션 이어서
- [ ] migration 실제 적용 · event persist RPC 검증
- [ ] 게시판·alignment batch 실이벤트 연결
- [ ] 시민등급·Lv6~10 XP·empathy→명성 수치 확정
- [ ] 실제 알림·활동 생성 · 레벨업/영토 팝업 연결

### [외계행성 시스템 운영 기반] (2026-07-30)

#### 완료 (코드만)
- moderation 상태 계약 · 복귀 페널티 7/15/30/시즌
- SQL 초안 (`migration_alien_system.sql` **미적용**)
- 접근 context · 관측 contract · 자유광장 board 재사용
- 지구/외계 댓글·반응 `audience_scope` 분리
- 랭크 정의·주간 인기인 이력 계약 (점수식 미구현)
- 외계 메인 좌우 split UI(지구 관측/외계 커뮤니티) + 기본 선택(인기 관측/자유광장)
- UI: 52:48 · 내부 scrollbar 없음 · 좌우 독립 pagination(6/7) · 오른쪽 4탭 한 줄 · 글쓰기 헤더
- `alienOriginTerritory` contract + 출신별(개척/수호/중앙/UNKNOWN) 파티션 권한
- board-service ALIEN category 권한 차단(read/write/comment/react)
- `npm run test:alien-system` — unit 152 PASS (+ 회귀)
- **실 이동·자동 판정·API_OPERATIONAL 금지**

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/alien-moderation-core.js` | 상태·페널티·plan |
| `shared/alien-origin-core.js` | 출신 성향 snapshot·파티션 권한 |
| `shared/alien-access-core.js` | 접근 권한 |
| `shared/alien-observation-core.js` | 관측 계약 |
| `shared/alien-rank-core.js` | 랭크 정의 |
| `shared/alien-legacy-map.js` | 레거시→ALIEN |
| `supabase/migration_alien_system.sql` | state/event/signal/RPC |
| `server/alien-*-*.js` | repo/service/routes |
| `public/alien-observation-*.js` · `alien-system-inspect.js` | client |

#### 다음 세션 이어서
- [ ] migration 실제 적용 · state 초기화
- [ ] 신고 review → signal · 복합 판정 공식
- [ ] 관측/자유광장 API 운영 활성화 전 UI
- [ ] 시즌 종료 데이터 · 랭크/주간 인기인 공식

### [영토 발전 데이터 연결] (2026-07-30)

#### 완료 (코드만)
- `shared/territory-evolution-core.js` — 계약·임계값·label·이미지 SSOT
- CENTRAL **직접 소속만** 집계 (개척·수호 30% 합산 제거)
- population adapter/repo · evolution service · snapshot SQL 초안
- client adapter/API client · hover contract 연결
- `npm run test:territory-evolution`
- **이미지·지도·패널 위치 미변경** · **실 count/migration 미실행**

#### 다음 세션 이어서
- [ ] migration 실제 적용 · 실 사용자 territory count
- [ ] snapshot 주기·scheduler 확정
- [ ] `TERRITORY_EVOLUTION_OPERATIONAL` 활성화 전 UI 전환
- [ ] 휴면/탈퇴 포함 여부 · 유효 시민 정의

### [프로필 UI 데이터 연결] (2026-07-30)

#### 완료 (코드만 · 운영 미연결)
- 단일 public profile contract · self/public 분리
- assembler · 영토/성향지도 adapter · mini/modal adapter · API client+캐시
- 익명 작성자 프로필 오픈 차단
- `npm run test:user-profile` (단위 + user-data 회귀)
- **PNG·좌표·레이아웃 미변경** · **USER_DATA_OPERATIONAL 미활성**

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/public-profile-core.js` | 계약·sanitize·XP·업적·상태 VM·익명 게이트 |
| `server/user-profile-assembler.js` | 공개/본인 프로필 조립 |
| `server/user-profile-territory-adapter.js` | 영토 조회 (클라이언트 미신뢰) |
| `server/user-profile-alignment-map-adapter.js` | 공개 성향지도 (원점수 미노출) |
| `public/user-profile-data-adapter.js` | API↔Mini/Modal |
| `public/user-profile-api-client.js` | 모드·캐시·`__scInspectUserProfileData` |

#### 다음 세션 이어서 (미완료)
- [ ] 실제 public/self profile API 운영 연결 (`USER_DATA_OPERATIONAL`)
- [ ] 실 DB join 검증 · territory/alignment map 실연결
- [ ] Lv6~10 XP · citizenRank 확정
- [ ] 프로필 사진 Storage · 업적 아이콘 · Mock 제거

### [사용자 데이터] (2026-07-29)

#### 완료 (코드만 · DB 미적용)
- 레벨 범위 **1~10** (`USER_LEVEL_MIN/MAX`, `LEVEL_RANGE` — `shared/user-data-config-core.js`)
- XP 자동 계산은 **Lv1~5 임계값만** (`autoLevelCap: 5`) — Lv6~10 XP TODO · `player-progression.js` UI **미변경**
- RPC 권한 분리: **authenticated JWT** (팔로우·대표업적·알림읽음·북마크) vs **service_role** (progression·업적부여)
- `userClient` / `adminClient` 분리 · Express route 소유권 검증
- `npm run test:user-data` → **80/80 PASS** (회귀: board-core · board-compat · alignment)

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/user-data-config-core.js` · `shared/user-data-schema-core.js` | UUID·레벨·모드·검증 |
| `supabase/migration_user_data_system.sql` | 스키마·RLS·RPC·GRANT (**미적용**) |
| `server/user-data-*.js` | memory/supabase repo · service · routes |
| `public/user-data-legacy-adapter.js` · `user-data-api-client.js` | localStorage 조사 · API dry-run |
| `tools/test-user-data-system.js` | 80항 통합 테스트 |

#### 다음 세션 이어서 할 일 (미완료 · TODO.md 참고)
- [ ] `migration_user_data_system.sql` **실제 Supabase 적용**
- [ ] 실 DB RLS/RPC 검증 · 기존 profiles 충돌 확인
- [ ] 실제 사용자 데이터 migration preview · 이전 정책
- [ ] `USER_DATA_OPERATIONAL=true` 전 UI localStorage → API 치환
- [ ] Lv6~10 XP 임계값 확정 · citizen_rank CHECK
- [ ] user_bookmarks `post_id` FK (board migration 후)

#### 절대 하지 말 것
- migration 실제 적용·운영 API 활성화 (명시적 작업 전까지)
- `player-progression.js` XP/레벨 UI 로직 변경
- service-role key 클라이언트 노출

### [게시판·alignment 전환 준비] (2026-07-29)

- 게시판: `shared/board-*-core.js` · `server/board-*` · `migration_board_core_system.sql` · `npm run test:board-core` / `test:board-compat`
- alignment: `public/alignment-*.js` (구 `political-orientation-territory-rules.js` 대체) · `migration_alignment_system.sql` · `npm run test:alignment-supabase`
- **BOARD_OPERATIONAL=true** (local .env, `board_posts` migration 적용) · USER_DATA_OPERATIONAL / alignment live 는 비활성 유지

#### 테스트 명령
```bash
npm run test:user-data      # 80/80 (~9분, alignment 1회)
npm run test:board-core
npm run test:board-compat   # 내부 회귀 포함
npm run test:alignment-supabase
```

#### 회귀 테스트 참고
- `test:user-data`는 `SC_SKIP_COMPAT_REGRESSION=1`로 board-compat **단위만** 실행 후 alignment 1회 (중복 방지)

### [정치 성향] (2026-07-26)

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `public/political-orientation-simulation.js` | 1~5차 Mock 시뮬레이션 (페이지 로드 시 자동 실행 없음) |
| `public/alignment-territory-rules.js` | **운영용** 영토 판정 순수 함수 (구 `political-orientation-territory-rules.js`) |
| `docs/TODO.md` · `docs/CHANGELOG.md` | 완료/미완료 · 변경 기록 |

#### 시뮬 모드 (서로 상태 덮어쓰지 않음)
1. `BASE_SCORE_MOVEMENT` — 기본 점수 보유 이동
2. `ZERO_START_LATENT_ORIENTATION` — 0점·중앙 시작 · 숨은 성향으로 반응만 생성
3. `LARGE_SCALE_THRESHOLD_COMPARISON` — 1,000명 · CENTRAL ±1000/800/600/400
4. `TERRITORY_OSCILLATION_CAUSE_ANALYSIS` — 왕복 원인 (경계 노이즈 등)
5. `TERRITORY_STABILIZATION_COMPARISON` — 안정화 방식 비교

#### 운영용 영토 판정 (채택안 · DB 미연결)
`alignment-territory-rules.js` 고정 규칙:
- 중앙 **-1000 ~ +1000**
- 진입: `+1001` / `-1001` · 복귀: `+800` / `-800` (200점 히스테리시스)
- **2회 연속** pending 확인 후 영토 변경
- PIONEER ↔ GUARDIAN **직접 이동 금지** (반드시 CENTRAL 경유)
- 입력: 이미 계산된 `orientationScore`만 · 점수 자체는 변경하지 않음

개발용 콘솔:
```js
__scRunPoliticalTerritoryRuleTests()          // 18항
__scGetPoliticalTerritoryRules()
__scEvaluatePoliticalTerritoryTransition(state, batchTime)
__scRunTerritoryStabilizationQuickComparison() // 5차 빠른 비교
__scRunAllOrientationFixedTests()              // 시뮬 고정 테스트 124항
```

#### 점수 계산 규칙 (시뮬 · 변경 금지)
- `DELTA_WINDOW_SCORE` · 99일 50% + 최근 30일 50%
- 반응 가중치 80/120 · 배치당 ±500 · 05:00/17:00
- 외계행성(ALIEN) 정치 성향 제외

#### 다음 세션 이어서 할 일 (미완료)
- [ ] 실제 정치 성향 **배치**에 `evaluatePoliticalTerritoryTransition` 연결
- [ ] 사용자 DB 필드 (`pendingTerritory` 등) 추가 · 영토 변경 저장
- [ ] 영토 변경 알림 · 시민등급 재판정 · 업적 연결
- [ ] Firebase/API · 베타 실데이터 재조정
- [ ] (검토) 3회 연속 · 쿨다운 · 최소 체류기간 — **아직 미적용**

#### 같은 날 함께 들어간 관련 작업 (커밋에 포함)
- 업적 Mock 1~2차 · 시즌 설정 스키마 · 희귀도 프레임
- 영토 발전 hover/population 소규모 보완

#### 절대 하지 말 것 (오늘 기준선)
- 시뮬 1~5차 결과/상태를 운영 로직으로 덮어쓰기
- 점수 계산 공식·가중치·상한 임의 변경
- 배치 없이 DB/API에 영토 저장 연결 (명시적 작업 전까지)

### [영토 발전 Hover — 작전 HUD] (2026-08-02)

- 지도 영토 hover 시 싱글톤 `#sc-territory-evolution-hover` (`.territory-operation-hud`)
- Hover: 영토명 · 인원 · 현재 단계 · 다음 필요 · 진행률 · 현재 이미지 1장 · 클릭 안내
- 전·현재·다음 비교: `TerritoryEvolutionHover.buildDetailStageCompare` (클릭 상세용 보존)
- 핵심 파일:
  - `public/territory-evolution-images.js` — 이미지 경로 · 공통/외계 단계명
  - `public/territory-evolution-population.js` — 직접 소속 집계 계약 · Mock/live 주입
  - `public/territory-evolution-hover.js` — 작전 HUD · debounce · reveal · inspect
  - `public/assets/territory-evolution/` — 발전단계 PNG
- **미변경 기준선:** 지도 wrapper · SVG viewBox/히트존 · 클릭 이동 · 22장 registry · 단계 임계값

### [영토 지도 업데이트] (2026-07-22)

- 새 통합 영토 이미지 적용 완료
- 새 이미지 기준 영토별 히트존 적용 완료
- 영토별 마우스 호버 동작 적용 완료
- 중앙광장 성장 이미지는 아직 기획 및 제작 단계
- 이후 작업에서는 현재 지도 이미지, 히트존 좌표계와 호버 동작을 기준선으로 유지

| 프로필 UI | **ProfileFrame** (PNG 1024×819 + px 오버레이)가 기본. legacy 카드는 `hidden` |
| 성향 | **3축 누적점수**(보수·중도·진보) + **외계인 %** — 브라우저 localStorage 데모 |
| ProfileFrame 성향 | **4축 표시**(center/pioneer/guardian/alien 0~100) — **게임 축과 아직 미연동(더미)** |
| 신규 성향 축 | 시뮬·운영 판정은 **단일 orientationScore** (PIONEER+/GUARDIAN−) — alignment-scoring 3축과 **아직 미통합** |

### 새 세션 필수 규칙 (`.cursor/rules/sentencearena.mdc`)

1. 작업 전 `PROJECT_CONTEXT.md` · `TODO.md` · `CHANGELOG.md` · **이 문서 §0 오늘 작업** 읽기  
2. UI는 `index.html` `<style>` 우선 · `sc-*` UI Kit · `data-territory`로 색상  
3. **기존 JS 로직(성향·레벨·팔로우·반응) 함부로 수정 금지** — UI 작업은 CSS 위주  
4. HTML `id` 변경 금지 · 작업 후 `CHANGELOG.md` + `TODO.md` 갱신  

---

## 1. 프로젝트 폴더 구조

```
sentence-craft/
├── public/                          # ★ 프론트 전부 (배포 루트)
│   ├── index.html                   # ★ 단일 SPA (~23k+ lines) — 메인 작업 파일
│   ├── political-orientation-simulation.js      # ★ 성향 1~5차 Mock 시뮬
│   ├── political-orientation-territory-rules.js # ★ 운영용 영토 판정(순수)
│   ├── season-config.js             # 시즌 설정 스키마
│   ├── achievement-definitions.js · achievement-acquired-alert.js · user-achievements.js
│   ├── territory-beliefs.js         # 영토 신념 SSOT (displayName, belief, …)
│   ├── territory-evolution-images.js    # 발전단계 이미지·단계명 SSOT
│   ├── territory-evolution-population.js # 발전 인원 집계 계약·Mock/live
│   ├── territory-evolution-hover.js     # 지도 Hover 작전 HUD
│   ├── alignment-scoring.js         # ★ 성향 3축 점수 수학 (브라우저)
│   ├── player-progression.js        # 레벨·XP·명성·글당 상한 (브라우저)
│   ├── display-name.js              # ★ displayName 조회·캐시 (Search v1 사전)
│   ├── search-system.js             # ★ Search v1 — 통합검색 모달 · 시민 검색
│   ├── bookmark-list.js             # ★ Community v2 — 북마크 목록 모달
│   ├── follow-list-modal.js         # ★ Follow v1 — 팔로워·팔로잉 목록 모달 · 언팔로우
│   ├── follow-system.js
│   ├── permissions-guide.js
│   ├── rank-leaderboard.js
│   ├── tendency-trends-ui.js
│   ├── ui-sounds.js
│   ├── assets/
│   │   ├── achievements/            # 업적 아이콘 PNG · rarity-frames/
│   │   ├── territory-icons/         # 레거시 PNG (점진 교체 중)
│   │   └── territories/
│   │       ├── banners/             # WEBP v1
│   │       ├── emblems/             # WEBP v1
│   │       └── profiles/            # ProfileFrame PNG 4종 (1024×819)
│   ├── auth/callback.html           # OAuth 콜백
│   └── territories/                 # 맵 PNG, territory-hit-zones.json
├── config/                          # 서버/설계용 Node 모듈
│   ├── world-territories.js         # 영토·게시판 단계·인구 시각화 구간
│   ├── alignment-system.js          # 성향 시스템 뼈대 (SIGNAL_TYPES, 임계값)
│   ├── alignment-rank-limits.js   # 랭크별 축 상한·글당 캡 (1~10랭크)
│   ├── player-progression.js        # XP·레벨·명성 등급 (서버용 미러)
│   ├── kantapbiya.js                # 외계행성 규칙
│   └── signup-countries.js
├── docs/                            # ★ 프로젝트 문서
│   ├── AI_HANDOFF.md                # ← 이 문서
│   ├── PROJECT_CONTEXT.md
│   ├── TODO.md / CHANGELOG.md
│   ├── ALIGNMENT_REACTION_TUNING.md # ★ 성향 반응 수치 일람 (정확값)
│   ├── DAILY_ISSUE_CONTENT_GRAVITY.md
│   └── … (데일리 이슈·DB·Supabase 가이드 등)
├── scripts/ · tools/ · supabase/
├── server.js                        # Express API
├── app-config.js
└── package.json
```

### 실행

```bash
npm start   # http://localhost:3000
```

- ProfileFrame **좌표 에디터**: localhost 전용 (`__scProfileLayoutEditor`)
- 히트존 에디터: 별도 도구 (territory-hit-zones, viewBox `0 0 1600 900`)

---

## 2. 구현 완료 ✅

### 핵심 플랫폼

- [x] 로그인/회원가입 UI · 게스트 모드 · Supabase Auth API (`/api/auth/*`)
- [x] 메인 지도 (16:9 tribal-s1) · SVG 히트존 · 4영토 클릭 진입
- [x] 중앙광장 허브 (데일리 이슈, 인기글, 실시간 현황, 게시글, 페이지네이션)
- [x] 영토 게시판 (개척/수호/외계) · 글/댓글/반응 UI
- [x] 팔로우 + 알림 (클라이언트)
- [x] 채팅 API (인메모리 베타)
- [x] 권한 안내 · 히스토리 탭 · 게시글 상세

### 정치 성향 Mock + 운영 판정 (2026-07-26) — ★ 최신

- [x] 1~5차 시뮬레이션 (`political-orientation-simulation.js`) · 고정 테스트 124항
- [x] 운영용 영토 판정 순수 함수 (`political-orientation-territory-rules.js`) · 테스트 18항
- [x] 채택 규칙: CENTRAL ±1000 · hysteresis 200 · 2회 연속 · 직접 교차 이동 금지
- [ ] 배치·DB·API·알림·시민등급 연결 (내일 이후)

### ProfileFrame (2026-07-09 ~ 07-10) — **현재 기본 프로필 UI**

- [x] PNG 4스킨 (`center`/`pioneer`/`guardian`/`alien`) · 좌하단 HUD · 접기/펼침
- [x] **펼침 애니메이션** 0.2s ease-out · **접기 애니메이션** 0.18s ease-in (애니 후 hide)
- [x] `SC_PROFILE_LAYOUT` px 좌표 (1024×819) · 스킨별 `SC_PROFILE_LAYOUT_BY_SKIN`
- [x] localhost **좌표 에디터** (localStorage `sc_profile_layout_editor_v3`)
- [x] 데이터 파이프라인: `SC_PROFILE_DATA` → `getCurrentProfileData()` → `renderProfileData()`
- [x] **활동 요약 실데이터 1차 + 표시 안정화** (2026-07-12): `resolveUserProfileActivity` · `normalizeProfileActivityDisplay` · 0→`--` · 모달 HUD 동기화
- [x] **영토 기록 실데이터 1차 + 표시 fallback** (2026-07-12): `resolveUserTerritoryRecord` · `normalizeTerritoryRecordDisplay` · 빈값 규칙
- [x] 오버레이: USER ID · LEVEL · 명성 · 경험치% · expGauge · 활동 5 · 영토 4
- [x] **성향지도 SVG** (`alignmentMapLayer`) · 4축 polygon/line/dot · **0.28s 이동 애니메이션**
- [x] 성향지도 **캘리브레이션 에디터** (축 최대치 · 그룹별 centerPioneer / guardianAlien)
- [x] **대표 업적** 3슬롯 (아이콘·이름·날짜) · `renderProfileAchievements()` · 좌표 에디터
- [x] legacy `.profile-citizen-card__legacy` — `hidden` 유지 (JS id 호환)

### 게시글 작성자 프로필 UX (2026-07-10, 개발 #3)

**철학:** 글보다 **사람** — 게시글 → 작성자 → 프로필 → 팔로우 → 다른 글 탐색.

| 단계 | 상태 | API / 비고 |
|------|------|------------|
| 작성자 카드 HUD | ✅ | 1차 HUD 스타일 · 2차 `Lv.N · 명성` · 3차 영토 Badge |
| Hover 미니 프로필 | ⚠️ 보류 | `ScMiniProfile` 코드 유지 · **화면 attachHover 연결 해제** (2026-07-11) · Hover는 `title` 안내만 |
| 프로필 모달 | ✅ | `ScProfileModal` — `open` · `close` · `getUserId` · ESC/배경/X/닫기 · scroll lock · fade |
| 모달 ProfileFrame | ✅ | **새 UI 없음** — `renderProfileFrameInModal` · `buildUserProfileDataForModal` · `data-pf-layer` 스코프 |
| 회귀 QA | ✅ | Hover/Click/Frame/4스킨/HUD복원/닫기/DOM — `closeScProfileModal` 이중 콜백 FIX |
| 댓글 작성자 프로필 | ✅ | `renderThreadedCommentNode` — Hover + 클릭 → `openUserProfile` (2026-07-11) |
| 활동 피드 작성자 프로필 | ✅ | `authorId` 있는 항목만 Hover/클릭 · `post_created` 저장 (2026-07-11) |
| 알림 작성자 프로필 | ✅ | `actorId` 항목 — 작성자 영역 → 프로필 · 내용 영역 → 목적지 이동 (2026-07-11) |

**절대 금지 (요청 없이):** ProfileFrame HTML/CSS · `SC_PROFILE_LAYOUT` · `SC_PROFILE_LAYOUT_BY_SKIN` · PNG 수정.  
**스킨 규칙:** `territorySkin` → 해당 PNG → `SC_PROFILE_LAYOUT_BY_SKIN[skin]` 좌표 (center 좌표를 다른 스킨에 쓰지 않음).

**다음 확장 순서 (닉네임 있는 모든 곳):**

1. [x] 댓글 작성자 — Hover → `openUserProfile` (2026-07-11)
2. [x] 활동 피드 작성자 — `authorId` 저장만 (화면에 이름 미표시 → 프로필 연결 없음, 2026-07-11)
3. [x] 알림 작성자 — 아바타·닉네임만 `openUserProfile` (2026-07-11)
4. [x] 랭킹 — 닉네임(유저 ID)만 `openUserProfile` (2026-07-11)
5. [x] **displayName 통일** — `resolveDisplayName(userId)` 전역 표시 (2026-07-12)

**Search System v1 (2026-07-12) ✅:** `search-system.js` · `sc-map-tab-search` · `sc-search-modal` · 시민: `collectDisplayNameIndex` · 토론: `sc_board_bundle_v1` 제목/본문/작성자 displayName · `__scBoardNavigateToPost` · `__scSearchCitizens` · `__scSearchDiscussions`

**UserCard UX 규칙 (2026-07-11~):** Hover = `title`/`aria-label` **「클릭해서 유저 프로필 보기」** 만 (ScMiniProfile 팝업 미사용) · Click = **아바타·닉네임·유저 ID**만 → `openUserProfile()` → ScProfileModal → ProfileFrame · 공통 헬퍼 `wireScUserProfileLink()`.

작업 단위: **한 곳씩** · Composer 2.5 Fast · 기능 추가만 (ProfileFrame 개선/리팩토링 금지).

**알림 카드 클릭 규칙 (2026-07-11):** `actorId` 있음 → **아바타·닉네임** 클릭 = `openUserProfile()` (`stopPropagation`) · 제목/메시지 영역 클릭 = `navigateFromNotification()` · 시스템 알림은 단일 클릭 유지.

**Community System v1 — 북마크 (2026-07-11):** `sc_bookmarks_v1` · userKey별 `{ postId, createdAt }` · 게시글 목록/상세 `저장` 버튼 토글.

**Community System v2 — 북마크 목록 1차 (2026-07-12):** `bookmark-list.js` · HUD `sc-map-tab-bookmarks` · `findPostByIdAnywhere` · `__scBoardNavigateToPost` · 삭제 시 Toast.

**Follow System v1 2차 (2026-07-12):** 팔로잉 탭 `언팔로우` 버튼 · `FollowSystem.toggleFollow` · `renderList()` 재조회 · Toast · HUD·`board__follow-btn` 자동 갱신 (`follow-system.js` 기존 hook).

**Follow System v1 1차 (2026-07-12):** `follow-list-modal.js` · `FollowListModal.open(tab)` · HUD `#avatar-dock-follow-followers` / `#avatar-dock-follow-following` · `FollowSystem` + `resolveDisplayName` · 프로필 `openUserProfile` · `__scFollowLists(userId)` 디버그 · **localStorage 전용** (`sc_follow_v1`).

**ProfileFrame 상단 팔로워 (2026-07-12):** `profileData.followers` · `resolveProfileFollowerCount` → `FollowSystem.getFollowerCount` · `followersLabelLayer` + `followersLayer` · 명성(`fame`) 위 좌표 · 4스킨 통일 `{785,25,92,33}` / `{882,25,96,33}` · 0명 `0` · 금색 라벨 · 명성 톤 숫자 박스 · 에디터 X/Y/W/H · **아이콘/Emoji 없음**

**Community System v1 — 공유 (2026-07-11):** `buildPostShareUrl` · `linkTarget`과 동일 쿼리(`view=post&postId&territoryId&stage`) · `공유` 버튼 클릭 → 클립보드 · `#sc-share-toast` HUD 안내.

**Community System v1 — 신고 (2026-07-11):** `sc_reports_v1` · userKey별 `{ postId, reason, detail?, createdAt, reporterId }` · 반응 바 **신고** 버튼 → HUD 모달 · 행동 사유 6종 · **상세 의견** textarea (300자 · 기타 필수) · 중복/본인 글 Toast만 — 숨김·제재·외계행성 이동 없음.

**랭킹 UI 1차 (2026-07-11):** `rank-leaderboard.js` · 탭 전체/중앙/개척/수호/외계 · `getLeaderboard(filter)` 재사용 · TOP1~5 👑🥈🥉⭐ Badge · 프로필 Hover/클릭은 미연결.

**랭킹 UI 2차 (2026-07-11):** TOP3 행 여백·아이콘 크기 · 영토 `data-territory` Badge · 내 순위 2×2 HUD 그리드 · 모달 폭 확대.

**랭킹 프로필 UX (2026-07-11):** `rank-leaderboard.js` · 닉네임(`strong`)만 `wireScUserProfileLink` · 전 탭 공통.

### 성향·게임 로직 (브라우저 데모 — localStorage)

- [x] 3축 누적 점수 + 표시 % (`alignment-scoring.js`)
- [x] 좋아요/싫어요 → 반응자·작성자 양방향 델타 (`applyReactionScoresWithMult`)
- [x] 일일 표시 % 캡 · 글당 반응 상한 · 외계인 % (`planetPct`) 별도 축
- [x] 데일리 이슈 관점 선택 → 미세 성향 이동 (콘텐츠 중력)
- [x] 영토 해금 임계 (40% / 60%) · 외계 경고 30% · 강제 편입 50%
- [x] 레벨/XP/명성 (`player-progression.js`) — 글+25, 댓글+12, 이슈댓글+10

### UI/디자인

- [x] CSS 변수 디자인 시스템 (`--sc-*`) · UI Kit (`sc-panel`, `sc-card`, …)
- [x] `data-territory` 기반 영토 색상 자동 전환
- [x] `territory-beliefs.js` 신념 SSOT · 공식 WEBP 배너/엠블럼 v1

---

## 3. 구성 중 / 부분 구현 ⚠️

| 영역 | 상태 | 비고 |
|------|------|------|
| **ProfileFrame ↔ 실제 성향** | ⚠️ 분리됨 | 게임은 `conservative/centrist/progressive`, ProfileFrame은 `center/pioneer/guardian/alien` 더미 |
| **getCurrentProfileData()** | 부분 실데이터 | Auth·progression merge + 활동 요약 4항목 + **영토 기록 4항목** (현재소속·이동·영향력·등급) |
| **Supabase DB** | 뼈대 | 테이블·Auth 일부. 집계·프로필 실시간 동기화 미완 |
| **성향 서버 집계** | config만 | `config/alignment-system.js` — 실제 글 분석 파이프라인 없음 |
| **업적 시스템** | persistence + 알람 + RETROACTIVE 기반 | 정의 11개 · first-post canonical/RETROACTIVE · 대표 업적 ProfileFrame canonical · `acquisition_notified_at` · Guest Mock · browser self-grant 금지 |
| **아바타** | placeholder | legacy 슬롯·업로드 UI 있음. ProfileFrame 오버레이 미구현 |
| **데일리 이슈 AI** | 로컬 풀 | AI 자동 생성 파이프라인 없음 |
| **결제·영토전·추방 자동화** | 기획만 | 상품 정의됨, 코드 미구현 |
| **localStorage 좌표** | 주의 | 에디터 저장값이 `SC_PROFILE_LAYOUT` 기본값을 덮어씀 → 「초기화」 필요할 수 있음 |

---

## 4. TODO / 남은 작업 (우선순위)

> 전체 목록: `docs/TODO.md`

### 게시글 작성자 프로필 확장 (개발 #3 다음)

1. [x] 댓글 작성자 — Hover → `openUserProfile` (2026-07-11)
2. [x] 활동 피드 · `authorId` 항목만 (2026-07-11)
3. [x] 알림 · `actorId` 항목만 (2026-07-11)
4. [x] 랭킹 — 닉네임만 `openUserProfile` (2026-07-11)

### Community System v1 (2026-07-11~)

1. [x] 게시글 북마크 1차 — `sc_bookmarks_v1` · `togglePostBookmark` · 반응 바 **저장** 버튼
2. [x] 게시글 공유 1차 — `buildPostShareUrl` · **공유** 버튼 · 링크 복사 Toast
3. [x] 게시글 신고 1차 — `sc_reports_v1` · **신고** 버튼 · HUD 모달 · 행동 사유만 · 기록만 (제재 없음)
4. [x] 게시글 신고 상세 의견 — textarea 300자 · 기타 필수 · `detail` 필드 저장
5. [x] 북마크 목록 화면 2차 → **v2 북마크 목록 1차 완료** (2026-07-12)

### Follow System v1 (2026-07-12) — 구현 완료 · QA 대기

1. [x] 팔로워·팔로잉 2탭 목록 모달 — `follow-list-modal.js` · HUD 숫자 클릭 진입
2. [x] 시민 행 · 프로필 연결 · Empty · 정렬(displayName)
3. [x] ProfileFrame 상단 팔로워 수 — `followers` 레이어 · 4스킨 좌표
4. [x] **팔로잉 탭 언팔로우** — `toggleFollow` · Toast (2026-07-12)
5. [ ] **2차 QA** — 언팔로우·`sc_follow_v1`·HUD·목록·Empty·Toast·게시글 버튼·랭킹·ProfileFrame 회귀 확인

### 다음 세션 최우선 (2026-07-12)

1. [ ] **Follow System v1 2차 QA** — 위 체크리스트 통과 후 완료 처리
2. [ ] **Settings System v1** (이후)
3. [ ] **Admin System v1** (이후)

### ⏸️ 보류 — 기능

업적 시스템(설계 후) · 타인 프로필 팔로워 목록 · 추천 사용자 · 친구 시스템 · 차단 · 팔로워/팔로잉 검색 · 서버 동기화 · 실시간 DB · Follow 검색/페이지네이션

### ⏸️ 보류 — UI

ProfileFrame 전체 폴리싱 · 팔로워 최종 디자인 · 버튼/배지 통일 · 아이콘 통일 · 모달 UI 통일 · 반응형 최종 점검

**기타 보류:** ScMiniProfile 코드 삭제 · 랭킹 UI 추가 개선 · 아바타 · 관리자 · 업적 고도화

### ProfileFrame 다음 순서

1. [ ] **아바타** ProfileFrame 오버레이
2. [ ] `getCurrentProfileData()` — 로그인/API 실데이터 연결
3. [ ] **게임 성향 → ProfileFrame 4축** 매핑 연동
4. [ ] 경험치 게이지 위치 최종 보정
5. [ ] `SC_PROFILE_LAYOUT` 4스킨 최종 확정 + QA
6. [ ] ProfileFrame **모바일** 최종 보정

### 게임/백엔드

- [ ] 성향 **서버 집계** (글/댓글/반응 → DB)
- [ ] 영토 귀속 **자동화** · 첩자 배지
- [ ] XP/명성 **실제 적용** (현재 클라이언트 데모)
- [ ] 추방 (비호감 30) · 지구귀환티켓
- [ ] 결제 (카카오/토스/소액)
- [ ] 영토전 · 업적 조건 처리 · AI 데일리 이슈

---

## 5. 현재 막혀 있는 / 주의할 부분 🚧

1. **이중 성향 모델**  
   - 게임 로직: `conservative` · `centrist` · `progressive` (+ `planetPct`)  
   - ProfileFrame SVG: `center` · `pioneer` · `guardian` · `alien` (0~100)  
   - **연결 함수 없음** — 프로필 지도는 더미, 게시판 막대는 별도 저장소

2. **단일 파일 SPA**  
   - `index.html` 2만 줄+ → 탐색은 `Grep` 필수. 무분별 리팩토링 위험

3. **JS 수정 제한 규칙**  
   - UI 작업이어도 프로필/성향 **데이터 로직** 건드리면 회귀 위험. 요청 없이 수정 금지

4. **localStorage 의존**  
   - 성향·데일리 이슈·좌표 에디터·프로필 사진 등 **브라우저 로컬** — 다기기/서버 동기화 없음

5. **PROJECT_CONTEXT.md 일부 구식**  
   - §7 미구현 목록에 “대표 업적 미구현” 등 **낡은 표현** 있음 → `CHANGELOG.md`·이 문서 우선

6. **문서 인코딩**  
   - `config/alignment-rank-limits.js` 헤더 주석 일부 깨짐 (내용은 정상)

---

## 6. 리팩토링이 필요한 부분 (장기)

| 항목 | 이유 | 권장 방향 |
|------|------|-----------|
| `index.html` 분리 | 유지보수·AI 컨텍스트 한계 | CSS/JS 모듈 분리 (빌드 도입 시) — **현재는 의도적 단일 파일** |
| legacy 프로필 카드 | hidden이나 JS id 다수 참조 | ProfileFrame 완성 후 단계적 제거 |
| `territory-icons/` PNG | WEBP v1과 혼재 | `assets/territories/`로 통일 |
| 성향 모델 통합 | 3축 vs 4축 vs planetPct | 단일 `ProfileAlignment` 어댑터 설계 |
| localStorage → API | 데모 한계 | `/api/me/profile` 확장 + Supabase |
| `alignment-rank-limits` | 1~10랭크 vs `player-progression` 1~5랭크 | 기획 정합성 검토 필요 |

---

## 7. ★ 성향(Alignment) 시스템 — 반드시 전달할 사항

> **정치 성향은 제재하지 않는다.** 방향 자체를 막지 않고, **행동(비호감·신고 30회)** 만 moderation.  
> **외계인 %(`planetPct`)** 는 정치 축과 분리 — 싫어요·외계 표시가 주로 증가.

### 7.1 저장소 (브라우저 데모)

| 키 | 내용 |
|----|------|
| `sc_political_scores_v1` | 유저별 `{ conservative, centrist, progressive, planetPct?, forcedTerritory? }` |
| `sc_align_daily_pct_cap_v1` | 일일 표시 % 변동 캡 (기준선 스냅샷) |
| `sc_align_content_gravity_v1` | 데일리 이슈 콘텐츠 중력 일일 합산 |
| `sc_daily_issue_stance_v1` | 데일리 이슈 관점 선택 기록 |

### 7.2 사람 축 3개 — 누적 점수 → 표시 %

**파일:** `public/alignment-scoring.js` (`window.AlignmentScoring`)

| 상수 | 값 | 의미 |
|------|-----|------|
| `initialScores()` | 각 축 **12** | 초기 합 36 — 소수 반응에 %가 덜 흔들림 |
| `MIN_AXIS` | **0.5** | 축 최소 클램프 |
| `W_REACTOR_LIKE` | **2.0** | 반응자: 남 글 **좋아요** → 작성자 **반대편** 방향으로 밀림 |
| `W_REACTOR_DISLIKE` | **-0.6** | 반응자: **싫어요** |
| `W_AUTHOR_LIKE` | **1.0** | 작성자: 내 글에 **좋아요** → 반응자 성향 방향으로 |
| `W_AUTHOR_DISLIKE` | **-0.6** | 작성자: **싫어요** 받음 |

**표시 %:** `toDisplayPercent()` = 세 축 합으로 나눈 비율 (합≈100).  
**UI 라벨 격차:** `LEAN_NEUTRAL_MAX=12`, `LEAN_MILD_MAX=25` (질서·개혁 격차만 표시)

#### 한 번의 좋아요/싫어요 알고리즘

```
반응자 델타 = oppositeFaceUnit(작성자 단위벡터) × W_REACTOR_*
작성자 델타 = unit3(반응자) × W_AUTHOR_*
→ applyDelta로 conservative/centrist/progressive 누적
```

- `oppositeFaceUnit`: 작성자 최대 축의 **반대 면** 중심 방향  
- 균형(스프레드 < 0.08)이면 중도·양극에 살짝 분산

### 7.3 게시판 추가 스케일 (`index.html`)

| 상수 | 값 |
|------|-----|
| `PEER_SOCIAL_PRESSURE_SCALE` | **0.33** | 사람 축 델타 전체 추가 축소 |
| `DISLIKE_ALIGN_SCALE` | **0.4** | 싫어요 시 사람 축만 추가 40% |
| `FACTION_UNLOCK_PCT` | **40** | 영토 1단계 해금 표시 % |
| `FACTION_STAGE2_PCT` | **60** | 2단계 |
| `ALIGN_DAILY_PCT_PER_AXIS` | **5** | 하루 표시 % 각 축 ±5% 캡 |
| `ALIEN_WARN_PCT` | **30** |
| `ALIEN_FORCE_KANTA_PCT` | **50** |
| `ALIEN_MARK_DELTA` | **10** | 외계 표시 1회 |
| `LIKE_RECV_PLANET_DELTA` | **2** | 받은 좋아요 → planetPct |
| `DISLIKE_RECV_PLANET_DELTA` | **3** | 받은 싫어요 → planetPct (더 큼) |

**적용 순서** (`applyReactionScoresWithMult`): mult → 싫어요 스케일 → 글당 상한 → 일일 % 캡 → 저장

### 7.4 무엇이 성향을 움직이고 / 안 움직이나

| 행동 | 사람 3축 | planetPct | 비고 |
|------|----------|-----------|------|
| 좋아요 / 싫어요 (지구 게시판) | ✅ | 싫어요·외계표시 시 ✅ | 외계 **게시판**은 사람 축 경로 제외 |
| **공감** | ❌ | ❌ | 영토 인구 bump만 (`EMPATHY_POP_BUMP=4`) |
| 데일리 이슈 **관점 선택** | ✅ (약함) | ❌ | mult **0.12** |
| 데일리 이슈 공감/좋아요 | ✅ | ❌ | mult **0.2** |
| 데일리 이슈 싫어요 | ✅ (반대 lean) | ❌ | mult **0.2** |
| 이슈 클릭/체류 | ✅ (매우 약) | ❌ | 0.005 / 0.01 / 0.015 |
| 데일리 이슈 **댓글 작성** | ❌ | ❌ | 활동·XP만 |
| 글/댓글 **작성 자체** | ❌ (XP만) | ❌ | XP: 글25, 댓글12, 이슈10 |

**데일리 이슈 역할 → lean 벡터** (`DAILY_ISSUE_ROLE_LEAN`):

| type | progressive | centrist | conservative |
|------|-------------|----------|--------------|
| progressive | 0.7 | 0.2 | 0.1 |
| centrist | 0.25 | 0.5 | 0.25 |
| conservative | 0.1 | 0.2 | 0.7 |
| unsure | 0.2 | 0.6 | 0.2 |

- UI에는 **라벨만** 노출. lean은 `leanForDailyIssueRoleType(type)`만 신뢰 (AI가 넣어도 덮어씀)
- 상세: `docs/DAILY_ISSUE_CONTENT_GRAVITY.md`

### 7.5 상한·캡

| 종류 | 값 | 위치 |
|------|-----|------|
| 글당 반응 상한 (랭크 0~4) | `[120, 200, 320, 480, 720]` | `player-progression.js` `PER_POST_REACTION_CAP` |
| 콘텐츠 중력 일일 합 | **0.65** | `ALIGN_CONTENT_GRAVITY_DAILY_MAX` |
| 랭크별 축 절대 상한 (설계) | 3천~100만 | `config/alignment-rank-limits.js` (서버 연동 예정) |

### 7.6 ProfileFrame 성향지도 (표시 전용)

**데이터:** `SC_PROFILE_DATA.alignment` — `{ center, pioneer, guardian, alien }` 각 **0~100**

**렌더:** `renderProfileAlignmentMap()` — SVG viewBox `0 0 100 100`

| 축 | 방향 (중심 50,50) |
|----|-------------------|
| alien | 위 (y 감소) |
| guardian | 오른쪽 (x 증가) |
| center | 아래 (y 증가) |
| pioneer | 왼쪽 (x 감소) |

**축 스케일:** `SC_PROFILE_ALIGNMENT_AXIS_MAX_BY_GROUP` — 게임값 100이 PNG 끝이 아님  
- 예: `center: 72` → 표시값 72가 축 끝  
- 그룹: `centerPioneer` (중앙·개척 PNG) / `guardianAlien` (수호·외계 PNG)

**애니메이션:** 값 변경 시 0.28s ease-out 보간 (polygon·polyline·circle)

> ⚠️ **아직 `sc_political_scores_v1`과 자동 동기화되지 않음.** 연동 시 매핑 규칙 설계 필요.

### 7.7 영토 ID 대응표

| CSS `data-territory` | 내부 ID | 표시명 | ProfileFrame skin |
|---------------------|---------|--------|-------------------|
| `centrist` | COMMON | 중앙광장 | `center` |
| `reform` | PROGRESSIVE | 개척영토 | `pioneer` |
| `order` | CONSERVATIVE | 수호영토 | `guardian` |
| `alien` | KANTAPBIYA | 외계행성 | `alien` |

### 7.8 튜닝 시 수정 위치 (빠른 참조)

| 조정 목표 | 파일·상수 |
|-----------|-----------|
| 반응 1회 세기 | `alignment-scoring.js` `W_*` |
| 싫어요 정치 축 약화 | `DISLIKE_ALIGN_SCALE` |
| 외계 % 민감도 | `DISLIKE_RECV_PLANET_DELTA` 등 |
| 하루 % 변동 | `ALIGN_DAILY_PCT_PER_AXIS` |
| 한 글 누적 | `PER_POST_REACTION_CAP` |
| 수치 전체 표 | **`docs/ALIGNMENT_REACTION_TUNING.md`** |

---

## 8. ProfileFrame 데이터 파이프라인

```
SC_PROFILE_DATA (더미 · 원본 미변경)
       ↓
getCurrentProfileData() / loadCurrentUserProfile()
       ↓ mergeResolvedProfileActivity(player.userId)
       ↓ mergeResolvedProfileTerritory(player.userId)
       ↓ finalizeProfileDisplayFields()
buildUserProfileDataForModal(userId)   ← 타인 프로필 모달
       ↓ mergeResolvedProfileActivity(userId)
       ↓ mergeResolvedProfileTerritory(userId)
       ↓ finalizeProfileDisplayFields()
renderProfileFrameInModal(userId)
       ↓ applyProfileFramePixelLayout(frame) → ensureProfileFrameListLayerBounds
       ↓ renderProfileData(data, { frameRoot: frame })
       ↓
renderProfileAlignmentMap(data.alignment, { frameRoot })
renderProfileAchievements(data, { frameRoot })
```

**활동 요약 집계 (`resolveUserProfileActivity`)**

| 필드 | 소스 |
|------|------|
| `posts` | `sc_board_bundle_v1` authorId · postId dedupe |
| `comments` | 댓글·대댓글 authorId · commentId dedupe |
| `receivedLikes` | 본인 글·댓글 `reactions.empathy.length` 합 |
| `discussions` | 참여한 distinct `postId` 수 |
| `aura` | **미연결** — 표시 `--` (미로그인 데모만 Mock 허용) |

디버그: `__scProfileActivity('guest_demo')` · `__scTerritoryRecord('guest_demo')` · `__scResolvedProfileData(userId)` · `__scInspectProfileFrame(userId)`

**모달 Overlay:** HUD는 `#activitySummaryLayer` CSS로 목록 레이어 100%×100%. 모달은 `data-pf-layer`만 있어 `ensureProfileFrameListLayerBounds()`로 동일 bounds 적용 (0×0 클리핑 방지).

**표시 기준:** 활동·영토 **숫자형** — 1 이상 숫자 · **0도 `--`** · 확인 불가 `--` · **팔로워(`followers`)는 0도 `0`** · 소속 없음 `기록 없음` · 등급 없음 `참여자` · LEVEL·명성·경험치 % 변경 없음 · `value||'--'` 금지 · 원본 숫자 0 유지.

**영토 기록 집계 (`resolveUserTerritoryRecord`)**

| 필드 | 표시명 | 소스 · fallback |
|------|--------|----------------|
| `current` | 현재 소속 | `__scPlayer` / `getState().territoryId` / `forcedTerritory` · 없으면 **기록 없음** |
| `moved` | 이동 횟수 | 시즌 아카이브 · exileHistory · 기록 없으면 **--** · **0도 --** |
| `influence` | 시민 영향력 | `getMyStandings` / `rankReputationScore` · 불가 **--** · **0도 --** |
| `rank` | 시민 등급 | `getDisplay().rankShort` · **참여자** |

> **「최초 소속」 사용 안 함.** 표시 fallback: `normalizeTerritoryRecordDisplay()`.

### SC_PROFILE_LAYOUT 좌표 (1024×819 px)

- `SC_PROFILE_LAYOUT_BY_SKIN`: center=pioneer 공유, guardian/alien 개별
- 에디터: `window.__scProfileLayoutEditor` (localhost)
- localStorage: `sc_profile_layout_editor_v3`
- 업적: `achievement` · `achievementSlots[3]` · `achievementTitles[3]` · `achievementDates[3]`
- 팔로워 (2026-07-12): `followersLabel` `{785,25,92,33}` · `followers` `{882,25,96,33}` — 4스킨 동일

---

## 9. 개발 도구 (localhost)

| 도구 | 접근 |
|------|------|
| ProfileFrame 좌표 에디터 | UI 토글 · `__scProfileLayoutEditor` |
| 성향지도 캘리브레이션 | 에디터 패널 · `sc_profile_alignment_axis_max_v1` |
| 업적 좌표 복사 | 「현재/전체 영토 업적 슬롯 복사」 |
| 콘솔 | `refreshCurrentProfile()` · `__scProfileActivity(userId)` · `__scTerritoryRecord(userId)` · `__scFollowLists(userId)` · `FollowListModal.open('following')` |

---

## 10. 관련 문서 인덱스

| 문서 | 용도 |
|------|------|
| `docs/PROJECT_CONTEXT.md` | 세계관·디자인·ProfileFrame 상세 |
| `docs/TODO.md` | 작업 체크리스트 |
| `docs/CHANGELOG.md` | 최근 변경 (2026-07-12 Follow v1 · ProfileFrame 세션) |
| `docs/ALIGNMENT_REACTION_TUNING.md` | 성향 반응 **정확한 상수표** |
| `docs/DAILY_ISSUE_CONTENT_GRAVITY.md` | 데일리 이슈 성향 이동 |
| `docs/PLAYER_LEVEL_PROGRESSION.md` | 레벨·XP·명성 |
| `.cursor/rules/sentencearena.mdc` | AI 작업 규칙 |

---

## 11. 새 AI에게 첫 메시지 예시

```
docs/AI_HANDOFF.md, PROJECT_CONTEXT.md, TODO.md를 읽고 작업해 주세요.
작업: [구체적 요청]
제약: ProfileFrame 좌표/SC_PROFILE_LAYOUT 변경 없음, 기존 성향 JS 로직 수정 없음, UI는 index.html <style>만.
```

---

*이 문서는 인수인계용입니다. 코드 변경 시 관련 섹션과 `CHANGELOG.md`를 함께 갱신하세요.*
