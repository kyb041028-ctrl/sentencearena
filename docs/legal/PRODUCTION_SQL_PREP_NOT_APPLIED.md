# 운영 SQL 준비 메모

이 문서는 적용 절차가 아닙니다. Production 검증이 아닙니다. SQL을 실행하지 않았습니다. 영구정지 재가입 차단은 추가하지 않았습니다.

대상 파일:

- `supabase/migration_audit_withdrawal_set_null_v1.sql`
- `supabase/migration_service_role_route_min_grants_v1.sql`
- `supabase/migration_sensitive_consent_withdraw_tx_v1.sql` (10차 후보. 위 두 파일과 별개)

세 파일 모두 production REQUIRED catalog에 없습니다.

## 1. 감사기록 탈퇴 SQL

하는 일: 트리거 함수 두 개의 본문을 바꿉니다.

- `public.admin_moderation_audit_events_block_mutation()`
- `public.legal_hold_operator_events_block_mutation()`

데이터 행을 지우거나 사용자 번호를 비우지 않습니다. 이후 회원탈퇴가 외래 키로 사용자 번호를 NULL로 바꿀 때, 행동·사유·대상·메모·시각이 그대로이면 그 UPDATE를 통과시킵니다. 다른 열을 바꾸는 UPDATE와, 보존 해제 없는 DELETE는 여전히 거부합니다.

적용 전에 백업할 것:

- 운영에 실제로 있는 두 함수의 본문. `pg_get_functiondef` 결과. 저장소의 예전 파일과 같다고 가정하지 않습니다.
- 감사 행과 보전 행의 `actor_user_id`, `target_user_id`. 함수 교체 자체는 이 값을 바꾸지 않습니다. 나중에 탈퇴가 NULL로 바꾸면, 함수를 되돌려도 그 번호는 돌아오지 않습니다.

복구 한계:

- 함수 본문은 백업해 둔 정의로 다시 넣을 수 있습니다.
- 이미 NULL이 된 사용자 번호는 이 SQL을 되돌리는 것만으로는 복구되지 않습니다.
- 감사 행 자체는 이 SQL이 삭제하지 않습니다.

## 2. service_role 권한 SQL

추가 GRANT만 있습니다. 행을 지우지 않고, RLS를 바꾸지 않습니다.

- `board_posts`: SELECT, INSERT, UPDATE
- `board_comments`: SELECT, UPDATE
- `board_reactions`: SELECT
- `board_reports`: SELECT, UPDATE
- `profiles`: SELECT
- `profiles`의 `signup_completed_at`, `first_visit_guide_eligible_at`, `first_visit_guide_completed_at`, `central_plaza_hint_seen_at`만 UPDATE
- `user_alignment_state`, `alignment_history`, `alignment_territory_history`: SELECT, DELETE

적용 전에 백업할 것:

- 같은 테이블에 대한 `service_role` 현재 권한 목록.

복구 한계:

- 같은 권한을 REVOKE하면 권한 추가는 되돌릴 수 있습니다.
- 이미 이 권한에 의존하는 서버가 있으면 REVOKE 뒤 그 경로가 실패할 수 있습니다.
- 데이터는 이 파일이 삭제하지 않습니다.
- 10차 철회 함수의 EXECUTE 권한은 이 파일에 없습니다.

## 3. 민감정보 철회 함수 SQL

`withdraw_sensitive_political_consent(uuid)` 하나를 만듭니다. 호출이 성공하면 성향 상태, 변화 기록, 영토 이동 기록 삭제와 동의 해제가 같은 트랜잭션입니다. 프로필 영토, 반응, 외계, 백업은 바꾸지 않습니다. `service_role`만 실행할 수 있습니다.

함수를 만들기만 해서는 기존 행이 지워지지 않습니다. 회원이 철회를 성공시킨 뒤에 지워진 성향 행은 함수를 지워도 돌아오지 않습니다.

적용 전에 백업할 것:

- `user_alignment_state`, `alignment_history`, `alignment_territory_history`
- `user_legal_consents`의 동의 시각과 공개 설정

복구 한계:

- 함수 생성은 DROP FUNCTION으로 되돌릴 수 있습니다.
- 이미 성공한 철회의 삭제 데이터는 백업이 없으면 복구되지 않습니다.

## 4. 순서

두 기존 파일은 서로를 참조하지 않습니다. 스키마만 보면 어느 쪽을 먼저 해도 서로 깨지지 않습니다. 어느 순서로 운영에 넣을지는 아직 승인된 결정이 아닙니다.

철회 함수는 두 파일에 의존하지 않습니다. 이 후보 서버는 그 함수가 있는 데이터베이스에서만 철회를 성공시킵니다. 권한 SQL의 DELETE만 넣고 함수가 없으면, 새 서버의 철회는 실패합니다.

세 파일 모두 이번 작업에서 실행하지 않았습니다.

## 5. 12차 후보. 아직 실행하지 않음

철회 함수만으로는 계산 저장과 반응 스냅샷 경합이 닫히지 않습니다. 아래 두 파일은 기존 SQL을 바꾸지 않고 따로 둔 후보입니다.

- `supabase/migration_alignment_batch_consent_recheck_candidate.sql`
- `supabase/migration_reaction_snapshot_consent_recheck_candidate.sql`

계산 후보: `apply_alignment_score_batch(jsonb)` 본문에, 성향 행을 쓰기 전에 `user_legal_consents`를 잠그고 분리 동의가 유효한지 다시 확인합니다. 점수식, 상한 500, 영토 후보 규칙은 원본과 같습니다. 이 파일이 없으면 서버가 동의를 걸러낸 뒤에도, 그 다음의 데이터베이스 함수는 철회를 다시 보지 않습니다.

반응 후보: `toggle_board_reaction(text, uuid, text, text, text, text)` 가 새 점수·영토 복사만 동의 중에 남깁니다. 좋아요와 싫어요 개수, 취소, 중복 방지는 유지합니다. 영토 스냅샷 열이 현재 NOT NULL이라, 복사를 비우려면 같은 파일의 NULL 허용이 함께 있어야 합니다. 함수만 먼저 넣으면 동의 없는 새 반응 전체가 롤백될 수 있습니다.

둘 다 production REQUIRED catalog에 없습니다. 이번 작업에서 실행하지 않았습니다.

## 6. 격리된 PostgreSQL이 없을 때의 확인 절차

13차에서 psql, docker, DB 주소를 다시 확인했다. 없으면 설치하지 않고 접속하지 않는다. 아래는 실행한 절차가 아니다.

1. 빈 로컬 데이터베이스만 쓴다. 운영 주소, Supabase, 회원 데이터는 넣지 않는다.
2. 현재 함수 본문과 GRANT를 먼저 읽는다. 저장소와 다르면 후보로 덮어쓰지 않는다.
3. 스키마와 함수와 권한을 백업한다.
4. 승인된 SQL만, 의존 순서대로 넣는다. 이번 작업에서 승인된 적용 목록은 비어 있다.
5. 철회가 먼저인 경우, 계산이 먼저인 경우, 반응이 먼저인 경우, 탈퇴가 먼저인 경우, 같은 철회의 반복, 늦은 동의, 명시적 재동의, 잠금 대기, 롤백 뒤 재시도를 가짜 사용자로 본다.
6. 옛 반응과 감사 행과 legal_hold는 넓게 지우지 않는지 본다.
7. 문제가 있으면 그 데이터베이스만 버리고, 운영은 그대로 둔다.

## 7. 로컬 격리 DB 준비. 14차에서 실행하지 않음

이 절은 설치 절차를 승인한 기록이 아니다. 14차는 이미 깔린 격리 PostgreSQL만 찾고, 없으면 설치하지 않았다. 아래를 실행하지 않았다.

버전: 이 컴퓨터에서 postgres, psql, initdb, pg_ctl, docker를 찾지 못했다. 따라서 실행 중인 버전은 없다. 나중에 쓸 후보는 PostgreSQL 공식 Windows 안내가 가리키는 배포처의 지원 중인 안정 ZIP이다. 프리릴리스, 설치 마법사의 Windows 서비스 등록, Docker, 유료 호스팅은 쓰지 않는다. 가입이나 결제가 필요하면 그 경로는 포기한다.

실행 방법: ZIP을 이 작업 전용 임시 폴더에만 푼다. PATH, Windows 서비스, 방화벽, 프로젝트 .env는 바꾸지 않는다. initdb로 그 폴더 안에만 빈 클러스터를 만든다. pg_ctl로 127.0.0.1의 높은 포트에만 띄운다. createdb로 데이터베이스 이름은 consent_isolated만 만든다. 비밀번호는 그 프로세스에만 두고 채팅이나 로그에 쓰지 않는다. 접속 문자열은 환경변수 CONSENT_ISOLATED_DATABASE_URL에만 넣는다. DATABASE_URL, SUPABASE_URL, 운영 주소는 이 시험이 읽지 않는다.

스키마 순서: 빈 consent_isolated에만 넣는다. 먼저 로컬 역할 anon, authenticated, service_role과 auth.users, auth.uid() 스텁을 만든다. 그 다음 저장소 파일을 이 순서로 넣는다.

1. schema_profiles_identity_history.sql
2. migration_handle_new_user_emailless_oauth.sql
3. migration_activity_name_unique.sql
4. migration_canonical_user_territory.sql
5. migration_canonical_territory_central_start.sql
6. migration_board_core_system.sql
7. migration_political_alignment_persistence.sql
8. migration_political_alignment_beta_v1.sql
9. migration_legal_gate_v1.sql
10. migration_legal_territory_disclosure_v1.sql
11. migration_user_sanctions_v1.sql
12. migration_account_withdrawal_v1.sql
13. migration_admin_moderation_audit_v1.sql
14. migration_legal_hold_and_audit_purge_v1.sql
15. migration_audit_withdrawal_set_null_v1.sql
16. migration_service_role_route_min_grants_v1.sql
17. migration_sensitive_consent_withdraw_tx_v1.sql
18. migration_alignment_batch_consent_recheck_candidate.sql
19. migration_reaction_snapshot_consent_recheck_candidate.sql

15번부터 19번이 이번 다섯 파일이다. 다섯 파일은 REQUIRED 목록에 넣지 않는다. 19번은 NULL 허용과 함수 교체를 한 파일로 넣는다. 함수만 먼저 넣지 않는다. 설치가 끝나면 15번부터 19번을 한 번 더 넣어 다시 실행이 되는지 본다.

시험 역할: 설치를 수행한 로컬 슈퍼유저가 함수 소유자다. 시험은 service_role로 철회와 계산을 호출하고, authenticated와 anon으로는 그 두 함수가 거부되는지 본다. 반응 함수는 기존처럼 authenticated 실행을 유지한다. 운영 역할이나 회원 비밀번호를 복사하지 않는다.

함수 설치: 위 순서의 CREATE OR REPLACE와 GRANT다. 데이터 행을 만들지 않는다. 가짜 회원은 시험 스크립트가 @consent-it.invalid 주소로만 만든다.

동시 트랜잭션: 접속을 두 개 연다. lock_timeout은 8초다. 한 접속이 동의 행을 잠근 동안 다른 접속의 철회가 기다리는지 본다. 잠금 순서를 서로 반대로 하면 deadlock(40P01)이 나는지 하니스만 확인하고 롤백한다. 그 다음 철회 함수와 계산 함수를 같은 회원에게 동시에 호출해 deadlock이 없어야 한다.

정리: 시험이 만든 auth.users 행을 지운다. 연결된 외래 키는 CASCADE로 따라간다. 감사 행과 legal_hold 행을 시험이 일부러 남긴 경우에는 그 행의 사용자 번호만 비고 행은 남는지 먼저 확인한 뒤, 데이터베이스 전체를 버릴 때만 함께 없어진다. 클러스터 정리는 그 consent_isolated 데이터베이스와 이번 임시 폴더만 대상으로 한다. 다른 PostgreSQL 서비스는 멈추지 않는다.

아직 필요한 승인: ZIP 받기, initdb, pg_ctl 시작, consent_isolated 만들기, tools/test-consent-five-sql-integration.js 실행. 각 단계는 별도 승인이 필요하다. 이 문서를 썼다는 것은 그 승인이 아니다. 비용은 로컬 디스크와 CPU뿐이어야 한다. 유료 자원이면 실행하지 않는다.
