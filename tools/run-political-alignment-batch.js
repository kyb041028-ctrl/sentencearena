#!/usr/bin/env node
'use strict';
/**
 * Manual alignment score batch (no scheduler).
 *
 *   node tools/run-political-alignment-batch.js --dry-run
 *   node tools/run-political-alignment-batch.js --apply --confirm-dev-db
 *
 * UUID/PII not printed. Browser public API is not used.
 */

require('dotenv').config();

const persistSvc = require('../server/political-alignment-persist-service');

function parseArgs(argv) {
  const out = { dryRun: true, apply: false, confirm: false, batchId: null };
  argv.forEach(function (a) {
    if (a === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (a === '--dry-run') {
      out.dryRun = true;
      out.apply = false;
    } else if (a === '--confirm-dev-db') {
      out.confirm = true;
    } else if (a.indexOf('--batch-id=') === 0) {
      out.batchId = a.slice('--batch-id='.length);
    }
  });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply) {
    if (!args.confirm) {
      console.error(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED' }));
      process.exit(1);
    }
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
      console.error(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
      process.exit(1);
    }
  }

  const report = await persistSvc.runPoliticalAlignmentBatch({
    apply: args.apply,
    batchId: args.batchId || undefined,
    asOf: new Date(),
  });

  const out = {
    ok: true,
    dryRun: !args.apply,
    apply: args.apply,
    batchId: report.batchId,
    userCount: report.userCount,
    nonzeroCombined: report.nonzeroCombined,
    scoreWrite: report.scoreWrite,
    schedulerConnected: false,
    territoryMoveEvaluated: false,
    users: report.usersRedacted,
    rpc: report.rpc || null,
  };
  console.log(JSON.stringify(out));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), code: e && e.code }));
  process.exit(1);
});
