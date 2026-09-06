# SentenceArena Current State

Last updated: 2026-09-06
Repository HEAD: `4f2d67e` (docs SSOT; tip of master at last STATE write)
Prior feature HEAD: `ef557ff` (report UX + reporter notification)
Status source: repository + Production `/ready` (2026-09-06) + latest confirmed project state

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

Production `/ready` observed 2026-09-06 (facts only):

- `nodeEnv`: production
- `publicOrigin`: `https://sentencearena.com` (canonical)
- `supabaseConfigured`: true
- `database.ready`: true
- `boardOperational`: true
- `boardRepository`: supabase
- `territoryEvolutionOperational`: true
- `alienModerationV1`: **false**
- `politicalSchedulerEnabled`: **true**
- `dailyIssueMorningSchedulerEnabled`: **false**
- `dailyIssueRepository`: db
- `dailyIssueSchema`: daily_issue

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

### Runtime / deferred

- Morning automation: **OFF** (`dailyIssueMorningSchedulerEnabled: false`)
- Auto publish: deferred / not enabled as automatic production policy
- Next real published issue — sanction-block Chrome verification: DEFERRED

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

- `politicalSchedulerEnabled`: **true** (Production `/ready` 2026-09-06)

Do not assume old Railway env equals current host config without checking `/ready`.

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

- `alienModerationV1`: **false** (Production OFF)

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

- Audit automatic purge after retention period (`ADMIN_AUDIT_RETENTION_POLICY_PENDING`)
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

- Audit retention purge
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

- Morning automation policy decision (runtime currently OFF)
- Auto publish policy decision
- Real published issue sanction-block verification

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

Separate from implementation backlog:

- Current political scheduler policy (runtime is ON; confirm keep/change)
- Alien Production ON/OFF timing (runtime is OFF)
- Daily Issue morning collection ON/OFF
- Daily Issue auto-publish policy
- Moderation audit retention period final policy
- legal_hold policy details
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
