# Phase 19 Step 3 — Emergency halt (격리 PG)

## 1. 목적

Daily Issue **긴급 중지(emergency halt)** 가 KR/US **독립**으로 격리 PostgreSQL에 persist 되는지, 발행·forceAutoPublish·US SQL scheduler·공개 가시성과 함께 검증한다. Step 2에서 NOT_IMPLEMENTED였던 halt persist·US PG run store 시나리오를 Step 3 전용 도구로 실행한다.

## 2. Baseline commit

861f0e128e61f729f3ecc4e9518900d771074a3b (`861f0e1`) — step2 격리 PG 동시성·lifecycle suite.

## 3. 실행 조건

- `DAILY_ISSUE_DATABASE_URL`: 127.0.0.1 등 격리 대상만 (`tools/lib/daily-issue-isolated-target.js`).
- `DAILY_ISSUE_DB_SCHEMA`: 기본 `daily_issue_test` (허용 스키마만).
- 비밀(connection string 전체, 비밀번호)은 보고·로그에 넣지 않는다.

## 4. 도구

`node tools/test-phase19-daily-issue-step3.js`

출력 접두사: `PHASE19_STEP3 scenario_*` / 마지막 `PHASE19_STEP3_VERDICT PASS|FAIL|BLOCKED`.

Admin actor UUID (테스트): `11111111-1111-4111-8111-111111111111`.

## 5. Operational apply

NO — Production DB migration, deploy, env 반영 없음. 격리 DB 시험 전용.

## 6. Scenario A — KR halt on, US publish

KR `halted=true`, US normal. US 항목 `transitionItem` → PUBLISHED 성공. KR 항목 동시 시도 → `EMERGENCY_HALT_ACTIVE`.

## 7. Scenario B — US halt on, KR publish

US `halted=true`, KR normal. KR PUBLISHED 성공. US PUBLISHED → `EMERGENCY_HALT_ACTIVE` (영역 분리).

## 8. Scenario C — Both halted

KR·US 모두 halt on. KR·US publish 모두 `EMERGENCY_HALT_ACTIVE`.

## 9. Scenario D — forceAutoPublish + halt

KR halt on, `runMorningAutoPublish` with `forceAutoPublish: true`, morning env on, dryRun. `skipped` + reason `EMERGENCY_HALT_ACTIVE`.

## 10. Scenario E — Halt race before persist

KR halt off → APPROVED 항목 PUBLISHED 시도. `haltStore` 래퍼가 두 번째 `getRegion` 직전 KR halt on. Recheck에서 `EMERGENCY_HALT_ACTIVE`, DB status APPROVED 유지.

## 11. Scenario F — Restart read

연결 A에서 US halt on persist. 연결 B `createSqlEmergencyHaltStore` → `getRegionState('US')` still `halted=true`.

## 12. Scenario G — Admin actor required

`setEmergencyHalt` halt off without `actorId` → `ADMIN_ACTOR_REQUIRED`.

## 13. Scenario H — US orphan STARTED lease

US SQL store table에 `STARTED` + 만료 lease 수동 insert. `tryClaimRun` → `ORPHAN_RECOVERED`. `allowRetryAfterFailure: true` 재시도 → claim 성공.

## 14. Scenario I — FAILED retry after halt off

US run FAILED 기록( halt on 중 ). halt off 후 `allowRetryAfterFailure` claim 및 `runUsDailyIssueSlot`이 halt에 막히지 않음.

## 15. Scenario J — Dual connection US runKey

두 PG executor + `createSqlUsSchedulerStore`. 동일 `runKey` 동시 `tryClaimRun` → 정확히 1 claim, status RUNNING.

## 16. Scenario K — US daily max (PG count)

동일 ET dateKey에 US PUBLISHED 3건 PG insert. `runUsDailyIssueSlot` (`publishedTodayOverride` 없음) → `DAILY_MAX_REACHED`.

## 17. Scenario L — TEMP_HIDDEN + comments

US PUBLISHED → TEMP_HIDE meta. 댓글 PG insert. `loadPublicIssue`(publicVis) → `TEMP_HIDDEN`. 댓글 row는 DB에 유지.

---

## Changed files (this step)

- tools/test-phase19-daily-issue-step3.js
- docs/reports/phase19-step3.md

## Verdict (local run)

격리 URL 미설정 시 `PHASE19_STEP3_VERDICT BLOCKED` (exit 2). URL 설정 후 전 시나리오 green이면 `PASS` (exit 0). `ISOLATED DB FAIL` 1건이라도 exit 1.
