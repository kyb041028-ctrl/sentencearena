# Phase 19 Step 5 — Concurrency + admin POST + prod store guard

## 1. 기준·브랜치

기준 HEAD: 119fd209f750a270ee0baf0123ca322d33d1b780  
브랜치: cursor/map-layout-cards-bc3c  
PR: #1 유지  
4단계 기능 재구현 없음. 실제 결함 최소 수정.

## 2. 항목별 구현·검증

1. 미국 하루 3건 동시성  
   - `shared/daily-issue-us-daily-quota-lock.js`: ET dateKey advisory lock + 동일 TX published US count.  
   - `transitionReviewItem` US PUBLISHED 시 halt lock 다음 quota lock. 초과 시 US_DAILY_MAX_REACHED.  
   - 격리 PG: 기존 3건 후 차단 유지. 2건 선발행 + 서로 다른 runKey·후보 동시 publish/slot → 합계 3, 초과 1건 US_DAILY_MAX_REACHED 또는 run DAILY_MAX_REACHED. publishedTodayOverride 미사용.

2. 긴급 중지 경합  
   - DB repo publish는 TX 내 `lockAndAssertPublishAllowedInTx`만 사용(사전 assertPublishAllowed 제거).  
   - `halt_row_locked` trace + audit HALT_ON. 동시 halt ON + KR publish → EMERGENCY_HALT_ACTIVE, APPROVED 유지.

3. 관리자 API GET/POST  
   - mock: none/bad 401, MEMBER 403, ADMIN/OWNER GET·POST 200.  
   - mock actor userId UUID(테스트 fixture). REAL Supabase Auth: REAL AUTH BLOCKED.

4. 미국 실행 저장소 운영  
   - NODE_ENV=production + DB URL 없음/연결 실패 → unavailable store, scheduler 미시작, 자동 발행 없음.  
   - dev/test memory·SQL 경로 유지.

## 3. 변경 파일

- shared/daily-issue-us-daily-quota-lock.js (신규)
- server/daily-issue-emergency-halt-store.js (halt lock trace)
- server/daily-issue-review-sql-repository.js (US quota TX lock)
- server/daily-issue-review-service.js (DB halt gate in TX only)
- server/daily-issue-api-errors.js (US quota / halt codes)
- server/daily-issue-routes.js (halt POST body guard)
- server/daily-issue-us-run-service.js (prod no silent memory)
- server/daily-issue-us-scheduler.js (prod store gate)
- tools/daily-issue-api-test-fixtures.js (mock admin UUID)
- tools/test-phase19-daily-issue-step5.js (신규)
- docs/reports/phase19-step5.md

## 4. 테스트 명령

embedded-postgres 부트 후:

node -e "const boot=require('./tools/lib/daily-issue-isolated-embedded-pg'); const cp=require('child_process'); boot.bootDailyIssueIsolated().then(async r=>{const env=Object.assign({},process.env,{DAILY_ISSUE_DATABASE_URL:r.url,DAILY_ISSUE_DB_SCHEMA:r.schemaName,NODE_ENV:'test'}); const c=cp.spawnSync('node',['tools/test-phase19-daily-issue-step5.js'],{encoding:'utf8',env:env}); console.log(c.stdout); await r.shutdown(); process.exit(c.status||0);});"

또는 DAILY_ISSUE_DATABASE_URL 설정 후:

node tools/test-phase19-daily-issue-step5.js

## 5. 동시성 근거

- US quota: pg_advisory_xact_lock(dateKey) + COUNT published US same ET day in one transaction.  
- Halt race: daily_issue_emergency_halt FOR UPDATE in publish TX; trace phase halt_row_locked before blocksNewPublish.  
- Concurrent test: two parallel transitionItem + two runUsDailyIssueSlot; pg count cap 3.

## 6. 결과 (격리 PG embedded)

us_daily_three_then_block PASS  
us_daily_concurrent_two_of_three PASS  
halt_race_lock_trace PASS  
halt_get_none MOCK PASS  
halt_get_bad MOCK PASS  
halt_get_member MOCK PASS  
halt_get_admin MOCK PASS  
halt_get_owner MOCK PASS  
halt_post_member MOCK PASS  
halt_post_admin MOCK PASS  
halt_post_owner MOCK PASS  
halt_auth_real REAL AUTH BLOCKED  
us_prod_no_memory_fallback PASS  
us_dev_memory_allowed PASS  
PHASE19_STEP5_VERDICT PASS

## 7. 남은 출시 차단

- 운영 Supabase migration·REAL Auth halt POST 미검증  
- LIVE AI·실알림·운영 자동발행 ON end-to-end 없음  
- 베타 출시 판정 불가

## 8. 운영 반영

NO. 격리 DB·mock auth만.
