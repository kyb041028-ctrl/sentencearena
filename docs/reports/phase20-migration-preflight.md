# Phase 20 Step 2 — Migration preflight (격리 PG + 정적 catalog)

## 1. 기준·최종 커밋

기준 HEAD: 4f92d0d5d3f2db70bf7a7af2bee9d490ca2a7401  
브랜치: cursor/map-layout-cards-bc3c  
PR: #1 유지  
운영 Supabase·운영 DB·migration apply·유료 OpenAI·REAL Auth 접속 없음.  
격리 embedded-postgres: `node tools/test-phase20-migration-preflight.js` → PHASE20_PREFLIGHT_VERDICT PASS.

## 2. 충돌한 마이그레이션 (정적 대조)

| 충돌 | 설명 |
| --- | --- |
| migration_user_data_system.sql | production-public `DO_NOT_APPLY`. `test-activity-region-auth-env.js`가 과거 이 파일로 user_notifications 등을 만든 뒤 v2 적용 → 공식 public REQUIRED와 다른 스키마를 검증함. 20차에서 제거. |
| migration_activity_region_v2.sql | PLAN ONLY. user_notifications / user_activity_events / user_bookmarks 는 공식 REQUIRED에 없고 user_data_system 초안에만 존재. 공식 22개 REQUIRED만 적용한 DB에는 v2 전체 적용 불가. |
| daily_issue harness 순서 | 19차 harness가 official 6개 중 account_withdrawal·ops_workflow 누락, comments/scheduler 순서가 catalog와 불일치. 20차에서 `migration-preflight-orders` SSOT로 통일. |
| phase19·us_region | production daily_issue catalog 6개에 미포함. 스테이징 manifest로만 관리(운영 catalog 자동 승격 금지). |

## 3. 수정 파일

- shared/migration-preflight-orders.js (신규, 공식·스테이징·PLAN/CANDIDATE/DO_NOT_APPLY 목록)
- tools/lib/daily-issue-local-pg-harness.js (official 6 + staging 2 순서, applySql export)
- tools/test-activity-region-auth-env.js (user_data_system 제거, 공식 subset + v2 전 PLAN stub)
- tools/test-phase20-migration-preflight.js (신규)
- docs/candidates/staging-daily-issue-migration-manifest.json (신규)
- docs/reports/phase20-migration-preflight.md

(20차 3단계에서 plan-activity-region-v2-dependency-stub 제거·activity region candidate 분리 — `phase20-activity-region-preflight.md` 참고.)

## 4. 적용 가능 SQL과 순서

### public — 공식 REQUIRED (22 files, `production-public-migration-core.js`)

schema_profiles_identity_history.sql  
→ handle_new_user_emailless → activity_name_unique  
→ canonical_user_territory → canonical_territory_central_start  
→ board_core → user_progression_canonical → events_xp → empathy_received_fame_rpc  
→ user_achievements_persist → grant_user_achievement_canonical → achievement_notified_state → achievement_service_role_select_v1  
→ political_alignment_persistence → political_alignment_beta_v1 → alignment_self_direction_streak_v1  
→ alien_moderation_v1 → alien_operator_review_v1 → account_withdrawal_v1  
→ legal_gate_v1 → rights_infringement_v1 → empathy_received_fame_revoke_rpc  

격리 PG: auth.users stub + auth.uid() + anon/authenticated/service_role 후 위 순서 PASS.

### daily_issue schema — 공식 6 + 스테이징 2 (`docs/candidates/staging-daily-issue-migration-manifest.json`)

1. migration_daily_issue_review_lifecycle.sql  
2. migration_daily_issue_morning_scheduler.sql  
3. migration_daily_issue_alignment_seed_v1.sql  
4. migration_daily_issue_comments_v1.sql  
5. migration_daily_issue_account_withdrawal_v1.sql  
6. migration_daily_issue_ops_workflow_v1.sql  
7. migration_daily_issue_us_region_candidate.sql (CANDIDATE, schema rewrite)  
8. migration_daily_issue_phase19_safety_v1.sql (STAGING, halt·US runs·lease, RLS deny_all)  

## 5. 적용 금지 SQL (대표)

- migration_user_data_system.sql (DO_NOT_APPLY, 초안)
- migration_alignment_system.sql (DO_NOT_APPLY, 구 schema)
- drop_profiles_identity_schema.sql
- migration_activity_region_legal_consent_candidate.sql (CANDIDATE ONLY, 법적 검토 미완 — 공식 승격 금지)
- migration_activity_region_plan.sql (CANDIDATE ONLY)
- migration_activity_region_v2.sql — 공식 catalog 미포함; 스테이징 적용 시 user_data 계열 선행 또는 v2 분할·공식화 필요

## 6. 격리 DB 결과 (embedded-postgres)

PHASE20_PREFLIGHT catalog_deps PASS  
PHASE20_PREFLIGHT user_data_system_class PASS  
PHASE20_PREFLIGHT public_apply PASS (22 migrations)  
PHASE20_PREFLIGHT public_inspect PASS  
PHASE20_PREFLIGHT daily_issue_apply PASS (schema daily_issue_preflight, 8 files)  
PHASE20_PREFLIGHT di_phase19_objects PASS (halt 초기 KR/US 2행, us_scheduler_runs, activity_region 컬럼)  
PHASE20_PREFLIGHT idempotent_reapply PASS  
PHASE20_PREFLIGHT activity_region_v2_plan SUPERSEDED (20차 3단계: board+progression candidates, stub removed)  
PHASE20_PREFLIGHT_VERDICT PASS  

로컬 Auth stub ≠ REAL Auth PASS.

## 7. KR/US 활동 분리

| 파일 | 분류 | DB 객체·비고 |
| --- | --- | --- |
| migration_activity_region_v2.sql | PLAN ONLY | board_* activity_region, 트리거, user_activity_region_profile/achievement, RLS on region score tables. user_notifications/events/bookmarks 의존 → 공식 스키마와 gap |
| migration_activity_region_legal_consent_candidate.sql | CANDIDATE ONLY | user_activity_region_legal_consents (US 18세·약관·민감·마케팅 철회 컬럼). draft_status DRAFT_NOT_LEGAL_REVIEW |
| migration_activity_region_plan.sql | CANDIDATE ONLY | user_activity_region_post 등; v2 주석은 운영 글 저장소 아님 |
| legal_gate_v1 | APPLICABLE (공식) | KR 만 14세, user_legal_consents. US 18세는 앱 core + US 후보 테이블 |
| migration_sensitive_consent_withdraw_tx_v1 | OPTIONAL (전용 apply) | 동의 철회 TX — staging manifest에 public OPTIONAL로 별도 계획 |

미국 18세: `shared/legal-gate-core.js` AGE_UNDER_18 + US 후보 SQL(미승격).  
동의 철회: legal_gate + sensitive withdraw migration(스테이징 승인 후).

## 8. Auth 준비 (접속·변경 없음, 설정 이름만)

| 항목 | 준비 | 미준비 | 외부 필요 |
| --- | --- | --- | --- |
| 일반 가입·로그인 | 코드·env 이름 확정 | 스테이징 프로젝트 env 미기록(본 step) | Supabase Auth provider·redirect URL |
| 세션·JWT | Bearer + createAdminAccessGuard | REAL end-to-end 미검증 | APP_PUBLIC_ORIGIN, Supabase JWT secret(대시보드) |
| ADMIN/OWNER | app_metadata.role | 스테이징 계정 role 부여 미실행 | Dashboard 또는 service_role(서버만) |
| US 18세 | legal-gate-core | US legal consent 테이블 후보 미적용 | 법무 확정 후 candidate apply 승인 |
| KR/US 활동 | v2 PLAN + 앱 라우트 | 공식 DB에 v2 미적용 | activity_region apply 정책 결정 |
| 동의 철회 | migration 파일 존재 | staging apply·REAL Auth 없음 | SQL apply 승인 |
| 긴급 중지 GET/POST | 19차 mock PASS | REAL JWT BLOCKED | Supabase + DI DB phase19 |

## 9. 미해결 P0 / P1

P0 (환경·catalog):

- 스테이징 Supabase + DAILY_ISSUE_DATABASE_URL + phase19 스테이징 manifest apply 승인·실행(본 step 미실행)
- activity_region_v2 공식화 또는 board-only 분리 + user_data 대체 migration 계획
- REAL Auth halt/admin smoke
- Launch Finalization (20차 1단계)

P0 (코드): 본 preflight에서 공식 SQL apply 실패 없음(격리 PASS).

P1:

- OpenAI LIVE — 베타 범위 미확정(아래 §10). 키 가정 금지.
- USER_DATA notifications API
- OPTIONAL public migrations (audit_withdrawal, service_role_grants 등)

## 10. 베타 범위 · AI (임의 결정 없음)

저장소는 US/KR Daily Issue에 OpenAI adapter·비용 cap 코드가 있으나 LIVE NOT_CONFIGURED.  
베타가 **수동 검수·발행만**이면 AI 자동화는 P1 이상으로 보류 가능.  
베타가 **AI 초안 생성 필수**이면 LIVE AI·키·cap 검증이 P0.  
**제품 오너 범위 확정 전 P0/P1 AI 판정 고정하지 않음.**

## 11. 다음 스테이징에 필요한 승인·설정

1. 스테이징 Supabase 프로젝트(운영 ref 사용 금지) + SUPABASE_URL·publishable/anon·service_role(서버만)  
2. APP_PUBLIC_ORIGIN 스테이징 URL + OAuth redirect  
3. public REQUIRED 22 apply (PUBLIC_SCHEMA confirm 게이트) — 승인 후  
4. daily_issue schema: 공식 6 + manifest staging 2 apply — 승인 후  
5. activity_region_v2 적용 전략(PLAN split vs user_data 후속) — 승인 후  
6. US legal consent candidate — 법무 승인 전 apply 금지  
7. REAL Auth 통합 테스트(DAILY_ISSUE_REAL_AUTH_INTEGRATION 등) — 승인 후  
8. 베타 AI 포함 여부 확정  

## 12. 베타 출시 판정

본 step은 migration preflight만. 베타 출시 가능 판정하지 않음.
