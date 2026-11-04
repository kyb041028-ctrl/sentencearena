# Phase 19 Step 4 — Hardening (격리 PG + HTTP)

## 1. 기준·브랜치

기준 HEAD: 4958893a7f427e4f33a3585321e92c9b2b0ce994  
브랜치: cursor/map-layout-cards-bc3c  
PR: #1 유지  
3단계 기능 재개발 없음. 결함 최소 수정만.

## 2. 항목별 구현·검증

1. 긴급 중지 ↔ PUBLISHED 저장 경합  
   - SQL repository `transitionReviewItem`에서 review row `FOR UPDATE` 후 `daily_issue_emergency_halt` region row `FOR UPDATE` 재검증.  
   - 격리 PG: halt ON 후 publish → EMERGENCY_HALT_ACTIVE, status APPROVED 유지. 동시 halt toggle race invariant PASS.

2. 내부 우회 옵션  
   - `shared/daily-issue-publish-internal-guard.js`: skipHaltCheck, forceAutoPublish, __testDailyIssueOverride, publishedTodayOverride HTTP/서비스 차단.  
   - `__internalForceApproved` + trusted test context만 force 허용. US run 내부 force 유지.  
   - HTTP admin publish body에 skipHaltCheck → UNAUTHORIZED_PUBLISH_OPTION.

3. 긴급 중지 관리자 API 인증  
   - mock guard: 토큰 없음 401, bad token 401, member 403, ADMIN/OWNER 200 (GET emergency-halt/KR).  
   - REAL Supabase Auth 통합: REAL AUTH BLOCKED (본 run 미설정).

4. US SQL scheduler 초기화  
   - `resolveUsSchedulerStore`: DAILY_ISSUE_DATABASE_URL + schema 시 SQL store, 없으면 memory (운영 검증 완료 아님으로 보고).  
   - `daily-issue-us-scheduler.js` start/runSlot에 databaseUrl 전달.  
   - 재연결 후 run row SUCCESS 유지. 동시 slot + pgCount=3 + DAILY_MAX PASS.

5. TEMP_HIDDEN 공개 HTTP  
   - Express `createDailyIssueApiApp` 실 라우트: list 제외, detail/comments 404, DB 댓글 유지 PASS.

## 3. 변경 파일

- shared/daily-issue-publish-internal-guard.js (신규)
- server/daily-issue-emergency-halt-store.js (lockAndAssertPublishAllowedInTx)
- server/daily-issue-review-sql-repository.js (halt TX lock, mapPgError)
- server/daily-issue-review-service.js (guard validate)
- server/daily-issue-us-run-service.js (resolveUsSchedulerStore, internal force mark)
- server/daily-issue-us-scheduler.js (SQL store init path)
- server/daily-issue-routes.js (HTTP bypass reject, resolveHaltStore executor)
- server/daily-issue-api-errors.js (UNAUTHORIZED_PUBLISH_OPTION, EMERGENCY_HALT_ACTIVE)
- tools/test-phase19-daily-issue-step4.js (신규)
- tools/test-phase19-daily-issue-step3.js (trusted test opt only)
- docs/reports/phase19-step4.md

## 4. 테스트 명령

embedded-postgres 부트 후:

node tools/test-phase19-daily-issue-step4.js

환경: DAILY_ISSUE_DATABASE_URL (127.0.0.1), DAILY_ISSUE_DB_SCHEMA=daily_issue_test, NODE_ENV=test

## 5. 결과 (격리 PG embedded)

halt_tx_lock PASS  
halt_race_invariant PASS  
bypass_guard_negative PASS  
bypass_http_reject PASS  
halt_auth_* MOCK PASS (5 cases)  
halt_auth_real_supabase REAL AUTH BLOCKED  
us_sql_restart_path PASS  
us_concurrent_daily_max PASS  
public_http_temp_hidden PASS  
PHASE19_STEP4_VERDICT PASS

## 6. 남은 출시 차단

- 운영 Supabase migration·REAL Auth halt API 미검증  
- US scheduler memory fallback still exists when DB URL absent (not production-verified)  
- LIVE AI·실알림·운영 자동발행 ON end-to-end 없음  
- 베타 출시 판정 불가

## 7. 운영 반영

NO. 격리 DB·mock auth 테스트만.
