# Twelve-achievement branch implementation

This is a code candidate on `cursor/map-layout-cards-bc3c`, not a Production activation.
The original eleven definitions/IDs/KR display copy remain. Only `bug-busters` is new.
US copy is display-only and shares the catalog in `public/achievement-definitions.js`.

## Owner acceptance

In `/admin/inquiries/`, an authenticated OWNER can open a BUG inquiry, enter its stable
canonical bug key and reproduction/log verification evidence, and select
“실제 버그로 수락하고 업적 지급”. ADMIN/member/guest users cannot use this action.

The action calls `POST /api/admin/inquiries/:id/accept-verified-bug` with
`{verified:true, bugKey, evidence}`. The server derives reporter, country and owner
from the stored inquiry and verified JWT. A body userId/country/role is ignored.
Keys use 3–120 lowercase ASCII letters/digits/dots/underscores/colons/hyphens and
must identify the same actual bug consistently across repeat reports. Evidence is
10–2000 characters. Mere submission or changing inquiry status to DONE never grants.

`achievement_verified_bugs` preserves inquiry, canonical bug key, reporter, country,
accepting owner, evidence and DB acceptance timestamp. Unique bug/inquiry/reporter
constraints and a per-account transaction lock prevent duplicate grants. Receipt and
grant commit together; failures roll both back. Retrying is safe. Existing account
awards are permanent and do not reset with seasons.

Old inquiries have no confirmed country. Their new country field remains NULL and
acceptance returns `INQUIRY_REGION_UNCONFIRMED` until the actual country is reviewed
and set through a separately approved data correction. Never infer KR for these rows.
The new intake writes its server-resolved activity country without changing intake gates.

## Beta eligibility and dates still to confirm

Successful normal board posts/comments and Daily Issue comments call the dedicated
server-only grant path after content validation and persistence. Existing legal,
sanction, Alien and country checks stay in place. Rejected writes never qualify.
No login/signup/view/reaction or client count/date can qualify. There is no level
threshold. A grant returns in the successful write response for immediate display;
unseen grants also hydrate later through the existing one-time notification flow.

No beta start/end dates have been supplied or seeded. `achievement_beta_windows`
must contain independently confirmed KR/US start/end instants, stored as
`timestamptz` with explicit UTC offsets. The accepted interval is **[start, end)**.
Missing configuration, a future start or an ended window grants nothing. Do not
invent an open-ended end date or use a feature flag as a substitute for a date decision.
The user's follow-up confirmed immediate grant on satisfying the existing condition;
it did not supply dates or authorize login-based eligibility.

Only newly persisted qualifying actions are wired. No historical beta backfill was
run or silently enabled. Retrospective eligibility needs confirmed windows and a
separately reviewed canonical-history process. No other deferred condition is activated.

## Candidate migrations (not applied to any external database)

1. Inquiry database: `supabase/migration_inquiry_achievement_region_candidate.sql`.
   Adds nullable country with KR/US validation; existing unknown countries stay NULL.
2. Achievement database: `supabase/migration_special_achievements_candidate.sql`.
   Requires existing canonical grant RPC and activity-region v2 tables. Adds window
   configuration, immutable acceptance receipts, private service-role grant functions,
   US notification sequence/state and featured slots. Existing US acquisition times
   remain unchanged; historical rows are marked already notified only when the new
   column is first added. Retrying migration never suppresses newer unseen grants.
3. Confirm and configure actual KR/US beta windows before expecting beta grants.
4. Verify the inquiry and achievement database destinations independently. US uses
   the existing local regional query connection, or the explicitly enabled
   `ACTIVITY_REGION_SUPABASE_SCHEMA=1` client. An unavailable US store fails closed;
   there is no fallback to KR tables. Production uses the shared achievement database
   for the global bug receipt uniqueness constraint; physically separate independent
   achievement databases cannot enforce one global cross-database account constraint.

Applying migrations, configuring live windows and deploying remain separate actions.
No existing production migration runner was changed to auto-apply these candidates.

## Verification

- `npm run test:special-achievements`: 62 checks for original KR copy, all twelve US
  definitions, deferred-condition guards, OWNER/member/ADMIN JWT authorization,
  trusted reporter/country binding, rejected writes and real board/Daily Issue hooks.
- `npm run test:special-achievement-db -- <absolute path to @electric-sql/pglite>`:
  47 checks executing candidate SQL and the existing canonical RPC in an isolated
  embedded PostgreSQL. Includes missing/future/expired windows, each participation
  action, retry/deduplication, rollback, RLS/function permissions, legacy alert-state
  preservation, US ledger isolation, real US score hooks, featuring and notifications.
  Install that optional test-only module outside the repo; no runtime dependency
  or production DB connection is required. This is not a multi-connection live DB test.
- Existing persistence (50), notification (36), restore (48), ops wiring (18),
  backfill (24), board core (58), admin hub (40), region isolation, Supabase mock
  and US profile frame checks passed. Count assertions were updated from 11 to 12.
- `test-featured-achievement-modal-ui.js`: its own feature checks pass; its nested
  `test-user-content-system.js` fails four pre-existing CSS/accessibility assertions.
- `test-daily-issue-comments.js`: fails before comment creation during fixture
  publish with `HALT_STATE_READ_FAILED`. Both this failure and the four user-content
  failures reproduce on the untouched starting commit `9fcf0eb` in a separate checkout.
  They were not changed in this task. The new focused test bypasses the unrelated
  publish fixture by seeding a published issue and executes the real comment route.

No Production browser/Auth/DB end-to-end or external migration was run.
