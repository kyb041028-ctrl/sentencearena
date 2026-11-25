# Phase 19 Step 3 — Emergency halt & safety (격리 PG)

## 1. 기준·최종 커밋

기준: 861f0e128e61f729f3ecc4e9518900d771074a3b (step2 suite).  
브랜치: cursor/map-layout-cards-bc3c.  
최종 커밋: 7a77c27b7646a98ca8c46b145fa238b4910b9e85.  
PR: #1 유지.

## 2. 구현 기능

- KR/US 독립 긴급 중지 PG 테이블 + 감사 로그 + 관리자 API (GET/POST emergency-halt/:region).
- env 자동발행 OFF와 긴급 중지 분리. halt 조회 실패 시 발행 fail-closed.
- 자동·forceAutoPublish·관리자 신규 PUBLISHED 경로 halt 검증 + DB 커밋 직전 재검증.
- forceAutoPublish는 env OFF 우회는 유지하되 halt ON이면 차단.
- US scheduler run SQL 저장소 + lease + orphan lease 만료 복구.
- KR morning scheduler run lease + orphan 처리.
- US 일일 maxPerDay=3 PG 집계 선검사 (publishedTodayOverride 테스트 전용).
- TEMP_HIDDEN 공개 차단 (목록·직접·댓글·반응), DB 댓글/반응 유지.

## 3. 변경 파일

- supabase/migration_daily_issue_phase19_safety_v1.sql
- shared/daily-issue-emergency-halt-core.js
- shared/daily-issue-public-visibility-core.js
- server/daily-issue-emergency-halt-store.js
- server/daily-issue-emergency-halt-service.js
- server/daily-issue-us-scheduler-sql-store.js
- server/daily-issue-review-service.js
- server/daily-issue-us-run-service.js
- server/daily-issue-morning-scheduler-store.js
- server/daily-issue-morning-scheduler-service.js
- server/daily-issue-routes.js
- tools/lib/daily-issue-local-pg-harness.js
- tools/test-phase19-daily-issue-step3.js
- docs/reports/phase19-step3.md

## 4. 기존 결함·수정

- forceAutoPublish가 env OFF만 우회하고 halt 없음 → halt PG + publish 경로 차단.
- US run store 메모리 전용 + getByRunKey/tryClaimRun await 누락 → SQL store + async 수정.
- 일일 상한이 claim 이후에만 적용 → PG count 선검사 DAILY_MAX_REACHED.
- 숨김 US 이슈 댓글 공개 조회 → publicVis + loadPublicIssue 차단.

## 5. 긴급 중지

테이블 daily_issue_emergency_halt / daily_issue_emergency_halt_audit. KR·US 행 독립. setEmergencyHalt는 actorId 필수 + audit insert. RETIRED·TEMP_HIDDEN·정정 경로는 publish gate 미적용.

## 6. force 우회 차단

halt ON + forceAutoPublish → runMorningAutoPublish skipped EMERGENCY_HALT_ACTIVE. transitionItem PUBLISHED FORCE/ADMIN/AUTO kind별 assertPublishAllowed.

## 7. 크래시 복구

scheduler/US run STARTED·RUNNING + lease_expires_at 만료 → ORPHAN_LEASE_EXPIRED FAILED 기록 후 allowRetryAfterFailure 시 재claim. 무조건 SUCCESS 처리 없음.

## 8. US run DB

daily_issue_us_scheduler_runs + createSqlUsSchedulerStore. executor 제공 시 PG 사용. advisory xact lock으로 동시 claim 1건.

## 9. 일일 제한

US: countPublishedUsOnDate PG 집계, maxPerDay=3, override는 NODE_ENV=test 또는 __testDailyIssueOverride.  
KR: 아침판 maxTotalPublished 8 / 카테고리 3은 기존 operator publish gate. 별도 “하루 1건” canon 미확정 → KR 전용 일일 1건 cap 신규 추가 없음 (결정 대기).

## 10. 숨김·댓글·반응

TEMP_HIDDEN 시 publicVis false. 댓글 store row 유지. scenario L PASS.

## 11. 실행 명령

embedded-postgres 부트 후:

node tools/test-phase19-daily-issue-step3.js

환경: DAILY_ISSUE_DATABASE_URL (127.0.0.1), DAILY_ISSUE_DB_SCHEMA=daily_issue_test, NODE_ENV=test.

## 12. 테스트별 PASS/FAIL (격리 PG, embedded)

A ISOLATED DB PASS  
B ISOLATED DB PASS  
C ISOLATED DB PASS  
D ISOLATED DB PASS  
E ISOLATED DB PASS  
F ISOLATED DB PASS  
G ISOLATED DB PASS  
H ISOLATED DB PASS  
I ISOLATED DB PASS  
J ISOLATED DB PASS  
K ISOLATED DB PASS  
L ISOLATED DB PASS  
PHASE19_STEP3_VERDICT PASS

## 13. 출력 핵심 증거

scenario_A KR_block=EMERGENCY_HALT_ACTIVE US_publish=true  
scenario_D reason=EMERGENCY_HALT_ACTIVE  
scenario_K pgCount=3 reason=DAILY_MAX_REACHED  
scenario_L load=TEMP_HIDDEN comments=1  
scenario_J claims=1

## 14. 남은 NOT_IMPLEMENTED

- 운영 Supabase에 migration_daily_issue_phase19_safety_v1.sql 미적용.
- KR “하루 1건” 정책 canon 확정 시 별도 구현 필요.
- halt HTTP 라우트 Production admin JWT·역할 실검증 없음 (격리 PG + actorId gate만).
- LIVE AI·실알림·NAVER 경로 미검증.

## 15. 남은 BETA_BLOCKER

- step2 forceAutoPublish vs env OFF: halt 연동 후 halt OFF에서 force는 의도된 내부 우회로 유지. halt ON 우회는 차단됨.
- Production Auth·LIVE AI·운영 스케줄 ON 상태 end-to-end 미검증 → 베타 출시 판정 불가.

## 16. 운영 반영 여부

NO. SQL은 브랜치 파일만. 격리 embedded-postgres에서만 migration 적용·테스트.

## 17. 다음 작업

- 사용자 승인 후 격리 스테이징에 migration 적용 및 admin halt UI 연동.
- KR 일일 발행 정책 DECISIONS 확정.
- Production deploy 전 Auth·스케줄 dry-run 및 step3 시나리오 스테이징 재실행.
