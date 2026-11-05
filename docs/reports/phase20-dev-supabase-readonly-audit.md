# Phase 20 Step 5 — sentencearena-dev Supabase read-only audit

## 1. 기준·작업 커밋

기준 HEAD: db8ca97c8a6d59bcf66d3beec4af4b5efb769910  
브랜치: cursor/map-layout-cards-bc3c · PR #1 유지  
본 단계 변경: 본 보고서만(읽기 전용 조사). 서비스 코드·migration apply 없음.  
작업 커밋: push 후 origin HEAD(보고서 커밋 1건). 대상 구현 커밋 없음.

## 2. 접속 여부

DEV live read-only 접속: **실패 → BLOCKED**  
이 Cloud Agent 런타임에 `.env` 없음. `DAILY_ISSUE_DATABASE_URL`·`DATABASE_URL`·`SUPABASE_URL`·anon/service 키 모두 미설정.  
Production ref(`rlzltrwwamrgrfwlaqxj`) 및 기타 금지 ref에 연결 시도 없음.

## 3. 확인한 ref

허용 대상(문서·도구 SSOT): 프로젝트 `sentencearena-dev`, ref `wzpreuseuiuzwpoqqckr`.  
**Live ref 일치: 미검증**(DB/API URL 부재). ref를 이름만으로 가정하지 않음.

## 4. 검사 방법(계획·정적)

실행한 것(비밀 미출력):
- `node tools/_tmp-env-ref-check.js` — env 부재 확인 후 삭제(임시).
- `node tools/run-production-public-migrate.js check` — 공식 public REQUIRED 22개 카탈로그 정적 OK( DB 미연결).

Live DEV에서 승인·로컬 `.env` 확보 시 권장(본 세션 미실행):
1. `tools/apply-service-role-route-min-grants.js`와 동일 ref 게이트(`EXPECTED_REF`·`FORBIDDEN_REFS`)로 URL ref 검증.
2. `information_schema`·`pg_policies`·`pg_class.relrowsecurity`에 대한 **SELECT만** (회원 행·auth.users·이메일·토큰 조회 금지).
3. `shared/production-public-migration-core.js` `inspectPublicSchema` + 수동 컬럼·RLS 목록과 GitHub SQL 대조.
4. JWT 실로그인·INSERT/UPDATE/migration apply 금지.

## 5. public 스키마( live 판정 )

Live: **전 항목 UNKNOWN**(미접속). 아래는 GitHub SSOT 대비 **기대·대조 기준**만.

공식 REQUIRED 22 migration이 만드는 핵심 객체(`production-public-migration-core.js`):
- 테이블: profiles, identity_history, board_posts/comments/reactions/reports, user_progression(+events), user_achievements, user_alignment_state, alignment_*, moderation_*, account_withdrawal_*, user_legal_consents, rights_infringement_* 등.
- 함수: handle_new_user, toggle_board_reaction, apply_alignment_score_batch 등.

20차 staging 후보(`staging-activity-region-migration-manifest.json`) — 공식 catalog **미승격**:
- `board_posts`/`board_comments`/`board_reactions`.`activity_region` + norm·트리거·post region lock → DEV live **UNKNOWN**(미적용 시 **MISSING** 예상).
- `user_activity_region_profile` / `user_activity_region_achievement` → **UNKNOWN**(**MISSING** 예상).

`user_notifications` / `user_activity_events` / `user_bookmarks` → 공식 REQUIRED 없음 → **MISSING** 정상(임시 테이블 금지).

STATE §17(2026-10-25) dev 회원·admin 기록은 **과거 검증**이며, 현재 스키마 PRESENT/MISSING 증명 아님.

## 6. daily_issue( live 판정 )

Live: **UNKNOWN**.  
GitHub 공식 6파일(`daily-issue-production-migration-core.js` / staging manifest `officialOrder`): review lifecycle, morning scheduler, alignment seed, comments, account withdrawal, ops workflow.  
SQL 원문은 `public.daily_issue_*` 테이블명; 적용 시 `DAILY_ISSUE_DB_SCHEMA`·rewrite 정책에 따라 실제 schema명은 DEV에서 확인 필요.

Staging 확장(`staging-daily-issue-migration-manifest.json`, catalog 미승격):
- `migration_daily_issue_us_region_candidate.sql` — review_items/comments/reactions/scheduler_runs `activity_region` → live **UNKNOWN**.
- `migration_daily_issue_phase19_safety_v1.sql` — `daily_issue_emergency_halt`, `daily_issue_emergency_halt_audit`, `daily_issue_us_scheduler_runs` + deny_all RLS → live **UNKNOWN**.

스케줄 실행 기록: 공식 `daily_issue_scheduler_runs`(및 US runs 후보) — live **UNKNOWN**. 적용 이력만으로 정상 스케줄 동작 주장 금지.

## 7. RLS·권한( live )

Live: **UNKNOWN**.  
정적 기대( GitHub ):
- board_*: board_core migration RLS ON(후보는 board RESTRICTIVE KR/US 미추가).
- user_alignment_state / user_legal_consents: persistence migration SELECT own 등.
- activity-region progression candidate: profile/achievement RLS + authenticated SELECT own.
- phase19 safety: halt·audit·us_scheduler_runs anon/authenticated deny_all — **service_role/서버 경로 의존**.

JWT 실인증·회원 A/B live SELECT: **미실행**. 로컬 embedded PG stub 결과를 REAL Auth PASS로 쓰지 않음.

## 8. SQL 차이(GitHub vs DEV live)

공식 public 22: GitHub REQUIRED catalog — DEV live UNKNOWN  
activity-region board/progression candidate: GitHub CANDIDATE — live UNKNOWN(미apply 시 MISSING 예상)  
PLAN v2 / user_data_system / legal consent: DO_NOT_APPLY 또는 BLOCKED — DEV apply 금지  
DI official 6 + phase19 + us_region: staging manifest — live UNKNOWN  

충돌 가능 SQL(apply 전 검토): migration_activity_region_v2.sql, migration_user_data_system.sql, migration_alignment_system.sql, drop_profiles_*  
적용 금지: Production ref, catalog 승격 없는 후보를 운영 REQUIRED에 합치기, migration CLI apply(본 세션)

## 9. 적용 후보(스테이징 계획용, live 미적용)

승인·ref 확인·격리 PG PASS 후에만 검토:
1. 공식 public REQUIRED 22 (기존 게이트).
2. `staging-activity-region-migration-manifest.json` 2파일.
3. `staging-daily-issue-migration-manifest.json` officialOrder 6 + stagingExtensions(phase19·us_region) — 파일별 owner 승인.

## 10. 데이터 보존 위험

본 세션: **쓰기·migration·truncate 없음** — dev 데이터 변경 없음.  
향후 apply 시: activity_region additive는 NULL=KR legacy 전제; post region lock은 자식 있는 글 region 변경 거부; DI halt/scheduler는 서비스 role 전제. **dev 데이터 초기화·재생성 제안 없음.**

## 11. REAL Auth 준비

Live: **BLOCKED**(Supabase URL/anon 미설정).  
20차 4단계: REAL Auth smoke·HTTP activity-region **미완**. Admin JWT·스테이징 전용 테스트 계정은 별도 승인·로컬 env 필요.  
STAGING_VERIFIED / BETA_READY **금지**.

## 12. P0 / P1

P0: 로컬/CI 전용 env로 **wzpreuseuiuzwpoqqckr ref 확인 후** 본 보고서 §5–7 live 재실행; REAL Auth smoke; staging manifest apply 승인; Launch Finalization(20차 1단계).  
P1: user_data 공식 migration; legal consent candidate(법무); US political engine(미구현·베타 필수 미확정); v2 RESTRICTIVE board RLS(선택).

## 13. 스테이징 전환 판정(단일)

**BLOCKED** — DEV read-only schema/RLS 감사 미완(접속 수단 없음).  
부가: 스키마 정합·20차 후보 반영은 live 확인 전 **NEEDS_MIGRATION** 가정. REAL Auth·쓰기 검증 전 **NEEDS_ISOLATION** 유지.  
READY_FOR_STAGING_PLAN / STAGING_VERIFIED / BETA_READY **아님**.

## 14. 다음 승인

1. sentencearena-dev 전용 `.env`(ref `wzpreuseuiuzwpoqqckr`만) — Cloud Agent 또는 로컬 read-only 감사 재실행 승인(비밀 채팅·GitHub 저장 금지).  
2. `information_schema`/`pg_policies` SELECT-only 감사 스크립트 실행 승인(migration apply 아님).  
3. staging activity-region·daily_issue manifest **파일별** apply 승인.  
4. REAL Supabase Auth HTTP smoke 승인.

베타 출시 가능 판정하지 않음.
