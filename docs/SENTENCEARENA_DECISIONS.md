# SentenceArena Design Decisions

Last updated: 2026-09-06 (DEC-021 legal_hold + audit purge policy)
Companion: `docs/SENTENCEARENA_STATE.md` (current factual state)

Older handoff/checklist documents are historical references.
They must not override ACTIVE decisions in this file.

## Information priority (design)

1. ACTIVE decisions in this file
2. Latest user-confirmed decisions
3. Actual implementation
4. Older designs / proposals

If an old design conflicts with an ACTIVE decision, treat the old design as discarded (see SUPERSEDED section).
Do not silently change ACTIVE decisions — edit this file explicitly when policy changes.

---

## ACTIVE decisions

### DEC-001 — Canonical identity

Status: ACTIVE  
Decision: Internal identity is `auth.users.id` (UUID).  
Reason: One stable key for profiles, progression, board, sanctions, and audits.  
Do not resurrect: Alternate ID schemes keyed only on email or provider-local IDs.  
Related implementation: profiles / auth bootstrap / board author_user_id.

### DEC-002 — New member territory and score

Status: ACTIVE  
Decision: All new members start CENTRAL with political score 0. No territory selection at signup.  
Reason: Territory is earned/moved by system rules; signup must not pick political camps.  
Do not resurrect: “New user manually chooses Pioneer / Guardian / Central.”  
Related implementation: canonical territory central-start; onboarding without territory picker.

### DEC-003 — Activity name onboarding

Status: ACTIVE  
Decision: Members complete activity-name onboarding before full participation identity is shown.  
Reason: Public display name is product identity, separate from OAuth profile defaults.  
Do not resurrect: Skipping activity-name as optional forever for new accounts.  
Related implementation: activity-name onboarding APIs / UI.

### DEC-004 — Age gate

Status: ACTIVE  
Decision: Age 14+ gate before account completion.  
Reason: Legal / community floor for participation.  
Do not resurrect: Age-unchecked open signup.  
Related implementation: legal gate flows.

### DEC-005 — Political alignment ≠ moderation

Status: ACTIVE  
Decision: Political orientation is separate from moderation. Political opinion itself cannot be a sanction reason. Alignment changes from user behavior / opinion signals; Daily Issue direct choice can seed alignment.  
Reason: Project philosophy — regulate harmful behavior, not political direction.  
Do not resurrect: Political alignment based exile; left/right Alien split; KANTAPBIYA_LEFT/RIGHT; signal-zone political model; territory self-selection as political identity.  
Related implementation: political alignment services/schedulers; board/report moderation paths.

### DEC-006 — Sensitive political consent

Status: ACTIVE  
Decision: Sensitive political consent is separate and default OFF. Withdrawal of that consent removes alignment state/history but does not delete the account.  
Reason: Privacy minimization and explicit opt-in.  
Do not resurrect: Bundling political processing into mandatory signup without separate consent.  
Related implementation: consent columns / withdrawal of political processing.

### DEC-007 — Alien is behavior moderation

Status: ACTIVE  
Decision: Alien is behavior moderation observation / isolation. Reports alone are not enough. Intentional misconduct aimed at Alien entry must not be rewarded. Operator and behavior signals matter.  
Reason: Prevent farming and political misuse of exile mechanics.  
Do not resurrect: Alien as political exile; automatic Alien from alignment alone.  
Related implementation: alien-moderation-service; report/sanction ladders; Production flag `alienModerationV1` (open-beta policy ON — DEC-019).

### DEC-008 — Territory keys and Central population

Status: ACTIVE  
Decision: Territory keys are fixed: pioneer, central, guardian, alien. Central evolution population = pioneer + central + guardian. Alien is excluded. Evolution stage may decrease when population decreases.  
Reason: Shared Earth population drives Central stage; Alien is outside Earth count.  
Do not resurrect: Old reform/order naming as canonical keys; planetPct Alien model for Earth population.  
Related implementation: `shared/territory-evolution-core.js`.

### DEC-009 — Guest read-only

Status: ACTIVE  
Decision: Guests may browse; write actions (post/comment/react/report/follow/chat send, etc.) are blocked.  
Reason: Reduce abuse and keep member canonical paths clean.  
Do not resurrect: Guest write with local mock progression.  
Related implementation: guest read-only UI/server guards.

### DEC-010 — EMPATHY vs LIKE/DISLIKE

Status: ACTIVE  
Decision: EMPATHY is separate from LIKE/DISLIKE.  
Reason: Distinct social signal and Fame rules.  
Do not resurrect: Collapsing empathy into like counts.  
Related implementation: empathy events / Fame ±1.

### DEC-011 — Faction battle separation

Status: ACTIVE  
Decision: Faction battle is separate from political alignment, territory population, moderation, and Daily Issue.  
Reason: Avoid cross-system coupling and accidental “politics = battle score.”  
Do not resurrect: Using alignment score as battle LIVE source of truth without an explicit new decision.  
Related implementation: faction battle UI/helpers (LIVE data still deferred).

### DEC-012 — Progression canon

Status: ACTIVE  
Decision: Canonical progression = `user_progression`. Level official max core 10. Fame = `reputation_score`. Guests must not show fake member progression.  
Reason: One server source for Level/XP/Fame.  
Do not resurrect: Client-only progression as truth; guest mock Level/Fame display.  
Related implementation: user-progression-service; guest progression removal.

### DEC-013 — Admin discovery vs action

Status: ACTIVE  
Decision: General site = discovery/view. Admin pages = official operator action. Operator content action uses soft hide, never hard delete. Member own deletion = `DELETED`. Operator hide = `HIDDEN_BY_OPERATOR`. Hide/delete and sanction are independent actions.  
Reason: Preserve auditability and separate content visibility from user sanctions.  
Do not resurrect: Hard delete as default operator tool; treating operator hide as member `DELETED`.  
Related implementation: `/admin/posts/`, `/admin/comments/`, board status fields.

### DEC-014 — Admin audit append-only

Status: ACTIVE  
Decision: Admin moderation audit is append-only. Corrections are new events; old audit rows are not edited.  
Reason: Forensic integrity for operator actions.  
Do not resurrect: Editable audit logs or silent overwrites.  
Related implementation: `admin_moderation_audit_events`.

### DEC-015 — Reports vs sanctions

Status: ACTIVE  
Decision: Report count ≠ violation count. Reports do not automatically equal sanctions. Report-based actions link `report_id` to audit. Rejected reports are also auditable (`REPORT_REJECTED`).  
Reason: Operators judge behavior; spam/report farming must not inflate guilt.  
Do not resurrect: Auto-sanction solely from report volume.  
Related implementation: board report review; audit linkage commits through `ef557ff`.

### DEC-016 — Reporter public result only

Status: ACTIVE  
Decision: Reporter receives only a public processing result. No sanction type/duration, Alien move, admin identity, other reporters, or internal notes.  
Reason: Privacy and anti-harassment; discourage retaliation targeting.  
Do not resurrect: Notifying reporters of the other party’s exact sanction.  
Related implementation: `shared/report-result-notification-core.js`; moderation inbox.

### DEC-017 — Official posts

Status: ACTIVE  
Decision: Official posts only ADMIN/OWNER. No normal member progression reward for operator official posts. Members cannot forge official.  
Reason: Trust signal without farming XP/achievements.  
Do not resurrect: Title-string `[공식]` as the sole official authority.  
Related implementation: `board_posts.is_official` / admin official routes.

### DEC-018 — Daily Issue public surface

Status: ACTIVE  
Decision: Published Daily Issue is a separate public content flow. Public APIs must not expose hidden alignment direction.  
Reason: Prevent leaking private political scoring into public issue UX.  
Do not resurrect: Public endpoints returning raw alignment vectors for answers.  
Related implementation: daily-issue public APIs.

### DEC-019 — Open beta operational schedulers ON

Status: ACTIVE  
Decision: For open beta operations: political alignment scheduler ON; Alien Moderation V1 ON; Daily Issue morning collection ON; Daily Issue auto-publish ON (`DAILY_ISSUE_MORNING_AUTO_PUBLISH`).  
Reason: Owner decision 2026-09-06 — do not leave these as “turn on later.”  
Do not resurrect: treating these four as undecided / deferred product choices.  
Related implementation: `POLITICAL_ALIGNMENT_SCHEDULER_ENABLED`, `ALIEN_MODERATION_V1`, `DAILY_ISSUE_MORNING_SCHEDULER_ENABLED`, `DAILY_ISSUE_MORNING_AUTO_PUBLISH`; `/ready` checks.

### DEC-020 — Admin moderation audit retention

Status: ACTIVE  
Decision:
- `admin_moderation_audit_events` retention period is **1 year** from creation time
- Normal operations: UPDATE/DELETE forbidden; append-only remains
- After 1 year, rows become eligible for automatic purge only via a controlled system path
- ADMIN/OWNER must not get a manual audit-delete UI
- legal_hold applicability and post-release timing for purge: see DEC-021

Reason:
- Enough window for operator action tracing
- Avoid indefinite retention of operational/personal data
- Separate “no arbitrary edit/delete” from “time-bounded retention”

Do not resurrect: open-ended “retention undecided” / `ADMIN_AUDIT_RETENTION_POLICY_PENDING` as a product decision.  
Related implementation: `admin_moderation_audit_events` append-only RLS/triggers; controlled purge RPC `purge_expired_admin_moderation_audit_events` (DEC-021).

### DEC-021 — Legal hold

Status: ACTIVE  
Decision:

1. Purpose — use only when real preservation is needed:
   - litigation / legal dispute
   - investigation / law-enforcement request
   - rights-infringement dispute
   - formal legal preservation request
   - operator-judged formal case requiring evidence preservation  
   Do not use for ordinary ops convenience.

2. Allowed targets only:
   - deleted-content evidence
   - report records
   - sanction records
   - admin moderation audit
   - rights-infringement cases and related retained materials/attachments  
   Not targets: whole profiles, XP, Fame, political alignment, unrelated general activity data.

3. Authority:
   - set: OWNER only
   - release: OWNER only
   - ADMIN cannot set/release
   - reason required for both set and release
   - do not expose legal_hold existence to ordinary members

4. Effect:
   - legal_hold controls preservation only
   - does not auto-change post status, hide/restore, report judgment, sanction, Alien, or account status
   - legal_hold ≠ sanction / content hide / account restriction

5. Auto-delete:
   - while hold is active, retention auto-delete for that target is fully stopped

6. Release:
   - no automatic release; OWNER manual only
   - A) if original retention expiry is still in the future → keep original expiry
   - B) if original expiry already passed during hold → `released_at + 7 days` grace
   - do not re-extend full retention from scratch for the hold duration

7. Audit:
   - HOLD_SET / HOLD_RELEASE recorded in append-only `legal_hold_operator_events`
   - admin audit rows stay append-only; hold state lives in `admin_moderation_audit_legal_holds`

Reason: Owner decision 2026-09-06 — finalize DEC-D06 and unlock audit auto-purge under DEC-020.  
Do not resurrect: inventing extra retention targets/periods, ADMIN legal_hold toggle, or member-facing hold UI.  
Related implementation: `/api/admin/retention/legal-hold`, `/admin/retention/`, retention scheduler audit count, migration `migration_legal_hold_and_audit_purge_v1.sql`.

### DEC-022 — Evolution stage display names

Status: ACTIVE  
Decision: This entry is the only source for evolution stage display names. Do not copy the table into other docs or rules. Changing any name in this table, or adding another name for the same stage, requires the user's explicit approval. This decision does not change territory keys or stage math in DEC-008.

Earth territories share one name list. Keys: `pioneer`, `guardian`, `central`.

1. 원시 / Primitive
2. 고대 / Ancient
3. 중세 / Medieval
4. 근대 / Modern
5. 현대 / Contemporary
6. 미래 / Future

Alien (`alien`) uses its own list. Do not mix these names with the Earth list.

1. 문명탄생 / Exploration
2. 문명형성 / Outpost
3. 문명발전 / Settlement
4. 문명확장 / Expansion
5. 문명번영 / Prosperity
6. 문명포화 / Ascension

Rules:

- Korea (`/kr`) keeps the Korean column. The United States (`/us`) keeps the English column.
- Do not mix stage 1–6 names across territories.
- The card nameplate, the map tab, the detail panel, and the hover label show the same name for that territory and stage.
- New UI uses this same list.
- Do not put Present, First spark, Forming, Growing, Spreading, Thriving, or Full back on the United States UI.
- Display names are separate from stage calculation, thresholds, and population counts.
- Korea and United States data stay separate.

Reason: The card plaques and the on-screen stage words must stay one list, and that list must not change without an explicit user approval.  
Do not resurrect: United States labels Present, First spark, Forming, Growing, Spreading, Thriving, Full. Do not use `reform` / `order` as territory keys (DEC-008).  
Related implementation: `public/activity-region.js` US phrase table, commit `95f3d8511093a64d411e5d7cb12f424cc120482a`. Not a Production deploy.

### DEC-023 — Citizen rank, leader election, impeachment, representative agenda

Status: ACTIVE  
Decision: `docs/RANK_ELECTION_POLICY.md` is the only source for citizen rank, leader election, impeachment, and the representative agenda. Do not copy that document's tables here. The confirmed scope is the ranks, evaluation weights, first-time qualification counts, Wednesday refresh, valid population, pioneer/guardian leader election, impeachment thresholds, and the agenda split from Daily Issue, as written in that file. Anything that file marks 미확정 stays undecided. Do not invent numbers. This policy is not implemented in code. Do not treat it as shipped. It does not change DEC-008 territory keys, DEC-012 Fame/Level/XP accounting, or DEC-018 Daily Issue.  
Reason: Rank names and leader seats must have one approved list, separate from old local formulas.  
Do not resurrect: the previous 4-tier fame grade and 5 leaders per territory (SUP-018).  
Related implementation: none. Code still uses the old local formula or `CITIZEN_RANK_POLICY_NOT_FINALIZED`.

---

### DEC-023 — Achievement catalog and verified bug acceptance

Status: ACTIVE (product decision; branch implementation, not Production activation)
Decision: Preserve the original eleven achievements and add only 센스코 / Bug Busters, for twelve total. Keep Korean copy; localize US names/descriptions/alerts/profile display with identical IDs and policies. Grant connected achievements when the real qualifying action succeeds. A bug submission alone never qualifies: the OWNER must verify and accept a real BUG inquiry. Require evidence and a stable canonical bug key; exclude duplicate bugs and grant permanently once per account. Ordinary inquiry status changes, including DONE, are not acceptance.

Beta citizen retains its established first meaningful participation policy (post, board comment, Daily Issue comment), not login, signup, reactions, or level 5. No dates may be invented. Country-specific confirmed start/end instants are required before beta grants; use [start, end). Other deferred conditions stay deferred.

Reason: Explicit user instructions on 2026-11-08, including “유효한 버그를 제보해서 내가 수락했을때”.
Related implementation: `docs/ACHIEVEMENT_ROLLOUT.md`. No master merge or Production deployment is authorized by this entry.

---

## DEFERRED decisions (policy not finalized)

These are not SUPERSEDED; they await an explicit product/ops choice (see STATE §16).

| ID | Topic | Notes |
| --- | --- | --- |
| DEC-D01 | Political scheduler keep-ON policy | **RESOLVED** → DEC-019 (ACTIVE ON) |
| DEC-D02 | Alien Production ON timing | **RESOLVED** → DEC-019 (ACTIVE ON) |
| DEC-D03 | Daily Issue morning collection ON/OFF | **RESOLVED** → DEC-019 (ACTIVE ON) |
| DEC-D04 | Daily Issue auto-publish policy | **RESOLVED** → DEC-019 (ACTIVE ON) |
| DEC-D05 | Audit retention period | **RESOLVED** → DEC-020 (ACTIVE — 1 year) |
| DEC-D06 | legal_hold details | **RESOLVED** → DEC-021 (ACTIVE) |
| DEC-D07 | Member report history UI | `MEMBER_REPORT_HISTORY_UI_PENDING` |
| DEC-D08 | Faction battle LIVE rules | Product expansion |
| DEC-D09 | Real season rules | Needed before season-linked Alien return |

Resolved deferred rows stay listed only as historical pointers; they must not be treated as open decisions.
---

## SUPERSEDED designs (do not resurrect)

### SUP-001 — Signup territory selection

Status: SUPERSEDED  
Replaced by: DEC-002  
Note: New users do not pick Pioneer/Guardian/Central at signup.

### SUP-002 — Node 20 as current runtime target

Status: SUPERSEDED  
Note: Historical “Node 20 target” language is obsolete; do not treat Node 20 as the current required baseline without a new ACTIVE decision.

### SUP-003 — Naver login unimplemented

Status: SUPERSEDED  
Note: Naver login is implemented; do not re-open as a greenfield auth gap.

### SUP-010 — US Daily Issue live ingest sources

Status: OPEN (branch `cursor/map-layout-cards-bc3c` only)  
Note: `us-national` ingest uses verified US RSS entries in `config/daily-issue-source-registry.js`. Unverified URLs stay `enabled:false`. LIVE READY requires multi-source clustering; quality thresholds not reduced. Production US scheduler/publish not activated by this work alone.

### SUP-004 — Daily Issue schema missing

Status: SUPERSEDED  
Note: Daily Issue DB schema/repository path exists (`daily_issue`).

### SUP-005 — Territory evolution mock-only / images missing

Status: SUPERSEDED  
Note: Evolution stages, HUD, and images are implemented; snapshot history remains deferred.

### SUP-006 — Account withdrawal missing

Status: SUPERSEDED  
Note: Withdrawal exists.

### SUP-007 — Age gate missing

Status: SUPERSEDED  
Note: Age gate exists (DEC-004).

### SUP-008 — Achievements all dummy

Status: SUPERSEDED  
Note: Six core achievements are connected; five remain deferred — not “all dummy.”

### SUP-009 — Political alignment = moderation

Status: SUPERSEDED  
Replaced by: DEC-005

### SUP-010 — Political alignment → Alien exile

Status: SUPERSEDED  
Replaced by: DEC-005, DEC-007

### SUP-011 — Left/right Alien split

Status: SUPERSEDED  
Replaced by: DEC-007

### SUP-012 — Old reform/order territory naming as canon

Status: SUPERSEDED  
Replaced by: DEC-008 (`pioneer` / `central` / `guardian` / `alien`)

### SUP-013 — planetPct Alien model

Status: SUPERSEDED  
Note: Do not use planetPct Alien population models for current Earth evolution rules.

### SUP-014 — KANTAPBIYA_LEFT / KANTAPBIYA_RIGHT

Status: SUPERSEDED  
Replaced by: DEC-005, DEC-007

### SUP-015 — Signal-zone political model

Status: SUPERSEDED  
Replaced by: DEC-005

### SUP-016 — “Alien Stage 1 unresolved” as open blocker

Status: SUPERSEDED  
Note: Do not treat as an active unresolved product blocker. Alien V1 is not an open product decision; under ACTIVE DEC-019 it is ON for open-beta Production, matching STATE `alienModerationV1=true`. This corrects an outdated "currently OFF" description and does not change DEC-019.

### SUP-017 — “4th Alien automatically SEASON_END” before real season exists

Status: SUPERSEDED  
Note: Season-linked automatic end is invalid until a real season system is decided (DEC-D09).

### SUP-018 — 4-tier fame grade and 5 leaders

Status: SUPERSEDED  
Replaced by: DEC-023 (`docs/RANK_ELECTION_POLICY.md`)  
Note: The old local formula is a 4-tier fame grade (시민 / 논객 / 대표 / 지도자, no 원로) with `chiefsMaxCount = 5`. That formula is not current policy. The numbers stay written in `docs/PLAYER_LEVEL_PROGRESSION.md` section 3 and in local progression code. Do not delete those records. Do not implement or restore them as the live rank rules.

---

## How to update this file

1. New product rule → add `DEC-xxx` with Status ACTIVE (or DEFERRED if undecided).
2. Replacing an old rule → set old entry SUPERSEDED and point to the new DEC.
3. Never leave conflicting ACTIVE rules for the same topic.
4. After each coding task, if behavior changed policy, update here in the same change set as STATE when possible.
