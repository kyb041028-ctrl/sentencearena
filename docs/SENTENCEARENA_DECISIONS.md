# SentenceArena Design Decisions

Last updated: 2026-09-06
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
Related implementation: alien-moderation-service; report/sanction ladders; Production flag `alienModerationV1` (currently OFF per STATE).

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

---

## DEFERRED decisions (policy not finalized)

These are not SUPERSEDED; they await an explicit product/ops choice (see STATE §16).

| ID | Topic | Notes |
| --- | --- | --- |
| DEC-D01 | Political scheduler keep-ON policy | Runtime currently ON |
| DEC-D02 | Alien Production ON timing | Runtime currently OFF |
| DEC-D03 | Daily Issue morning collection ON/OFF | Runtime currently OFF |
| DEC-D04 | Daily Issue auto-publish policy | Manual approve path exists |
| DEC-D05 | Audit retention period | `ADMIN_AUDIT_RETENTION_POLICY_PENDING` |
| DEC-D06 | legal_hold details | Not fully wired |
| DEC-D07 | Member report history UI | `MEMBER_REPORT_HISTORY_UI_PENDING` |
| DEC-D08 | Faction battle LIVE rules | Product expansion |
| DEC-D09 | Real season rules | Needed before season-linked Alien return |

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
Note: Do not treat as an active unresolved product blocker; Alien V1 is a feature flag (currently OFF).

### SUP-017 — “4th Alien automatically SEASON_END” before real season exists

Status: SUPERSEDED  
Note: Season-linked automatic end is invalid until a real season system is decided (DEC-D09).

---

## How to update this file

1. New product rule → add `DEC-xxx` with Status ACTIVE (or DEFERRED if undecided).
2. Replacing an old rule → set old entry SUPERSEDED and point to the new DEC.
3. Never leave conflicting ACTIVE rules for the same topic.
4. After each coding task, if behavior changed policy, update here in the same change set as STATE when possible.
