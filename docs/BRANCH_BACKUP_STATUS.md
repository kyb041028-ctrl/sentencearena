# Branch backup status

Branch: `cursor/map-layout-cards-bc3c`  
Remote: `kyb041028-ctrl/sentencearena`  
This note is a backup label for this development branch. It does not change `docs/SENTENCEARENA_STATE.md` and it does not mark production complete.

## Checked on this branch

- KR and US profile rows stay on `user_activity_region_profile`. A missing US row is `PROFILE_MISSING` and is not filled from Korea.
- Rank formula weights are unchanged. Local tests for the formula, the 3-month term comparison, and the election preview passed.
- Leader election, impeachment storage, daily local-midnight refresh, and leader agenda were exercised on the isolated database `rank_election_session_48872` at `127.0.0.1`. That database is not production.
- US Daily Issue mock evaluation runs without a live model call. Real AI is not connected.
- Achievement story videos and invite mini icons are in the asset paths the page already requests. The largest video in this commit is under 10 MB. Git LFS is not configured.

## Not verified

- Real Supabase Auth.
- A full browser regression.
- US Daily Issue with a real AI model.
- Automatic publish of real news.
- Season length.
- The hour and minute of the Monday leader agenda.

Production Supabase, NAVER Cloud, and production deploy were not changed.
