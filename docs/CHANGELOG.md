# 센텐스아레나 — 변경 기록 (CHANGELOG)

> 최근 주요 변경 사항을 날짜 역순으로 정리합니다.
> 마지막 업데이트: 2026-08-09 (브랜드 SentenceArena · GitHub `sentencearena`)

---

## [미배포] — 현 작업 이후

### ★ 2026-08-09 — 브랜드 리브랜딩 SentenceArena

- 표시: `SentenceCraft`/`센텐스크래프트` → **`SentenceArena`/`센텐스아레나`**
- GitHub: `kyb041028-ctrl/sentencecraft` → **`kyb041028-ctrl/sentencearena`** (rename, history 유지)
- 로컬 origin: `https://github.com/kyb041028-ctrl/sentencearena.git`
- 메타: npm `sentencearena` · health service `sentencearena-api` · Cursor rule `sentencearena.mdc`
- 유지: `sc_*` storage · migration SQL checksum · Supabase ref/keys · OAuth secrets · 로컬 폴더명
- Auth/OAuth/운영 DB/Railway 실배포/기능·UI 로직 미변경

### ★ 2026-08-07 — 작업 정리 (문서)

- `PROJECT_CONTEXT`: 브랜드·GitHub 식별자 표 · 데일리 이슈 운영 원칙 현행화
- `AI_HANDOFF`: 브랜드/GitHub 완료 요약 블록 추가
- 기능 코드·Auth·DB·Railway 실배포 미변경

### ★ 2026-08-07 — GitHub repository 하이픈 제거 (`sentencecraft`)

- GitHub: `kyb041028-ctrl/sentence-craft` → `kyb041028-ctrl/sentencecraft` (이후 `sentencearena`로 재rename)
- 당시 origin: `https://github.com/kyb041028-ctrl/sentencecraft.git`
- Auth/OAuth/운영 DB/Railway deploy/기능 코드 미변경

### ★ 2026-08-07 — GitHub repository rename (`sentence-craft`)

- GitHub: `kyb041028-ctrl/sentnse_craft` → `kyb041028-ctrl/sentence-craft` (이후 `sentencecraft` → `sentencearena`)
- Auth/OAuth/운영 DB/Railway deploy/기능 코드 미변경

### ★ 2026-08-07 — 브랜드 철자 교정 (당시 SentenceCraft)

- 표시/문서: `SentensCraft`·`SENTENSCRAFT` 제거 · 당시 정식 표기 `SentenceCraft` (2026-08-09에 SentenceArena로 교체)
- 유지: `sc_*` storage · migration SQL 미수정
- Auth/OAuth/운영 DB/Railway deploy 미변경

### ★ 2026-08-07 — Railway 베타 배포 직전 점검

- `.gitignore`: `.env.*` 무시 · `.env.example`/`.env.production.example`만 추적 · bak/test-user-data 제외
- 회귀 PASS · Railway CLI 미설치(대시보드 작업은 사용자) · 실배포·운영 migration 미실행

### ★ 2026-08-07 — Railway 베타 배포 준비 (실배포 없음)

- `server.js`: `HOST` 기본 `0.0.0.0` · `PORT` env (Railway 자동 주입)
- `package.json` engines → `20.x`
- `railway.json`: Nixpacks · `npm start` · healthcheck `/health`
- `nixpacks.toml`: Node 20
- `.env.production.example`: Railway Variables A/B/C · 첫 배포 scheduler=0
- Dockerfile 없음 · 비밀값·운영 migration·실배포 미실행

### ★ 2026-08-07 — 베타 배포 전 서버 안정화 1차

- `server/graceful-shutdown.js`: SIGTERM/SIGINT · HTTP close → scheduler stop → PG pools · timeout(기본 10s) · 중복 호출 안전
- `server/http-cors-config.js`: production allowlist만 · development localhost 유지 · 전역 `origin:true` 제거
- `server/production-boot-guards.js`: production에서 JSON repo/test schema/reset/namespace fail-closed · legacy token 경고
- `server.js`: `/ready` 추가 · scheduler stop 핸들 · 단일 인스턴스 정책 로그
- `server/daily-issue-pg-client.js`: pool registry + `closeAllDailyIssuePools`
- `.env.production.example`: web=1 · scheduler 정책 · `/health` `/ready` · `SHUTDOWN_TIMEOUT_MS`
- 테스트: `test:server-stability` 26 · api-security 11 · admin-api 39 · public-api 13 · morning-scheduler 33 PASS

### ★ 2026-08-07 — 운영용 daily_issue schema·migration 절차 1차

- 운영 schema 확정: `daily_issue` (`daily_issue_test`/`public` 차단)
- `shared/daily-issue-production-migration-core.js`: 게이트·checksum·rewrite·transaction apply·구조 검증 (reset/truncate 없음)
- `tools/run-daily-issue-production-migrate.js`: check / dry-run / apply / verify
- npm: `daily-issue:production:migrate:*` · `test:daily-issue-production-migrate` (27 PASS)
- `.env.production.example`: 운영 env 템플릿 (개발 플래그 제외)
- confirm: `DAILY_ISSUE_CONFIRM_PRODUCTION_MIGRATION=APPLY_DAILY_ISSUE_PRODUCTION`
- **실제 운영 DB 미적용** · 기존 개발 `--confirm-dev-db` 도구 유지

### ★ 2026-08-06 — 베타 배포 전 점검 (문서·체크리스트)

- 운영 schema/migration confirm 경로·env 분리·CORS·스케줄러 단일 기동·smoke·롤백 관점 정리
- 코드 변경 없음 · 상세는 `docs/AI_HANDOFF.md` 오늘 세션 마무리 절

### ★ 2026-08-06 — Auth 정식화 (anon/publishable만, service-role 폴백 제거)

- `server/supabase-server-auth-config.js`: Auth 키를 `SUPABASE_ANON_KEY` → `SUPABASE_PUBLISHABLE_KEY`만 허용. `SUPABASE_SERVICE_ROLE_KEY` 폴백 제거
- `server.js`: Auth 클라이언트는 anon/publishable만 사용. service-role은 Auth 로그인 경로 미사용(alignment Admin API 등 서버 전용 유지)
- `.env.example`: Auth 필수 키 vs service-role(Admin API 전용) 구분 명시
- 회귀: auth-config 6 · admin-api 39 · api-security 11 · admin-ui 41 · admin-ui-security 17 · public-api 13 · public-ui 27 PASS
- publishable 설정 후 실검증: signin / ADMIN review / signout 200 · keySource=`publishable`

### ★ 2026-08-06 — 관리자 로그인 실패 진단·수정 (ANON 미설정)

- 원인: `.env`에 `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` 없음 → `/api/auth/signin` 503(`SUPABASE_NOT_CONFIGURED`), 관리자 가드 fail-closed. 계정(confirmed·ADMIN)·비밀번호·프로젝트 URL은 정상.
- `server/supabase-server-auth-config.js`: 서버 Auth 키 해석(anon → publishable → service-role fallback)
- `server.js` · `daily-issue-admin-auth.js` · `daily-issue-routes.js`: 해당 설정 사용. 서버 재시작 후 signin·ADMIN review API 200 확인
- `.env.example`: publishable 키·service-role 폴백 안내 추가

### ★ 2026-08-06 — 정식 관리자 인증 1차 (Supabase Auth)

- `server/daily-issue-admin-auth.js`: 개발용 `DAILY_ISSUE_ADMIN_API_TOKEN` 가드 제거 → Supabase access token 검증 + 역할 게이트(`ADMIN`/`OWNER`)로 전환
- `server/daily-issue-routes.js` · `server/daily-issue-api-errors.js`: 관리자 인증 오류코드(`ADMIN_AUTH_NOT_CONFIGURED`/`ADMIN_ROLE_FORBIDDEN`) 반영, 감사 로그에 관리자 userId/role 기록
- `public/admin/daily-issues/index.html` · `admin-daily-issue.js`: 토큰 입력 모달 제거, 이메일·비밀번호 로그인 모달/세션(`sc_sb_auth_session`) 기반 인증으로 변경, 로그아웃 시 `/api/auth/signout` 호출 후 세션 제거
- 관리자 권한 정책: USER/MODERATOR 접근 차단(403), ADMIN/OWNER 접근 허용
- 회귀: `test:daily-issue-admin-api`, `test:daily-issue-api-security`, `test:daily-issue-admin-ui`, `test:daily-issue-admin-ui-security`, `test:daily-issue-public-api`, `test:daily-issue-public-ui` PASS

### ★ 2026-08-06 — 제목·RSS 요약 교차출처 confirmed fact 추출

- `shared/daily-issue-title-fact-core.js` (신규): 출처별 fact tuple(subject/action/period/numeric) · 2+ 독립출처 공통 필드만 CONFIRMED · 수치 충돌 시 `NUMERIC_CONFLICT`/`NUMERIC_SCOPE_MISMATCH` + `SOURCE_DISAGREEMENT` · 전망·정치해석 제외 · choices/stance 미생성
- `shared/daily-issue-ingest-core.js`: 교차출처 CONFIRMED 없을 때 title-fact 경로 병합 · `feedSummary` 보존 · require 순서 버그 수정
- `shared/daily-issue-cluster-core.js`: 제목 고유명사 합의 없는 본문 generic 토큰(온라인·코스피 등) 오병합 차단
- 검증: `test:daily-issue-title-fact` 8 PASS · `daily-issue:validate-confirmed-fact-live` · cross-source +1(13c)
- quality gate v2 · AUTO 판정 · 수동 enqueue 없이 E2E `{ ok: true, enqueued: 2 }` 유지

### ★ 2026-08-06 — 교차출처 클러스터링 보강 (한국어 RSS)

- `shared/daily-issue-cluster-core.js`: 제목 정규화(속보·종합보·대괄호 태그), 한국어 고유명사·기관명 동적 추출, fuzzy proper noun 매칭, clusterScore/독립출처 분리, generic-only 오병합 차단, 연합 재전송 감지 플래그
- `server/daily-issue-morning-scheduler-service.js` · `daily-issue-review-service.js`: enqueue 시 `readyCandidates` 전체 객체 사용 (요약 `candidates` 배열 아님)
- runKey namespace: `DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE` · E2E `e2e:` prefix (운영 runKey 삭제 금지)
- 검증: `daily-issue:validate-clustering-live` · cross-source 테스트 +2 · morning scheduler +1
- quality/freshness/자동게시 판정 기준 미완화 · 실제 RSS READY 생성 확인

### ★ 2026-08-06 — 관리자 데일리 이슈 화면 운영자 UX 단순화

- `daily_issue_test` 테스트 fixture 정리 (mornsched_/pubdec_smoke_/smoke·2099 스케줄러 run 등) · 실제 한국어 후보 유지
- 관리자 UI 한국어 표시: 상태·게시 판정·스케줄러·감사 이력 · KST 시간(Asia/Seoul)
- 목록·상세 기본 화면 단순화 · 내부 enum/UTC/runKey 등은 「개발 정보 보기」 접기 영역
- 필터: 검수 필요 / 자동 게시 가능 / 게시 중 / 종료됨 · 큐: 관리자 검수 / 자동 게시 사후 검수
- DB·API·lifecycle·판정 정책·관리자 작업 기능 변경 없음

### ★ 2026-08-06 — 정식 아침판 스케줄러·운영 감시 1차

- 04:30 KST 수집 / 05:00 KST AUTO 게시 분리 · timezone `Asia/Seoul` 고정 · 기본 disabled
- env: `DAILY_ISSUE_MORNING_SCHEDULER_ENABLED` · `COLLECT_CRON` · `PUBLISH_CRON` · `CATCHUP_MINUTES=30`
- runKey 분리 (`morning-collect:YYYY-MM-DD` / `morning-publish:YYYY-MM-DD`) · PG unique + advisory lock · JSON store
- catch-up 30분 · 초과 시 MISSED · collect 실패 시 publish BLOCKED · 실패를 0건 성공으로 은폐하지 않음
- 관리자 API: morning/status · history · run-collect · run-publish · 사후 검수 큐(`postReviewQueue`)
- 관리자 UI: 아침판 운영 패널·경고·수동 실행 · 큐 필터
- 판정/lifecycle 미변경 · 운영 public schema 금지 · `npm start` 미실행
- 테스트: `test:daily-issue-morning-scheduler` 32 PASS · PG smoke 13 PASS · publication-decision 회귀 24 PASS

### ★ 2026-08-06 — 데일리 이슈 자동 게시 / 수동 검수 2단계 정책

- 판정: `AUTO_PUBLISH_ELIGIBLE` · `MANUAL_REVIEW_REQUIRED` (`shared/daily-issue-publication-decision-core.js`)
- 원칙: 애매하면 MANUAL · AUTO 범위 좁게 · quality/freshness/lifecycle 미완화 · 운영 `public` schema 금지
- enqueue 시 판정 메타 부착: `publicationDecision` · `publicationDecisionReasons` · `requiresManualReview` · `autoPublishEligibleAt` · `autoPublishBlockedReasons`
- 05:00 KST 아침판: AUTO만 READY→APPROVED→PUBLISHED · actor=`AUTO_MORNING_EDITORIAL` · audit payload에 판정 근거
- MANUAL·HOLD·REJECT·중복 signature는 자동 게시 차단 · 관리자 approve/publish/retire 유지
- 관리자 UI 목록·상세에 게시 판정 표시 · serializer 필드 노출
- CLI: `daily-issue:morning-publish` · opt-in `DAILY_ISSUE_MORNING_AUTO_PUBLISH=1`
- 테스트: `test:daily-issue-publication-decision` 24 PASS · `test:daily-issue-publication-decision-pg` 12 PASS (`daily_issue_test`)

### ★ 2026-08-06 — 데일리 이슈 사용자 공개 화면 연결 1차

- 배치: 중앙광장(`#centrist-hub-wrap`) 데일리 이슈 섹션 — live 모드에서 공개 API 우선
- `GET /api/daily-issues` 목록 · `GET /api/daily-issues/:id` 상세 · PUBLISHED·미만료만
- 표시: 제목·핵심 사실·확인 중·출처·게시/만료 · 로딩·빈(`현재 게시된 데일리 이슈가 없습니다`)·오류 구분
- 제외: admin/audit/rawText/reviewerId/choices/stance · 관리자 UI 미수정 · 지도/메인 구조 유지
- `public/daily-issue-public-api-client.js` · `public/daily-issue-public-ui.js` · `test:daily-issue-public-ui`
- 자동 수집/게시/스케줄러·quality/freshness/lifecycle 정책·운영 public schema **미구현/미사용**

### ★ 2026-08-06 — 한국어 검수 필터 · Quality/Freshness 표시 수정

- 영어 UNICEF(NPR) 후보 `daily_issue_test`에서 제거 · 한국어 READY 1건만 유지 · `public` 미터치 · 승인/게시 안 함
- korea-economy/korea-policy: 기본 `language=ko` · 영문 출처(yonhap-en/bok-eng/fed)는 world 전용
- Quality/Freshness `undefined` 원인: serializer가 DB의 `ok`/`freshnessOk`를 `passed`로 매핑하지 않음 → 매핑 수정(정책 미변경)
- 관리자 UI: 통과/실패 표시

### ★ 2026-08-05 — daily_issue_test fixture 정리 · 한국어 교차 READY 1건

- `daily_issue_test`만 정리: `api_smoke_`/`ui_smoke_`/`dbg_`/`test_` 등 fixture 삭제 · 운영 `public` 미터치
- 실수집 후보 유지(영문 NPR UNICEF) + 한국어 뉴스 교차 후보 1건 enqueue (승인·게시 안 함)
- 출처: `yonhap-ko-economy`(연합 경제 RSS) + `mk-economy`(매일경제) — 제목·CONFIRMED claim 한국어
- 군집 고유명사 보강(`모건스탠리`/`오세훈`/`김용범` 등) · 임계치 미완화 · claim id 후보 prefix로 충돌 방지
- 정리 후 READY_FOR_REVIEW=1 → 한국어 추가 후 READY=2 / TOTAL=2

### ★ 2026-08-05 — 데일리 이슈 8차 관리자 검수 화면 1차

- `/admin/daily-issues` — `public/admin/daily-issues/` (HTML/CSS/JS) · `server.js` 라우트
- 토큰 모달 → sessionStorage만 · 사용자 `index.html` 링크 없음 · 하드코딩 금지
- 목록/상세/history · 승인·보류·반려·게시·종료·재검증 (기존 관리자 API)
- expectedStatus+lockVersion · approve≠publish · 409 재조회 · 401 토큰 재입력
- prefix `sc-admin-daily-issue-` · rawText 미표시 · noopener 외부 링크
- 테스트: `test:daily-issue-admin-ui` · `admin-ui-security` · `daily-issue:admin-ui:smoke`
- 정식 인증·스케줄러·자동 게시·운영 화면·`npm start` 미구현/미실행
- quality/freshness/lifecycle·API 계약·choices/stance 미변경

### ★ 2026-08-05 — 데일리 이슈 7차 서버 API 1차

- Express 라우터: `server/daily-issue-routes.js` (+ auth/validation/errors/rate-limit/serializers)
- 관리자 API: review list/detail/approve/hold/reject/publish/expire/retire/revalidate/history
- 공개 API: `GET /api/daily-issues`, `GET /api/daily-issues/:id` (PUBLISHED·미만료만)
- 임시 토큰 가드 `DAILY_ISSUE_ADMIN_API_TOKEN` (Bearer · timing-safe · fail-closed · query 금지 · 정식 인증 아님)
- expectedStatus+expectedLockVersion · approve≠publish · service→repository만 · SQL 직접 금지
- requestId · HTTP 오류 매핑 · memory rate limit(개발용) · CORS allowlist · Cache-Control: no-store
- 테스트: `test:daily-issue-admin-api` · `public-api` · `api-security` · `daily-issue:api:smoke`
- 관리자 UI·정식 권한·스케줄러·자동 게시·운영 public schema·`npm start` 미구현/미실행
- quality/freshness/lifecycle 정책·choices/stance 미변경

### ★ 2026-08-05 — 데일리 이슈 6차 실 PostgreSQL 통합 검증 PASS

- 개발 Supabase pooler 연결 (직접 `db.*:5432` timeout → pooler URL로 `.env` 갱신)
- schema `daily_issue_test` migration 적용·재실행(idempotent) · 12 tables · FK/unique/index/RLS
- 실 PG contract 13 · atomicity 18 · migration apply 9 PASS
- evidenceRefs mapper · Supabase TLS · `enabled:false` 명시 fail-closed 수정
- JSON/실 DB bundle 동일 · choices/stance 없음 · 테스트 schema만 TRUNCATE
- 서버 API·관리자 UI·스케줄러·운영 migration 미구현/미실행 · `npm start` 미실행
- 조건 A~G PASS → 서버 API 단계 진행 가능

### ★ 2026-08-05 — 데일리 이슈 실 PostgreSQL adapter 6차

- `pg` 의존성 · `server/daily-issue-pg-client.js` · `daily-issue-review-sql-repository.js` · sql-mapper
- 상태 전환+audit 동일 DB transaction · `SELECT … FOR UPDATE` · lock_version 조건부 UPDATE
- `DAILY_ISSUE_DATABASE_URL`만 사용 (운영 DATABASE_URL/Supabase 자동 연결 금지 · JSON fallback 금지)
- memory-SQL executor로 SQL 경로 단위 검증 (`test:daily-issue-sql-executor` 34)
- migration apply: `daily-issue:db:migrate --confirm-dev-db` · document jsonb 컬럼 추가
- 실 Postgres integration/migration: **SKIPPED** (개발 DB URL 없음) — 구현 완료·실 검증 미완료
- CLI `--repository=db` · 테스트 schema reset 게이트 (`daily_issue_test|dev`)
- 서버 API·관리자 UI·스케줄러·운영 migration 미구현/미실행 · 정책/choices/stance/설문 미변경

### ★ 2026-08-05 — 데일리 이슈 DB 스키마·저장소 추상화 5차

- repository 계약: `shared/daily-issue-review-repository-contract.js`
- JSON 구현체: `server/daily-issue-review-json-repository.js` (원자성 B·history rollback 유지)
- DB/fake-db: `server/daily-issue-review-db-repository.js` · factory `createDailyIssueReviewRepository`
- review service는 repository만 사용 · 정책은 shared lifecycle/quality/freshness/duplicate core
- 기본값 `DAILY_ISSUE_REPOSITORY=json` · `db` 선택 후 연결 실패 시 JSON 자동 fallback 금지
- migration 초안: `supabase/migration_daily_issue_review_lifecycle.sql` (**운영 DB 미적용**)
- lockVersion optimistic concurrency · 상태 전환+감사 로그 동일 transaction
- JSON→DB dry-run: `tools/migrate-daily-issue-review-json-to-db.js` (`--apply`는 DATABASE_URL 없으면 차단)
- 테스트: `test:daily-issue-repository` (72) · `test:daily-issue-db-schema` (44) · review 63 · atomicity 17
- 서버 API·관리자 인증/UI·스케줄러·자동 게시·운영 migration 미구현/미실행
- quality/freshness/lifecycle 정책·choices/stance·가입 설문 미변경

### ★ 2026-08-05 — 검수 상태·감사 로그 원자성 (B방식)

- 상태 파일 스냅샷 → atomic write → history append
- append 실패 시 상태 파일 atomic rollback · rollback 실패 시 FATAL
- `commitStoreWithHistory` · 테스트 `test:daily-issue-review-atomicity`

### ★ 2026-08-05 — 데일리 이슈 검수·게시 생명주기 4차 (JSON)

- READY는 즉시 게시가 아니라 검수 대기(`READY_FOR_REVIEW`) — 자동 승인/게시 없음
- 상태: READY_FOR_REVIEW · HELD · APPROVED · PUBLISHED · REJECTED · EXPIRED · RETIRED · SUPERSEDED · UPDATE_PENDING
- 모듈: `lifecycle-core` · `duplicate-core` · `review-core` · `review-service` · CLI `run-daily-issue-review.js`
- JSON: `.cache/daily-issue/review/` (queue/published/rejected/retired/history) · atomic rename · 감사 로그
- 중복·UPDATE 판정 · 승인 전 freshness 만료 EXPIRED · 게시 기간 후 RETIRED
- 브라우저 번들은 PUBLISHED만 · choices/stance/reviewerId/rawText 제외
- 정책: `config/daily-issue-publication-policy.js` (일반 24h · 공식/통계 72h · ongoing 48h)
- 테스트: `test:daily-issue-review` (63) · 실 Ukraine 후보 임시 lifecycle 통과
- 실 DB·관리자 웹·스케줄러·외부 AI·가입 설문 미구현 유지

### ★ 2026-08-05 — 데일리 이슈 최신성(freshness) 게이트 3차

- 시간 필드 분리: publishedAt / updatedAt / feedSeenAt / retrievedAt / sourceEventDate (상호 대체 금지)
- 정책: `config/daily-issue-freshness-policy.js` (일반 72h · 공식/통계 7일 · 속보 48h)
- 코어: `shared/daily-issue-freshness-core.js` — novelty/stale · freshnessClass · fail-closed
- quality READY 이후 freshness 게이트 — 둘 다 통과해야 최종 READY / 오늘 게시 후보
- freshnessClass: BREAKING · RECENT_UPDATE · ONGOING_WITH_NEW_DEVELOPMENT (게시 가능) / BACKGROUND · RECIRCULATED · STALE · UNKNOWN (차단)
- CLI: `--fresh-only` · `--as-of` · `--max-age-hours` · `--output-fresh-bundle`
- 스크립트: `test:daily-issue-freshness` · `ingest:daily-issue:*:fresh`
- 기존 READY 2(Ceuta·Ukraine) 재판정 → 둘 다 ONGOING_WITH_NEW_DEVELOPMENT로 freshness 통과
- world fresh smoke: qualityReady 1 → freshnessReady 1 (Ukraine); Ceuta는 이번 피드에서 multiSource 미형성
- korea-economy: multiSource 0 유지 · pair 거부 주원인 DATE_WINDOW_MISMATCH / ENTITY_OVERLAP_LOW (기준 미완화)
- 자동 PUBLISHED · localStorage · 스케줄러 · 외부 AI · 가입 설문 미구현 유지

### ★ 2026-08-05 — 외부 출처 수집 파이프라인 2차

- 교차 확인용 출처 확대(연합영문·가디언·NPR·WHO·UN·Fed·매경·BOK 보도자료) — HTTP 검증 후 enabled
- 공식기관 full-text allowlist + `#board` 제한 추출(뉴스 본문 크롤 금지)
- BOK 한국어 description 없음 → 공식 게시 페이지 메타로 evidence 생성(조건 A PASS)
- 제목 수준 보수 군집화 · 교차 claim 합의 · world dry-run READY 2(Ceuta·Ukraine)
- 품질 게이트 미완화 · 소스 도메인 dedupe가 evidence 링크를 깨지 않도록 수정
- 그룹 CLI/테스트: `ingest:daily-issue:world` · `test:daily-issue-cross-source`

### ★ 2026-08-05 — 외부 출처 수집 파이프라인 1차 (RSS/Atom)

- 레지스트리·SSRF 안전 fetch·RSS/Atom 파싱·중복 제거·보수적 군집화·evidence substring 추출
- `buildDailyIssueCandidate` 연결 · 기본 dry-run · READY 후보만 생성(자동 PUBLISHED 아님)
- 활성 피드: 한국은행 공식 RSS 3 · BBC World / 404 URL은 enabled:false
- 한국어 BOK 일부 피드는 description 없음 → 제목만으로 evidence 미인정(fail-closed)
- 캐시 `.cache/daily-issue/` (git 제외) · CLI `ingest:daily-issue:dry` / `smoke`
- 품질 게이트 미완화 · 정적 풀 게시 미사용 · 유료 API·본문 무단 크롤·외부 AI·가입 설문 미구현
- 테스트: `npm run test:daily-issue-ingest`

### ★ 2026-08-05 — 출처 근거 기반 claim 분류·검증 파이프라인

- 시스템은 절대적 진실을 판정하지 않으며, 출처가 뒷받침하는 범위만 분류·표시
- 순수 모듈 추가: `shared/daily-issue-source-core.js` · `claim-core.js` · `quality-core.js`
- claim 7분류: CONFIRMED_FACT / ATTRIBUTED_CLAIM / SOURCE_DISAGREEMENT / UNVERIFIED / ANALYSIS_FORECAST / CONTEXT / REJECTED
- evidence 연결·숫자/날짜/기관 불일치·과도 단정·유도 질문 검사 후 fail-closed
- `buildDailyIssueCandidate` — 수집기 입력 인터페이스
- 품질 게이트 v2: evidence·CONFIRMED_FACT 필수 · 정적 풀은 실출처/evidence 부족으로 전부 QUARANTINED
- UI: 확인된 내용·각 측 설명·불일치·미확인·분석·배경 분리 · REJECTED 미노출
- 답변 선택·열람/체류 성향·가입 설문 미복원 · 댓글 좋아요/싫어요 LEGACY_LOCAL 유지
- 테스트: `npm run test:daily-issue-claim` · `npm run test:daily-issue`

### ★ 2026-08-05 — 데일리 댓글·대댓글 반응 LEGACY_LOCAL 성향 연결

- 사용자 댓글·대댓글 좋아요/싫어요만 일반 게시판과 동일하게 `applyReactionScoresWithMult` 적용
- 전환(좋아요↔싫어요)은 기존 점수 취소 후 신규 적용
- empathy·열람·체류·답변 선택·댓글 작성 자체는 성향 미반영 유지
- 외계 actor/author·영토 미확인 시 UID 저장은 유지하고 성향만 스킵
- `shared/daily-issue-reaction-align-core.js` + 실행형 테스트 보강
- 서버 05:00/17:00 배치·품질 게이트·출처 데이터·가입 설문 미변경

### ★ 2026-08-04 — 데일리 이슈: 성향 선택형 → 출처 기반 자유 토론

- 데일리 이슈 답변 선택 UI, 선택 안내, 선택 기반 댓글/반응 잠금 제거
- 댓글/대댓글/반응에서 `getDailyIssueStance` 선행 요구 제거
- 데일리 이슈 선택/열람/체류/본문 클릭 기반 `tryApplyContentGravityDelta` 경로 제거
- `sourceRefs` 표준화 및 `publicationStatus`, `qualityGateVersion`, `qualityCheckedAt`, `qualityFailureReasons` 추가
- 독립 출처 계산(`originDomain`/`primarySourceUrl`/`publisher`) 및 품질 게이트(`READY/PUBLISHED/QUARANTINED`) 적용
- 중립 문구 정적 검사(유도·선동 표현) 추가, 검증 오류 포함 fail-closed 처리
- 카테고리 통과 이슈가 없으면 fallback 게시 대신 "현재 게시 기준을 충족한 이슈를 준비 중입니다." 표시
- 신규 집중 테스트 추가: `tools/test-daily-issue-system.js`

### ★ 2026-08-02 — 일일 작업 묶음 (Hover · 전황 · 글쓰기 · 외계 권한)

1. 영토 Hover 작전 HUD 병렬 reveal
2. 중앙·외계 진영 전황 Mock UI (목록 막대 · 레이어 깃발 · BALANCED 상세 깃발 없음)
3. 글 성격 카드 + `factionBattleEnabled` 진영 토론 모드
4. 제한형 리치 본문 에디터 · 모달 확대 · sanitize · `bodyFormat`
5. 외계 글쓰기 정책 조사 후 submit 파티션·상태 재검사 보강 (정책 미변경)

### ★ 2026-08-02 — 외계 게시글 submit 파티션 권한 재검사

- 외계 게시글 submit·모달 진입에서 `getAlienWriteButtonState` / `resolveWriteButtonState` 동일 규칙 재검사
- 출신 불일치·RETURNED·SUSPENDED·명예의 전당·비추방(BOARD_LOCKED) 등록 우회 차단
- 권한 실패 시 tryWriteActivity·localStorage·XP·피드보다 먼저 return (부수 효과 없음)
- 글쓰기 정책(활성 추방·자유광장·출신 구역) 자체는 미변경 · 실 API/DB 보류

### ★ 2026-08-02 — 새 글 작성 제한형 리치 텍스트 에디터

- 새 글 모달 본문: textarea → 제한형 리치 에디터 (`BoardRichEditor` + `BoardRichContentCore`)
- 본문 작성 영역 확대 · 모달 폭 ~820px · 상단 글 성격 카드 3열 압축
- 기본 서식: 본문/소제목·굵게·기울임·밑줄·취소선·인용·목록·링크·구분선·실행취소/다시실행
- 저장: `body` + `bodyFormat`(`plain`|`rich`) · sanitize 후 Mock/localStorage 저장 · 실 DB migration 보류
- 상세 본문 안전 렌더링 · 목록/검색 plain text excerpt(HTML 태그 미노출)
- 사진은 기존 별도 첨부(최대 4장) 유지 · 글 성격·진영 토론·전황 로직 미변경

### ★ 2026-08-02 — 글 성격 카드 · 진영 토론 모드

- 새 글 모달: select → 자유토론/유머·일상/정보·분석 선택 카드 (`debate`/`light`/`info` key 유지)
- `factionBattleEnabled` 토글 추가 · 유머·일상(및 외계 meme)에서는 강제 OFF
- 전황 목록 막대·상세 깃발은 중앙/외계 + `factionBattleEnabled===true` 일 때만 표시
- 기존 글·Mock은 false · 점수 판정·깃발 연출 로직 미변경 · 실 DB migration 보류

### ★ 2026-08-02 — BALANCED 상세 깃발 표시 제거

- DOMINANT/LEADING 단독 깃발만 상세 표시 · BALANCED/INSUFFICIENT는 깃발 없음
- BALANCED 상태 판정·목록 세력 막대·단독 연출·점수 계산 유지

### ★ 2026-08-02 — 박빙 3깃발 slot 분리 배치

- BALANCED에서 공용 66% 겹침 제거 → `.sc-balanced-faction-slot--{pioneer,central,guardian}` 독립 X 좌표
- 레이어 PNG·단독 우세 연출·전황 계산 미변경

### ★ 2026-08-02 — 전황 상세 깃발 레이어 PNG 연출 적용

- `faction-flag-animation-assets` 레이어(pole/cloth/tassel/base/impact-remain)를 `public/assets/faction-flags/layers`에 배치
- 상세 DOMINANT/LEADING/BALANCED 임시 CSS 깃발 → 레이어 낙하·착지·slice wave로 교체
- 전황 계산·목록 막대·적용 범위·댓글 입력란 위치 미변경 · 원본 작업 폴더 유지

### ★ 2026-08-02 — 중앙광장·외계행성 진영 전황 UI (Mock)

- 중앙광장·외계행성 게시글 목록 오른쪽에 진영 세력 막대 (숫자/퍼센트 상시 미표시)
- 개척·수호 게시판에는 전황 UI 미적용
- 상세 상단 우세 깃발 낙하·착지·wave · 균형 시 소형 깃발 3개 · 반응 부족 시 깃발 미표시
- 댓글 입력란을 본문·반응 버튼 바로 아래로 이동
- deterministic Mock · reduced-motion 대응 · `__scInspectFactionBattleUi`
- 실 DB/API·alignment·moderation 미연결

### ★ 2026-08-02 — 영토 Hover 병렬 reveal ~2초 조정

- hoverDelay 150ms · textReveal 1650ms · progress 650ms@0.48 · image fade 550ms@0.63
- 전체 연출 목표 ~2000ms · linear shared progress 유지 · 순차 행 복원 없음

### ★ 2026-08-02 — 영토 Hover 정보 행 병렬 reveal

- 줄 단위 순차 등장 → 4개 정보 행 동시 시작 · 공통 horizontal typing progress
- hover delay 180→110ms · text ~260ms · progress/image 조기 등장 · 전체 ~450~600ms
- cancelReveal / revealToken · rAF 1개 유지 · rapid territory switch 즉시 취소

### ★ 2026-08-02 — 영토 Hover HUD 이미지 column 가로 확대

- HUD 폭 ~495px (480~505) · text column ~150px 고정 · image column ≥320px
- 실제 이미지 `height:100%; width:auto; contain` · edge fade 축소 · boundary correction 재사용

### ★ 2026-08-02 — 영토 Hover HUD 내부 레이아웃 미세 조정

- text column 축소 · image column 확대 (`0.72fr / 1.18fr`) · label/value gap·padding 축소
- 이미지 full-height · contain 유지 · edge fade 축소 · 「다음까지」 축약

### ★ 2026-08-02 — 영토 Hover HUD 이미지 contain · 클릭 안내 제거

- 현재 단계 이미지 `object-fit: cover` → **contain** · 강한 mask crop 제거 · 가장자리 fade overlay만
- 이미지 영역 비중 확대(약 52/48) · 「클릭하여 상세 보기」 DOM/CSS/reveal 제거 · path click 유지

### ★ 2026-08-02 — 영토 Hover 작전 정보 HUD

- 대형 카드·전/현재/다음 3장 비교 Hover 제거 → `.territory-operation-hud` 투영형 HUD
- Hover 핵심만: 영토명·인원·현재 단계·다음 필요·진행률·현재 이미지 1장·클릭 안내
- 이미지 mask/fade · 순차 reveal(~850ms) · debounce 180ms · sound hook(asset 없음)
- `buildDetailStageCompare`로 전·현재·다음 비교 계약 보존 · 계산·22장·hit zone 미변경

### ★ 2026-08-02 — 최근 세계 활동 영토맵 전용 표시

- **좌표 에디터·스킨 스위치** 기본 숨김 (`__scShowProfileLayoutEditor()`로만 표시)
- `#screen-main` 활성일 때만 표시 · 게시판/상세/가이드/히스토리에서 `is-view-hidden`+`hidden`
- 좌표 에디터 ON 시에도 활동 패널 숨김 · 종료 후 영토맵이면 재표시
- `notifyAppViewChanged`를 `__scApp`·게시글 상세 전환에 연결 · DOM/데이터/scroll/접기 유지
- inspect `visibility` 필드 추가 · 폭 230·top offset 4·LIVE_SCROLL·저장30 미변경

### ★ 2026-08-02 — 최근 세계 활동 패널 폭 · 문구 밀도

- preferred width **270 → 230px** (min 210) · stack CSS `14.375rem` · 저장 width도 map gap에 맞게 clamp
- 활동 문구 font `0.7rem → 0.64rem` · 최대 2줄 clamp · 시간은 `0.6rem` 한 줄 유지
- 아이콘 고정폭 · 행 min-height `3.05rem` · 패널 높이 16.5rem·LIVE_SCROLL·top 미변경

### ★ 2026-07-31 — 최근 세계 활동 패널 좌표 에디터 드래그 · 자동 저장

- 좌표 에디터 ON 시「최근 세계 활동」패널 드래그 이동
- `sc_world_activity_panel_pos_v1` localStorage **자동 저장** (별도 저장 버튼 없음)
- 저장된 left/top/width 우선 적용 · 초기화 시 활동 위치도 리셋
- 자동 top 보정에 의존하지 않고 사용자가 직접 배치

### ★ 2026-07-31 — 최근 세계 활동 패널 세로 위치 map 상단 정렬

- `ACTIVITY_TOP_OFFSET` 110 → **4** (`activityTop ≈ mapTop + 4px`)
- 충돌은 실제 `rectsOverlap`일 때만 최소(+8px) 보정 · 에디터/영토 버튼 존재만으로 top 내리지 않음
- navigation 아래 유지 · 가로 위치·gap 16·LIVE_SCROLL·저장30 미변경

### ★ 2026-07-31 — 세계 활동 LIVE_SCROLL · 지도 비침범 · 상단 이동 · pagination 제거

- 침범 원인: `.sc-left-side-stack` 로컬 `--sc-left-rail-max:16.5rem`이 JS root 변수를 가려 폭이 항상 넓게 유지됨
- 수정: map frame rect 기준 `stack.style.left/width/top` 직접 동기화 · gap 16px · `activityRect.right <= mapLeft - gap`
- bottom 고정 제거 → `map.top + ~110px` top 배치 · 프로필/좌표 에디터 충돌 회피
- pagination 완전 제거 · 최신 unshift LIVE_SCROLL · 목록 `overflow-y:auto` + scroll 보존(맨 위면 top 유지, 과거 열람 중이면 강제 top 금지)
- 패널 고정 높이 ~16.5rem · 저장30·dedupe30초·접기·채팅 독립 유지
- inspect: `LIVE_SCROLL` · `pagination.enabled:false` · layout gap/overlaps

### ★ 2026-07-31 — 최근 세계 활동 왼쪽 독립 rail · 지도 비침범 · 채팅 높이 복원

- 활동 패널: 오른쪽 stack 분리 → `#sc-left-side-stack` (이후 LIVE_SCROLL·위치 재조정)

### ★ 2026-07-31 — 프로필 바깥 클릭 즉시 닫기 · 최근 세계 활동 우측 재배치

- 프로필 닫기 이원화: 수동 접기 `animate:true` / 바깥 `pointerdown` `animate:false`
- (이후 활동 패널은 왼쪽 rail로 재이동)

### ★ 2026-07-31 — 프로필 바깥 클릭 자동 접기

- `#avatar-dock` 열린 상태에서 바깥 `pointerdown` → `collapseProfilePanel()` (이후 즉시 닫기로 강화)
- 내부·관련 surface 예외: `data-sc-profile-interaction-surface` (대표 업적 모달·활동 목록·팔로우·일반 프로필 모달·좌표 에디터 등)
- 열기 탭·dock 자체 surface로 즉시 재접힘 방지 · 좌표 에디터 활성 시 자동 접기 비활성
- `preventDefault`/`stopPropagation` 없음 · listener 1회 등록 · `__scInspectProfileOutsideCollapse`
- `npm run test:profile-outside-collapse` · PNG·좌표·실데이터 미변경

### ★ 2026-07-31 — 대표 업적 모달 선택 흐름 개편 (상단 미리보기 · 하단 체크 · 확정 저장)

- 상단: 선택 가능 목록 제거 → 임시 선택 최대 3슬롯 미리보기(체크박스 없음 · 빈 슬롯「선택 대기」)
- 하단 획득 기록: 행 체크박스가 유일한 선택 컨트롤 · 분류 탭·pageSize 5·pagination 유지
- `featuredDraftKeys` 임시 상태 · category/page 전환 시 선택 유지 · **선택 완료**에서만 `setFeaturedAchievementIds`
- 닫기 시 저장 없음 · 업적 정의·실데이터·PNG·좌표 미변경
- `inspectFeaturedAchievementModal` · `npm run test:featured-achievement-modal` 갱신

### ★ 2026-07-31 — 대표 업적 선택 카드 3열 정렬 수정 (체크박스 우측 고정)

- 원인: 모달 아이콘에 `sc-profile-achievement` 재사용 → 프로필용 `position:absolute`가 1열을 붕괴·아이콘/제목 겹침
- `grid-template-columns: 3.25rem minmax(0, 1fr) 2.75rem` · selection `justify-self:end` · padding 우측 축소
- 아이콘에서 프로필 클래스 제거 · 획득 기록 탭/pagination·선택 로직·실데이터 미변경

### ★ 2026-07-31 — 대표 업적 선택 모달 카드 겹침 수정 · 획득 기록 분류/페이지 (UI만 · 실데이터 미변경)

- `public/index.html`
  - 선택 카드 `icon | content | selection` 3열 grid · 체크박스 absolute 겹침 제거
  - 업적명 최대 2줄(`-webkit-line-clamp: 2`) · 날짜는 제목 아래
  - 획득 기록 내부 `max-height`/`overflow` 스크롤 제거
  - 모달 본문(`__body`) 단일 scroll fallback · footer 고정
- `public/user-achievements.js`
  - 카드 DOM: icon → meta(title/date) → checkbox · label 전체 선택 · checkbox `stopPropagation`
  - 획득 기록: 실제 `ACHIEVEMENT_CATEGORIES` 기반 분류 탭(전체 우선 · 빈 분류 숨김 · 미분류)
  - pagination pageSize 5 · 탭 변경 시 page=1 · 선택 상태와 독립
  - 정렬 유지: acquiredAt desc → acquisitionSequence
  - `inspectFeaturedAchievementModal` / `__scInspectFeaturedAchievementModal`
- `tools/test-featured-achievement-modal-ui.js` · `npm run test:featured-achievement-modal`
- 선택 로직(최대 3)·업적 key·acquiredAt·acquisitionSequence·정의·PNG·좌표·DB 변경 없음

### ★ 2026-07-31 — 프로필 대표 업적 표시 개선 · 작성글/댓글 활동 목록 (코드만 · DB/API 미연결)

- `public/index.html`
  - 대표 업적 제목 최대 2줄(`-webkit-line-clamp: 2`) · 카드 제목 영역 높이 통일
  - 획득 날짜 글자 약 20% 확대(10px→12px scale) · 날짜 칸 세로 중앙 (캘린더 아이콘은 PNG 고정)
  - 활동 요약 작성 글·댓글 행 클릭/키보드 접근 → 활동 목록 모달
  - `#sc-user-content-modal` · `data-comment-id` · 원문 이동 adapter
- `shared/user-content-list-core.js` — POSTS/COMMENTS contract·sanitize·공개 필터
- `server/user-content-service.js` · memory/supabase repo · routes(운영 503)
- `public/user-content-*.js` — client/adapter/modal/inspect
- `tools/test-user-content-system.js` · `npm run test:user-content`
- 실제 DB·migration·운영 API·프로필 PNG·업적 데이터·좌표 대규모 변경 없음

### ★ 2026-07-31 — 외계행성 좌우 split UI 다듬기 (레이아웃·pagination · 데이터 구조 변경 없음)

- `public/index.html` — 외계 메인 UI만 조정 (관측·출신 권한·board 데이터 구조 유지)
  - 좌우 폭 `52fr : 48fr`로 재조정 (기존 `1.65fr : 1fr` ≈ 62:38 제거)
  - 목록 내부 `overflow-y`/`max-height` 스크롤 상자 제거 → 브라우저 document scroll만 사용
  - 좌·우 독립 pagination (기존 `paginatePostList`/`renderBoardPagination` 재사용)
    - 왼쪽 pageSize 6 · 오른쪽 pageSize 7
    - 탭/페이지 변경 시 반대쪽 상태 유지 · 탭 변경 시 해당 쪽 page만 1로 초기화
  - 오른쪽 커뮤니티 탭 PC 한 줄 4탭: 자유광장 / 개척 구역 / 수호 구역 / 명예의 전당
  - 글쓰기 버튼을 오른쪽 패널 헤더(제목 우측)로 정렬 · 권한별 표시만 조정
  - 목록 제목 ellipsis · 메타 한 줄 · 헤더/탭/버튼 겹침 방지
- `public/alien-observation-data-adapter.js` — `normalizePage`/`paginateAlienList`/`buildAlienPaginationState`/`resolveWriteButtonState`
- `public/alien-system-inspect.js` — layout·pagination·writeButton·overlapCheck 검사 필드 확장
- `tools/test-alien-system.js` — split UI·paging·글쓰기 노출 테스트 추가
- 실제 DB·migration·운영 API·관측/권한 core·지도·PNG 변경 없음

### ★ 2026-07-30 — 외계행성 메인 좌우 분할·출신 성향 파티션 (코드만 · 운영 미연결)

- `public/index.html` — 외계 메인을 좌우 split로 재구성
  - 좌: 지구 관측 구역(인기 관측글/중앙광장 관측/영토 관측)
  - 우: 외계 커뮤니티 구역(자유광장/개척 외계구역/수호 외계구역/명예의 전당)
  - 기본 활성: 좌 `인기 관측글`, 우 `외계 자유광장`
  - 읽기 전용 파티션 안내 문구 + 구역별 글쓰기 버튼 제어
- `shared/alien-origin-core.js` — `alienOriginTerritory` snapshot contract·권한 계산·partition 매핑
- `shared/alien-access-core.js` — alien context에 origin/partition permissions 포함
- `server/alien-user-context-adapter.js` — moderation state의 origin 값을 access context로 전달
- `server/board-service.js` — ALIEN category(`ALIEN_FREE_PLAZA`/`ALIEN_PIONEER_ZONE`/`ALIEN_GUARDIAN_ZONE`)별
  read/write/comment/react 권한 차단 (서버 강제)
- `shared/alien-observation-core.js` — POPULAR type + observation thread 참조 contract 추가
- `public/alien-observation-data-adapter.js` — split layout/access/state view-model 확장
- `public/alien-system-inspect.js` — split/partition/origin/permissions/observation 참조 검사 확장
- `supabase/migration_alien_system.sql` 초안 확장
  - `user_moderation_state`: `alien_origin_territory`, `origin_captured_at`, `origin_source`
  - `alien_observation_threads`: source post 참조형(`UNIQUE(source_post_id, observation_type)`)
  - category key 주석을 ALIEN 3 파티션 기준으로 명시
- `tools/test-alien-system.js` — origin 정규화·출신별 파티션 권한·상대 구역 write 차단 테스트 보강
- 실제 migration apply, 실사용자 origin migration, 운영 API 활성화, scheduler 연결은 미실행

### ★ 2026-07-30 — 사용자 이벤트 파이프라인 운영 기반 (코드만 · DB/실이벤트 미적용)

**domain event contract**
- `shared/user-domain-event-core.js` — eventType·dedupeKey·UUID 검증·민감 payload 제거
- `shared/user-event-policy-core.js` — progression/achievement/notification/activity 정책 테이블

**명성등급·시민등급 분리**
- `shared/user-rank-core.js` — reputation grade(참여자~지도자) vs citizen rank 별도 필드
- `shared/citizen-rank-evaluation-core.js` — `CITIZEN_RANK_POLICY_NOT_FINALIZED` placeholder

**progression plan**
- `shared/user-progression-event-core.js` — 확정 XP만(post 25·comment 12) · reputation 감점 금지
- Lv6~10 임계값·empathy→명성 수치 미확정 시 `NO_POLICY`

**업적**
- `shared/achievement-definitions-core.js` — `public/achievement-definitions.js` Node SSOT
- `shared/achievement-evaluation-core.js` — 조건 판정 engine (plan only)
- `territory-citizen` 레벨 5 1회 · acquisitionSequence 계획

**알림·활동 피드 분리**
- `shared/user-notification-core.js` — 중요 알림 plan·priority(CRITICAL/IMPORTANT/NORMAL)
- `shared/user-activity-core.js` — 활동 plan·legacy type map·30/8 limit

**orchestrator · repository**
- `server/user-event-orchestrator.js` — dry-run 파이프라인 (derived depth≤3)
- `server/user-event-memory-repository.js` · `user-event-supabase-repository.js`(stub)
- `server/user-event-service.js` — `LEGACY_LOCAL`/`API_DRY_RUN` 기본 · `API_OPERATIONAL` 비활성

**SQL 초안 (미적용)**
- `supabase/migration_user_event_pipeline.sql` — `user_domain_event_log` · `persist_user_event_plan` RPC

**시스템 adapter (plan only · 미연결)**
- `server/board-user-event-adapter.js` — POST/COMMENT/EMPATHY/FOLLOW (LIKE→명성 변환 없음)
- `server/alignment-user-event-adapter.js` — TERRITORY_CHANGED만
- `server/alien-user-event-adapter.js` · `territory-evolution-user-event-adapter.js`

**클라이언트**
- `public/user-event-data-adapter.js` — legacy notification/activity ↔ contract
- `public/user-event-system-inspect.js` — `__scInspectUserEventSystem()`
- `shared/user-cache-invalidation-core.js` — 캐시 무효화 interface

**미적용**
- migration apply · 실 XP/명성/시민등급/업적/알림/활동 write 없음
- alignment batch·게시판·외계·영토발전 실연결 없음 · localStorage UI 흐름 유지

**테스트**
- `npm run test:user-event` — 86 단위 + alien/tevo/profile/user-data/board/alignment 회귀 (93 PASS)

---

### ★ 2026-07-30 — 외계행성 시스템 운영 기반 (코드만 · DB/자동판정 미적용)

**외계 상태·복귀 페널티 core**
- `shared/alien-moderation-core.js` — EARTH/ALIEN_ACTIVE/RETURN_ELIGIBLE 등 상태 계약
- 복귀 페널티: 1차 7일 · 2차 15일 · 3차 30일 · 4차+ 시즌 종료(`seasonEndAt` 없으면 available:false)
- alignment 점수와 moderation 상태 필드 분리

**SQL 초안 (미적용)**
- `supabase/migration_alien_system.sql`
- `user_moderation_state` · `user_moderation_events` · `moderation_signals`
- `board_comments.audience_scope` (EARTH/ALIEN) 확장
- `alien_weekly_legends` 이력 테이블
- RPC: `persist_alien_transfer_plan` / `persist_alien_return_plan` / `mark_alien_return_eligible` (service_role 전용)
- 자동 threshold·신고 수 단독 transfer 없음

**접근 context · 관측 · 자유광장**
- `shared/alien-access-core.js` · `server/alien-user-context-adapter.js`
- 외계 사용자 중앙광장 직접 접근 차단 구조 · 관측 전용 접근
- `shared/alien-observation-core.js` — CENTRAL/TERRITORY 관측 · EARTH_ONLY/ALIEN_ONLY/ALL · preview 5(provisional)
- 지구·외계 댓글/반응 분리 (board `audience_scope` 재사용 · 클라이언트 scope 무시)
- 외계 자유광장: `territory=ALIEN` + `ALIEN_FREE_PLAZA` (별도 posts 테이블 없음)

**repository / service / routes**
- moderation · observation · rank memory/supabase-stub · service · routes
- 기본 `LEGACY_LOCAL` · `ALIEN_SYSTEM_OPERATIONAL`/`API_OPERATIONAL` 비활성
- 실제 이동·persist·자동 판정·scheduler 미실행

**랭크·주간 인기인**
- `shared/alien-rank-core.js` — 견습/선임/수석/최고 정의만 (점수식·임계값 미구현)
- 주간 인기인 persistence contract · 업적 연결 interface만

**클라이언트**
- `alien-observation-data-adapter.js` · `alien-observation-api-client.js`
- `__scInspectAlienSystem()` (`alien-system-inspect.js`)
- 레거시 변환: `shared/alien-legacy-map.js` (UI 대규모 key 치환 없음)

**미적용**
- migration apply · 실 사용자 외계 이동 · 자동 moderation · 운영 API 활성화 · 지도/프로필 PNG 변경 없음

**테스트**
- `npm run test:alien-system` — 단위 + territory-evolution/board/user-profile/user-data(alignment 1회) 회귀

---

### ★ 2026-07-30 — 영토 발전 ↔ 실제 사용자 데이터 연결 준비 (코드만)

**단일 evolution contract**
- `shared/territory-evolution-core.js` — 임계값·단계 label·이미지 경로·상태 VM 단일 원천
- CENTRAL 집계 = **직접 소속만** (`CENTRAL_AGGREGATION_MODE=DIRECT_ONLY`, 개척·수호 30% 합산 제거)
- ALIEN 지구 집계 제외 · 인원 감소 시 단계 하락 · highestStage 없음

**adapter · repository · service**
- `server/territory-population-adapter.js` — 클라이언트 population 무시
- memory / supabase-stub repository (실 count·실 DB 미실행)
- `server/territory-evolution-service.js` — evolution 조립 · snapshot plan만 (저장 보류)
- `supabase/migration_territory_evolution_system.sql` 초안 (미적용) · RLS SELECT 공개 · 쓰기 service_role

**클라이언트**
- `territory-evolution-data-adapter.js` · `territory-evolution-api-client.js` (캐시 TTL 30s)
- hover는 core contract 경유 · PNG·패널 위치·지도 **미변경**
- `__scInspectTerritoryEvolutionData()`

**미활성**
- `TERRITORY_EVOLUTION_OPERATIONAL` / API_OPERATIONAL 미활성 · 실제 count·snapshot 저장 없음

**테스트**
- `npm run test:territory-evolution` — 단위 + user-profile unit + user-data 회귀

---

### ★ 2026-07-30 — 프로필 UI ↔ 실제 사용자 데이터 연결 준비 (코드만)

**단일 public profile contract**
- `shared/public-profile-core.js` — dataStatus·accountState·공개/본인 mapper·XP progress·대표 업적·익명 게이트·상태별 view model
- public/self 분리 (`mapPublicUserProfile` / `mapSelfUserProfile` · sanitize)
- 비공개 필드(email·auth·moderation·내부 alignment·알림·북마크) 공개 응답에서 제거

**assembler · adapter**
- `server/user-profile-assembler.js` — profile+progression+featured+follow+territory+alignmentMap 결합
- `server/user-profile-territory-adapter.js` — 클라이언트 영토 미신뢰 · OPERATIONAL/LEGACY/MOCK/UNAVAILABLE
- `server/user-profile-alignment-map-adapter.js` — 내부 원점수 미노출 · available:false 기본

**클라이언트**
- `public/user-profile-data-adapter.js` — API → mini/modal · legacy → contract
- `public/user-profile-api-client.js` — LEGACY_LOCAL/DRY_RUN/OPERATIONAL · 메모리 캐시(TTL 30s) · `__scInspectUserProfileData`
- `wireScUserProfileLink` / `openUserProfile`에 익명·블라인드 게이트 연결
- 기존 ProfileFrame PNG·좌표·레이아웃 **미변경**

**API**
- `GET /api/users/me/profile/full` · `GET /api/users/:userId/profile/public` (운영 비활성 시 503)
- USER_DATA_OPERATIONAL · API_OPERATIONAL **미활성** · migration 미적용 · 실데이터 미변경

**테스트**
- `npm run test:user-profile` — 단위 76항 + user-data 회귀(80/80, board/alignment 포함)

---

### ★ 2026-07-29 — 사용자 데이터 필수 보완 (레벨 1~10 · RPC 권한 분리 · 테스트 80/80)

**레벨 범위 1~10**
- `USER_LEVEL_MIN=1` · `USER_LEVEL_MAX=10` · `LEVEL_RANGE` 단일 원천 (`user-data-config-core.js`)
- SQL CHECK `level BETWEEN 1 AND 10` · schema `validateLevel` · mapper `normalizeLevel`
- XP 자동 레벨 계산은 기존 Lv1~5 임계값만 유지 (`autoLevelCap: 5`) — Lv6~10 XP 임계값 TODO
- `player-progression.js` UI 로직 미변경

**RPC 권한 분리**
- **authenticated JWT**: `toggle_user_follow` · `set_featured_achievements` · `mark_user_notification_read` · `create_user_bookmark` · `remove_user_bookmark` — `auth.uid()` 소유권 검증
- **service_role 전용**: `apply_user_progression_event` · `grant_user_achievement` — PUBLIC/anon/authenticated REVOKE
- SQL GRANT/REVOKE · SECURITY DEFINER `SET search_path = public`

**repository·service**
- `setUserClient` / `setAdminClient` 분리 · 사용자 route는 mutationUserRepo 경유
- profile patch 시 level/xp/reputation 직접 변경 거부 · 알림 생성 공개 route 403

**테스트**
- `tools/test-user-data-system.js` 80항 · `execFileSync` + 회귀별 timeout
- `npm run test:user-data` 80/80 PASS · exit 0 · board/alignment 회귀 포함

**미적용 (유지)**
- migration 실제 적용 없음 · USER_DATA_OPERATIONAL 비활성 · 실제 사용자 데이터 미변경

---

### ★ 2026-07-29 — 실제 사용자 데이터 연결 구조·Supabase 운영 전환 준비 (코드·SQL만)

**운영 사용자 ID 통일**
- 운영 사용자 ID를 Supabase Auth `auth.user.id` UUID 하나로 통일
- guest/guest_demo/email/임시 ID를 운영 저장에서 차단 (`user-data-config-core.js`)
- 게스트 데이터와 로그인 사용자 데이터 완전 분리 · 자동 병합 없음

**기존 사용자 데이터 구조 조사**
- 인증: `sc_sb_auth_session` sessionStorage — Supabase Auth 연결 (server.js 기존 구현)
- 프로필: `public.profiles` (Supabase, 기존 schema 존재) — display_name·avatar_url·bio·home_country·citizenship_status
- 경험치·레벨·명성: `sc_player_progression_v1` localStorage 완전 클라이언트 기반
- 팔로우: `sc_follow_v1` / `sc_follow_notify_v1` / `sc_follow_notify_prefs_v1` localStorage
- 알림: `sc_notifications_v1` localStorage (최대 50개, 45초 dedupe)
- 활동 피드: `sc_activity_feed_v1` localStorage
- 북마크: `sc_bookmarks_v1` localStorage (userId key 기반)
- 업적: 런타임 Mock (`UserAchievements`) — localStorage 미사용
- 신고: `sc_reports_v1` localStorage — board_reports 설계와 분리 유지
- 표시 이름: `sc_display_names_v1` localStorage 캐시
- 프로필 사진: `sc_profile_photo_v1:{uid}` localStorage (base64)

**신규 공용 모듈**
- `shared/user-data-config-core.js` — UUID 규칙·게스트 ID 규칙·localStorage key 목록·데이터 전환 모드·진행 이벤트 타입·알림 규칙·한도
- `shared/user-data-schema-core.js` — userId/프로필/진행상태/팔로우/업적/알림/활동/북마크 검증 · 공개 프로필 필터 (`filterPublicProfile`)

**Supabase SQL 마이그레이션 (파일만, 미적용)**
- `supabase/migration_user_data_system.sql`: user_progression · user_progression_events · user_follows · user_achievements · user_featured_achievements · user_notifications · user_activity_events · user_bookmarks
- RLS 정책: 진행상태·업적·알림·활동은 서버 전용 쓰기 · 팔로우·북마크는 본인 관리
- RPC: apply_user_progression_event(dedup) · toggle_user_follow(원자 count 갱신) · grant_user_achievement · set_featured_achievements(보유 검증) · mark_user_notification_read · create/remove_user_bookmark
- citizen_rank 컬럼: 명성등급·시민등급 확정 전 null 허용 (TODO 유지)
- user_bookmarks post_id FK: board_posts migration 적용 후 후속 migration에서 추가

**서버 모듈**
- `server/user-data-memory-repository.js` — 인메모리 repository (API_DRY_RUN·테스트 전용)
- `server/user-data-supabase-repository.js` — Supabase repository (API_OPERATIONAL 전용, service-role)
- `server/user-data-service.js` — 인증·게스트 차단·입력 검증·공개/비공개 분리·서버 계산 필드 보호·DB 오류 미노출
- `server/user-data-mapper.js` — DB row ↔ API 응답 변환 · filterPublicProfile
- `server/user-data-routes.js` — Express router · 운영 비활성 전 USER_DATA_API_NOT_ACTIVATED 반환 · 일반 사용자 XP/업적 부여 API 없음

**클라이언트 모듈**
- `public/user-data-legacy-adapter.js` — sc_player_progression_v1·sc_follow_v1·알림·활동·북마크·업적 Mock 검사 · buildLegacyUserMigrationPreview · `window.__scInspectLegacyUserData()`
- `public/user-data-api-client.js` — LEGACY_LOCAL/API_DRY_RUN/API_OPERATIONAL 모드 · 쓰기 dry-run 검증 · 실제 fetch 미호출(비활성)

**server.js 변경**
- user-data-routes mount (운영 비활성 상태) — `USER_DATA_OPERATIONAL` 환경변수로 추후 활성화

**index.html 변경**
- user-data-config-core.js · user-data-schema-core.js · user-data-legacy-adapter.js · user-data-api-client.js 스크립트 로드 추가

**테스트**
- `tools/test-user-data-system.js` 신규 70항 · `npm run test:user-data`
- board-core 49/49 · alignment 88/88 회귀 유지
- **USER_DATA_API_OPERATIONAL 미활성** · 실제 DB·사용자 데이터 이전 없음 · localStorage 원본 미변경

### ★ 2026-07-29 — 게시판 구조 충돌 정리·API 전환 준비 (코드만)

- 게시판 댓글 최대 길이 **1500자** 공용 통일 (`shared/board-config-core.js`)
- `app-config` 140자는 **데모 짧은 입력**(`demoShortInputMaxChars`)으로 분리 — 게시판과 무관
- `empathy`를 alignment 4종 반응과 분리 · `planetVoters`는 DEFERRED/LEGACY로 운영 API 제외
- 레거시 영토 ID 단일 변환 모듈 (`normalizeBoardTerritory` 등)
- `public/board-legacy-adapter.js` — localStorage ↔ API draft/view 변환 · `__scInspectLegacyBoardCompatibility()`
- 데이터 모드: `LEGACY_LOCAL`(기본) / `API_DRY_RUN` / `API_OPERATIONAL`(미활성)
- `public/board-api-client.js` — 검증·dry-run·레거시 반응 차단 보강
- SQL `board_comments_content_max_len` CHECK 1500 추가 (migration 파일만, **미적용**)
- `npm run test:board-compat` 38항 + board-core 49/49 + alignment 88/88 회귀
- **BOARD_OPERATIONAL / API_OPERATIONAL 미활성** · 실제 DB·localStorage 이전 없음

### ★ 2026-07-29 — 게시판 코어 운영 스키마·서버 API (코드·SQL만)

- `supabase/migration_board_core_system.sql` · board_posts / board_comments / board_reactions / board_reports
- 반응 4종(LIKE/RECOMMEND/DISLIKE/DOWNVOTE) · 계열별 활성 1개 · 취소·교체 RPC `toggle_board_reaction`
- 긍정·부정 동시 보유 허용 · EARTH/ALIEN 집계 분리 · 반응 당시 양쪽 영토 snapshot
- 익명 author_user_id DB 저장 · public View/서버 mapper로 일반 노출 차단
- 소프트 삭제(DELETED) · 삭제/블라인드 대상 신규 반응·댓글 금지
- 신고 저장·중복 방지 · 자동 블라인드/moderation 미구현
- `server/board-service.js` · memory/supabase repository · routes · `public/board-api-client.js`
- 기본 `BOARD_OPERATIONAL` 비활성 · 실제 DB 미적용 · UI 전면 교체 없음
- `npm run test:board-core` 48항 · alignment 회귀 88/88 유지

### ★ 2026-07-29 — alignment 저장 안정화·동시성·서버 core·live 검증

- 점수/신호 컬럼 `numeric(20,6)` · score_change 정확 등식 CHECK · RPC numeric cast
- repository numeric 문자열 정규화 · NaN/Infinity/잘못된 문자열 거부
- batch INSERT `ON CONFLICT DO NOTHING` + ROW_COUNT=0 → 중복 skipped (`committed: false`)
- history unique/check 오류는 batch 중복으로 오인하지 않음 (전체 rollback)
- `shared/alignment-territory-core.js` · `shared/alignment-batch-core.js` 분리
- public 어댑터 유지 · 기존 18/18 · 31/31 테스트 유지
- 서버 배치 서비스 vm/window/public 실행 의존 제거 · shared core 직접 require
- `tools/verify-alignment-supabase-live.js` · `ALIGNMENT_LIVE_VERIFY` / project ref 게이트
- 실제 테스트 Supabase 연결 정보 없음 → migration 실적용·RLS/RPC 실검증은 미실행

### ★ 2026-07-28 — alignment Supabase 운영 저장 시스템 (코드·SQL만)

- `supabase/migration_alignment_system.sql` · user_alignment_state / alignment_batches / alignment_history
- RLS · authenticated 자신의 상태/이력 SELECT만 · 일반 사용자 쓰기 금지
- RPC `persist_alignment_batch_plan` · 원자적 배치 저장 · 중복 batchId skipped 반환
- `server/alignment-supabase-admin.js` · service-role lazy init · 브라우저 분리
- `server/alignment-supabase-repository.js` · RPC 호출 · 응답 검증 · healthCheck
- `server/alignment-batch-service.js` · runAlignmentBatch · dry-run · dataSource/repository 주입
- `server/alignment-memory-data-source.js` · 테스트용 dataSource
- `server/alignment-batch-id.js` · createAlignmentBatchId (Asia/Seoul)
- `shared/alignment-schema-core.js` · 공용 검증/스키마 · 브라우저 어댑터 분리
- `.env.example` · SUPABASE_SERVICE_ROLE_KEY placeholder (값 미작성)
- `npm run test:alignment-supabase` · SQL/관리자/repository/배치/회귀 테스트
- 실제 DB 적용 · 스케줄 · 알림·시민등급·업적 · 공개 배치 API는 미연결

### ★ 2026-07-28 — alignment 저장소 인터페이스와 메모리 저장소 추가

- `alignment-persistence-repository.js` · 저장소 계약 · 원자적 배치 저장 실행 흐름
- `alignment-memory-repository.js` · 테스트용 메모리 저장소 · 트랜잭션 commit/rollback
- 동일 `batchId` 중복 저장 방지 · 사용자 상태/이력/배치 기록 일괄 저장
- 저장 실패 시 전체 rollback · 실패 강제 주입 옵션 · 개발용 `__sc*` 테스트 추가
- 실제 Firebase/DB/API 저장과 자동 스케줄은 미연결

### ★ 2026-07-28 — alignment 운영 저장 스키마 추가

- `alignment-storage-schema.js` · 사용자 상태/배치 이력/배치 실행 기록 스키마 정의
- 사용자 상태는 `users/{userId}.alignment` 중첩 구조로 통일
- 배치 결과를 저장용 update와 이력 레코드로 변환 · 배치 전체 persistence plan 생성
- 금지어 저장 key 재귀 검사 · 스키마 검증 함수 · 개발용 `__sc*` 테스트 추가
- 실제 DB/API/Firebase 저장과 자동 스케줄은 미연결

### ★ 2026-07-28 — 정치 성향 운영용 배치 처리 모듈 추가

- `alignment-batch-processor.js` · 사용자 단위/다중 사용자 배치 순수 처리
- DELTA_WINDOW_SCORE(99일 0.5 + 30일 0.5)와 alignment 영토 판정 모듈 연결
- `batchId` 기준 기초 중복 처리 방지 (`ALIGNMENT_BATCH_ALREADY_PROCESSED`)
- 사용자별 오류 격리 · invalid/alien/cancelled 반응 제외 통계 · `nextState` 반환
- 저장 직전 단계까지 구현 (DB/API/Firebase/스케줄/알림/시민등급/업적 미연결)

### ★ 2026-07-26 — 정치 성향 운영용 영토 판정 모듈 추가

- 기존 운영 파일명을 `alignment-territory-rules.js`로 정리 · 순수 판정 함수 분리
- 중앙 범위 -1000~+1000 · 200점 진입·이탈 경계 분리 · 2회 연속 확인
- 개척·수호 직접 이동 금지 (반드시 중앙 경유)
- `evaluateTerritoryTransition` · pending 상태 · 개발용 `__sc*` 테스트
- 점수 계산·1~5차 시뮬레이션·실제 DB/API 미연결 · UI 미변경

### ★ 2026-07-26 — 정치 성향 5차 영토 안정화 방식 비교

- `TERRITORY_STABILIZATION_COMPARISON` · 현재 방식·경계 200점 분리·2회 연속 확인 비교
- 경계 분리와 2회 연속 병합 · 400점 분리 병합 방식 비교
- `CENTRAL_1000` / `CENTRAL_800` 기준 · 동일 사용자·동일 반응·동일 점수 비교
- 진입·이탈 경계 분리(hysteresis) · 연속 배치 확인(pending) · 보류·방지 지표
- 참고용 종합 점수·PROMISING 등 분석 상태만 제공 · 운영 안정화 규칙은 아직 미적용
- `__scRunTerritoryStabilization*` · 고정 테스트 35항 · 1·2·3·4차 상태 분리 보존
- 실제 사용자·DB·API·UI 미연결

### ★ 2026-07-26 — 정치 성향 4차 영토 왕복 원인 분석

- `TERRITORY_OSCILLATION_CAUSE_ANALYSIS` · 신규 반응·취소·30일/99일 만료 원인 분리
- 왕복 경로 유형 · 경계선 민감도 · 방향 반전 분석
- 실제 행동 변화(BEHAVIOR_SHIFT)와 경계 흔들림(BOUNDARY_NOISE) 구분
- 중앙 범위별 동일 사용자·반응 왕복 비교 · UNEXPLAINED 검증
- 운영 기준·가중치·상한·안정화 규칙 미변경 · 1·2·3차 상태 분리 보존
- `__scRunTerritoryOscillationCause*` · 고정 테스트 31항 · 실제 사용자·DB·API·UI 미연결

### ★ 2026-07-26 — 정치 성향 3차 1,000명 기준값 비교 시뮬레이션

- `LARGE_SCALE_THRESHOLD_COMPARISON` 모드 · 중앙 범위 ±1000 / ±800 / ±600 / ±400 비교
- 사용자 1,000명(개척 400 · 중립 200 · 수호 400) · 전원 0점·중앙 시작
- 30일·99일 · 기본 10 seed 반복 · 동일 사용자·동일 반응 흐름으로 경계만 변경
- 적중률·중립 잔류율·오분류율·왕복률 · seed 평균·최소·최대·표준편차
- 참고용 종합 점수 순위만 제공 · 운영 기준 자동 확정 없음
- 빠른 실행(`__scRunLargeOrientationQuickComparison`) · 전체 실행 분리
- 3차 고정 테스트 18항 · 기존 1·2차 상태 미덮어씀 · 실제 사용자·DB·API·UI 미연결

### ★ 2026-07-26 — 정치 성향 2차 시뮬레이션 모드 추가

- `ZERO_START_LATENT_ORIENTATION` 모드 · 사용자 120명 모두 0점·중앙(CENTRAL) 시작
- 숨은 개척/중립/수호 행동 성향 각 40명 · `latentOrientation`은 점수에 직접 반영하지 않고 반응 데이터 생성에만 사용
- 숨은 성향별 반응 방향 확률 설정(`latentBehaviorRates`) · `__scSetLatentOrientationBehaviorRates`로 재조정 가능
- DELTA_WINDOW_SCORE·가중치 80/120·±500 상한·영토 기준 유지
- 30일·99일 분화 결과 비교 · 적중률·중앙 잔류율·반대 영토 오분류율·첫 이동 시점 보고
- 2차 고정 테스트 16항 · 1차 24항 유지 · 모드별 상태 분리 보존
- 실제 사용자·DB·API·일반 UI 미연결 · 개발용 `__scRunZeroStart*` 등

### ★ 2026-07-26 — 정치 성향 시뮬레이션 계산 방식 수정

- `baseOrientationScore`는 최초 시작점으로만 사용 · 목표 점수 접근(`target = base + combined`) 제거
- 99일/30일 결합값의 **배치 간 차이**만 점수에 가산 (`DELTA_WINDOW_SCORE`)
- 같은 반응 반복 가산 방지 · 반응 취소·기간 창 만료는 차이값으로 반영
- 결과 분포 맞추기용 인위적 반응량 조정 없음 · 고정 테스트 24항 PASS

### ★ 2026-07-26 — 정치 성향 1차 Mock 시뮬레이션

- `political-orientation-simulation.js` · 기본 성향 점수 Mock 120명(개척/중앙/수호 각 40)
- 99일 50% + 최근 30일 50% · 확정 반응 가중치 · 배치당 ±500(목표 점수 접근)
- 05:00/17:00 반복 배치 · 반응 취소 · 영토 이동 경로 기록 · 고정 테스트 14항
- 실제 사용자·DB·API 미연결 · 개발용 `__sc*`는 배포 전 제거/비활성 대상

### ★ 2026-07-26 — 업적 시스템 2차 (Mock 지급·알림·히스토리)

- CONFIRMED 업적 Mock 지급 · 중복 방지 · acquiredAt/acquisitionSequence 자동 생성
- persistenceType별 지급 규칙 · 기존 알림에 `ACHIEVEMENT_ACQUIRED` 연결
- 업적 히스토리 조회 · 대표 업적 자동 선택 금지
- CANDIDATE Mock(`dialogue-across-territories`) → `empathy-from-many` 교체
- 실제 이벤트·DB·API는 미구현

### ★ 2026-07-26 — 업적 시스템 1차 사용자 기능 (Mock)

- 사용자 업적 Mock (`user-achievements.js`) · currentAchievements / seasonHistory / featuredAchievementIds 분리
- 획득 날짜 표시 · 대표 업적 최대 3개 직접 선택 · 체크 순서대로 프로필 슬롯 표시
- 빈 슬롯 자동 채움 금지 · 기존 프로필 하드코딩 업적을 사용자 선택 데이터로 연결
- 실제 지급·DB·API·시즌 종료 배치는 미구현

### ★ 2026-07-26 — 시즌 설정 스키마 추가

- `season-config.js` · 시즌 길이 6개월 · 첫 시즌 시작일 미정 · 기본 상태 `UNSCHEDULED`
- 시즌 종료 처리는 다음 시즌 시작 배치에서 수행 예정 (`NEXT_SEASON_START_BATCH`)
- 실제 시즌 생성·계산·전환·초기화는 미구현

### ★ 2026-07-26 — SEASON_REPEATABLE 시즌 종료 정책 수정

- 시즌 종료 시 진행도뿐 아니라 현재 획득 상태도 초기화
- 이전 시즌 획득 내역은 히스토리에만 보존 · 현재 프로필·대표 업적에 비표시
- 대표로 선택된 시즌 업적은 시즌 종료 시 자동 해제 예정 · 빈 슬롯 자동 대체 금지
- 실제 시즌 종료 처리·히스토리 저장·대표 해제 로직은 미구현

### ★ 2026-07-26 — 업적 유지 유형(persistenceType) 3종 추가

- `PERMANENT_ONCE` 5 · `SEASON_REPEATABLE` 5 · `EVENT_PERMANENT` 1
- 시즌형 진행도·획득 상태는 시즌 종료 시 현재 보유에서 초기화 · 이전 시즌 내역은 히스토리만
- 조회 헬퍼·정의 검증 갱신 · 실제 시즌 초기화·반복 지급 로직은 미구현

### ★ 2026-07-26 — 베타 업적 11개 표시명·조건 메타 확정

- 표시명을 코믹한 게임 업적 톤으로 정리 · 업적 id 유지
- 일반·청동·황금·수정 희귀도 유지 · LEGENDARY 0
- 9개 CONFIRMED 조건 확정 · `dialogue-across-territories` CANDIDATE · `witness-of-an-era` BLOCKED
- 실제 지급·저장·API 미구현

### ★ 2026-07-26 — `first-step` 업적 정의 제거

- 가입 즉시 자동 생성되는 상태는 업적으로 취급하지 않기로 결정
- `first-step / 첫 발을 내딛다` 정의 삭제 · 베타 초기 정의 12→11개
- 프로필 대표 업적 Mock에는 영향 없음

### ★ 2026-07-26 — 베타 초기 업적 정의 데이터 12개

- `achievement-definitions.js` — 카테고리 6종 · 정의 12개 · 조회/검증 함수
- 희귀도 COMMON~LEGENDARY 기존 구조 재사용 · LEGENDARY 초기 미사용
- CONFIRMED `territory-citizen` · CANDIDATE 10 · BLOCKED `witness-of-an-era`
- 프로필 Mock 대표 3칸 → 정의 id 참조 (청동·황금·수정 테두리)
- 실제 지급·저장·API·알림 미구현

### ★ 2026-07-26 — 업적 희귀도 테두리 흰색 투명화 · 업적명/날짜 확대

- rarity-frames 5종 근백색 배경·중앙홀 → 실제 알파 투명 (24bpp→RGBA)
- 업적명 6→13px · 날짜 5→10px (`--profile-frame-scale` 유지)
- 날짜 박스 높이 12→20px (잘림 방지 · 아이콘 좌표 미변경)

### ★ 2026-07-26 — 프로필 대표 업적 희귀도 테두리 5종

- COMMON / BRONZE / GOLD / CRYSTAL / LEGENDARY · 표시명 일반·청동·황금·수정·전설
- `achievement-rarity-frames.js` · `public/assets/achievements/rarity-frames/{한글}.png`
- 대표 업적 아이콘 위 테두리 오버레이 · rarity 누락/오류 시 COMMON · 빈 슬롯 미표시
- ProfileFrame HUD·모달 동일 렌더 · 프로필 PNG·슬롯 좌표 미변경
- ScMiniProfile은 텍스트 목록 구조라 이번 작업에서 보류

### ★ 2026-07-26 — 영토 발전 Mock 시뮬레이션·경계값 검증

- `territory-evolution-debug.js` — `__scSetTerritoryPopulation` · `__scRunTerritoryEvolutionSimulation` 등
- 경계값·다음 단계 필요 인원·진행률·상승/하락·외계 단계명·중앙 30%·외계 이동 가정 검증
- Mock 가변 상태 + 기본값 복구 · 열린 Hover `refreshOpenPanel` 즉시 반영
- 사용자 UI/실데이터 API 미추가

### ★ 2026-07-25 — Hover 다음 단계 필요 인원·진행률 바

- `getTerritoryEvolutionNextStageProgress` · state에 remaining/progress 필드 추가
- 헤더: `다음 단계 …까지` / `발전 인원 N명 필요` + 구간 진행률 바
- 6단계: `최고 단계 … 달성` (바 숨김) · 임계값·peek·위치 미변경

### ★ 2026-07-25 — 영토 발전 인원 집계·단계 하락 정책 확정

- 집계 = 현재 소속 전체 회원 (활동/휴면 무관) · 탈퇴·삭제·게스트 제외
- 외계 이동자 = 현재 소속(alien)에만 집계 · 이전 영토 역사 필드는 집계 미사용·보존
- 단계 = 현재 발전 인원 재판정 (상승·하락) · highestStage 보정 없음
- `territory-evolution-population.js` — 집계 계약·함수 · live 주입 / Mock fallback
- 실데이터 census API·Supabase territory 필드 없음 → Mock 유지 (가짜 API 미추가)

### ★ 2026-07-25 — 영토 발전 인원·단계 자동 판정 (Mock)

- `TERRITORY_POPULATION_MOCK_SOURCE` · 단계 임계값 · 발전 인원/단계 계산 함수
- 중앙광장 = 직접 소속 + 개척·수호 각 30%(floor) · 외계 미포함
- Hover 헤더: `발전 인원수` + `단계 기준` · 기존 UI/위치/peek 유지
- 실제 DB·API·단계 하락 정책 없음

### ★ 2026-07-25 — 외계행성 발전 단계 표시명 분리

- `ALIEN_EVOLUTION_STAGE_LABELS` 추가 · `getTerritoryEvolutionStageLabel(key, stage)`
- Hover 헤더·안내 박스·이미지 alt에 영토별 단계명 적용
- 공통 `TERRITORY_EVOLUTION_STAGE_LABELS` 평면 구조 유지 (기존 참조 호환)
- 이미지 경로·순서·명패 상수 미변경

### ★ 2026-07-25 — 영토 발전 Hover · 단계 안내 UI 통일

- 금색 pill 제거 → 전단계/현재/다음단계 공통 2줄 `stage-label`
- 세 안내 상단 기준선 정렬 · 현재 단계만 크기·명도·테두리로 강조
- 양옆 안내 약화 · peek 비율·패널 위치 미변경

### ★ 2026-07-25 — 영토 발전 Hover · 전단계/다음단계 안내 overlay

- peek 카드 내부 badge 제거 → viewer 좌·우 상단 독립 `side-label`
- 표기: `← 전단계` / `다음단계 →` + 단계명 별도 줄
- 현재 단계 중앙 badge 유지 · 1·6단계 안내 미표시
- peek 비율·패널 위치·Mock 값 미변경

### ★ 2026-07-25 — 영토 발전 Hover 패널 · peek 슬라이드 UI

- 하단 썸네일 제거 → 메인 viewer 안 현재 중심 + 좌우 peek
- 헤더: 영토명 / **현재 인구수** / 현재 단계 위계 분리
- 카드 badge: `이전 단계 · …` / `현재 단계 · …` / `다음 단계 · …`
- alien 배치를 `alien-left`(수호와 같은 왼쪽 슬롯)로 변경
- Mock 값·이미지 상수·지도·히트존·클릭 이동 미변경

### ★ 2026-07-25 — 영토 발전 Hover 패널 (Mock)

- `territory-evolution-hover.js` — 싱글톤 패널 · Mock 단계/인원 · 이전·현재·다음 이미지
- 기존 히트존 `pointerenter/move/leave`에만 연결 · 클릭 이동·hover 강조 CSS 유지
- `TERRITORY_EVOLUTION_IMAGES` / `TERRITORY_BELIEFS.displayName` 재사용
- 화면 경계 clamp · fade/translateY · ScMiniProfile 미수정
- 실제 인원 집계·임계값·API 없음

---

### ★ 2026-07-25 — 수호 발전단계 3장 보충

- 수호 근대·현대·미래 PNG 등록 완료 (`guardian-early-modern` · `guardian-modern` · `guardian-future`)
- `territory-evolution-images.js` 수호 4~6단계 `null` 해제
- 공식 등록 **22장 구성 완성** (공통1 + 개척5 + 수호5 + 중앙5 + 외계6)
- 수호 현대와 기존 개척 현대가 동일 파일이라, 개척 현대는 `_review` 후보 이미지로 교체 (중복 해소)
- 확인용 미리보기: `/tools/territory-evolution-preview.html`

### ★ 2026-07-25 — 영토 발전단계 이미지 등록 (에셋만)

- `public/assets/territory-evolution/` — 발전단계 PNG 등록 (패널·판정·hover 미연결)
- `public/territory-evolution-images.js` — 경로 목록 상수
- 1차 등록 19장 · 수호 근대·현대·미래는 이후 보충
- 세계지도·히트존·hover 미변경

---

### ★ 2026-07-22 — 영토 지도 업데이트

- 새 통합 영토 이미지 적용 완료 (`territory-zones-tribal-s1.png` · `territory-zones-unified.png`)
- 새 이미지 기준 영토별 히트존 적용 완료 (`territory-hit-zones.json` · viewBox `0 0 1600 900`)
- 영토별 마우스 호버 동작 적용 완료 (개척·수호·광장 강도 완화 · 외계행성 기존 강도 유지)
- 중앙광장 성장 이미지는 아직 기획 및 제작 단계
- 이후 작업에서는 현재 지도 이미지, 히트존 좌표계와 호버 동작을 기준선으로 유지

---

### ★ 2026-07-12 — 세션 요약 (Follow System v1 · ProfileFrame)

**Follow System v1**
- 1차: `follow-list-modal.js` · HUD 팔로워/팔로우 수 클릭 · 2탭 목록 모달 · 프로필 연결 · Empty · `sc_follow_v1`
- 2차: 팔로잉 탭 `언팔로우` · `toggleFollow` · Toast · 목록·HUD·게시글 버튼 즉시 갱신
- **다음:** 2차 QA 체크리스트 통과 후 완료 처리

**ProfileFrame**
- 상단 팔로워: `followersLabel`/`followers` · `getFollowerCount` · 4스킨 좌표 통일 · 금색 라벨 · 명성 톤 숫자 박스 · 에디터 X/Y/W/H · **아이콘 없음(텍스트만)**
- 표시 안정화: `normalizeProfileActivityDisplay` · `normalizeTerritoryRecordDisplay` · `finalizeProfileDisplayFields`
- 0 표시: 활동·영토 숫자 **0→`--`** · 팔로워는 **0→`0`**
- 모달 Overlay: `ensureProfileFrameListLayerBounds` · HUD/모달 동기화 · `__scInspectProfileFrame`

---

### ★ 2026-07-12 — Follow System v1 2차 (팔로잉 탭 언팔로우)

- **팔로잉 탭만** 행 우측 `언팔로우` 버튼 (`board__follow-btn` 스타일)
- `FollowSystem.toggleFollow(userId)` 재사용 · 클릭 시 `preventDefault`/`stopPropagation`
- 언팔로우 후 `getFollowing` 재조회 렌더 · HUD 숫자·게시글 팔로우 버튼·랭킹(refresh) 자동 갱신
- Toast: 「언팔로우했습니다.」 · 팔로워 탭 버튼 없음 · localStorage 전용 유지

---

### ★ 2026-07-12 — ProfileFrame 팔로워 UI 최종 (텍스트 전용)

- **아이콘/Emoji 제거** — 팔로워 라벨 텍스트만 「팔로워」
- **라벨** — 금색 `#d4a86a` · LEVEL·명성과 동일 폰트 · `padding-right: 14px`
- **숫자 박스** — layout `followers` rect 크기 적용 · 붉은 금속 테두리 · 어두운 내부 · 명성 톤
- **좌표 에디터** — 팔로워 숫자 박스 X/Y/Width/Height 실시간 입력

---

### ★ 2026-07-12 — ProfileFrame 팔로워 좌표 (4스킨 통일)

- **팔로워 라벨** `{ x:785, y:25, w:92, h:33 }`
- **팔로워 숫자 박스** `{ x:882, y:25, w:96, h:33 }`
- `center` · `pioneer` · `guardian` · `alien` 전 스킨 동일

---

### ★ 2026-07-12 — ProfileFrame 팔로워 영역 UI 폴리싱

- **라벨** — LEVEL·명성과 동일 금색(`#d4a86a`) · text-shadow 통일
- **숫자 박스** — 명성 PNG 박스와 동일 톤(테두리·배경·radius·inset 광택) · `#followersLayer` 전용 CSS
- **간격** — 좌표 유지 · 라벨-숫자 밀착 배치
- 명성·LEVEL·경험치·PNG·기존 좌표 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 상단 팔로워 표시 추가

- **명성 위 빈 공간** — `followersLabel` · `followers` 오버레이 레이어 추가 (PNG·기존 좌표 변경 없음)
- **데이터:** `FollowSystem.getFollowerCount(userId)` · `profileData.followers` · `finalizeProfileDisplayFields()`에서 확정
- **표시:** 0명도 `0` (천 단위 구분은 명성과 동일 `formatScProfileDisplayNumber`)
- **4스킨 좌표:** `SC_PROFILE_LAYOUT_BY_SKIN` — center/pioneer/guardian/alien `followersLabel`·`followers` 추가
- **좌표 에디터:** 팔로워 라벨·값 타깃 등록 · HUD·모달 ProfileFrame 동일 렌더

---

### ★ 2026-07-12 — Follow System v1 1차 (팔로워·팔로잉 목록)

- **`public/follow-list-modal.js`** — `window.FollowListModal` (`open` · `close` · `render` · `setTab`)
- 좌측 HUD `#avatar-dock-follow-summary` — **팔로워 N명** / **팔로우 N명** 각각 클릭 → 해당 탭 모달
- 2탭 모달 (`sc-follow-modal`) — 팔로워 · 팔로잉 · ESC/배경/X 닫기
- 데이터: `FollowSystem.getFollowers` / `getFollowing` · `sc_follow_v1` localStorage (구조·계산 변경 없음)
- 시민 행: 통합검색 `sc-search-modal__item` 패턴 · `resolveDisplayName` · 아바타·이름만 프로필 연결
- Empty: 「아직 팔로워가 없습니다.」 / 「아직 팔로우한 시민이 없습니다.」
- 정렬: `resolveDisplayName` 가나다 오름차순
- 디버그: `window.__scFollowLists(userId)` — `{ followers, following }` 조회 전용
- **2차 예정:** 언팔로우 버튼 · 타인 프로필 팔로워 목록 · 서버 동기화 없음

---

### ★ 2026-07-12 — ProfileFrame 숫자 0 표시 → -- 통일

- **활동 요약·영토 기록 숫자형** (작성 글·댓글·받은 공감·토론 참여·전달한 아우라·이동 횟수·시민 영향력): 화면에서 **0도 `--`**
- **1 이상**만 실제 숫자 표시 · `formatProfileFrameCountDisplay()` 단일 처리
- **원본** `activity` / `territory` 숫자 0 유지 · `activityDisplay` / `territoryDisplay`만 변환
- LEVEL·명성·경험치 % · 현재 소속·시민 등급 표시 규칙 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 모달 Overlay 값 바인딩 버그 수정

- **원인:** 모달 ProfileFrame의 `activitySummaryLayer`·`territoryRecordLayer`가 `id` 없이 `data-pf-layer`만 존재 → HUD용 `#activitySummaryLayer` CSS(100%×100%) 미적용 → 레이어 0×0 + `overflow:hidden`으로 textContent는 설정됐으나 화면에서 클리핑
- **수정:** `ensureProfileFrameListLayerBounds()` — `applyProfileFramePixelLayout(frameRoot)`에서 목록 레이어 전체 오버레이 크기 확보
- **렌더 순서:** `renderProfileFrameInModal` — layout 적용 후 `renderProfileData` (`paintModalProfileFrame` · rAF 재실행)
- **디버그:** `window.__scInspectProfileFrame(userId)` — 최종 data + 모달 DOM textContent·layerBounds 조회
- frameRoot scoped 조회 유지 (`queryProfileFrameLayer`) · PNG·좌표·SC_PROFILE_LAYOUT 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 활동·영토 빈칸 표시 수정

- **원인:** `formatScProfileDisplayNumber(undefined)` → 빈 문자열 · `aura` 미집계 시 undefined · merge 후 표시값 미확정
- **표시 정규화 단일화:** `normalizeProfileActivityDisplay()` · `normalizeTerritoryRecordDisplay()` · `finalizeProfileDisplayFields()`
- **표시 기준:** 실제 값 표시 · **활동·영토 숫자형은 0도 `--`** · 1 이상만 숫자 · 데이터 확인 불가 `--` · 현재 소속 없음 `기록 없음` · 등급 없음 `참여자` · 전달한 아우라 계산 없음 `--` (Mock 숫자 금지)
- **`value || '--'` 금지** — `null`/`undefined`/`''` 만 `--` 처리
- 디버그: `window.__scResolvedProfileData(userId)` — 렌더 직전 최종 profileData clone
- ProfileFrame PNG · 좌표 · HTML/CSS · PlayerProgression 수식 변경 없음

---

### ★ 2026-07-12 — Community System v2 북마크 목록 1차

- HUD `sc-map-tab-bookmarks` (🔖) — 북마크 목록 모달 진입
- `public/bookmark-list.js` — `sc_bookmarks_v1` 목록 · `findPostByIdAnywhere` · `__scBoardNavigateToPost`
- 항목 표시: 제목 · 작성자(displayName) · 영토 Badge · 작성시간 · 저장시간
- 제목 클릭 → 게시글 상세 · 모달 닫힘 · 삭제 → `togglePostBookmark` + Toast
- Empty: 「저장한 게시글이 없습니다.」 · 정렬: `createdAt` DESC
- `window.findPostByIdAnywhere` 노출 (읽기 전용)
- 새 저장소 없음 · 게시글 bundle 구조 변경 없음

---

### ★ 2026-07-12 — Search System v1 완료 (통합검색 · 시민 + 토론)

- **토론 검색** — `sc_board_bundle_v1` 클라이언트 스캔 · 제목 · 본문 · 작성자 `displayName` · 최대 20건 · postId 중복 제거
- 정렬: 제목 완전/시작/부분 → 본문 → 작성자 displayName
- 결과 UI: `board__item` 스타일 · 제목 · 본문 말줄임(~50자) · 작성자 · 영토 Badge · 작성시간
- 제목 클릭 → `__scBoardNavigateToPost()` → 검색 모달 닫힘
- 디버그: `window.__scSearchDiscussions(query)`
- **Search System v1 완료** — 통합검색(시민 + 토론) · displayName 기준 · userId 내부 식별자

---

### ★ 2026-07-12 — Search System v1 1차 (통합검색 모달 · 시민 검색)

- 지도 HUD `sc-map-tab-search` (🔍) — 통합검색 진입
- `sc-search-modal` — 검색창 · **시민** 결과 · **토론** 준비 중 안내
- `public/search-system.js` — `searchCitizensByDisplayName` · `openSearchModal` / `closeSearchModal` · `renderCitizenSearchResults`
- 시민 검색: `collectDisplayNameIndex()` + `resolveDisplayName` · displayName 부분 일치 · 완전/시작/부분 일치 정렬 · 최대 15명
- 결과 클릭(이름·아바타만) → `openUserProfile` → 검색 모달 닫힘
- 디버그: `window.__scSearchCitizens(query)`
- **토론 검색 미구현** — 2차 예정
- ProfileFrame · 지도 · bundle 구조 · PlayerProgression 변경 없음

---

### ★ 2026-07-12 — displayName 통일 기반 (Search System v1 사전 작업)

- `public/display-name.js` — `resolveDisplayName(userId)` · `rememberDisplayName` · `syncCurrentUserDisplayName` · `collectDisplayNameIndex`
- 우선순위: 로그인 프로필 `nickname` / Auth `display_name` → `sc_display_names_v1` 캐시 → **fallback `userId`**
- `userId`는 내부 식별자 유지 · 화면 표시·향후 검색은 **displayName 기준**
- 적용: 게시글 목록·상세·댓글 · 알림 · 랭킹 · 아바타 HUD · Hover `aria-label` · 채팅 · 미니프로필 · 타 유저 ProfileFrame 모달
- **검색 UI/알고리즘 미구현** — Search System v1은 **검색창 하나 · displayName 기반 통합검색** · 결과 **「시민」+「토론」** 그룹 분리 예정
- 디버그: `window.__scResolveDisplayName` · `window.__scCollectDisplayNameIndex`
- 게시글/댓글 bundle 데이터 구조 · ProfileFrame PNG/좌표 · PlayerProgression 수식 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 영토 기록 표시 기준 정정

- **현재 소속**만 사용 — `territory.current`에 `resolveCurrentTerritoryIdForUser()` 기반 현재 영토 표시
- **「최초 소속」 폐기** — 코드·주석·문서에서 제거 (복원·계산 안 함)
- 표시 fallback 단일 처리: `normalizeTerritoryRecordDisplay()` — 현재 소속 `기록 없음` · 이동 `0` · 영향력 `0` · 등급 `참여자`
- `SC_PROFILE_DATA.territory` Mock — 중앙광장 / 0 / 0 / 참여자 (데모 유저)
- ProfileFrame PNG · 좌표 · HTML/CSS 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 영토 기록 실데이터 연결 1차

- `resolveUserTerritoryRecord(userId)` — 기존 PlayerProgression·유저 버킷·시즌 아카이브·성장 기여 데이터 조회
- 연결 항목 4개: **현재 소속**(`territory.current`) · **이동 횟수**(`territory.moved`) · **시민 영향력**(`territory.influence`) · **시민 등급**(`territory.rank`)
- (후속 정정) 최초 소속 로직 제거 → 현재 소속 기준으로 변경
- 이동 횟수: 시즌 아카이브 주 영토 변경 횟수 · 없으면 exileHistory · 없으면 0
- 시민 영향력: `getMyStandings` / `rankReputationScore` 재사용 · 없으면 Mock fallback
- `loadCurrentUserProfile()` · `buildUserProfileDataForModal()` — `mergeResolvedProfileTerritory()` merge
- 디버그: `window.__scTerritoryRecord(userId)`
- ProfileFrame PNG · 좌표 · HTML/CSS 변경 없음 · 새 영향력/이동 기록 시스템 미도입

---

### ★ 2026-07-12 — ProfileFrame 활동 요약 실데이터 연결 1차

- `resolveUserProfileActivity(userId)` — 게시판 bundle(`sc_board_bundle_v1`) 기반 활동 집계 헬퍼 추가
- 연결 항목 5개: **작성 글**(`posts`) · **댓글**(`comments`) · **받은 공감**(`receivedLikes`, empathy만) · **토론 참여**(`discussions`, 서로 다른 postId 수) · **전달한 아우라**(`aura` — 기존 계산값 없어 Mock fallback 유지)
- `loadCurrentUserProfile()` · `buildUserProfileDataForModal()` — clone 후 `mergeResolvedProfileActivity()` merge (SC_PROFILE_DATA 원본 미변경)
- 디버그: `window.__scProfileActivity(userId)` · `window.resolveUserProfileActivity(userId)`
- ProfileFrame PNG · 좌표 · `SC_PROFILE_LAYOUT` · HTML/CSS 변경 없음

---

### ★ 2026-07-11 — UserCard UX 단순화

- `ScMiniProfile.attachHover()` 화면 연결 해제 — 큰 팝업 미표시 · 컴포넌트 코드는 보류
- 프로필 클릭 범위를 **아바타·닉네임·유저 ID**로 축소 (게시글 상세·댓글·알림·랭킹)
- Hover 안내: `title` / `aria-label` — `클릭해서 유저 프로필 보기`
- 활동 피드: 작성자 이름 미표시 → 프로필 연결 해제
- 클릭 흐름 `openUserProfile()` → ScProfileModal → ProfileFrame 유지

---

### ★ 2026-07-11 — 랭킹 작성자 프로필 UX 1차

- 랭킹 모달 항목 닉네임 영역 — Hover `ScMiniProfile` · 클릭 `openUserProfile()` → `ScProfileModal` / ProfileFrame
- 전체·중앙·개척·수호·외계 탭 공통 · `userId` 없는 항목은 미연결

---

### ★ 2026-07-11 — 랭킹 UI 개선 2차

- TOP1~3 행 여백 확대 · 👑🥈🥉 아이콘·순위 숫자 가독성 정리
- 영토명 `sc-rank-modal__terr` Badge (`data-territory` 색상) · 내 순위 2×2 HUD 정보 그리드
- 모달 폭 `29rem` 소폭 확대 — 기능·데이터 변경 없음

---

### ★ 2026-07-11 — 랭킹 UI 개선 1차

- 랭킹 모달 탭 **전체 / 중앙 / 개척 / 수호 / 외계** 5종 (`getLeaderboard` 필터: `null` · `COMMON` · `PROGRESSIVE` · `CONSERVATIVE` · `KANTAPBIYA`)
- TOP1~5 시각 강조 — 👑🥈🥉 금·은·동 테두리 · 4~5위 ⭐ + TOP4/TOP5 Badge
- `rank-leaderboard.js` · `index.html` 모달 HTML/CSS — `PlayerProgression` 구조 변경 없음

---

### ★ 2026-07-11 — Community System v1 · 게시글 신고 상세 의견

- 신고 모달 **상세 의견** textarea (최대 300자 · 실시간 `0 / 300` 카운터)
- 사유별 규칙: 일반 사유는 선택 입력 · **기타** 선택 시 상세 의견 필수
- `sc_reports_v1` 항목에 `detail` 필드 추가 · `detail` 없는 기존 데이터 호환 유지

---

### ★ 2026-07-11 — Community System v1 · 게시글 신고 1차

- 게시글 목록·상세 반응 바 **신고** 버튼 (`sc-react-btn--report`) · HUD 모달 · 행동 기준 사유 6종 (정치 의견·성향 사유 없음)
- `sc_reports_v1` localStorage · userKey별 `{ postId, reason, createdAt, reporterId }[]` 저장
- 중복 신고·본인 글 신고 차단 · Toast 안내만 — 숨김·제재·외계행성 이동·관리자 기능 미포함

---

### ★ 2026-07-11 — Community System v1 · 게시글 공유 1차

- 게시글 목록·상세 반응 바 **공유** 버튼 (`sc-react-btn--share`) · `linkTarget` 동일 쿼리(`view`/`postId`/`territoryId`/`stage`) URL 복사
- `navigator.clipboard.writeText` + textarea fallback · HUD Toast `링크가 복사되었습니다.`
- SNS/카카오/QR/통계/DB 미포함

---

### ★ 2026-07-11 — Community System v1 · 게시글 북마크 1차

- `sc_bookmarks_v1` localStorage · userKey별 `{ postId, createdAt }[]` 저장
- 게시글 목록·상세 반응 바에 **저장** 버튼 (`sc-react-btn--bookmark`) · 토글 · 새로고침 유지
- 북마크 목록 UI·DB·검색 미포함 (v1 저장만)

---

### ★ 2026-07-11 — 알림 작성자 프로필 클릭과 콘텐츠 이동 영역 분리

- `buildNotificationItemElement` — `actorId` 있을 때 좌측 작성자 영역(아바타·닉네임)과 알림 내용 영역 클릭 분리
- 작성자 영역: Hover `ScMiniProfile` · 클릭 `openUserProfile()` (`stopPropagation`)
- 알림 내용 영역: 클릭 `navigateFromNotification()` · 읽음 처리 유지
- 시스템 알림(`level_up`/`alien_*` 등)은 기존 단일 클릭 동작 유지

---

### ★ 2026-07-11 — 알림 작성자 프로필 UX 1차

- **데이터 점검:** `sc_notifications_v1` 기존 항목은 `actorId` 미저장 · `follow`만 `linkTarget.userId` 보유
- `addNotification` — `actorId`/`authorId`/`userId` 또는 `linkTarget.userId` 저장 · 렌더 시 식별값 있는 항목만 `ScMiniProfile` + `openUserProfile` 연결
- `comment`/`like` 생성 시 `actorId` 기록 · `level_up`/`alien_*` 등 시스템 알림은 미연결

---

### ★ 2026-07-11 — 활동 피드 작성자 프로필 UX 1차

- **데이터 점검:** 기존 `sc_activity_feed_v1` 항목은 `authorId`/`userId` 미저장 — 익명 메시지(`한 시민이…`, `누군가…`) 유형은 식별값 추가 없음
- `addActivityFeedItem` — `authorId`/`userId` 선택 저장 · `renderActivityFeed`에서 식별값 있는 항목만 `ScMiniProfile` + `openUserProfile` 연결
- `post_created` 이벤트만 `authorId` 기록 (글 작성자)

---

### ★ 2026-07-11 — 댓글 작성자 프로필 UX 1차

- `renderThreadedCommentNode` — 댓글 작성자 meta에 `ScMiniProfile.attachHover` · 클릭 `openUserProfile()` 연결 (게시글·상세·데일리 이슈·대댓글 공통)
- 기존 `ScMiniProfile` · `ScProfileModal` · ProfileFrame 재사용 — 새 Hover/Modal/UI 없음

---

### ★ 2026-07-10 — ScProfileModal ProfileFrame 회귀 QA

- Hover · Click · ProfileFrame · 4스킨 · HUD 복원 · 닫기 · DOM/리스너 중복 — 회귀 검사 완료
- **FIX** `closeScProfileModal()` — `transitionend` + `setTimeout` 이중 호출로 `restoreHudProfileFrameAfterModal` 2회 실행되던 버그 수정 (`finished` 가드)

---

### ★ 2026-07-10 — ScProfileModal ProfileFrame 렌더 연결 1차

- `openUserProfile()` → 모달 내 기존 ProfileFrame 재사용 (`renderProfileData` · `applyProfileFramePixelLayout` · `data-pf-layer` 스코프)
- `buildUserProfileDataForModal(userId)` — MiniProfile · PlayerProgression · clone `SC_PROFILE_DATA` · `territorySkin`별 PNG/좌표

---

### ★ 2026-07-10 — 프로필 모달 껍데기 1차 (`ScProfileModal`)

- `openUserProfile(userId)` → HUD 프로필 모달 오픈 · `userId` state 저장 · 본문 `프로필을 불러오는 중...` placeholder
- ESC · 배경 클릭 · X · 닫기 버튼 · fade 0.2s — ProfileFrame 미연결

---

### ★ 2026-07-10 — Hover 미니 프로필 1차 (작성자 카드)

- 공통 `ScMiniProfile` · `#sc-mini-profile-popover` — HUD 미니 카드 (아바타·Lv/명성·영토·대표업적·활동지표)
- 게시글 상세 작성자 카드 Hover 표시 · 클릭 `openUserProfile()` → `ScProfileModal`

---

### ★ 2026-07-10 — 게시글 상세 작성자 카드 3차 (영토 Badge)

- 레벨/명성 아래 작성시간 행에 `[중앙광장]` 등 작은 영토 Badge 추가 (`data-territory` · `territoryShortLabel` 재사용)

---

### ★ 2026-07-10 — 게시글 상세 작성자 카드 2차 (레벨·명성)

- 닉네임 아래 `Lv.N · 명성등급` 표시 (`PlayerProgression.getDisplay` · 본인 `getCurrentProfileData()` 보강)

---

### ★ 2026-07-10 — 게시글 상세 작성자 영역 1차 CSS 개선

- 상단 작성자 메타를 어두운 HUD 카드형으로 정리 (아바타·닉네임/시간/카테고리 간격 · 팔로우 버튼 겹침 배치 · 약한 hover glow)

---

### ★ 2026-07-10 — ProfileFrame 좌표 에디터 기본 숨김

- localhost에서도 좌표 에디터·스킨 전환 버튼 기본 비표시
- 필요 시 콘솔 `__scShowProfileLayoutEditor()` / `__scHideProfileLayoutEditor()`

---

### ★ 2026-07-10 — 최근 세계 활동 피드 1차

- `sc_activity_feed_v1` localStorage · `global_demo` 키 · 최대 30건 저장 · 화면 8건 표시
- 메인 지도 좌하단 **최근 세계 활동** HUD 패널
- 글/댓글/공감/좋아요/팔로우/레벨업/외계 경고·이동 이벤트 연결 · 영토 변경 피드 제외
- 디버그: `__scAddActivity()` · `__scActivityFeed()` · `__scClearActivityFeed()`

---

### ★ 2026-07-10 — ProfileFrame 성향지도 첫 펼침 좌표 보정

- 접힌 상태에서 `refreshCurrentProfile()`·boot layout 스킵 → 펼침 후 double-rAF·애니메이션 종료 시 재동기화
- `renderProfileData()` — 영토 스킨/layout 적용 후 성향지도 렌더 (순서 수정)

---

### ★ 2026-07-10 — 알림센터 1차 (Notification Center)

- `sc_notifications_v1` localStorage · 유저별 알림 저장 (최대 50건)
- 맵 HUD 우상단 **알림** 버튼 + 프로필 벨 · 드롭다운 패널 · 읽지 않음 배지 · ESC/바깥 클릭 닫기
- 타입: `comment` · `like` · `follow` · `level_up` · `alien_warn` · `alien_move` · `achievement`(예비)
- 이벤트 연결: 댓글/공감/팔로우/레벨업 · 영토 변경 알림은 생성하지 않음
- 디버그: `__scAddNotification()` · `__scNotifications()` · `__scClearNotifications()`

---

### ★ 2026-07-10 — ProfileFrame 로그인 사용자 데이터 어댑터

- `loadCurrentUserProfile()` — Auth 세션 · `/api/auth/me` · `/api/me/profile` 캐시와 `PlayerProgression`을 merge해 ProfileFrame 데이터 생성
- `getCurrentProfileData()`는 `loadCurrentUserProfile()`만 호출 · `SC_PROFILE_DATA`는 미로그인 fallback (원본 불변)
- `__scPrefetchUserProfile()` — 로그인 후 프로필 API 선조회 · `__scCurrentProfile()` 디버그 헬퍼

---

### ★ 2026-07-10 — ProfileFrame 성향지도 게임 성향 어댑터

- `mapPoliticalScoresToProfileAlignment()` — `sc_political_scores_v1` → 표시용 4축 alignment 매핑
- `getCurrentProfileData()`가 localStorage 성향을 읽어 ProfileFrame 성향지도에 반영 · `__scPreviewProfileAlignment()` 디버그

---

### ★ 2026-07-10 — AI 인수인계 문서 (`docs/AI_HANDOFF.md`)

- 프로젝트 구조 · 완료/미완료 · 막힘·리팩토링 · **성향 변화 요소·수치** 정리

---

### ★ 2026-07-10 — 성향지도 이동 애니메이션 보강

- `alignment` 값 변경 시 polygon · polyline · circle 0.28s ease-out 보간 이동
- polygon fill-opacity 0.18 → 0.22 자연 변화 · glow 강도 유지 · SVG 구조·좌표 무변경

---

### ★ 2026-07-10 — ProfileFrame 접기 애니메이션

- 접기 버튼 클릭 시 0.18s ease-in · opacity + translateY/scale 퇴장 후 기존 hide 실행
- 펼침 애니메이션 유지 · 레이아웃·좌표 무변경

---

### ★ 2026-07-10 — ProfileFrame 펼침 애니메이션

- 프로필 탭 클릭(펼침) 시에만 0.2s ease-out · opacity + translateY/scale 진입
- 페이지 최초 진입·접힌 상태에서는 실행하지 않음 · 레이아웃·좌표 무변경

---

### ★ 2026-07-10 — 업적 이름·날짜 좌표 확정 (영토별)

- center/pioneer · guardian · alien `achievementTitles[3]` · `achievementDates[3]` 에디터 최종값 반영

---

### ★ 2026-07-10 — 업적 이름·날짜 좌표 에디터

- `achievementTitles[3]` · `achievementDates[3]` — 아이콘과 분리된 px 좌표 (1024×819)
- 에디터: 업적 아이콘 / 업적 이름 / 획득 날짜 각각 선택·드래그·크기 조절
- 영토별 기본값 (center·guardian·alien) · 복사 포맷에 titles/dates 포함
- 레이아웃 적용: `#achievementLayer` 내 img·title·date 개별 absolute 배치

---

### ★ 2026-07-10 — 대표 업적 이름·획득 날짜 텍스트

- `achievements` 객체 배열 (`id` · `title` · `date`) · 문자열 배열 하위 호환
- 슬롯 내 `profile-achievement-title` · `profile-achievement-date` · `renderProfileAchievements()` 연동

---

### ★ 2026-07-10 — 대표 업적 슬롯 좌표 확정 (영토별)

- center/pioneer · guardian · alien `achievement` · `achievementSlots[3]` 에디터 최종값 반영

---

### ★ 2026-07-10 — 업적 슬롯 에디터 선택·복사 개선

- 슬롯 div 우선 선택 (역순 탐색) — 크기 조절 Alt+←→/↑↓ 동작
- 「현재 영토 업적 슬롯 복사」·「전체 영토 업적 슬롯 복사」 (center/guardian/alien)

---

### ★ 2026-07-10 — 좌표 에디터 대표 업적 슬롯

- `SC_PROFILE_LAYOUT.achievement` · `achievementSlots[3]` px 좌표 (1024×819)
- 에디터: 대표 업적 영역 + 슬롯 0~2 드래그/방향키 · 스킨별 localStorage
- 「업적 슬롯 복사 (AI 전달용)」· 전체 좌표 복사에 achievement 포함
- `__scProfileLayoutEditor.copyAchievementSlots()` · `formatAchievementSlots()`

---

### ★ 2026-07-10 — 대표 업적 슬롯 UI (achievementLayer 내부)

- `#achievementLayer` 안 `profile-achievement-slot` × 3 (`data-slot` 0~2) · `profile-achievement-img`
- 슬롯 전용 CSS 추가 · `#achievementLayer` 좌표·기존 ProfileFrame 무변경
- `renderProfileAchievements()` 기존 구현 그대로 (`img.src`만 변경)

---

### ★ 2026-07-10 — 대표 업적 src 전용 렌더 (JS만)

- `SC_PROFILE_DATA.achievements` 더미 배열
- `renderProfileAchievements(data)` — 기존 슬롯 `img.src`만 변경 · DOM/CSS/레이아웃 무변경
- `renderProfileData()` 마지막 1줄 호출 추가

---

### ★ 2026-07-10 — 성향지도 캘리브레이션 스킨 그룹 분리

- **centerPioneer** (중앙·개척) / **guardianAlien** (수호·외계) 그룹별 `alignmentMap` · 축 최대치 분리
- `alignmentMap` — center/pioneer `{305,355}` · guardian/alien `{309,360}`
- `SC_PROFILE_ALIGNMENT_AXIS_MAX_BY_GROUP` — 축별 최대치 `{ alien:67, guardian:70, center:72, pioneer:69 }`
- 실제 성향값 렌더 시 축 스케일 적용 · 에디터는 그룹별 localStorage

---

### ★ 2026-07-10 — 좌표 에디터 성향지도 캘리브레이션

- 에디터 ON 시 축별 **최대치(0~100)** 입력 → polygon 미리보기 (`SC_PROFILE_ALIGNMENT_EDITOR_MAX`)
- **빨간 점** = SVG 중앙(최소 0) — PNG 축 중심 맞춤용
- `localStorage` `sc_profile_alignment_editor_max` 저장
- 「성향지도 복사 (AI 전달용)」→ `alignmentMap` 좌표 + `previewMax` 블록 클립보드
- `window.__scProfileLayoutEditor` — `getAlignmentEditorMax` · `setAlignmentEditorMax` · `copyAlignmentCalibration`

---

### ★ 2026-07-10 — 성향지도 SVG 완성도 보강 (glow · transition · 왕관)

- polygon stroke 강화 · drop-shadow · 점 크기 증가 · 중심점 circle
- `transition: 0.28s ease-out` — 값 변경 시 은은한 이동
- `alignmentMap` 좌표 `{ x: 304, y: 353, w: 190, h: 190 }` 확정 (전 스킨) · 왕관 마커 제거

---

### ★ 2026-07-10 — ProfileFrame 성향지도 SVG 오버레이

- `SC_PROFILE_DATA.alignment` — center/pioneer/guardian/alien (0~100)
- `SC_PROFILE_LAYOUT.alignmentMap` — px 좌표 · 좌표 에디터 대상
- `alignmentMapLayer` SVG polygon/polyline/circle · `renderProfileAlignmentMap()`
- 금색 반투명 fill · `renderProfileData(data)` 연동

---

### ★ 2026-07-10 — expGauge 그라데이션 (밝은 노랑 → 짙은 갈색)

- Fill: 좌 `#fff0a0` → 우 `#6b4512` 단계적 짙어짐
- Track: `#3d2810` (우측 톤과 통일)

---

### ★ 2026-07-09 — 프로필 시스템 (ProfileFrame) 일일 정리

**ProfileFrame 기본 UI 전환**
- PNG 기반 ProfileFrame을 기본 프로필 UI로 적용 · legacy UI `hidden` 유지
- 4종 영토 PNG (`center` / `pioneer` / `guardian` / `alien`) · `territorySkin` 자동 변경

**레이아웃**
- 좌측 하단 HUD 고정 · 패널/헤더/테두리 제거 · 접기 버튼 Frame 내부 우하단 · PNG 비율·크기 고정

**좌표**
- `%` 폐기 → `SC_PROFILE_LAYOUT` 1024×819 px · `scale = 너비 ÷ 1024`
- localhost 좌표 에디터 (드래그 · 방향키 · localStorage v3 · 복사)

**데이터 파이프라인**
- `SC_PROFILE_DATA` → `getCurrentProfileData()` → `renderProfileData()` → ProfileFrame
- `refreshCurrentProfile()` 개발용 갱신

**경험치 게이지**
- `expGaugeLayer` · 노란/골드 공통 디자인 · 100% Fill 배경 · %는 `expLayer` 텍스트만
- `expGauge` `{ x: 392, y: 126, w: 590, h: 10 }`

**미구현:** 아바타 · 성향지도 · 대표 업적 · 실유저/Firebase · 모바일 보정

---

### ★ 2026-07-09 (저녁12) — ProfileFrame 경험치 게이지 (expGauge)

- `expGaugeLayer` + `profile-frame__exp-gauge-fill` 추가
- `expGauge` 좌표 `{ x: 392, y: 126, w: 590, h: 10 }` · 좌표 에디터 대상
- 색상 회색 메탈 → **노란/골드** (가독성) · 바 100% 고정 · % 텍스트는 `expLayer`만

---

### ★ 2026-07-09 (저녁11) — Mock User Profile Adapter

- `getCurrentProfileData()` — SC_PROFILE_DATA 기반 더미 프로필 반환 (activity/territory 안전 복사)
- `refreshCurrentProfile()` — 콘솔 테스트용 get → render 파이프라인
- 초기 렌더: `getCurrentProfileData()` → `renderProfileData()` 흐름으로 통일

---

### ★ 2026-07-09 (저녁10) — renderProfileData() 영토 스킨 연동

- `data.territorySkin` → 기존 `setProfileTerritorySkin()` 호출 (center/pioneer/guardian/alien PNG)
- 텍스트 출력 + ProfileFrame 배경 스킨 한 함수로 갱신

---

### ★ 2026-07-09 (저녁9) — renderProfileData() ProfileFrame 렌더 파이프라인

- `window.renderProfileData(data)` — SC_PROFILE_DATA → ProfileFrame 13개 텍스트 슬롯 출력
- 페이지 로드 시 `renderProfileData(window.SC_PROFILE_DATA)` 1회 자동 실행
- `applyScProfileDataToFrame` 제거 · 좌표/PNG/스킨은 기존 `SC_PROFILE_LAYOUT`·`setProfileTerritorySkin` 유지

---

### ★ 2026-07-09 (저녁8) — SC_PROFILE_DATA 단일 더미 데이터 객체

- `window.SC_PROFILE_DATA` — userId, level, fame, expPercent, territorySkin, activity, territory
- ProfileFrame 오버레이 텍스트 HTML 하드코딩 제거 → 객체 참조

---

### ★ 2026-07-09 (저녁7) — ProfileFrame 영토별 좌표 분리

- `SC_PROFILE_LAYOUT_BY_SKIN` — center/pioneer 공통 · guardian/alien 개별 activity·territory 좌표
- 스킨 전환 시 `syncActiveProfileLayout()` + 좌표 자동 재적용
- localStorage v3 (스킨별 저장) · 에디터 복사/초기화 현재 스킨 기준

---

### ★ 2026-07-09 (저녁6) — ProfileFrame 4종 영토 PNG 스킨 연결

- `pioneer.png` · `guardian.png` · `alien.png` 추가 (`public/assets/territories/profiles/`)
- `setProfileTerritorySkin()` · `resolveProfileTerritorySkinKey()` — 배경 PNG만 교체, `SC_PROFILE_LAYOUT` 공통
- `renderTerritoryCreed()` 연동 · localhost 스킨 전환 버튼 (중앙/개척/수호/외계)

---

### ★ 2026-07-09 (저녁5) — ProfileFrame 좌표 확정 (에디터 캘리브레이션)

- `SC_PROFILE_LAYOUT_DEFAULT` 전체 좌표 에디터 최종값 반영 (1024×819 px)

---

### ★ 2026-07-09 (저녁4) — 좌표 에디터 「전체 좌표 복사」

- `SC_PROFILE_LAYOUT_DEFAULT` 전체 블록(index.html 붙여넣기용) 클립보드 복사
- 복사 시 x/y/w/h 정수 반올림 · territory `align` 포함

---

### ★ 2026-07-09 (저녁3) — ProfileFrame 가운데 정렬 렌더링 수정

- `.profile-frame__data-text` 내부 span — flex + ellipsis 시 가운데 정렬 깨짐 해소
- localStorage 로드 시 `align`은 기본값 유지 (x/y/w/h만 복원)

---

### ★ 2026-07-09 (저녁2) — ProfileFrame 정렬: 명성·경험치 오른쪽 / 소속·등급 가운데

- `#fameLayer` · `#expLayer` → 박스 오른쪽 정렬
- 영토 기록 `territory[0]`·`[3]` → `align: 'center'` (현재 소속 · 시민 등급)

---

### ★ 2026-07-09 (저녁) — ProfileFrame 좌표 개발용 에디터

- localhost 전용 좌표 에디터: 드래그·방향키·Shift/Alt 단축키·선택 박스 x/y/w/h 표시
- `SC_PROFILE_LAYOUT` localStorage 저장·초기화·클립보드 복사
- `SC_PROFILE_LAYOUT_DEFAULT` 분리 · 운영(비-localhost)에서는 UI 미표시

---

### ★ 2026-07-09 (오후11) — ProfileFrame 하단 y +6px · 영토 기록 행별 정렬

- `activity`·`territory` y 좌표 +6px (632~732 / 632~707)
- 영토 기록 행별 정렬: 소속·등급 왼쪽 / 이동 횟수·시민 영향력 오른쪽 (`align` + `padding-right: 6px × scale`)

---

### ★ 2026-07-09 (오후10) — ProfileFrame activity·territory y +25px

- `SC_PROFILE_LAYOUT` 활동 요약·영토 기록 행 y 좌표 +25px (대제목 줄 겹침 해소)
- userId / level / fame / exp 좌표 변경 없음

---

### ★ 2026-07-09 (오후9) — ProfileFrame 좌표 체계 px 전환 (1024×819 기준)

- `%` 좌표 미세조정 중단 — `SC_PROFILE_LAYOUT`에 `{ x, y, w, h }` px 고정
- `applyProfileFramePixelLayout()` — `scale = 프레임 너비 ÷ 1024`, 화면 좌표 = px × scale
- USER ID / LEVEL / 명성 / 경험치 / 활동 요약(5) / 영토 기록(4) 적용
- `ResizeObserver` + 도크 펼침 시 재계산 · 4개 영토 스킨 공통 좌표계
- alignmentMap · achievement는 % 유지 (추후 `SC_PROFILE_LAYOUT` 확장)
- 실제 데이터 연결 없음

---

### ★ 2026-07-09 (오후8) — ProfileFrame 오버레이 좌표 3차 캘리브레이션

- 상단 4칸·활동 요약·영토 기록 % 좌표 재조정 (라벨 겹침 해소)
- 텍스트 `clamp(7px, 0.66vw, 11px)`

---

### ★ 2026-07-09 (오후7) — ProfileFrame 오버레이 색상·좌표 2차 캘리브레이션

- 텍스트 `#f8f1d8` · `clamp(8px, 0.72vw, 12px)` — 가독성 개선
- 상단 4칸·활동 요약·영토 기록 % 좌표 재조정 (프레임 기준)

---

### ★ 2026-07-09 (오후6) — ProfileFrame 오버레이 정렬 규칙 확정

- USER ID / 명성 / 경험치 / 영토 기록 → 왼쪽 정렬 + ellipsis
- LEVEL → 가운데 정렬
- 활동 요약 숫자 → 오른쪽 정렬 (끝선 맞춤)
- 공통: `position:absolute`, 칸 `width` 고정, `nowrap` + `text-overflow:ellipsis`

---

### ★ 2026-07-09 (오후5) — ProfileFrame 데이터 오버레이 캘리브레이션 (더미)

- 6개 레이어에 더미 텍스트/숫자 출력 (USER ID, LEVEL, 명성, 경험치, 활동 요약, 영토 기록)
- 금장색 `.profile-frame__data` 스타일 · % 좌표 임시값
- 실제 데이터 연결 없음 (위치 보정 단계)

---

### ★ 2026-07-09 (오후4) — ProfileFrame 좌측 여백 축소 · 접기 버튼 금장 스타일

- 도킹 `left: 0.375rem` (앱 모드 `--hud-map-inset` 대신 직접 지정)
- 접기 버튼 `right: 1.25rem; bottom: 0.85rem` — 금장 프레임 비가림
- 접기 버튼 금장/암색 계열 스타일 적용

---

### ★ 2026-07-09 (오후3) — ProfileFrame 좌하단 HUD 도킹 · 접기 버튼 카드 부착

- ProfileFrame 좌하단 정렬 (`left/bottom: 1.375rem`, center 정렬 제거)
- 패널 `width: auto` — 카드 너비에 맞춤
- 접기 버튼 ProfileFrame 내부 `absolute` (right/bottom: 0.5rem)

---

### ★ 2026-07-09 (오후2) — ProfileFrame 크롬 제거 (PNG 단독 표시)

- `avatar-dock__panel--profile-frame` — 패널 배경·테두리·그림자·backdrop 제거
- "영토 시민 카드" 헤더 숨김
- 접기 버튼만 PNG 아래 오른쪽에 소형 유지

---

### ★ 2026-07-09 (오후) — ProfileFrame 패널 맞춤 · 레거시 UI 숨김

- `.profile-frame` — `dvh` 기반 `max-height` + `aspect-ratio: 1024/819`로 패널 내 한 화면 표시
- 패널 내부 세로 스크롤 제거 (`avatar-dock__panel--profile-frame`)
- `avatar-deco-panel`(기본/참여자/없음/없음) 및 레거시 프로필 DOM `hidden` 유지

---

### ★ 2026-07-09 — ProfileFrame 기본 레이아웃 (중앙광장 스킨)

**구조**

- `ProfileFrame` 컨테이너 추가 — 중앙광장 프로필 PNG를 `contain`으로 원본 비율 표시
- 오버레이 레이어 8개 placeholder: `userIdLayer`, `levelLayer`, `fameLayer`, `expLayer`, `alignmentMapLayer`, `achievementLayer`, `activitySummaryLayer`, `territoryRecordLayer`
- `territorySkin` 상수 준비: `center` / `pioneer` / `guardian` / `alien` (center만 실제 PNG)
- 기존 프로필 HTML·ID는 `profile-citizen-card__legacy`에 보존 (hidden)

**에셋**

- `public/assets/territories/profiles/center.png` — 중앙광장 프로필 기준 이미지 (1024×819)

**미구현 (의도적)**

- 데이터 연결, 텍스트·숫자·게이지, hover/click/animation, 반응형 세부 좌표 조정

---

### ★ 2026-07-05 저녁 — 프로필 방향·에셋 v1 확정 (문서)

**확정 방향**

- 프로필 스킨(시안 PNG)은 **아직 Cursor 미적용** — 별도 작업으로 보류
- **영토 시민 카드** 게임형 HUD 유지 · **유저가 주인공**, 영토는 배경
- 좌 **전신 아바타** · 우 닉네임/Lv/명성/XP/보조배너/레이더
- 신념 배너는 보조 — 유저보다 주인공처럼 보이면 안 됨
- 성향 **레이더만** · 가로 게이지·퍼센트 **사용 안 함**
- **가입일 제외** · **소속 중복 금지**

**항목 명칭 정리**

- 활동 요약: 작성 글 / 댓글 / 받은 공감 / **토론 참여** / **전달한 아우라** (팔로워 우선순위 ↓)
- 전달한 아우라: 다른 시민에게 남긴 영향력 누적 지표 (글·댓글·토론·공감·상호작용)
- 영토 기록: 최초·현재 소속 / 이동 횟수 / **시민 영향력** / 시민 등급 (~~명명된 점수~~ 폐기)
- 성향 지도 아래 **AI 한 줄 설명** 영역 예정 (수치 대신 변화 흐름)

**공식 에셋 v1**

- `public/assets/territories/banners/` — reform · centrist · order · alien `.webp`
- `public/assets/territories/emblems/` — 동일 4종
- 매핑: 개척(파랑·검+날개) / 중앙(초록·신전) / 수호(빨강·방패+검) / 외계(보라·수정)

**코드 작업 (오늘)**

- 에셋 WEBP 8종 정리 · CSS 변수 1차 연결 · 시민 카드 2열 골격 · 패널 스크롤 안정화

**내일 TODO:** `docs/TODO.md` §「다음 작업 — 프로필 마무리」1~10

### ★ 프로필 패널 레이아웃 안정화

- `.avatar-dock__panel` 세로 스크롤 허용 (`overflow-y: auto`)
- flex `min-height: 0` / `overflow: hidden` 압축 제거 → 콘텐츠 자연 높이
- 보조 배너 72px 고정, 성향 레이더 `min-height: 150px`

### ★ 영토 시민 카드 레이아웃 골격 재정렬 (시안)

- 상단 전체 배너 제거 → `.profile-main-zone` 내부 보조 배너(80~110px)
- `.profile-citizen-card__body` 2열: `.profile-avatar-zone` | `.profile-main-zone`
- 좌: 전신 아바타 세로 카드 + `--profile-territory-emblem-url`
- 우: 닉네임/Lv/명성/XP → 배너 → 레이더+성향 설명
- 하단 3카드(대표 업적/활동/영토 기록) 유지

### ★ 영토 배너·엠블럼 에셋 1차 UI 연결

- `public/index.html` — `SC_TERRITORY_BANNERS` / `SC_TERRITORY_EMBLEMS` 상수, `applyProfileTerritoryAssets()` 추가
- `renderTerritoryCreed()` → `#avatar-player-card-wrap`에 `--profile-territory-banner-url`, `--profile-territory-emblem-url` 설정
- 신념 박스(`.profile-citizen-card__belief`) — 공식 배너 hero 표시 (gradient·워터마크 제거, HTML 텍스트 sr-only)
- 기존 `territory-icons` PNG 참조 유지

### ★ 영토 배너·엠블럼 에셋 정리

- `public/assets/territories/banners/` — reform / centrist / order / alien `.webp` 4종 추가
- `public/assets/territories/emblems/` — reform / centrist / order / alien `.webp` 4종 추가
- PNG 소스 → WEBP 변환 (`tools/convert-territory-assets.py`); HTML/CSS/JS 연결 없음

### ★ 프로필 HUD 최종 다듬기 (Grid 유지)

- Lv / 명성 / 시민등급 → `profile-header__infobar` 단일 정보 바로 통합
- `profile-main` stretch 제거 → 신념·경험치 아래 빈 공간 축소
- 신념 카드 높이 ~25% 축소, motto 글자 크기 확대 (`white-space: pre-line` 유지)
- 아바타 카드 프레임·영토 소속 foot 강화 (`avatar-card-territory-name` 노출)
- 성향 레이더 제목 시각 숨김, 차트 ~12% 확대 (9.5rem)
- 하단 3요약 카드 padding/gap/font ~12% 압축
- 모바일(767px↓)만 프로필 내부 스크롤 허용

### ★ 영토 시민 카드 레이아웃 재정렬

- `profile-citizen-card` 단일 카드: 신념 crest → 아바타·성향·시민정보 body → 시민 기록 footer
- 영토 신념·엠블럼을 카드 상단 hero로 승격 (워터마크·영토 그라디언트)
- 아바타·성향 레이더·하단 기록을 카드 내부 구역으로 통합 (개별 패널 테두리 제거)
- 패널 제목 "영토 시민 카드"로 변경

_다음 우선순위는 TODO.md 참조_

---

## 2026-07-04

### ★ 오늘 작업 요약

- 메인 영토맵을 신규 16:9 원시시대 버전으로 교체
- 영토 명칭을 **개척영토 / 중앙광장 / 수호영토 / 외계행성**으로 통일
- `territory-beliefs.js` 기반 공식 신념 시스템 적용
- 영토 엠블럼 및 신념 이미지 교체
- 메인맵 레이아웃 확대 및 화면 최적화
- 프로필 UI를 기존 레이아웃에서 **Grid 기반 구조**로 재설계 시작

### 메인맵 · 영토

- tribal-s1 원시시대 16:9 지도 에셋 적용 (`territory-zones-tribal-s1.png`)
- `territory-hit-zones.json` — viewBox `0 0 1600 900`, 4영역 좌표 재조정
  (`progressive` / `conservative` / `plaza` / `kantapbiya`)
- 메인맵 표시 영역 확대 및 HUD 레이아웃 화면 최적화

### 신념 · 엠블럼

- `public/territory-beliefs.js` — Single Source of Truth, `renderTerritoryCreed()` 연동
- 영토별 엠블럼 PNG 교체 (`assets/territory-icons/`)
- 프로필 신념 HUD: 엠블럼 + `belief` 문장 + `displayName`의 신념

### 프로필 UI (Grid 재설계)

- **상단** `profile-main`: 사이드바(아바타+4축 레이더) | 메인(헤더+신념+경험치)
- **하단** `profile-summaries`: 대표 업적 · 활동 요약 · 영토 기록 3카드
- 오른쪽 정치 성향 가로 게이지 제거 → 좌측 4축 성향 레이더로 통합
- 패널 폭 48rem → 56rem, 반응형 브레이크포인트(767/1199px)
- 뷰포트 높이 최적화: 패널 세로 스크롤 제거, 여백·신념 카드·레이더 축소, 하단 3카드 첫 화면 노출

---

## 2026-07-02 (오늘)

### ★ 영토 명칭 전면 통일

- **개혁영토** → **개척영토** (내부 ID `PROGRESSIVE` / CSS key `reform` 유지)
- **질서영토** → **수호영토** (내부 ID `CONSERVATIVE` / CSS key `order` 유지)
- **깐따삐아** → **외계행성** (내부 ID `KANTAPBIYA` 유지)
- 적용 범위: `public/index.html`, `public/permissions-guide.js`, `config/world-territories.js`, `config/alignment-rank-limits.js`, `docs/`
- 성향 게이지 라벨: "개혁%/질서%" → "개척%/수호%"
- TOP3 헤더: "개혁 · TOP3" → "개척 · TOP3", "질서 · TOP3" → "수호 · TOP3"
- 인기댓글 섹션: "개혁 인기댓글" → "개척 인기댓글", "질서 인기댓글" → "수호 인기댓글"
- 호감도 라벨: "개혁 호감도" → "개척 호감도", "질서 호감도" → "수호 호감도"
- aria-label, 게시판 해금 안내, 진영 이동 레이블 등 모든 사용자 노출 문자열 교체

### ★ 영토 신념 데이터 파일 분리 (`public/territory-beliefs.js` 신규 생성)

- 신념 데이터의 **Single Source of Truth** 확립
- `window.TERRITORY_BELIEFS` 으로 전역 노출 (IIFE 패턴)
- 데이터 구조:
  ```js
  {
    displayName : '개척영토',
    subtitle    : '변화를 만드는 사람',
    belief      : '미래는 기다리는 것이 아니라,\n개척하는 것이다.',
    philosophy  : '변화를 두려워하지 않고\n새로운 가능성을 향해 나아간다.'
  }
  ```
- `philosophy` 필드: 데이터에만 존재, 프로필 미노출 (향후 영토 소개·툴팁 활용)
- `index.html` 에서 `<script src="/territory-beliefs.js">` 로 가장 먼저 로드

### ★ 프로필 신념 HUD — 외부 데이터 연동

- `index.html` 인라인 `TERRITORY_BELIEFS` 상수 제거
- `renderTerritoryCreed()` → `window.TERRITORY_BELIEFS[cssId].belief` 참조로 교체
- HUD 서브텍스트: `displayName` 기반으로 "— 개척영토의 신념 —" 동적 생성
- `.avatar-territory-creed__motto` CSS에 `white-space: pre-line` 추가 (`\n` 줄바꿈 적용)

### 신념 문장 최종 확정

| 영토 | 신념 |
|------|------|
| 중앙광장 | "답은 하나가 아니라, 함께 찾는 것이다." |
| 개척영토 | "미래는 기다리는 것이 아니라, 개척하는 것이다." |
| 수호영토 | "질서는 자유를 지키는 가장 강한 약속이다." |
| 외계행성 | "경계 밖의 시선은 새로운 문명을 만든다." |

### 신념 JS 데이터 구조 개선 (`headline` → `belief` + `philosophy` 분리)

- 기존 `headline` 단일 필드 → `belief` (표시용) + `philosophy` (보관용)
- `title` 필드 → `displayName` + `subtitle` 필드로 대체 (표시명과 부제 분리)

---

## 2026-07-02 (오전)

### 영토 신념 HUD — JS 동적 렌더링 전환

- 기존: HTML에 4개 영토 문구 하드코딩 + CSS `display:none`/`block` show/hide
- 변경: HTML 2개 동적 element (`#avatar-creed-motto`, `#avatar-creed-sub`)
- `TERRITORY_BELIEFS` 상수 정의 → `setMeta()` 내 `renderTerritoryCreed()` 호출
- `TERRITORY_CSS_MAP` 추가: `COMMON→centrist`, `PROGRESSIVE→reform`, `CONSERVATIVE→order`, `KANTAPBIYA→alien`
- CSS `[data-for]` show/hide 선택자 전체 제거
- `data-territory` 동기화: panel, badge, cardWrap 모두 `renderTerritoryCreed()` 내에서 갱신

---

## 2026-07-02 (하단 가독성 정리)

### 하단 활동 영역 가독성 개선 (`public/index.html`)

- `avatar-deco-panel__label` 색상 조정: `#334155` → `#64748b`
- `avatar-deco-panel__value--empty` 색상 조정: `#1e293b` → `#475569`
- 잠금 슬롯 opacity: `0.45` → `0.65`
- sticky 헤더 `backdrop-filter: blur(8px)` 제거 → 스크롤 하단 콘텐츠 블러 해소
- 활동 카드 라벨 색상: `#64748b` → `#94a3b8`
- 접기 버튼 row `margin-top: 0.15rem` 추가

---

## 2026-06-28

### 영토 신념 HUD + 성향 HUD 리디자인 (commit: `0b43d7b`)

#### 소속 배너 HUD Banner화
- `flex` 전환, `align-self: stretch` (전폭 소속 배너)
- `min-height: 44px`, `padding: 0.7rem 1.1rem`, `border-radius: 12px`
- 영토별 색상 체계 적용: centrist → 녹색(`#3DFFB3`), reform → 파랑(`#5AA8FF`), order → 빨강(`#FF5A5A`), alien → 보라(`#C77DFF`)
- `box-shadow: 0 0 14px rgba(영토색, 0.18)` glow 추가

#### 영토 신념 HUD (신규 섹션)
- `div.avatar-territory-creed` 신규 추가 (소속 배너 바로 아래 배치)
- 신념 문장 4종 (영토별 HTML `data-for` 속성으로 관리)
- 워터마크: `::before` 가상요소 (🏛/⚡/🛡/🪐), `font-size: 7rem`, `opacity: 0.07`
- `data-territory` 변경으로 배경·문장·워터마크·텍스트색 전체 자동 전환
- 높이: `min-height: 4.5rem` (와이드 배너 형태)
- 신념 문장: `font-size: 1.38rem`, `font-weight: 800`, `max-height: 2.6em` (2줄 제한)

#### 성향 HUD 업데이트
- 아이콘 크기: `1.15rem` → `2.2rem` (게이지와 균형), `1.9rem` (엠블럼)
- 아이콘·게이지 간격 gap: `0.4rem` → `0.28rem`
- 게이지 색상 업데이트:
  - centrist: `#3DFFB3 → #8CFFD9`
  - reform: `#5AA8FF → #A5D4FF`
  - order: `#FF5A5A → #FFB1B1`
  - alien: `#C77DFF → #E6B3FF`
- `avatar-dock__panel[data-territory]` 선택자 기반 게이지 자동 색상 전환

---

## 2026-06-26

### 영토 소속 배지 HUD 개선

- `avatar-territory-badge` 구조 확립
  - `span.avatar-territory-badge__icon` (영토 아이콘)
  - `span#avatar-meta-territory` (영토명)
  - `span.avatar-territory-badge__suffix` ("주민")
- `div.avatar-player-info-sub` 추가 (Lv + 명성 보조)
- `p#avatar-meta-summary` → `avatar-dock__sr-only` (JS 연산용, 화면 비표시)

---

## 2026-06-26 (이전)

### 영토 프로필 패널 플레이어 카드 리디자인 (commit: `3767bd2`)

#### Part 8 — 영토 소속 시각화
- `avatar-territory-badge` 도입 (`data-territory` 기반)
- 영토 전용 표시 (배지 > 레벨 > 명성 정보 흐름)

#### Part 7 — 프로필 탭 전환 애니메이션
- `.avatar-dock__tab` hide → `opacity: 0; visibility: hidden; transform: translateY(0.35rem)` 전환
- `display: none` 대신 transition 기반 (레이아웃 안정성)

#### Part 6 — 접기 버튼 위치 변경
- 헤더에서 제거 → 패널 하단 `div.avatar-panel-close-row`로 이동
- "당기듯 열고 밀어서 닫는" UX

#### Part 5 — 플레이어 카드 4:5 비율 + 명예 장식 분리
- 카드 비율: `3:4` → `4:5`
- 명예 장식 슬롯(프레임/칭호/휘장/오라)을 카드 영역에서 → 패널 하단 영역으로 분리
- 패널 폭: `34rem` → `48rem`
- 좌측 카드 폭: `8.5rem` → `18.5rem`

#### Part 4 — 2열 레이아웃 도입
- `avatar-panel-body`: 2열 grid (좌: 플레이어 카드, 우: 정보)
- `avatar-player-card` 신규 (영토 하단바 아이콘 구조 포함)
- `avatar-honor-slots` 명예 장식 슬롯 UI

#### Part 3 — 아바타 슬롯 HUD화
- "잠금 이미지" 아바타 변경, "업로드" → "편집"
- 미래형 프로필 HUD 형태의 슬롯
- 빈 이미지: SVG + "SLOT" 텍스트

---

## 2026-06 (중앙광장 레이아웃 개편, commit: `3767bd2`)

### 전체 중앙광장 레이아웃 개편

- 기존 순서: 데일리 이슈 → 인기글/실시간 현황/영토 현황(2열) → 게시글 → 사이드바
- 구 "보드 정보" 섹션을 게시글 탭에서 → 별도 보드 정보 섹션으로
- 하단 헤더 blur 고정 요소 제거

### 정보 카드 디자인 통일

- 데일리 이슈 / 인기글/실시간 현황 / 영토 현황 카드 공통 스타일 정착
- border-radius, border, padding, gap, 색상 통일
- 좌측 accent line 강조

### 시각 정보 계층화(Hierarchy) 정립

- 데일리 이슈(Primary): 굵은 accent line, background 5~8% 흐림, shadow 강화
- 인기글/실시간 현황/영토 현황(Secondary): 조금 작은 사이즈
- 게시글(Passive): 최소화

### 게시글 카드 레이아웃 최적화

- 카드 내부 padding 20~30% 축소
- 카드 간 margin 축소
- 반응 버튼 compact 구성 (사용자 참여 기반, 나머지 숫자 제거)
- 붙여넣기 버튼 카드에서 제거
- 하드 정보 한 줄 정리 (작성자 · 날짜 · 카테고리)
- 게시글 목록 1열 + 구분선

---

## 2026-06 (UI Kit 구축, commit: `3767bd2` 이전)

### 전체 UI Kit / 디자인 시스템 구축

- CSS 변수 시스템 전체 도입 (`--sc-sp-*`, `--sc-r-*`, `--sc-bc-*`, etc.)
- 버튼 Primary/Secondary 스타일
- 카드 공통 스타일
- 섹션 헤더 스타일
- 인풋 필드 스타일
- 배지(Badge), 태그(Tag) 공통 컴포넌트 이식
- 패널 공통 border/radius/background
- 입력창 스타일 통일
- Transition 속도 통일 (`--sc-ease`)

---

## 2026-05 이전 (기반 구축)

### 초기 기반 구축

- Express 서버 + Supabase 연동
- 영토 지도 (SVG 히트존, PNG 배경 배치)
- 게시판 시스템 (중앙광장/개척/수호/외계행성)
- 데일리 이슈 시스템
- 팔로우 시스템
- 레벨/XP/명성 config 정의
- 성향 시스템 config 정의
- 외계행성 추방/체류 UI
- 알림 데이터 구조
- 히스토리 탭
- 게시글 상세 화면
- OAuth 소셜 로그인 버튼 (Google, Apple, Kakao, Naver)
- 게스트 모드
