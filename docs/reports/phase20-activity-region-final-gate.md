# Phase 20 Step 4 — Activity region final gate

## 1. 수정한 허위 PASS

`tools/test-phase20-activity-region-preflight.js`의 `kr_alignment_unchanged`가 조건 불일치 시 `'PASS'`로 기록되던 삼항 연산자를 `'FAIL'`로 수정. `user_alignment_state`에 score 42.5·previous_signal 1을 선저장한 뒤 US profile·board 활동 후 동일성 검사. 빈 행끼리 비교 통과 제거(`kr_alignment_seed` FAIL). `kr_alignment_negative_detector`로 score tamper 시 비교기가 drift를 감지하는지 확인.

## 2. 한국 성향 실검증

격리 PG: KR alignment 행(42.5) 존재 확인 → US `user_activity_region_profile`·US board insert → score·previous_signal 불변 ISOLATED PASS. final-gate에서 120.25/-1 행으로 US board insert 후 재검증. US political batch/scheduler **미구현** — DB가 KR `user_alignment_state`를 US 활동으로 덮지 않음만 검증.

## 3. RLS A/B (authenticated SELECT)

회원 A(`TEST_USER`)·B(`USER_B`). `SET LOCAL role authenticated` + `request.jwt.claim.sub` 스텁. A는 본인 KR/US profile·achievement SELECT 가능. A가 B profile·achievement 조회 시 0행. postgres(서비스 경로)는 B profile 1행 조회 가능 — Supabase `service_role`과 동일 계약 아님, **로컬 stub**. REAL Supabase Auth: BLOCKED.

## 4. 게시글 국가 변경

결함: board candidate v1은 댓글·반응만 REGION_MISMATCH, **글 activity_region UPDATE는 자식 존재 시 변경 가능**했음.  
수정: `migration_activity_region_board_scope_candidate.sql`에 `REGION_IMMUTABLE_WITH_CHILDREN` 트리거 추가(댓글 또는 POST 반응 있으면 post region 변경 거부).  
KR/US 글 각각 댓글·반응 생성 후 parent/child norm 일치 PASS. KR 글 US로 flip 시도 → 차단 PASS. 국가별 목록 필터는 DB `activity_region_norm` 집계만 검증; **앱 라우트·service_role write는 별도**. board candidate는 KR/US RESTRICTIVE RLS 미포함 — RLS만으로 KR/US 공개 분리 완료라고 쓰지 않음.

## 5. 변경 파일과 테스트 명령

변경:
- supabase/migration_activity_region_board_scope_candidate.sql (post region lock trigger)
- tools/test-phase20-activity-region-preflight.js (허위 PASS·seed·negative detector)
- tools/test-phase20-activity-region-final-gate.js (신규)

명령:
- `node tools/test-phase20-activity-region-preflight.js`
- `node tools/test-phase20-activity-region-final-gate.js`

## 6. PASS / FAIL / BLOCKED

kr_alignment_unchanged / seed / negative_detector: ISOLATED DB PASS  
kr_alignment_real_row / negative_logic (final-gate): ISOLATED DB PASS  
rls_ab_profile / rls_ab_achievement: ISOLATED DB PASS  
rls_service_role_bypass: ISOLATED DB PASS (postgres seed path)  
board_post_region_change_blocked: ISOLATED DB PASS (trigger fix 후)  
board_kr_us_children_match / board_region_filter_db: ISOLATED DB PASS  
real_supabase_auth: BLOCKED  
user_notifications / events / bookmarks: BLOCKED (3단계 동일)  
legal_us_consent_sql: BLOCKED  
US political alignment engine: NOT IMPLEMENTED  

PHASE20_FINAL_VERDICT PASS · PHASE20_ACTIVITY_VERDICT PASS (step4 실행 시).

## 7. 스테이징 적용 가능 파일

승인 시 순서: 공식 public REQUIRED 22 → `migration_activity_region_board_scope_candidate.sql`(post lock 포함) → `migration_activity_region_progression_scope_candidate.sql`. manifest: `docs/candidates/staging-activity-region-migration-manifest.json`. PLAN v2·legal consent candidate·user_data_system 승격 없음.

## 8. 남은 베타 P0 (스테이징 진입 필수)

1. REAL Supabase Auth + HTTP activity-region smoke (로컬 stub 대체 아님)  
2. 스테이징 DB에 공식 22 + activity-region manifest 2 apply **명시 승인**  
3. user_data 3테이블 공식 migration 또는 v2 분할 정책 **설계 승인**  
4. US legal consent candidate — **법무·시행일 BLOCKED** 해소 전 apply 금지  
5. Launch Finalization / Auth·RSS·DI 운영 게이트 (20차 1단계 P0 잔여)  
6. US 정치성향 엔진 — 베타 필수 여부 **미확정**, 미구현 유지  

격리 DB만으로는 스테이징 진입 **미충족**. 추가 로컬 사전점검 차수 제안 없음.

## 9. Supabase 연결·DB 적용에 필요한 승인

- 스테이징 project 연결·service_role apply (비밀 회전·`.env` 변경 각각 별도 승인)  
- public REQUIRED 22 apply (PUBLIC_SCHEMA confirm)  
- activity-region staging manifest 2파일 apply  
- legal consent candidate apply — 법무 승인 전 금지  
- user_data 공식 migration 확정 전 v2 user_* ALTER 금지  

## 10. 커밋

기준 HEAD: badaae2c4e92269f08fb324d9d03720119ecd9b9  
대상 커밋(20차 4단계 구현·SQL·테스트): 72b49d553c77f8baf18b087687fe2f3fe71426c8  
보고서 작성 커밋: 본 파일을 담은 직후 커밋 — 메시지 `docs: phase20 step4 final gate report`  
브랜치: cursor/map-layout-cards-bc3c · PR #1 유지  

베타 출시 가능 판정하지 않음. 스테이징 진입 = REAL Supabase 검증 + P0 승인 충족 후에만.
