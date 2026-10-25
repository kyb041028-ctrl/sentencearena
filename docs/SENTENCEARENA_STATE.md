# SentenceArena Current State

Last updated: 2026-10-25 (launch finalization documents, docs only)
Repository branch: `master`
Repository HEAD at this record: `11cbab05d280b673b3bd0c78379e114bda13d417` (baseline immediately before this docs commit)
Prior documented HEAD: `b66ae96d2b840a63eb5e387965a10de2d171053b` (2026-10-25 open beta dev verification code baseline)
Prior documented HEAD: `d62bab5507309d5f23d51e6371248df3e9b32904` (2026-10-22 SSOT refresh)
Prior documented HEAD: `3db0533` (2026-09-06 session closing)
Prior feature HEAD: `8b6dfb1` (legal hold + admin audit retention purge code)
Status source: `master` through `11cbab05` + sentencearena-dev verification recorded 2026-10-25 + owner-confirmed Production rollout (2026-09-06) + owner-confirmed NAVER Cloud app server stop (2026-10-14) + DEC-019 + DEC-020 + DEC-021
Code vs Production: legal_hold / admin audit purge = **PRODUCTION COMPLETE** as verified 2026-09-06 (migration + NAVER runtime at that check). This 2026-10-25 record does not add a new Production verification. Two later migrations are verified on sentencearena-dev only and are not applied to Production (§17).
2026-10-22 docs-only note (historical, through `d62bab55` only): commits after `3db0533` through `d62bab55` are `cbcff3c` (session closing), `34a7ff2` and `f10bee7` (agent safety rules), `d62bab55` (Codex handoff). No product feature commit in that range. That sentence does not describe commits after `d62bab55`.
Commits after `d62bab55` through `b66ae96` include product and test changes. The 2026-10-25 dev-verification docs commit does not restate those diffs. It records the dev verification result on top of `b66ae96`.
This launch-finalization docs edit sits on `11cbab05`. It does not restate product diffs. It records legal-draft contradiction fixes and an unchecked pre-launch checklist.
Session closing: see `docs/SESSION_CLOSING_PROTOCOL.md`

Older handoff/checklist documents are historical references.
They must not override these current-state documents.

---

## Information priority (SSOT)

### Current-state judgment

1. Actual current Production/runtime and latest implementation
2. `docs/SENTENCEARENA_STATE.md` (this file)
3. Latest completed work reports
4. Current ACTIVE design decisions (`docs/SENTENCEARENA_DECISIONS.md`)
5. Older handoff / checklist / chat records

### Design-decision judgment

1. ACTIVE decisions in `docs/SENTENCEARENA_DECISIONS.md`
2. Latest user-confirmed decisions
3. Actual implementation
4. Older designs / proposals

Rules:

- An old TODO must never override a newer COMPLETE.
- An old design that conflicts with an ACTIVE decision is treated as discarded.
- If code/runtime differs from STATE, do not force code to match old docs — confirm the difference, then update STATE to the latest fact.
- The same item must not appear as both COMPLETE and TODO.
- Completed items are removed from TODO-style backlog sections here; Git preserves history.

### Maintenance rules (every development task)

BEFORE WORK:

1. Read this STATE file
2. Read relevant ACTIVE decisions
3. Compare requested work with current COMPLETE / DEFERRED state

AFTER WORK:

1. Update actual COMPLETE state
2. Remove obsolete TODO-style items from this file
3. Add newly discovered limitations to Deferred
4. Update current HEAD
5. Never silently change an ACTIVE decision
6. If a design decision changes, update `SENTENCEARENA_DECISIONS.md` explicitly

---

## 1. Runtime / operations

| Item | Status | Fact |
| --- | --- | --- |
| Production domain | COMPLETE | `https://sentencearena.com` |
| NAVER Cloud Korea migration | COMPLETE | Owner-confirmed; do not re-open as TODO |
| Railway → NAVER Cloud migration | COMPLETE | Owner-confirmed |
| DNS cutover | COMPLETE | Owner-confirmed |
| Post-migration validation | COMPLETE | Owner-confirmed |
| Railway rollback-period / cleanup | COMPLETE | Owner-confirmed |

Do not invent server IP, instance name, or cutover timestamps when not verified in current materials.

### Current process

- NAVER Cloud app server process: **stopped** as of 2026-10-14.
- Source for this update: owner confirmed the stop for this SSOT edit. Written record: `docs/SENTENCEARENA_HISTORY_CONTEXT.md`.
- This 2026-10-22 edit did not probe the live host. Do not treat this file as a new `/health` or `/ready` check.
- The stop does not reverse DEC-019, the 2026-09-06 rollout, or migration COMPLETE. It is not a new PRODUCTION COMPLETE.
- Server start, stop, or return is outside this document.

### Open Beta ops flags — policy PRODUCTION COMPLETE (2026-09-06)

| Check | Value |
| --- | --- |
| `politicalSchedulerEnabled` | **true** (policy ON) |
| `alienModerationV1` | **true** (policy ON) |
| `dailyIssueMorningSchedulerEnabled` | **true** (policy ON) |
| `dailyIssueMorningAutoPublishEnabled` | **true** (policy ON) |

These four ops flags are **policy PRODUCTION COMPLETE** (DEC-019). Do not resurrect them as PARTIAL, apply pending, confirm live, decide later, or deferred.

Policy ON is separate from process running. The app server process is stopped as of 2026-10-14, so this file does not claim those schedulers are executing now.

### Host snapshot verified 2026-09-06 (not the current process)

| Check | Value on 2026-09-06 |
| --- | --- |
| `sentencearena.service` | **active** |
| `/health` | **OK** (200 / ok:true) |
| `database.ready` | **true** |

Not re-checked on 2026-10-22. Current database readiness is unknown here. The app server process is stopped as of 2026-10-14.

Production host paths last recorded (no secrets):

- Env source: `/etc/sentencearena.env`
- Shadow env: `/etc/sentencearena-shadow.env`
- systemd unit: `sentencearena.service`
- Origin: `https://sentencearena.com`

Policy reference: DEC-019 (ACTIVE).

Other `/ready` facts observed 2026-09-06 (snapshot, not a current live claim):

- `nodeEnv`: production
- `publicOrigin`: `https://sentencearena.com` (canonical)
- `supabaseConfigured`: true
- `boardOperational`: true
- `boardRepository`: supabase
- `territoryEvolutionOperational`: true
- `dailyIssueRepository`: db
- `dailyIssueSchema`: daily_issue

### 1b. Open beta ops flags (env map)

| Flag | Env | Production |
| --- | --- | --- |
| Political scheduler | `POLITICAL_ALIGNMENT_SCHEDULER_ENABLED` | policy ON / COMPLETE |
| Alien V1 | `ALIEN_MODERATION_V1` | policy ON / COMPLETE |
| Daily Issue morning collect | `DAILY_ISSUE_MORNING_SCHEDULER_ENABLED` | policy ON / COMPLETE |
| Daily Issue auto publish | `DAILY_ISSUE_MORNING_AUTO_PUBLISH` | policy ON / COMPLETE |

The Production column is DEC-019 policy, verified ON on 2026-09-06. It is not a claim that the process is running after 2026-10-14.

Political consent safety (verified in code 2026-09-06):

- Apply batch filters users via `legal-gate-service.filterUserIdsAllowed` (`sensitive-political-v1` + age + territory disclosure complete)
- Consent withdrawal deletes alignment state/history
- New members CENTRAL / score 0; no signup territory picker
- Alignment not used as Alien/sanction criterion
- Scheduler Asia/Seoul 05:00 / 17:00; batch_id idempotency

Daily Issue auto publish safety:

- Only `AUTO_PUBLISH_ELIGIBLE` items
- Duplicate signature/candidate blocked
- Max published caps preserved
- Requires `DAILY_ISSUE_MORNING_AUTO_PUBLISH=1` (Production ON)
- Manual operator approve/publish path remains available

Historical note: older docs that say “Railway Amsterdam operating / NAVER Cloud pending” are obsolete for current-state questions. Do not resurrect them into TODO.

---

## 2. Auth / members —COMPLETE

- Google login
- Kakao login
- Naver login
- Guest browsing
- Session restore / logout
- Activity-name onboarding
- New member starts CENTRAL / score 0
- No territory selection during signup
- Age 14+ signup gate
- Sensitive political consent separated (default OFF)
- Political profile private
- Account withdrawal
- Canonical identity = `auth.users.id`

### Production withdrawal warning (2026-10-25)

Account withdrawal above is the implemented member path. On sentencearena-dev, ordinary withdrawal and withdrawal of an account that has sanction/audit history passed after `supabase/migration_audit_withdrawal_set_null_v1.sql`.

That migration is not applied to Production. Until `supabase/migration_audit_withdrawal_set_null_v1.sql` is applied to Production, withdrawal of a user who has sanction/audit history can still fail on the existing Production trigger.

---

## 3. Board / community —COMPLETE

- Posts, comments, replies
- LIKE / DISLIKE
- EMPATHY (separate from LIKE/DISLIKE)
- Reports
- Edit
- Member soft delete → status `DELETED`
- Guest read-only
- Real Supabase board repository
- Other-member profile / level from server (`user_progression`)
- Admin direct post moderation
- Admin direct comment / reply moderation

---

## 4. Profile / XP / Fame / Achievement

### COMPLETE

- Canonical `user_progression`
- Level
- XP
- Fame = `reputation_score`
- Real activity statistics
- Post XP +25
- Board comment/reply XP +12
- Daily Issue comment XP +10
- Empathy recipient Fame +1 / remove −1
- Guest fake progression removed

### Connected achievements (6) —COMPLETE

- first-post
- first-comment
- first-empathy-received
- territory-citizen
- record-builder
- conversation-bridge

### Deferred achievements (5)

- steady-footsteps
- empathy-from-many
- dialogue-across-territories
- witness-of-an-era
- beta-citizen

---

## 5. Daily Issue

### COMPLETE

- Source collection
- Admin review
- Approve
- Publish
- Public list / detail
- Comments
- Reactions
- Admin management

### Runtime

- Morning automation: **policy ON** (`dailyIssueMorningSchedulerEnabled: true`, DEC-019)
- Auto publish: **policy ON** (`dailyIssueMorningAutoPublishEnabled: true`, DEC-019) — AUTO_PUBLISH_ELIGIBLE only
- App server process is stopped as of 2026-10-14. These ON values are policy, not a claim that the morning job is running now. Not re-checked live on 2026-10-22.
- Next real published issue — sanction-block Chrome verification: DEFERRED (Chrome backlog only)

Do not list morning/auto-publish as undecided, pending, or PARTIAL.

---

## 6. Territory evolution

### COMPLETE

- Territories: pioneer / central / guardian / alien
- Evolution stage 1–6
- Population calculation
- CENTRAL evolution population = CENTRAL + PIONEER + GUARDIAN
- Alien excluded from Central calculation
- Stage can decrease
- Evolution images / HUD
- Next threshold display

### Deferred

- Historical evolution snapshot persistence

---

## 7. Political alignment

### Confirmed design (see DECISIONS)

- All new members CENTRAL / score 0
- Political orientation separated from moderation
- Political opinion itself is not a sanction reason
- Daily Issue answers contribute initial seed
- Normal board reactions accumulate later
- 99-day + recent 30-day weighting structure

### Runtime

- `politicalSchedulerEnabled`: **true** — policy PRODUCTION COMPLETE (DEC-019)
- App server process is stopped as of 2026-10-14. This is not a claim that the scheduler process is running now. Not re-checked live on 2026-10-22.

---

## 8. Alien moderation

### Confirmed principles (see DECISIONS)

- Alien = behavior moderation / observation
- Political alignment is not an Alien criterion
- Intentional report farming must not be rewarded
- Behavior signals + operator decision
- Earth interaction restrictions
- Return rules

### Runtime

- `alienModerationV1`: **true** — policy PRODUCTION COMPLETE (DEC-019)
- App server process is stopped as of 2026-10-14. This is not a claim that the moderation process is running now. Not re-checked live on 2026-10-22.

### Deferred

- operator_hold
- Mistaken-action / cancel flow
- Season-linked return
- Multi-instance DB atomic lock
- Expanded Alien internal community

---

## 9. Reports / sanctions / admin —COMPLETE

### Admin surfaces

- `/admin/` integrated home
- Common navigation
- Post management
- Comment / reply management
- Reports / sanctions
- Appeals
- Official posts
- Daily Issue
- Rights infringement
- Moderation audit search (`/admin/audit/`)

### Admin audit (`admin_moderation_audit_events`, append-only)

- POST_SOFT_DELETE
- POST_RESTORE
- COMMENT_SOFT_DELETE
- COMMENT_RESTORE
- SANCTION_APPLIED
- REPORT_REJECTED
- `report_id` linkage for report-based actions

Current protection (do not weaken for normal operators):

- service_role also UPDATE/DELETE/TRUNCATE denied
- DB trigger blocks UPDATE/DELETE
- append-only; corrections = new events

### Admin audit retention

- Audit retention period policy: **COMPLETE — 1 year** (DEC-020; from `created_at`)
- Controlled automatic purge implementation: **PRODUCTION COMPLETE** (RPC + retention scheduler `counts.audit`; Production verified 2026-09-06)
- Active legal_hold exclusion: **COMPLETE**
- Released hold 7-day grace: **COMPLETE** (DEC-021)
- Operators must not get a manual delete UI; purge is controlled system path only
- Direct normal UPDATE/DELETE protection remains; purge uses SECURITY DEFINER + session GUC bypass inside RPC only

### Legal hold (DEC-021)

- Policy: **COMPLETE** (ACTIVE DEC-021; DEC-D06 RESOLVED)
- Code: **COMPLETE** — OWNER set/release API + `/admin/retention/` UI; ADMIN status-read only; member APIs do not expose hold
- Targets: evidence / report / sanction / rights case / admin audit (separate hold state table for audit)
- Production DB migration `migration_legal_hold_and_audit_purge_v1.sql`: **COMPLETE** (tables/RPC/columns verified; audit row count unchanged)
- NAVER runtime rollout: **COMPLETE as verified 2026-09-06** (release on origin/master `c252cd2` lineage; at that check `sentencearena.service` was active, `/health` OK, retention scheduler enabled). Not a 2026-10-22 live check. App server process is stopped as of 2026-10-14.
- OWNER API/UI deployed: **COMPLETE** (`/admin/retention/` 200; Guest POST legal-hold 401)
- OWNER real HOLD_SET → HOLD_RELEASE on live data: **not done** — Chrome backlog only (no fake Production hold data created)
- sentencearena-dev check 2026-10-25 (§17): ADMIN set/release 403, OWNER set/release 200, audit events preserved. Dev only. DEC-021 unchanged. This does not close the Production live-data item above. It is not an open-beta code blocker.

### Content status

| Actor | Status |
| --- | --- |
| Member own delete | `DELETED` |
| Operator hide | `HIDDEN_BY_OPERATOR` |
| Operator restore | `ACTIVE` |

### Report handling — COMPLETE

- Report action → audit `report_id` linkage
- Rejected report audit
- Report review card target preview
- Post / comment management direct links
- Report audit direct link
- Reporter result notification (public result only)
- Multiple reporters each get independent result notifications
- Sanction details / private moderation info not exposed to reporters

### Historical reference commits (admin moderation arc)

- `276dc34` —admin home / post moderation
- `747e9e0` —moderation audit
- `eedb4a1` —comment / reply moderation
- `985b941` — report → audit linkage
- `6c9da82` —report rejection + hide-state unify
- `ef557ff` —report UX + reporter notification
- `8b6dfb1` —DEC-021 legal_hold + admin audit retention purge (code)
- Production rollout docs — `b64ab3f` (rollout marked complete) and `3db0533` (session-close HEAD pointer). Current baseline HEAD is the 2026-10-15 handoff commit, not a new rollout.

### Admin deferred (do not mix with COMPLETE above)

- Sanction + audit full atomic transaction (`SANCTION_AUDIT_ATOMICITY_LIMITATION`)
- Report rejection + audit full atomic transaction (`REPORT_REJECT_AUDIT_ATOMICITY_LIMITATION`)
- SANCTION_RELEASED audit
- ACTION_CANCELLED audit
- MEMBER_REPORT_HISTORY_UI_PENDING
- REPORT_RESULT_NOTIFICATION_DELIVERY_LIMITATION (notify failure does not roll back review)

---

## 10. Rights / legal

### COMPLETE

- Rights infringement intake
- Attachments
- Admin review
- Rejection fields
- Logged-in intake backend
- Withdrawal
- Retention framework (as implemented)

### Intentionally deferred

- rights_email_verify (not treated COMPLETE without current DB proof)
- SMTP / mail delivery
- Non-member email verification
- Revisit after 2026-09-17
- Withdrawal-after-rights PII handling
- Permanent-ban withdrawn-user rejoin block wiring

---

## 11. First visit

### Implemented

Flow: legal signup → activity name → first visit guide → Central Plaza  
Existing users: no forced backfill

### Chrome verification deferred

- Real first visit
- Same-account refresh / relogin does not repeat guide

---

## 12. Official posts —COMPLETE

- Schema (`is_official` / `isOfficial`)
- ADMIN/OWNER create / update / end / delete path
- Official author = real admin
- No normal XP / achievement reward for operator official posts
- Members cannot forge official

### Deferred verification

- Production badge real Chrome verification (no evidence of COMPLETE → keep deferred)

---

## 13. Product-wide deferred backlog

### Community / product expansion

- Faction battle LIVE data
- Follow / Aura
- Chat DB persistence
- Payments
- Real season system
- Expanded Alien internal community
- Full USER_EVENT pipeline
- Territory evolution snapshot persistence
- Advanced bot / multi-account / cluster / shadow dampening
- Multi-instance Alien DB atomic lock
- Advanced analytics

### Achievements

- steady-footsteps
- empathy-from-many
- dialogue-across-territories
- witness-of-an-era
- beta-citizen

### Progression

- LIKE/DISLIKE XP/Fame
- Login XP
- Activity-name XP
- Territory-move XP
- Delete XP clawback
- Fame rank auto-calculation
- XP failure retry / reprocessing robustness

### Admin

- Sanction+audit atomicity
- Report-rejection+audit atomicity
- SANCTION_RELEASED
- ACTION_CANCELLED
- Member report history UI
- Report result notification retry / recovery

### Rights / legal

- rights_email_verify
- SMTP
- Nonmember email verification after 2026-09-17 review
- Withdrawal-after-rights PII handling
- Permanent-ban rejoin blocking

### Alien

- operator_hold
- Mistaken-action rollback / cancel
- Season linkage
- Multi-instance lock
- Expansion of Alien community

### Daily Issue

- Next real published issue sanction-block Chrome verification (feature itself is ON)

---

## 14. Chrome verification backlog

### Dev verification note (2026-10-25)

§17 records PASS on sentencearena-dev for the listed member, admin, and legal_hold checks. That dev evidence does not mark the Production Chrome items below COMPLETE, and it does not add PRODUCTION COMPLETE. Those remaining Production Chrome items are not open-beta code blockers. The remaining open-beta blocker is Launch Finalization (§17).

Keep deferred unless clear completion evidence exists:

- First visit guide
- Relogin no-repeat
- Logged-in rights submission
- Nonmember rights guidance
- Official post Production badge
- Real ADMIN admin pages
- Real MEMBER admin block
- Other-member Level on real content
- Next real Daily Issue sanction blocking
- OWNER real legal_hold action Chrome verification (HOLD_SET → HOLD_RELEASE on real preservation targets; no fake Production data)

Do not mark COMPLETE without evidence. Do not duplicate items already proven COMPLETE after NAVER Cloud migration.
Do not resurrect legal_hold / audit purge Production migration as PENDING.

---

## 15. Open beta — remaining before launch

### Current as of 2026-10-25

No open-beta code blocker remains except Launch Finalization. Launch Finalization and the pre-launch Production checklist are in §17. They are not completed work.

The 2026-10-22 candidate list below is kept as history. It is not the current code-blocker list.

### 2026-10-22 candidate list (historical)

NAVER Cloud migration is **not** listed here (already COMPLETE).
The 2026-10-14 app server stop is operational state. It is not a migration TODO and not a product feature.

Remaining candidates at that date:

- Legal documents finalization
- Privacy policy
- Terms
- Community / moderation / report policy
- Rights guidance
- Withdrawal / support / footer information
- Operator / business legal information insertion
- FAQ
- World / territory guide
- Known Issues
- Feedback / bug channel
- Opening announcement
- Initial official / community content
- Initial Daily Issue
- Final Chrome regression
- Operation checklist

---

## 16. Decisions pending (discussion first)

Separate from implementation backlog. **Resolved 2026-09-06 (DEC-019 policy ON; `/ready` true on that date):** political scheduler ON, Alien V1 ON, Daily Issue morning ON, Daily Issue auto-publish ON. That live check is not the process state after the 2026-10-14 app server stop.

**Resolved 2026-09-06 (policy):** admin moderation audit retention = 1 year (DEC-020).  
**Resolved 2026-09-06 (policy + code + Production rollout verified that day):** legal_hold = DEC-021 ACTIVE; DEC-D06 RESOLVED; Production migration + NAVER runtime COMPLETE as of that verification; controlled audit purge PRODUCTION COMPLETE. Not re-verified live on 2026-10-22.

Next policy discussion priorities:

- Member report history UI need / timing
- Faction battle LIVE calculation rules
- Future season rules

Do not resurrect legal_hold as an open policy decision or Production PENDING item.

---

## 17. Open beta dev verification (2026-10-25)

Docs-only record. No product code, DB, Supabase, or NAVER change in this edit. DEC-019, DEC-020, and DEC-021 are unchanged. This is not a Production verification and not a new PRODUCTION COMPLETE.

### Environment

- Dev Supabase project: `sentencearena-dev`
- Dev project ref: `wzpreuseuiuzwpoqqckr`
- Fully separate from Production
- Real member, admin, and OWNER role checks passed
- No secrets, keys, or database URLs are recorded here
- This edit did not probe Production or the NAVER host. The 2026-10-14 app server stop record stands. Policy ON and process running stay separate.

### Member flows — PASS on sentencearena-dev

- login
- CENTRAL initial state
- profile
- post
- comment and reply
- like
- dislike
- empathy
- cancel
- report
- report-result inbox
- rights intake
- Daily Issue
- sensitive-consent withdrawal
- legal gate
- ordinary withdrawal
- withdrawal of an account that has sanction/audit history

### Admin flows — PASS on sentencearena-dev

- admin login
- member blocked from admin API
- official post
- list and read
- hide and restore
- report review
- WARNING sanction
- audit
- Daily Issue approve and publish
- expired issue approve blocked

### legal_hold — PASS on sentencearena-dev

- ADMIN set/release: 403, and that 403 is correct
- OWNER set/release: 200
- audit events preserved
- DEC-021 unchanged
- Production live-data OWNER HOLD_SET → HOLD_RELEASE remains not done (§9). Not an open-beta code blocker.

### Not an open-beta blocker

- `GET /api/users/me/notifications` stays `USER_DATA_API_NOT_ACTIVATED`
- Report-result notices use the moderation inbox

### Migrations verified on sentencearena-dev only

Not applied to Production:

- `supabase/migration_service_role_route_min_grants_v1.sql`
- `supabase/migration_audit_withdrawal_set_null_v1.sql`

Until `supabase/migration_audit_withdrawal_set_null_v1.sql` is applied to Production, withdrawal of a user who has sanction/audit history can still fail on the existing Production trigger.

### Conclusion

No open-beta code blocker remains except Launch Finalization.

### Launch Finalization — not done

Internal prep document: `docs/legal/LAUNCH_FINALIZATION.md`. It is not a public privacy schedule and not completed launch work. Legal drafts were compared to this baseline and corrected only where they contradicted current product behavior. They are not published and not linked from public pages.

Still unset, labeled exactly `Launch Finalization에서 확정`:

- operator/business name
- representative
- address
- support email
- privacy officer
- effective date

Also still not confirmed here:

- final Supabase project/region
- public Terms / Privacy / Community Policy links
- a confirmed public rights-retention year for formal rights cases
- a court name (public drafts do not name one)

Code-derived Google / Kakao / Naver scope and storage notes are in that prep document only. Google requested scopes and Naver console scopes are not in this repository. That inventory does not confirm a public privacy schedule.

### Pre-launch Production checklist — not completed work

Unchecked. This record does not apply migrations, change Production data, start NAVER, or publish legal pages.

Dev-verified only, on sentencearena-dev ref `wzpreuseuiuzwpoqqckr`, not applied to Production:

- `supabase/migration_service_role_route_min_grants_v1.sql`
- `supabase/migration_audit_withdrawal_set_null_v1.sql`

Until `supabase/migration_audit_withdrawal_set_null_v1.sql` is applied to Production, withdrawal of a user who has sanction/audit history can still fail on the existing Production trigger.

Unchecked items:

- Production DB backup/status check
- migration order (the two SQL files do not reference each other; order is not chosen)
- Production env check
- legal gate
- OAuth settings
- minimum smoke test
- start NAVER server only if needed
- connect public legal pages
- final open-beta GO/NO-GO

---

## Cross-check notes (2026-09-06)

- NAVER Cloud migration: COMPLETE only — not also TODO
- DEC-021 legal_hold + admin audit purge Production rollout: COMPLETE (migration + runtime); OWNER Chrome HOLD action remains backlog only
- New-user territory selection: not ACTIVE (superseded)
- Alien: behavior moderation, not political exile
- Admin hide: `HIDDEN_BY_OPERATOR`, not `DELETED`
- Report result notification / comment moderation / report→audit / REPORT_REJECTED: COMPLETE, not TODO
- rights_email_verify: deferred, not COMPLETE

## Cross-check notes (2026-10-22)

- Branch `master`. Baseline HEAD `d62bab5507309d5f23d51e6371248df3e9b32904`.
- COMPLETE and DEFERRED lists above were checked against ACTIVE DEC-001–DEC-021 and CHANGELOG. No COMPLETE item was reclassified. No new PRODUCTION COMPLETE was added.
- App server process stopped 2026-10-14. DEC-019 flags stay policy ON. Policy ON and process running stay separate.
- Wording restored from git `b64ab3f` only where later commits lost characters: Railway arrow, evolution stage 1–6, Fame remove −1, signup flow arrows, report→audit, and the Railway historical note.
- Not copied from HISTORY into current canon: Alien stay lengths, retention periods other than DEC-020/DEC-021, server IP, instance size, billing.

## Cross-check notes (2026-10-25)

- Docs only, on `master`, code baseline `b66ae96d2b840a63eb5e387965a10de2d171053b`.
- sentencearena-dev (`wzpreuseuiuzwpoqqckr`) member, admin, and OWNER checks in §17 passed. Production was not modified and was not re-verified.
- `migration_service_role_route_min_grants_v1.sql` and `migration_audit_withdrawal_set_null_v1.sql` are dev-verified only. Until the withdrawal migration is applied to Production, withdrawal of a user who has sanction/audit history can still fail on the existing Production trigger.
- Open-beta code blocker remaining: Launch Finalization only. Pre-launch Production checklist is not completed work.
- DEC-021 not edited. ADMIN legal_hold set/release stays forbidden. 2026-09-06 legal_hold Production COMPLETE is unchanged.

## Cross-check notes (2026-10-25 launch finalization prep)

- Docs only. Baseline before this docs commit: `11cbab05d280b673b3bd0c78379e114bda13d417`. No product code, Production DB, Production Supabase, or NAVER change. No server start. No public legal page.
- Legal drafts in `docs/legal/` were corrected only for contradictions with current product behavior. Business name, representative, address, support email, privacy officer, and effective date stay unset and labeled `Launch Finalization에서 확정`.
- Public drafts do not name a court, do not confirm a formal rights retention period, and do not treat non-member rights intake as an open-beta prerequisite. Open beta rights intake stays member-only.
- OAuth code inventory and the unchecked Production checklist are in `docs/legal/LAUNCH_FINALIZATION.md`. That inventory is not a confirmed public privacy schedule.
- `migration_service_role_route_min_grants_v1.sql` and `migration_audit_withdrawal_set_null_v1.sql` stay dev-verified only. Until the withdrawal migration is applied to Production, withdrawal of a user who has sanction/audit history can still fail on the existing Production trigger.
- DEC-019, DEC-020, and DEC-021 were not edited. Older COMPLETE history in this file was not deleted.
