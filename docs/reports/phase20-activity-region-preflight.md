# Phase 20 Step 3 — Activity region preflight (공식 22 + staging candidates)

## 1. 기준·최종 커밋

기준 HEAD: 9bc70fdcfa66cfe694c4d12e03c74d3b72ea93d5  
최종 HEAD: b47d72e5e2f85ddfbda000880c0563274c5de0a1  
브랜치: cursor/map-layout-cards-bc3c  
PR: #1 유지  
격리 검증: `node tools/test-phase20-activity-region-preflight.js` → PHASE20_ACTIVITY_VERDICT PASS  
2단계 `plan-activity-region-v2-dependency-stub.sql` 제거. PLAN v2 전체 apply·임시 user_data 테이블 우회 없음.

## 2. 스키마 의존 (공식 22 적용 후)

| 객체 | 공식 22 후 | PLAN v2 추가 의존 |
| --- | --- | --- |
| board_posts / comments / reactions | 존재, activity_region 없음 | board candidate로 컬럼·트리거 |
| user_progression, user_alignment_state | 존재 (KR SSOT) | 변경 없음 |
| user_activity_region_profile / achievement | 없음 | progression candidate로 신규 |
| user_notifications, user_activity_events, user_bookmarks | **없음** | v2 ALTER 대상이지만 공식 스키마 없음 → BLOCKED |

`migration_user_data_system.sql`은 DO_NOT_APPLY 초안. 임시 테이블로 v2 우회 금지(20차 3단계).

## 3. 신규 후보 SQL (staging only, catalog 승격 없음)

1. `supabase/migration_activity_region_board_scope_candidate.sql`  
   activity_region_norm, board 3테이블 컬럼·CHECK·인덱스, 댓글/반응 REGION_MISMATCH 트리거. board RLS **추가 enable 없음**(board_core 기존 RLS 유지).

2. `supabase/migration_activity_region_progression_scope_candidate.sql`  
   user_activity_region_profile, user_activity_region_achievement, RLS ON + authenticated SELECT own. user_progression/user_achievements 미변경.

3. `docs/candidates/staging-activity-region-migration-manifest.json` — 적용 순서·제외 목록.

`migration_activity_region_v2.sql` — PLAN ONLY 유지, 승격하지 않음.  
`migration_activity_region_legal_consent_candidate.sql` — CANDIDATE ONLY, 법무 BLOCKED.

## 4. 변경 파일

- supabase/migration_activity_region_board_scope_candidate.sql (신규)
- supabase/migration_activity_region_progression_scope_candidate.sql (신규)
- shared/migration-preflight-orders.js (STAGING_ACTIVITY_REGION_CANDIDATES, OFFICIAL_PUBLIC_REQUIRED_COUNT)
- tools/test-phase20-activity-region-preflight.js (신규)
- tools/test-phase20-migration-preflight.js (stub/v2 smoke 제거)
- tools/test-activity-region-auth-env.js (board+progression candidate, stub 제거)
- tools/lib/plan-activity-region-v2-dependency-stub.sql (삭제)
- docs/candidates/staging-activity-region-migration-manifest.json (신규)
- docs/reports/phase20-migration-preflight.md (2단계 보정)
- docs/reports/phase20-activity-region-preflight.md

## 5. 격리 DB 결과

PHASE20_ACTIVITY required_count PASS count=22  
PHASE20_ACTIVITY official_public_apply ISOLATED DB PASS  
PHASE20_ACTIVITY user_data_table_* BLOCKED (3 tables absent)  
PHASE20_ACTIVITY public_inspect ISOLATED DB PASS  
PHASE20_ACTIVITY candidate_apply / candidate_idempotent ISOLATED DB PASS  
PHASE20_ACTIVITY kr_legacy_null / comment_region_mismatch / comment_inherit_us / reaction_inherit_us ISOLATED DB PASS  
PHASE20_ACTIVITY kr_progression_unchanged / kr_alignment_unchanged ISOLATED DB PASS  
PHASE20_ACTIVITY rls_profile_policy ISOLATED DB PASS (policy exists + RLS enabled on new tables only)  
PHASE20_ACTIVITY legal_us_consent_sql BLOCKED  
PHASE20_ACTIVITY real_auth BLOCKED  
PHASE20_ACTIVITY_VERDICT PASS  

## 6. KR/US 게시판 분리

- NULL/empty activity_region → activity_region_norm = KR (legacy).
- US 글은 activity_region='US' 명시 저장.
- 댓글·반응 트리거: 원글/대상과 불일치 시 REGION_MISMATCH.
- KR/US 목록 필터·US write: **앱·service_role 경로**(DB candidate는 board RESTRICTIVE policy 미포함 — v2의 authenticated KR-only RESTRICTIVE는 후속 staging 옵션, board RLS 이미 ON).

## 7. RLS·권한

- board_*: board_core에서 RLS 이미 ON. board candidate는 정책 추가·RLS enable 없음.
- user_activity_region_*: candidate에서 RLS ON + SELECT own (authenticated). INSERT/UPDATE는 service_role(앱) 전제.
- embedded PG에서 SET ROLE authenticated 세션 검증은 Supabase JWT 환경과 다름 → 정책 존재·relrowsecurity만 ISOLATED PASS.

## 8. 성향 영향

- user_alignment_state / user_progression 행: US profile insert 후에도 변경 없음(ISOLATED PASS).
- US tendency jsonb 컬럼은 storage only. US political batch/scheduler **미구현** — 동작한다고 기록하지 않음.

## 9. 미국 연령·법적 동의

- 앱: `legal-gate-core.js` US_MIN_AGE=18, AGE_UNDER_18 (user_legal_consents 경로).
- DB: `migration_activity_region_legal_consent_candidate.sql` 미적용 → BLOCKED (법적 검토·시행일 선행).
- sensitive consent 철회 TX migration: 공식 OPTIONAL, 스테이징 apply 승인 전 BLOCKED.

## 10. 스테이징 적용 가능 여부

- 공식 public REQUIRED 22 → staging board candidate → progression candidate: **격리 PG PASS**.
- user_data 3테이블 region 컬럼: **공식 스키마 확정 전 BLOCKED**.
- legal consent candidate: **BLOCKED**.

## 11. 남은 P0 / P1

P0: 스테이징 Supabase에 공식 22 + manifest 2 apply 승인·REAL Auth smoke; user_data 공식 설계 또는 v2 분할 정책; Launch Finalization.  
P1: v2 RESTRICTIVE board policies(선택); notifications/events/bookmarks 공식 migration; 베타 AI 범위(20차 1단계와 동일 미확정).

## 12. 스테이징에 필요한 승인

1. public REQUIRED 22 apply (기존 게이트)  
2. staging-activity-region-migration-manifest 2파일 apply  
3. legal consent candidate — 법무 승인 전 금지  
4. user_data 계열 공식 migration 설계 승인 전 v2 user_* ALTER 금지  
5. REAL Auth + activity region HTTP smoke  

## 13. 2단계 보고서 개수 정정

`production-public-migration-core.js` REQUIRED 배열 길이 = **22** (`shared/migration-preflight-orders.js` OFFICIAL_PUBLIC_REQUIRED_COUNT). 2단계 문서의 22 표기가 맞으며, 코드 SSOT와 일치 확인(20차 3단계).

## 14. 베타 출시 판정

본 step은 staging candidate 설계·격리 검증만. 베타 출시 가능 판정하지 않음.
