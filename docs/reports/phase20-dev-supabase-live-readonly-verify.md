# Phase 20 Step 5 마무리 — sentencearena-dev live read-only

판정: READONLY_CONNECTED_STAGING_BLOCKED

기존 `docs/reports/phase20-dev-supabase-readonly-audit.md` 는 대체하지 않는다. 이 파일만 이번 실측으로 갱신한다.

출시 판단은 이 보고서의 범위가 아니다.

## 1. 기준

이번 갱신 직전 HEAD: 8f5229220d883decb3e825174253288f86ef194d
브랜치: cursor/map-layout-cards-bc3c
PR: #1 유지. master 병합 없음. 새 PR 없음. force 없음.
작업 위치: 이 브랜치가 이미 붙어 있는 별도 worktree. 사용자 master 체크아웃과 기존 `.env` 는 열지 않았고 수정하지 않음.
허용 대상: sentencearena-dev, ref wzpreuseuiuzwpoqqckr 하나.
열지 않은 ref: rlzltrwwamrgrfwlaqxj, vmpdddcdnxeavchgivcd.
서비스 코드 수정 없음. migration apply 없음. DDL 없음. 회원 행·게시물 본문 조회 없음. 데이터 변경 없음.
조회는 information_schema, pg_catalog, pg_policies 만. 트랜잭션은 READ ONLY.

## 2. 연결 보관

비밀번호는 세션에 없었다. 개발 PC에 숨김 입력창을 띄워 받았고, 명령줄 인자로 넘기지 않았다.
보관 위치: Windows 자격 증명 관리자. 종류는 일반 자격 증명, 현재 Windows 사용자, 이 PC에만 유지(DPAPI).
주소·프로젝트 ref·포트·DB 이름·SSL 요구는 저장소 밖의 로컬 JSON에만 있다. 그 파일에는 비밀번호와 전체 접속 URI가 없다.
그 JSON 경로는 Git 저장소 밖이다. 이 worktree와 사용자 master 체크아웃 `git status` 에 나타나지 않는다. 커밋하지 않는다.
기존 `.env` 는 열지 않았다. `.env` 는 `.gitignore` 2행에 의해 추적 제외다. 공식 DEV 설정을 그 파일에 합치지 않았다.
평문 비밀번호 파일은 만들지 않았다.

## 3. 새 프로세스 SELECT 1

저장 프로세스가 끝난 뒤, 다른 프로세스가 자격 증명 관리자만 읽어 접속했다.
SELECT 1: 성공.
current_user: postgres. 풀러 로그인 이름은 ref가 붙은 역할이고, 데이터베이스 안 역할은 postgres다. 이 조합으로 허용 ref 접속이 맞다.
current_database: postgres.
transaction_read_only: on.
클라이언트 TLS: 사용. 인증서 체인 검증은 SELF_SIGNED_CERT_IN_CHAIN 으로 실패해서, 암호화만 하고 인증서 검증은 끄고 붙었다.
pg_stat_ssl.ssl: false. 풀러가 TLS를 끝내고 뒤쪽 Postgres에는 비SSL로 붙는 형태로 읽힌다. 클라이언트에서 풀러까지는 TLS다.
회원 데이터는 읽지 않았다.

## 4. public — GitHub REQUIRED와 비교

공식 REQUIRED 테이블 24개: 전부 PRESENT.
확인한 테이블: profiles, identity_history, board_posts, board_comments, board_reactions, board_reports, user_progression, user_progression_events, user_achievements, user_featured_achievements, user_alignment_state, alignment_batches, alignment_history, alignment_territory_history, user_moderation_state, user_moderation_events, user_moderation_notifications, account_withdrawal_jobs, account_withdrawal_audit, user_legal_consents, rights_infringement_requests, rights_infringement_events, rights_infringement_objections, rights_infringement_abuse_state.

공식 REQUIRED 함수 9개: 전부 PRESENT.
handle_new_user, protect_canonical_membership_territory, toggle_board_reaction, apply_user_progression_event, revoke_empathy_received_fame, grant_user_achievement, mark_user_achievement_notified, apply_alignment_score_batch, withdraw_account_anonymize.

공식 REQUIRED 컬럼으로 코드가 지정한 항목: PRESENT.
profiles.territory, profiles.citizenship_status, profiles.exile_strike_count, board_reactions의 반응 시점 정렬 점수 2개, user_alignment_state.score, user_alignment_state.pending_territory, user_achievements.acquisition_notified_at, user_progression.reputation_score.

이미 따로 적용된 추가로 보이는 객체: PRESENT.
profiles.signup_completed_at, first_visit_guide_eligible_at, first_visit_guide_completed_at, central_plaza_hint_seen_at.
user_legal_consents의 territory_disclosure_consented_at, territory_disclosure_policy_version.
board_posts.is_official.
user_alignment_state.self_direction, self_direction_streak, self_direction_last_date.
deleted_content_evidence, user_sanction_records, user_sanction_appeals, banned_rejoin_blocks.
admin_moderation_audit_events, admin_moderation_audit_legal_holds, legal_hold_operator_events.
misinfo_report_abuse_state, rights_infringement_attachments.
뷰 board_posts_public, board_comments_public.

user_alignment_state.current_territory: 없음. 구 migration_alignment_system.sql 모양이 아니다. 공식 persistence 쪽과 같다.

public 베이스 테이블 33개 전부 RLS 켜짐. 정책 28개.
정책이 없는 테이블은 계정 탈퇴, 관리자 감사, 제재 기록, 권리침해, alignment_batches, 삭제 콘텐츠 증거 등이다. anon·authenticated 직접 접근은 RLS로 막힌다.
service_role은 BYPASSRLS true, postgres도 true. anon·authenticated는 false.
service_role 테이블 권한은 최소 권한 파일과 맞다.
board_posts: SELECT+INSERT+UPDATE.
board_comments: SELECT+UPDATE. INSERT는 없다. 회원 INSERT는 authenticated에 있다.
board_reactions: SELECT. 토글은 SECURITY DEFINER 함수.
profiles: 테이블 UPDATE 권한은 없고, signup_completed_at와 첫 방문 안내 컬럼 등 지정 컬럼 UPDATE만 있다.
user_alignment_state: SELECT+DELETE. 점수 기록은 apply_alignment_score_batch 쪽이다.

public 트리거 13개에는 영토 보호, 가입 완료 시각 보호, 첫 방문 안내 보호, is_official 보호, 게시판 부모 검사, 감사 로그 수정 금지가 있다.
activity region 트리거 이름(board_comments_same_activity_region, board_reactions_same_activity_region, board_posts_activity_region_lock)은 없다.

## 5. activity region — 이 브랜치 구현과 비교

public.board_posts, board_comments, board_reactions의 activity_region 컬럼: MISSING.
함수 activity_region_norm: MISSING.
user_activity_region_profile, user_activity_region_achievement, user_activity_region_legal_consents: 어떤 스키마에도 객체가 없다. MISSING.
서버 코드 `server/activity-region-score-repository.js` 와 `server/activity-region-supabase-score-repository.js` 는 user_activity_region_profile을 읽는다. DB와 불일치.
스테이징 manifest 2개 파일은 아직 공식 REQUIRED가 아니다.
migration_activity_region_board_scope_candidate.sql
migration_activity_region_progression_scope_candidate.sql

## 6. daily_issue — 요청한 스키마와 실제 위치

스키마 daily_issue: 없음. MISSING.
스키마 public 안에 daily_issue_* 테이블: 없음. MISSING.
이름 검색으로 찾은 위치: 스키마 daily_issue_test 에 공식 16개 테이블이 있다. 행 내용은 읽지 않았다.

daily_issue_test에 있는 테이블: daily_issue_review_items, sources, evidences, claims, review_item_sources, review_item_evidences, review_item_claims, claim_evidences, claim_sources, updates, audit_logs, repository_meta, scheduler_runs, reactions, comments, recollect_jobs.
정렬 컬럼 daily_issue_review_items.alignment_direction: PRESENT.
daily_issue_comments.user_id: NULL 허용. 탈퇴 migration과 같은 방향.
daily_issue_reactions.user_id: NULL 아님.
RLS: 16개 모두 켜짐.
정책: scheduler_runs와 recollect_jobs의 deny_all 2개만. 나머지 테이블은 정책이 없다.
트리거: 0개. 공식 daily issue SQL 파일에도 CREATE TRIGGER가 없다.
anon, authenticated, service_role 테이블 권한 행: 0. 소유자 postgres만 권한이 있다. service_role은 BYPASSRLS여도 GRANT가 없으면 이 스키마를 쓰지 못한다.

없는 것, daily_issue_test 포함 전체 이름 검색:
daily_issue_emergency_halt, daily_issue_emergency_halt_audit, daily_issue_us_scheduler_runs: MISSING.
scheduler의 lease_owner, lease_expires_at, activity_region 컬럼: 조회 조건에 없었으므로 MISSING.
서버 `server/daily-issue-emergency-halt-store.js` 와 아침 스케줄 저장 코드는 이 객체들을 쓴다. DB와 불일치.
공식 적용 도구는 스키마 이름을 daily_issue 만 허용한다. 코드 기본값 중에는 daily_issue_test 가 있다. 지금 DB는 그 테스트 이름에만 공식 16개 테이블이 있다. 스키마 위치가 DIFFERENT.

## 7. 구현과 DB

일치하는 부분: 공식 public REQUIRED 22개 파일이 만드는 테이블·지정 컬럼·지정 함수는 live에 있다. 현재 정렬 스케줄 경로는 `server/political-alignment-persist-service.js` 의 apply_alignment_score_batch 이고, 그 함수는 PRESENT.

불일치:
1. activity region 테이블·컬럼·트리거가 없다.
2. 공식 스키마 daily_issue 가 없고, 본문은 daily_issue_test 에만 있다.
3. phase19 긴급 중지·미국 스케줄 테이블과 lease, activity_region 컬럼이 없다.
4. public.admin_inquiries, public.admin_api_error_records 가 없다. 이 브랜치 서버가 그 테이블을 조회·기록한다. 이번 20차 스테이징 manifest에는 없다.

구 함수 persist_alignment_batch_plan: MISSING. 정의는 DO_NOT_APPLY 인 migration_alignment_system.sql 에만 있다. 없는 것이 맞고, 그 파일을 적용해 맞추면 안 된다. 옛 `server/alignment-supabase-repository.js` 의 persistBatchPlan 은 그 구 함수를 부른다. 현재 스케줄 경로는 그 함수를 쓰지 않는다.

## 8. 반드시 적용할 migration인가

지금 당장 적용해야 한다고 확정된 파일은 없다. 적용하지 않았다.

다시 적용하면 안 되는 것: 공식 public REQUIRED 22개. 객체가 이미 있다. CREATE OR REPLACE와 기존 행 보정이 들어 있어 전체를 다시 돌리는 계획이 아니다.

적용 후보이나 순서를 정하기 전인 것:
1. 공식 daily issue 6개 파일. daily_issue 스키마에는 없고 daily_issue_test 에는 테이블이 있다. 같은 SQL을 daily_issue 로 다시 쓰면 스키마가 둘이 된다. 이름을 정하기 전에는 적용하지 않는다.
2. staging-activity-region-migration-manifest.json 의 2개 후보. 객체가 없어 이 브랜치의 지역 기능은 실패한다. 공식 REQUIRED가 아니다.
3. migration_daily_issue_us_region_candidate.sql 과 migration_daily_issue_phase19_safety_v1.sql. 긴급 중지·미국 스케줄·lease·activity_region 가 없다. 넣을 스키마를 정한 뒤에만 파일 단위로 승인한다.
4. admin_inquiries, admin_api_error_records 를 만드는 SQL. 해당 화면을 스테이징에 넣을 때만 별도 승인. 이번 조회의 다음 필수 적용으로 올리지 않는다.
5. migration_rights_email_verify_v1.sql 의 rights_email_challenges: 테이블 없음. 파일 이유가 메일 검증 전에는 적용 금지다.

## 9. 중복·충돌 migration

live DB 안에 같은 트리거나 같은 테이블이 두 번 있는 충돌은 보이지 않았다. 충돌은 저장소 파일에 있다. 둘 다 적용하면 나중에 CREATE TABLE IF NOT EXISTS 가 옛 모양을 고정하거나, 같은 트리거 이름에서 실패한다.

적용하면 안 되는 겹침:
1. migration_alignment_system.sql 과 migration_political_alignment_persistence.sql. 둘 다 user_alignment_state 를 만든다. live는 current_territory 가 없는 공식 모양이다.
2. migration_user_data_system.sql 과 progression·achievements 공식 파일. 같은 테이블을 IF NOT EXISTS로 만든다. user_notifications, user_activity_events, user_bookmarks, user_follows 는 live에 없다. 초안은 적용되지 않았다.
3. migration_alien_system.sql 과 migration_alien_moderation_v1.sql. 둘 다 user_moderation_state 를 만든다. alien_observation_threads 는 live에 없다.
4. migration_activity_region_v2.sql, migration_activity_region_plan.sql, 스테이징 후보 2개. profile·achievement 테이블과 게시판 트리거 이름이 겹친다. v2는 user_notifications 정책까지 만든다. live에는 셋 다 없다. 후보와 v2를 같이 적용하면 안 된다.
5. daily issue SQL 원문은 public.daily_issue_* 이고, 공식 적용 도구만 daily_issue 로 이름을 바꾼다. 원문 적용과 도구 적용을 둘 다 하면 스키마가 둘이다. 지금은 public에도 daily_issue에도 없고 daily_issue_test 에만 있다.

## 10. 스테이징 테스트를 지금 시작할 수 있는지

읽기 전용 접속은 된다. 공식 public 게시판·프로필·진행·정렬·모더레이션 객체는 있다.
이 브랜치의 activity region 테스트와 데일리 이슈 긴급 중지·미국 지역 테스트는 객체가 없어 지금 시작하면 실패한다.
공식 스키마 이름 daily_issue 도 없다. daily_issue_test 를 공식 스키마인 것처럼 쓰면 적용 도구 규칙과 어긋난다.
REAL Auth 로그인과 쓰기 테스트는 하지 않았다.
그래서 실제 스테이징 테스트 시작은 아니다. READY_FOR_STAGING_PLAN 아님. STAGING_VERIFIED 아님.

## 11. 문제와 해결

1. 문제: 공식 DEV 비밀번호가 세션과 기존 `.env` 에 없었다. 해결: 숨김 입력으로 받아 현재 사용자 자격 증명 관리자에만 저장했다. 기존 `.env` 는 그대로다.
2. 문제: 풀러 인증서가 이 PC Node에서 SELF_SIGNED_CERT_IN_CHAIN 이다. 해결: 이번 읽기 검증은 암호화만 사용했다. 인증서 검증을 켜려면 신뢰할 CA를 정하는 별도 작업이 필요하다. 스키마 판정을 바꾸지는 않는다.
3. 문제: 데일리 이슈 테이블이 공식 스키마가 아닌 daily_issue_test 에 있다. 해결: 데이터를 옮기거나 스키마를 만들지 않았다. 이름을 사용자가 정한 뒤에만 그 스키마에 없는 파일만 적용한다.
4. 문제: activity region과 phase19 안전 객체가 없다. 해결: 후보 파일을 지금 적용하지 않는다. 스키마를 정한 뒤 파일마다 승인한다.
5. 문제: 저장소에 서로 겹치는 migration이 있다. 해결: DO_NOT_APPLY와 v2·plan 초안은 적용 목록에서 뺀다. public REQUIRED 22개는 다시 돌리지 않는다.

## 12. 다음 작업과 근거

다음 작업: 스테이징에서 쓸 데일리 이슈 스키마 이름을 하나 정하는 것이다.
근거: 공식 도구는 daily_issue 만 허용하는데, live에 있는 16개 테이블은 daily_issue_test 에만 있다. 이름을 정하기 전에 6개 파일을 적용하면 같은 구조가 두 스키마에 생긴다.
그 다음에, 정한 스키마에만 아래를 파일 단위로 승인할 수 있다.
1. phase19 안전 SQL과 미국 지역 후보. 긴급 중지·lease·activity_region 가 실측에 없다.
2. activity region 게시판 후보와 진행 후보. public에 컬럼·테이블·트리거가 없다.
public REQUIRED 22개 재적용은 다음 작업이 아니다. 객체가 이미 있다.

## 13. 사용자 승인이 필요한 것

1. 데일리 이슈 스키마를 daily_issue 로 새로 둘지, 이미 있는 daily_issue_test 를 이번 스테이징 대상으로 고정할지.
2. 그 결정 이후 phase19 안전 파일, 미국 지역 후보, activity region 후보 2개의 파일별 적용. 이번 세션에서는 적용하지 않음.
3. admin_inquiries, admin_api_error_records migration을 스테이징 범위에 넣을지.
4. REAL Auth로 회원 쓰기 테스트를 할지. 이번 조회는 카탈로그만 봤다.
5. TLS 인증서 검증을 켤지. 지금은 암호화만 확인했다.

적용 금지로 유지: public REQUIRED 전체 재실행, migration_alignment_system.sql, migration_user_data_system.sql, migration_activity_region_v2.sql, migration_activity_region_plan.sql, migration_alien_system.sql, Production ref, 데이터 수정.
