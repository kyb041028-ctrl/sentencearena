# Official DEV Auth verification — 2026-11-05

Target: `sentencearena-dev` (`wzpreuseuiuzwpoqqckr`) only.
Base: `fd5f6fba99d04a983ccac1de9a94272e622cebb6`.

## Results

- Existing Chrome dashboard session worked. Project URL and Publishable key obtained from that project's dashboard. No service-role key used.
- Created a disposable member test account without modifying existing accounts/passwords. Normal password sign-in issued an authenticated DEV JWT. `/auth/v1/user` verified it server-side.
- Running local application accepted that JWT: comment request against a deliberately nonexistent issue returned `404 ITEM_NOT_FOUND`, rather than authentication rejection. This probe created no data.
- Running application's public Daily Issue list contained zero issues. Therefore successful writes were tested through the actual Daily Issue HTTP routes in an isolated fixture harness, with the real `requireAuthenticatedUser` and live DEV `getUser` on every authenticated request.
- Passed guest/invalid-token rejection, comment create (201), readback, owner delete, LIKE activation/cancellation and detail viewer-state verification.
- Fixture repository/comments/reactions were in memory; fixture admin setup uses the existing test-only guard. The DEV account was never granted admin. Development legal/moderation defaults apply. This is **not** a deployed database, legal-consent, XP-persistence or browser OAuth end-to-end verification.
- Existing tests: Auth configuration 6/6, comments 34/34, Daily Issue alignment/reaction 66/66, political reaction input 25/25. Live smoke passed. An initially mistyped reaction test filename did not exist; reran the correct alignment-seed suite successfully.

## Cleanup and security

- Deleted only the newly created DEV Auth account; dashboard confirmed the original three account rows remain.
- Own fixture comment deleted, reaction cancelled, login session signed out. In-memory fixture discarded at process exit. No remote Daily Issue writes.
- Connection information retained outside the repository using Windows user-scoped DPAPI. Saved test password and JWT were removed after cleanup.
- Existing `.env`, production resources, existing data and master branch were not changed.
- Runtime authentication code required no change: existing Publishable-key support and `getUser` verification worked. This commit adds a repeatable verification tool and this report only.

## Re-run

Create an explicitly disposable `dev-auth-check-…@sentencearena.test` member in the same DEV project. Pipe JSON containing `url`, `publishableKey`, `testEmail`, `testPassword` to `node tools/verify-official-dev-auth.js` from a secure external store. Do not place credentials in arguments, repository files or `.env`. The tool rejects other projects, non-Publishable keys and production mode; it does not delete Auth accounts automatically. Remove the disposable Auth account after the run.

Known limitation: browser screenshot capture timed out, so no screenshot evidence is included. Supabase cleanup was verified using the visible user table. Full browser OAuth login and writes against a deployed DEV Daily Issue database remain unverified.

