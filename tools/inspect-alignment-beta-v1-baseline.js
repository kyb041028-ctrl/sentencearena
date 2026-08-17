#!/usr/bin/env node
'use strict';
require('dotenv').config();
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

async function main() {
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.log(JSON.stringify({ ok: false, error: exec.error }));
    process.exit(1);
  }
  const tables = await exec.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_alignment_state','alignment_batches','alignment_history','board_reactions','profiles','alignment_territory_history') ORDER BY 1"
  );
  const cols = await exec.query(
    "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='user_alignment_state' ORDER BY ordinal_position"
  );
  const rxcols = await exec.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='board_reactions' ORDER BY ordinal_position"
  );
  const stats = await exec.query(
    'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE score <> 0)::int AS nonzero_score, COUNT(*) FILTER (WHERE previous_signal <> 0)::int AS nonzero_prev, MIN(score) AS min_score, MAX(score) AS max_score, MIN(previous_signal) AS min_prev, MAX(previous_signal) AS max_prev FROM public.user_alignment_state'
  );
  const batches = await exec.query('SELECT COUNT(*)::int AS n FROM public.alignment_batches');
  const profiles = await exec.query(
    "SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE territory='CENTRAL')::int AS central FROM public.profiles"
  );
  const hist = await exec.query('SELECT COUNT(*)::int AS n FROM public.alignment_history');
  await exec.end();
  console.log(
    JSON.stringify(
      {
        ok: true,
        masked: maskDatabaseUrl(url),
        tables: tables.rows,
        alignmentCols: cols.rows,
        boardReactionCols: rxcols.rows,
        state: stats.rows[0],
        batches: batches.rows[0],
        profiles: profiles.rows[0],
        history: hist.rows[0],
      },
      null,
      2
    )
  );
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
