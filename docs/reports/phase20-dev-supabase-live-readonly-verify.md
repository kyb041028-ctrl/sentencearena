# Phase 20 Step 5 재검증 — sentencearena-dev live read-only

판정: BLOCKED

기존 `docs/reports/phase20-dev-supabase-readonly-audit.md` 는 대체하지 않는다. 이 파일은 같은 브랜치 위의 재검증 기록이다.

## 1. 기준

기준 커밋: a0102c91f9c3ef6b38ab85f7fb50a961d3833924
브랜치: cursor/map-layout-cards-bc3c
PR: #1 유지. master 병합 없음. 새 PR 없음.
작업 트리: 기존 체크아웃의 워킹트리는 수정하지 않음. 이 브랜치가 이미 붙어 있는 별도 worktree에서 이 보고서만 추가.
서비스 코드·migration·DDL·데이터 변경 없음.

## 2. 접속 성공 여부

실제 DEV 접속: 아니오.
PostgreSQL 세션을 열지 않았다. API도 호출하지 않았다.
LIVE PASS 아님. 스키마 live 판정은 전부 UNKNOWN.

## 3. 대상 증거 (ref만)

허용 대상: 프로젝트 sentencearena-dev, ref wzpreuseuiuzwpoqqckr.
이번 세션에서 그 ref가 들어 있는 연결 설정: 없음.

로컬 체크아웃 `.env` 는 있다. 값·URL 전체·키·비밀번호·토큰은 기록하지 않는다.
그 파일에서 확인한 이름만:

- SUPABASE_URL: 있음. API 호스트에서 프로젝트 ref 식별됨.
- DAILY_ISSUE_DATABASE_URL: 있음. PostgreSQL 사용자 `postgres.<ref>` 형태로 ref 식별됨.
- 두 ref는 서로 같다.
- 그 ref는 wzpreuseuiuzwpoqqckr 가 아니다.
- 그 ref는 이번 작업에서 금지한 운영 ref rlzltrwwamrgrfwlaqxj 도 아니다.
- 그 ref는 도구 `tools/apply-service-role-route-min-grants.js` 와 `tools/apply-audit-withdrawal-set-null.js` 의 FORBIDDEN_REFS 에 있는 vmpdddcdnxeavchgivcd 이다.
- 같은 파일의 다른 키에도 wzpreuseuiuzwpoqqckr 문자열은 없다.

식별은 됐다. 대상이 DEV가 아니라서 접속 전에 중단했다. 호스트만으로 또는 사용자만으로 식별이 안 된 경우가 아니다.

Supabase CLI:

- 사용자 폴더 `.supabase` 에는 locks 와 telemetry.json 만 있다. access-token 파일 없음.
- telemetry.json 에 허용 ref와 금지 ref 문자열 없음.
- 프로젝트 `supabase/.temp/project-ref` 없음. `supabase/config.toml` 없음.
- 프로세스 환경변수에 SUPABASE_URL, DATABASE_URL, DAILY_ISSUE_DATABASE_URL, anon/service 키 없음.

`.env.example` 과 `.env.production.example` 은 예시 파일이며 DEV 접속 설정이 아니다.
DEV 전용 설정은 새로 만들지 않았다. 운영 ref rlzltrwwamrgrfwlaqxj 설정은 찾지 못했고, 찾은 비-DEV 설정도 재사용하지 않았다. NAVER 접속 없음.

## 4. 객체 차이

live 카탈로그 SELECT를 하지 않았다. 아래는 GitHub 기준 목록이고, DEV 실재 여부는 전부 UNKNOWN.

공식 public REQUIRED 22 (`shared/production-public-migration-core.js` REQUIRED 길이 22)가 기대하는 테이블:

- profiles: UNKNOWN
- identity_history: UNKNOWN
- board_posts: UNKNOWN
- board_comments: UNKNOWN
- board_reactions: UNKNOWN
- board_reports: UNKNOWN
- user_progression: UNKNOWN
- user_progression_events: UNKNOWN
- user_achievements: UNKNOWN
- user_featured_achievements: UNKNOWN
- user_alignment_state: UNKNOWN
- alignment_batches: UNKNOWN
- alignment_history: UNKNOWN
- alignment_territory_history: UNKNOWN
- user_moderation_state: UNKNOWN
- user_moderation_events: UNKNOWN
- user_moderation_notifications: UNKNOWN
- account_withdrawal_jobs: UNKNOWN
- account_withdrawal_audit: UNKNOWN
- user_legal_consents: UNKNOWN
- rights_infringement_requests: UNKNOWN
- rights_infringement_events: UNKNOWN
- rights_infringement_objections: UNKNOWN
- rights_infringement_abuse_state: UNKNOWN

공식 REQUIRED 컬럼(territory, citizenship_status, exile_strike_count, reaction score snapshot 2개, alignment score/pending_territory, acquisition_notified_at, reputation_score): UNKNOWN

공식 REQUIRED 함수(handle_new_user, protect_canonical_membership_territory, toggle_board_reaction, apply_user_progression_event, revoke_empathy_received_fame, grant_user_achievement, mark_user_achievement_notified, apply_alignment_score_batch, withdraw_account_anonymize): UNKNOWN

게시판 국가 컬럼 (`migration_activity_region_board_scope_candidate.sql`, 공식 REQUIRED 아님):

- board_posts.activity_region: UNKNOWN
- board_comments.activity_region: UNKNOWN
- board_reactions.activity_region: UNKNOWN
- 인덱스 board_*_activity_region_created_idx: UNKNOWN
- 트리거 board_comments_same_activity_region, board_reactions_same_activity_region, board_posts_activity_region_lock: UNKNOWN

국가별 성장 테이블 (`migration_activity_region_progression_scope_candidate.sql`, 공식 REQUIRED 아님):

- user_activity_region_profile: UNKNOWN
- user_activity_region_achievement: UNKNOWN

daily_issue 공식 6파일 객체(실제 schema 이름은 미확인. SQL 원문은 public.daily_issue_* 이고 적용 시 rewrite될 수 있음):

- daily_issue_review_items, daily_issue_sources, daily_issue_evidences, daily_issue_claims 및 연결 테이블, daily_issue_updates, daily_issue_audit_logs, daily_issue_repository_meta: UNKNOWN
- daily_issue_scheduler_runs: UNKNOWN
- daily_issue_reactions, review_items.alignment_direction: UNKNOWN
- daily_issue_comments: UNKNOWN
- daily_issue_recollect_jobs: UNKNOWN

긴급 중지·미국 스케줄 (`migration_daily_issue_phase19_safety_v1.sql`, 공식 6파일 밖):

- daily_issue_emergency_halt: UNKNOWN
- daily_issue_emergency_halt_audit: UNKNOWN
- daily_issue_us_scheduler_runs: UNKNOWN
- daily_issue_scheduler_runs 의 lease_owner, lease_expires_at, activity_region: UNKNOWN

미국 지역 컬럼 후보(`migration_daily_issue_us_region_candidate.sql`): review_items, comments, reactions, scheduler_runs 의 activity_region: UNKNOWN

user_notifications, user_activity_events, user_bookmarks: 공식 REQUIRED에 없음. live 존재 여부 UNKNOWN. 없다고 단정하지 않음.

인덱스·제약·트리거·컬럼 타입 차이는 행을 읽기 전에는 DIFFERENT/MISSING으로 적을 수 없다. 전부 UNKNOWN.
회원 행, auth.users, 이메일, 토큰, 업무 데이터 SELECT는 하지 않았다.

## 5. RLS·정책·권한

live: UNKNOWN.
RLS on/off, 정책 이름, GRANT를 pg_class / pg_policies / information_schema 로 보지 않았다.
GitHub에 적힌 기대(board RLS, legal/alignment own SELECT, progression candidate own SELECT, phase19 deny_all)는 기대일 뿐이며 이번 DEV 검증 결과가 아니다.

## 6. 다음에 필요한 SQL

이번 단계에서 실행할 SQL은 없다.
이미 있는 객체에 공식 REQUIRED 22 전체를 다시 적용하는 계획은 세우지 않는다. DEV에 무엇이 있는지를 모르므로, 없는 객체만 고르는 적용 목록도 만들지 않는다.
DEV 데이터 보존이 우선이다. INSERT/UPDATE/DELETE, DDL, migration apply, 회원 생성, 로그인, 삭제, 키 발급은 하지 않았다.

다음에 허용되는 작업은, sentencearena-dev ref wzpreuseuiuzwpoqqckr 만 가리키는 API URL과 PostgreSQL URL이 둘 다 확인된 뒤의 읽기 전용 트랜잭션이다. 내용은 시스템 카탈로그 SELECT뿐이다. 그 결과가 PRESENT인 객체에는 migration을 다시 돌리지 않는다. MISSING인 객체만 파일 단위로 별도 승인을 받는다.

## 7. 차단 이유

1. 이 기계의 기존 `.env` API URL과 PostgreSQL URL은 둘 다 DEV ref가 아니다. 도구 금지 목록의 ref vmpdddcdnxeavchgivcd 로 식별된다.
2. sentencearena-dev 전용 URL은 `.env`, 프로세스 환경, Supabase CLI 로그인, 프로젝트 link 어디에도 없다.
3. 없는 DEV 설정을 새로 만들지 않았다.
4. 비-DEV 설정으로 접속하지 않았다.
5. 그래서 스키마·RLS live 대조가 불가능하다.

## 8. 스테이징 준비 판정

BLOCKED.
READY_FOR_STAGING_PLAN 아님. STAGING_VERIFIED 아님. LIVE PASS 아님.
베타 출시 가능 여부를 이 보고서로 판단하지 않는다.

## 9. 다음 승인

1. 현재 체크아웃 `.env` 를 바꾸지 말고, sentencearena-dev(ref wzpreuseuiuzwpoqqckr)만 가리키는 별도 읽기 전용 연결 정보를 준비한다. 비밀은 채팅과 GitHub에 넣지 않는다.
2. 그 다음에만 information_schema / pg_catalog SELECT 재검증을 승인한다.
3. 재검증으로 MISSING이 확인된 파일만, 파일마다 apply 여부를 따로 승인한다.
