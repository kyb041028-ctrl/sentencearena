#!/usr/bin/env node
'use strict';
/**
 * Additive: user_legal_consents territory disclosure columns.
 * No backfill. No existing-row UPDATE/DELETE.
 *
 *   node tools/apply-legal-territory-disclosure-migration.js --dry-run
 *   railway run --service sentencearena node tools/apply-legal-territory-disclosure-migration.js --confirm-apply
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migration_legal_territory_disclosure_v1.sql',
);

function parseArgs(argv) {
  const out = { confirm: false, dryRun: false };
  argv.forEach(function (a) {
    if (a === '--confirm-apply' || a === '--confirm-dev-db') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
  });
  return out;
}

function sqlBody(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .replace(/--[^\n]*/g, '\n');
}

function refuseSql(sql) {
  const body = sqlBody(sql);
  if (/\bTRUNCATE\b|\bDROP TABLE\b|\bDROP COLUMN\b|\bDROP SCHEMA\b|\bDELETE\s+FROM\b/i.test(body)) {
    return 'DESTRUCTIVE_SQL_REFUSED';
  }
  if (/\bUPDATE\s+/i.test(body)) return 'UPDATE_REFUSED';
  if (/\bINSERT\s+INTO\b/i.test(body)) return 'INSERT_REFUSED';
  if (/\bALTER TABLE\s+(?!public\.user_legal_consents\b)/i.test(body)) {
    return 'OTHER_TABLE_ALTER_REFUSED';
  }
  if (!/ADD COLUMN IF NOT EXISTS territory_disclosure_consented_at/.test(body)) {
    return 'MISSING_TERRITORY_DISCLOSURE_CONSENTED_AT';
  }
  if (!/ADD COLUMN IF NOT EXISTS territory_disclosure_policy_version/.test(body)) {
    return 'MISSING_TERRITORY_DISCLOSURE_POLICY_VERSION';
  }
  return null;
}

function isLocalHost(url) {
  try {
    const host = String(new URL(url).hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  } catch (_) {
    return false;
  }
}

async function countOrNull(exec, sql) {
  try {
    const res = await exec.query(sql);
    return res.rows && res.rows[0] ? res.rows[0].n : null;
  } catch (_) {
    return null;
  }
}

async function verify(exec) {
  const cols = await exec.query(
    "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='user_legal_consents' AND column_name IN ('territory_disclosure_consented_at','territory_disclosure_policy_version','age_requirement_confirmed_at','sensitive_political_consented_at','political_profile_visibility') ORDER BY 1",
  );
  const names = (cols.rows || []).map(function (r) {
    return r.column_name;
  });
  const legal = await exec.query(
    'SELECT COUNT(*)::int AS n, COUNT(age_requirement_confirmed_at)::int AS age_set, COUNT(sensitive_political_consented_at)::int AS sensitive_set, COUNT(political_profile_visibility)::int AS vis_set FROM public.user_legal_consents',
  );
  let tdAtSet = null;
  let tdVerSet = null;
  if (names.indexOf('territory_disclosure_consented_at') !== -1) {
    const td = await exec.query(
      'SELECT COUNT(territory_disclosure_consented_at)::int AS at_set, COUNT(territory_disclosure_policy_version)::int AS ver_set FROM public.user_legal_consents',
    );
    tdAtSet = td.rows[0] && td.rows[0].at_set;
    tdVerSet = td.rows[0] && td.rows[0].ver_set;
  }
  const consentFp = await exec.query(
    "SELECT md5(coalesce(string_agg(user_id::text || '|' || coalesce(age_requirement_confirmed_at::text,'') || '|' || coalesce(age_policy_version,'') || '|' || coalesce(sensitive_political_consented_at::text,'') || '|' || coalesce(sensitive_political_policy_version,'') || '|' || coalesce(political_profile_visibility,''), chr(10) ORDER BY user_id), '')) AS fingerprint FROM public.user_legal_consents",
  );
  const profiles = await exec.query(
    "SELECT COUNT(*)::int AS n, md5(coalesce(string_agg(id::text || '|' || coalesce(territory,'') || '|' || coalesce(signup_completed_at::text,''), chr(10) ORDER BY id), '')) AS fingerprint FROM public.profiles",
  );
  return {
    columns: names,
    hasTerritoryDisclosureAt: names.indexOf('territory_disclosure_consented_at') !== -1,
    hasTerritoryDisclosureVersion: names.indexOf('territory_disclosure_policy_version') !== -1,
    legalCount: legal.rows[0] && legal.rows[0].n,
    ageSet: legal.rows[0] && legal.rows[0].age_set,
    sensitiveSet: legal.rows[0] && legal.rows[0].sensitive_set,
    visibilitySet: legal.rows[0] && legal.rows[0].vis_set,
    territoryDisclosureAtSet: tdAtSet,
    territoryDisclosureVersionSet: tdVerSet,
    consentFingerprint: consentFp.rows[0] && consentFp.rows[0].fingerprint,
    profileCount: profiles.rows[0] && profiles.rows[0].n,
    profileTerritorySignupFingerprint: profiles.rows[0] && profiles.rows[0].fingerprint,
    alignmentStateCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.user_alignment_state'),
    alignmentHistoryCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.alignment_history'),
    postCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.board_posts'),
    commentCount: await countOrNull(exec, 'SELECT COUNT(*)::int AS n FROM public.board_comments'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const bad = refuseSql(sql);
  if (bad) {
    console.error(JSON.stringify({ ok: false, error: bad }));
    process.exit(1);
  }
  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  if (isLocalHost(url)) {
    console.error(JSON.stringify({ ok: false, error: 'LOCALHOST_DB_FORBIDDEN', maskedUrl: maskDatabaseUrl(url) }));
    process.exit(1);
  }
  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      bytes: sql.length,
      addsTerritoryDisclosureAt: /territory_disclosure_consented_at/.test(sql),
      addsTerritoryDisclosureVersion: /territory_disclosure_policy_version/.test(sql),
      maskedUrl: maskDatabaseUrl(url),
    }));
    return;
  }
  if (!args.confirm) {
    console.error(JSON.stringify({
      ok: false,
      error: 'CONFIRM_REQUIRED',
      hint: '--confirm-apply',
      maskedUrl: maskDatabaseUrl(url),
    }));
    process.exit(1);
  }

  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }
  const before = await verify(exec);
  await exec.query(sql);
  try {
    await exec.query("NOTIFY pgrst, 'reload schema'");
  } catch (_) {}
  const after = await verify(exec);
  await exec.end();
  console.log(JSON.stringify({
    ok: true,
    applied: 'migration_legal_territory_disclosure_v1.sql',
    before: before,
    after: after,
    columnsCreated:
      after.hasTerritoryDisclosureAt === true && after.hasTerritoryDisclosureVersion === true,
    noAutoConsent:
      after.territoryDisclosureAtSet === 0 && after.territoryDisclosureVersionSet === 0,
    legalRowsPreserved: before.legalCount === after.legalCount,
    profilesPreserved: before.profileCount === after.profileCount,
    existingConsentPreserved: before.consentFingerprint === after.consentFingerprint,
    ageSetPreserved: before.ageSet === after.ageSet,
    sensitiveSetPreserved: before.sensitiveSet === after.sensitiveSet,
    visibilitySetPreserved: before.visibilitySet === after.visibilitySet,
    territorySignupPreserved:
      before.profileTerritorySignupFingerprint === after.profileTerritorySignupFingerprint,
    alignmentPreserved:
      before.alignmentStateCount === after.alignmentStateCount &&
      before.alignmentHistoryCount === after.alignmentHistoryCount,
    postsCommentsPreserved:
      before.postCount === after.postCount && before.commentCount === after.commentCount,
    maskedUrl: maskDatabaseUrl(url),
  }));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
