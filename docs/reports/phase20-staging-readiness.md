# Phase 20 Step 1 — Staging readiness (조사·정적 분석)

## 0. 기준

기준 HEAD: d80f393e5c3b23cb5ab6674deec72c88236b7e80  
브랜치: cursor/map-layout-cards-bc3c  
PR: #1 유지  
본 작업: 코드 변경 없음(구현 결함 신규 발견 없음). 19차 격리 PG 테스트 재실행 없음. 운영 Supabase·운영 DB·유료 API·실게시·migration apply 없음.

---

## 1. Supabase Auth — 스테이징 실가입·로그인·세션·관리자 역할

### Docker 없이 별도 스테이징 Supabase 가능 여부

가능. Supabase Cloud 프로젝트만으로 Auth·Postgres·SQL Editor·Dashboard 설정이 가능하며 로컬 Docker는 필수 아님.

운영 프로젝트(ref 문서상 Production과 분리된 dev: `sentencearena-dev`, ref `wzpreuseuiuzwpoqqckr`)는 STATE §17에서 회원·ADMIN·OWNER 검증 PASS 기록이 있음. Production(ref `rlzltrwwamrgrfwlaqxj`)은 본 조사에서 사용하지 않음.

스테이징 권장: 운영과 분리된 Supabase 프로젝트 1개(기존 dev 재사용 또는 신규 staging 전용). 신규 프로젝트도 무료 tier로 Docker 없이 가능. 비용은 tier·사용량에 따름(한도 초과 시 불명).

### 서버(앱) 측 필수 환경변수 (값 기록 금지 — 이름만)

| 변수 | 용도 |
| --- | --- |
| SUPABASE_URL | Auth API·프로젝트 엔드포인트 |
| SUPABASE_ANON_KEY 또는 SUPABASE_PUBLISHABLE_KEY | 서버 Auth 로그인·세션 검증 (`server/supabase-server-auth-config.js`). service-role Auth 폴백 없음 |
| SUPABASE_SERVICE_ROLE_KEY | alignment persist·일부 서버 RPC·관리 배치. 브라우저·로그인 경로 금지 |
| APP_PUBLIC_ORIGIN | OAuth redirect·CORS 기준 origin (스테이징 URL로 별도 설정) |
| NODE_ENV | production 시 legal gate·fail-closed 동작 |
| LEGAL_GATE_ENFORCE | Production 동등 검증 시 1 (스테이징 정책에 맞게) |

### Supabase Dashboard 측 (키 값 제외)

- Authentication: Email/OAuth provider 활성화
- OAuth redirect: `https://<project>.supabase.co/auth/v1/callback` + 앱 `APP_PUBLIC_ORIGIN/auth-v2/callback.html` (`.env.production.example` C절)
- Kakao/Naver client secret: Supabase Custom OAuth에만 (Railway/서버 env에 넣지 않음)
- 관리자 역할: Auth 사용자 `app_metadata.role` = `ADMIN` 또는 `OWNER` (`server/daily-issue-admin-auth.js`, `createAdminAccessGuard`). `user_metadata`만 ADMIN인 계정은 403

### 스테이징 Auth REAL 검증 (19차 대비 미완)

- Daily Issue 긴급 중지 API: 19차 5단계는 mock guard만 PASS, `DAILY_ISSUE_REAL_AUTH_INTEGRATION` + Supabase URL 미설정 시 REAL AUTH BLOCKED (`phase19-step5.md`)
- Activity region 통합: `tools/test-activity-region-auth-env.js`는 REAL Supabase 없으면 BLOCKED 설계

준비됨: 코드·mock 테스트·dev 프로젝트 존재(과거 PASS 기록)  
미준비: 스테이징 origin + env + REAL JWT로 halt·board·DI admin end-to-end 미기록(본 step)

---

## 2. 스테이징 DB migration — 의존 순서·정적 분석 (apply 없음)

### A. public schema — SSOT

`shared/production-public-migration-core.js`의 REQUIRED 체인(요약):

1. `schema_profiles_identity_history.sql` (profiles, identity_history, on_auth_user_created)
2. `migration_handle_new_user_emailless_oauth.sql` → `migration_activity_name_unique.sql`
3. `migration_canonical_user_territory.sql` + `migration_canonical_territory_central_start.sql`
4. `migration_board_core_system.sql`
5. progression 계열: `user_progression_canonical` → `events_xp` → `empathy_received_fame_rpc` → revoke
6. achievements 계열: persist → grant → notified → service_role_select
7. `migration_political_alignment_persistence.sql` → `beta_v1` → `alignment_self_direction_streak_v1`
8. `migration_alien_moderation_v1` → `alien_operator_review_v1`
9. `migration_account_withdrawal_v1`
10. `migration_legal_gate_v1`
11. `migration_rights_infringement_v1`

별도 전용 apply로 Production에 이미 올라간 항목은 OPTIONAL_LATER에 명시(retention, signup_completed_at, misinfo, legal_territory_disclosure 등). 전체 REQUIRED 재실행 대상 아님.

STATE §17: dev에만 적용·Production 미적용 — `migration_service_role_route_min_grants_v1.sql`, `migration_audit_withdrawal_set_null_v1.sql` (Production 탈퇴·제재 이력 계정 실패 가능).

### B. daily_issue schema — SSOT

`shared/daily-issue-production-migration-core.js` 순서(6개):

1. review_lifecycle  
2. morning_scheduler  
3. alignment_seed_v1  
4. comments_v1  
5. account_withdrawal_v1  
6. ops_workflow_v1  

격리 PG harness(`tools/lib/daily-issue-local-pg-harness.js`)는 위 6개 다음에 추가:

7. `migration_daily_issue_us_region_candidate.sql`  
8. `migration_daily_issue_phase19_safety_v1.sql` (halt, US scheduler runs, lease 컬럼)

### C. 정적 분석 — 누락·충돌·RLS

| 이슈 | 분류 | 설명 |
| --- | --- | --- |
| phase19 safety + US region | catalog 누락 | production-public / daily-issue production core 6개에 phase19·us_region 미포함. 스테이징 daily_issue에 halt·US SQL store 없으면 19차 코드 경로 미검증 |
| activity_region_v2 | catalog 누락·후보 | 파일 헤더 PLAN ONLY. `production-public-migration-core` REQUIRED 없음. 앱 board/DI activity_region 컬럼은 코드·dev 테스트 전제 |
| activity_region_legal_consent_candidate | 후보 전용 | US 18세·동의 테이블 후보. CANDIDATE ONLY, legal review 미완 |
| migration_user_data_system.sql | DO_NOT_APPLY | draft; progression canonical이 대체 |
| migration_alignment_system.sql | DO_NOT_APPLY | 구 schema, beta_v1과 충돌 위험 |
| phase19 halt/US RLS | deny_all | anon/authenticated 전면 거부 — 서버 service_role·직접 SQL 연결 전제(클라이언트 직접 접근 불가) |
| legal_gate RLS | authenticated 본인 | DOB 미저장 정책은 migration/legal-gate-core와 일치 |
| public vs daily_issue | schema 분리 | DAILY_ISSUE_DATABASE_URL + DAILY_ISSUE_DB_SCHEMA=daily_issue. Supabase Auth DB와 동일 Postgres일 수 있으나 schema 분리 |

apply 금지 준수: 본 step에서 SQL 실행 없음.

---

## 3. KR/US 공통 회원·국가별 활동 — 스테이징 통합 검증 항목(확정)

공통 계정 1 auth.users / profiles 1행. 활동은 `activity_region` KR|US로 분리(코드·v2 migration 설계).

| # | 항목 | 기대 | 근거 |
| --- | --- | --- | --- |
| M1 | 이메일/OAuth 가입·로그인·세션 유지 | 200, `/api/supabase-config` configured | STATE §17 member flows |
| M2 | 신규 territory CENTRAL, 가입 시 영토 선택 없음 | profiles.territory | DEC-002, LAUNCH_FINALIZATION |
| M3 | KR activity: board list/write, DI list/comment/reaction | activity_region=KR 또는 legacy NULL→KR | activity_region_norm |
| M4 | US activity: US board/DI 필터, US DI ingest group | 명시 US 저장 | migration_activity_region_v2 주석 |
| M5 | US 가입 만 18세 | AGE_UNDER_18 403, DOB 미저장 | `shared/legal-gate-core.js` US_MIN_AGE=18 |
| M6 | KR 가입 만 14세 | AGE_UNDER_14 | 동일 core |
| M7 | 정치성향 민감정보 동의·영토 공개 동의 | legal gate 완료 전 READY/startCore 금지 | legal_gate_v1 |
| M8 | US region legal consent (후보 테이블) | candidate migration 적용 시에만 DB persist 검증 | activity_region_legal_consent_candidate |
| M9 | sensitive consent 철회 | withdrawal tx, batch recheck candidate | migration_sensitive_consent_withdraw_tx_v1 등 |
| M10 | MEMBER → admin API 403 | board/DI admin | createAdminAccessGuard |
| M11 | ADMIN/OWNER Bearer JWT → admin API 200 | app_metadata.role only | daily-issue-admin-auth |
| M12 | 긴급 중지 GET/POST KR·US | REAL JWT (19차 mock 외) | phase19 routes |
| M13 | 탈퇴·제재 이력 계정 탈퇴 | audit NULL migration 후 | audit_withdrawal_set_null |

---

## 4. 실제 RSS — READY 0 원인 (정책 완화 없음, 19차·STATE 숫자 재사용)

19차 RSS 무료 진단 스크립트: `tools/test-phase19-daily-issue-rss-free.js` — 출력 형식 `PHASE19_RSS_DIAG ready=N autoEligible=M sources=S` (본 step 재실행 없음).

STATE §5 US edition (2026-11-04 phase 12, branch 맥락):

- LIVE QUARANTINED 주원인: `SINGLE_DOC` / 독립 언론 2곳 미달
- FRB 단독·NPR World만 활성일 때 `sinceHours:72`에서 `STALE_ITEM` 다수 → run outcome `ZERO_NORMAL`(COLLECT_FAILED 아님)
- 검증 feed 추가 후(NPR News, CBS, White House 등) multi-source cluster 시 READY 가능 — Production 연동·공개 발행 주장 없음
- AP top feed: DNS 미검증으로 enabled:false 유지
- `independentNetworkKey`(NPR News+World=1 network), journalism-only cross-source, `CROSS_EVENT_CLUSTER`로 후보 분리

phase 18 fixture 진단(`tools/test-phase18-ready-zero-mock.js`): 빈 피드 → READY 0 + outcome 기록; 후보별 bucket(`tools/lib/daily-issue-us-quarantine-report.js`): INDEPENDENT_SOURCE_INSUFFICIENT, FRESHNESS_STALE, CROSS_VERIFICATION_FAILED 등.

역사적 KR world dry-run(AI_HANDOFF): multiSource 3, READY 2 — US와 별도.

READY 0이 “고장”이 아닌 경우: 교차 출처·확정 사실· freshness 정책 미충족 시 QUARANTINED/ZERO_NORMAL은 설계상 정상.

---

## 5. OpenAI 연결 — 환경·제한·비용·키 보호 (호출 없음)

### 환경변수 (이름만, `config/daily-issue-ai-env.js`)

공통/대체:

- OPENAI_API_KEY 또는 DAILY_ISSUE_AI_API_KEY
- DAILY_ISSUE_AI_MODEL / OPENAI_MODEL (기본 gpt-4o-mini)
- DAILY_ISSUE_AI_TIMEOUT_MS (5s–120s, 기본 45s)
- DAILY_ISSUE_AI_MAX_RETRIES (0–3, 기본 1)
- DAILY_ISSUE_AI_MAX_CALLS_PER_RUN (1–5, 기본 1)
- DAILY_ISSUE_AI_MAX_USD_PER_RUN (기본 0.08 USD/run 상한)

리전:

- US: DAILY_ISSUE_US_AI_API_KEY, DAILY_ISSUE_US_AI_MODEL, DAILY_ISSUE_US_AI_ENABLED=false 로 차단 가능. US pipeline 기본 enabled unless false
- KR: DAILY_ISSUE_KR_AI_ENABLED / DAILY_ISSUE_AI_ENABLED=true 필요 + key

격리 LIVE 테스트 게이트: DAILY_ISSUE_AI_ISOLATED_LIVE_TEST 등 (유료 호출은 명시 opt-in)

### 호출·보호

- `server/daily-issue-openai-adapter.js`: server-only fetch, apiKey 로그 금지, 401/403→AI_AUTH_ERROR, 429→AI_RATE_LIMIT
- `tools/test-phase18-ai-cost-mock.js`: estimatedUsdSoFar 상한 초과 시 AI_COST_LIMIT (mock, LIVE NOT_RUN)
- STATE: External LLM not configured in repo (rule-engine path)

예상 비용 상한(코드 기준, 실제 요금은 OpenAI pricing·토큰량 의존): run당 maxEstimatedUsdPerRun 기본 0.08 USD × maxCallsPerRun(≤5) → 설계상 run당 약 0.08 USD cap(phase18 mock). 월간 총비용은 스케줄·슬롯 수 미정 → 불명.

---

## 6. 실알림·스케줄·긴급 중지 — 스테이징 검증 항목

### 실알림

- 신고 처리 결과: `user_moderation_notifications` + moderation inbox (DEC/report-result-notification-core). reporter별 dedupe
- `GET /api/users/me/notifications`: STATE §17 — USER_DATA_API_NOT_ACTIVATED (베타 차단 아님, 별도 API)
- 스테이징: 제재·신고 처리 후 inbox UI/API 노출, dedupe, 제재 상세 미공개

### 스케줄 (스테이징은 OFF→단계적 ON)

| 스케줄 | env | 스테이징 검증 |
| --- | --- | --- |
| KR morning collect/publish | DAILY_ISSUE_MORNING_SCHEDULER_ENABLED, DAILY_ISSUE_MORNING_AUTO_PUBLISH | DB daily_issue + /ready, 수동 run smoke 후 ON. 04:30 collect 승인대기, auto publish 정책은 DEC-019와 별도 ops |
| US daily slots | US run service + SQL store (phase19) | DAILY_ISSUE_DATABASE_URL, phase19 migration, ET slot, 일 3건 cap |
| Political 05/17 KST | POLITICAL_ALIGNMENT_SCHEDULER_ENABLED | 기본 OFF, missed catch-up 없음 |

Production policy ON이나 NAVER process stopped(2026-10-14) — 스테이징 호스트에서 process·cron 실제 기동 검증 필요.

### 긴급 중지 관리자

- GET/POST `/api/admin/daily-issues/emergency-halt/:region` — Supabase JWT ADMIN/OWNER
- KR/US 독립 halt row, publish TX lock (19차)
- 스테이징: REAL JWT POST halt on → publish 차단 → halt off, audit row, US/KR 분리

---

## 7. 출시 차단 P0 / P1

### P0 — 베타 전 반드시

환경·운영 미준비:

- Launch Finalization 미확정(사업자·시행일·공개 약관 링크 등) — STATE §17
- 스테이징 앱 호스트: NAVER app server stopped; 스테이징 URL·env·/ready 미구성
- Production Supabase에 phase19 daily_issue migration 미적용(19차 보고)
- REAL Supabase JWT로 DI halt·admin API 미검증(19차 REAL AUTH BLOCKED)
- daily_issue 스테이징: production core 6 + us_region + phase19 apply 계획·검증 없음
- activity_region_v2 / US legal consent candidate: staging DB 계획 없으면 US 베타 UI·DB 불일치
- Production: audit_withdrawal_set_null 미적용 시 제재 이력 탈퇴 실패(STATE)

구현 결함(P0 코드):

- 본 step 정적 조사에서 신규 P0 코드 결함 확인 없음(19차 5단계 PASS 범위는 격리 PG·mock)

### P1 — 베타 직후·병행

- OpenAI LIVE 연동·비용 모니터링(현 NOT_CONFIGURED)
- USER_DATA_API notifications 별도 활성화 여부
- rights_email_verify 등 OPTIONAL migration
- AP RSS DNS 검증 후 enable
- Production Chrome OWNER legal_hold live (STATE §9, 코드 blocker 아님)
- political/alien scheduler ops ON 여부 운영자 결정

---

## 8. 베타 외부 계정·서버·비용 (기존 자원 우선)

| 자원 | 상태 | 비고 |
| --- | --- | --- |
| Supabase dev/staging project | 있음(dev 기록) | Docker 불필요. 신규 staging project는 선택 |
| NAVER Cloud (sentencearena.com) | 있음, process stopped | 재기동·스테이징 subdomain은 ops 승인 필요. 비용: 인스턴스 spec 불명 |
| OAuth (Google/Kakao/Naver) | 기존 콘솔 재사용 | 스테이징 redirect URL 추가만(신규 결제 불필요) |
| OpenAI | 계정·키는 운영자 보유 가정 | 본 step 호출 없음. 사용 시 run cap 0.08 USD(코드) |
| Railway | CHANGELOG 역사 | 현 SSOT는 NAVER; Railway 신규 가입 요구 없음 |
| Domain/DNS | sentencearena.com | 스테이징 origin 별도 필요 시 DNS만(비용 불명) |

불필요한 신규 유료 가입·결제 요구 없음. 스테이징 최소: Supabase(기존 dev)+로컬 또는 stopped NAVER 재시작+env.

---

## 9. 확인한 설정·준비·미준비·해결 우선순위

### 확인한 설정(저장소·문서)

- Auth env 이름: `.env.example`, `.env.production.example`, `supabase-server-auth-config.js`
- Migration catalog: `production-public-migration-core.js`, `daily-issue-production-migration-core.js`, harness order
- Admin role: app_metadata.role ADMIN|OWNER
- RSS/READY 원인: STATE phase 12 + phase18/19 진단 도구
- AI env/cap: `daily-issue-ai-env.js`, phase18 cost mock

### 준비됨

- 코드·mock·격리 PG 19차 PASS(재실행 없음)
- sentencearena-dev 회원·admin PASS 기록(2026-10-25)
- migration 정적 catalog·게이트 도구(`run-daily-issue-production-migrate.js`, public schema check)

### 미준비

- 스테이징 end-to-end(REAL Auth, phase19 DB, US activity legal DB, 호스트 /ready)
- Launch Finalization
- OpenAI LIVE
- phase19 SQL on any shared staging daily_issue schema(apply·검증 없음)

### 해결 우선순위

1. P0: 스테이징 Supabase+env+APP_PUBLIC_ORIGIN, public+daily_issue migration apply 계획(phase19 포함) — 승인 후 apply  
2. P0: REAL JWT admin·halt·member flows checklist M1–M13  
3. P0: Launch Finalization + 공개 법률 링크  
4. P0: 스테이징 앱 프로세스·/ready·DAILY_ISSUE_DATABASE_URL  
5. P1: OpenAI opt-in·cap 모니터링  
6. P1: RSS AP enable·알림 API roadmap  

---

## 10. 베타 출시 판정

본 문서는 스테이징 준비 조사만 수행. 베타 출시 가능 판정하지 않음.
