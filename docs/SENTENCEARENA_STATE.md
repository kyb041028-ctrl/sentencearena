# SentenceArena Current State

Last updated: 2026-09-06
Repository HEAD: `8945042`
Prior feature HEAD: `ef557ff` (report UX + reporter notification)
Status source: repository + owner-confirmed Production `/ready` (2026-09-06) + DEC-019 + DEC-020

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

### Open Beta ops flags — PRODUCTION COMPLETE (2026-09-06)

| Check | Value |
| --- | --- |
| `politicalSchedulerEnabled` | **true** |
| `alienModerationV1` | **true** |
| `dailyIssueMorningSchedulerEnabled` | **true** |
| `dailyIssueMorningAutoPublishEnabled` | **true** |
| `sentencearena.service` | **active** |
| `/health` | **OK** (200 / ok:true) |
| `database.ready` | **true** |

Production host (no secrets):

- Env source: `/etc/sentencearena.env`
- Shadow env: `/etc/sentencearena-shadow.env`
- systemd unit: `sentencearena.service`
- Origin: `https://sentencearena.com`

These four ops flags are **PRODUCTION COMPLETE**. Do not resurrect as PARTIAL, apply pending, confirm live, decide later, or deferred.

Policy reference: DEC-019 (ACTIVE).

Other observed `/ready` facts:

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
| Political scheduler | `POLITICAL_ALIGNMENT_SCHEDULER_ENABLED` | ON / COMPLETE |
| Alien V1 | `ALIEN_MODERATION_V1` | ON / COMPLETE |
| Daily Issue morning collect | `DAILY_ISSUE_MORNING_SCHEDULER_ENABLED` | ON / COMPLETE |
| Daily Issue auto publish | `DAILY_ISSUE_MORNING_AUTO_PUBLISH` | ON / COMPLETE |

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

## 2. Auth / members — COMPLETE

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

---

## 3. Board / community — COMPLETE

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

### Connected achievements (6) — COMPLETE

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

- Morning automation: **PRODUCTION ON** (`dailyIssueMorningSchedulerEnabled: true`)
- Auto publish: **PRODUCTION ON** (`dailyIssueMorningAutoPublishEnabled: true`) — AUTO_PUBLISH_ELIGIBLE only
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

- `politicalSchedulerEnabled`: **true** — PRODUCTION COMPLETE (DEC-019)

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

- `alienModerationV1`: **true** — PRODUCTION COMPLETE (DEC-019)

### Deferred

- operator_hold
- Mistaken-action / cancel flow
- Season-linked return
- Multi-instance DB atomic lock
- Expanded Alien internal community

---

## 9. Reports / sanctions / admin — COMPLETE

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
- Audit automatic purge implementation: **DEFERRED** until legal_hold rule finalized (DEC-D06)
- Operators must not get a manual delete UI; purge will be a controlled system path only
- legal_hold exception/release timing: **not decided** — do not invent

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

- `276dc34` — admin home / post moderation
- `747e9e0` — moderation audit
- `eedb4a1` — comment / reply moderation
- `985b941` — report → audit linkage
- `6c9da82` — report rejection + hide-state unify
- `ef557ff` — report UX + reporter notification (current HEAD)

### Admin deferred (do not mix with COMPLETE above)

- Audit automatic purge implementation (retention period itself is decided: 1 year / DEC-020; wait for legal_hold DEC-D06)
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
- legal_hold operator toggle
- Withdrawal-after-rights PII handling
- Sanction legal_hold persistence
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

## 12. Official posts — COMPLETE

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

- Audit automatic purge implementation (policy = 1 year COMPLETE; wait for legal_hold)
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
- legal_hold operator toggle
- Withdrawal-after-rights PII handling
- Sanction legal_hold persistence
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

Do not mark COMPLETE without evidence. Do not duplicate items already proven COMPLETE after NAVER Cloud migration.

---

## 15. Open beta — remaining before launch

NAVER Cloud migration is **not** listed here (already COMPLETE).

Remaining candidates:

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

Separate from implementation backlog. **Resolved and Production-live 2026-09-06:** political scheduler ON, Alien V1 ON, Daily Issue morning ON, Daily Issue auto-publish ON (DEC-019 + `/ready` true).

**Resolved 2026-09-06 (policy):** admin moderation audit retention = 1 year (DEC-020). Auto purge implementation still deferred pending legal_hold.

Next policy decision (priority 1):

- legal_hold policy details (DEC-D06)

Still pending discussion:

- Member report history UI need / timing
- Faction battle LIVE calculation rules
- Future season rules

---

## Cross-check notes (2026-09-06)

- NAVER Cloud migration: COMPLETE only — not also TODO
- New-user territory selection: not ACTIVE (superseded)
- Alien: behavior moderation, not political exile
- Admin hide: `HIDDEN_BY_OPERATOR`, not `DELETED`
- Report result notification / comment moderation / report→audit / REPORT_REJECTED: COMPLETE, not TODO
- rights_email_verify: deferred, not COMPLETE
