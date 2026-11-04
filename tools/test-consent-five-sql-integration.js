#!/usr/bin/env node
'use strict';

/**
 * 다섯 SQL을 빈 로컬 consent_isolated 에서만 실행하는 통합 시험.
 * 14차에서는 실행하지 않았다. 결과가 아니면 UNVERIFIED 다.
 * dotenv, DATABASE_URL, SUPABASE_URL 은 읽지 않는다. 운영 데이터는 넣지 않는다.
 *
 * 허용 환경변수: CONSENT_ISOLATED_DATABASE_URL
 * 데이터베이스 이름은 consent_isolated 만.
 * 호스트는 localhost, 127.0.0.1, ::1 만.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PREREQUISITE_SQL = [
  'schema_profiles_identity_history.sql',
  'migration_handle_new_user_emailless_oauth.sql',
  'migration_activity_name_unique.sql',
  'migration_canonical_user_territory.sql',
  'migration_canonical_territory_central_start.sql',
  'migration_board_core_system.sql',
  'migration_political_alignment_persistence.sql',
  'migration_political_alignment_beta_v1.sql',
  'migration_legal_gate_v1.sql',
  'migration_legal_territory_disclosure_v1.sql',
  'migration_alien_moderation_v1.sql',
  'migration_user_sanctions_v1.sql',
  'migration_account_withdrawal_v1.sql',
  'migration_admin_moderation_audit_v1.sql',
  'migration_retention_policy_v1.sql',
  'migration_signup_completed_at_v1.sql',
  'migration_first_visit_guide_v1.sql',
  'migration_legal_hold_and_audit_purge_v1.sql',
];
const FIVE_SQL = [
  'migration_audit_withdrawal_set_null_v1.sql',
  'migration_service_role_route_min_grants_v1.sql',
  'migration_sensitive_consent_withdraw_tx_v1.sql',
  'migration_alignment_batch_consent_recheck_candidate.sql',
  'migration_reaction_snapshot_consent_recheck_candidate.sql',
];

const SCENARIOS = [
  'consent and withdrawal',
  'rollback',
  'calculation vs withdrawal',
  'reaction vs withdrawal',
  're-consent vs late request',
  'withdrawal vs account deletion',
  'audit-history withdrawal',
  'legal_hold kept',
  'unauthorized RPC rejected',
  'rerun SQL',
  'territory snapshot NULL',
  'reaction counts and cancel kept',
  'batch idempotency',
  'lock wait and deadlock',
  'signup and age check kept',
];

let passed = 0;
let failed = 0;

function isDeadlock(err) {
  if (!err) return false;
  if (err.code === '40P01') return true;
  return /deadlock detected|40P01/i.test(String(err.message || err));
}

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
    return;
  }
  failed += 1;
  console.log('FAIL', name + (detail ? ' — ' + detail : ''));
}

function printUnverified(reason) {
  console.log('RESULT: UNVERIFIED');
  console.log('DB_PROOF: NOT_RUN');
  console.log('reason:', reason);
  SCENARIOS.forEach(function (name) {
    console.log('UNVERIFIED', name);
  });
}

function isolatedTarget(raw) {
  if (!raw || !String(raw).trim()) return { ok: false, reason: 'CONSENT_ISOLATED_DATABASE_URL missing' };
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch (e) {
    return { ok: false, reason: 'URL parse failed' };
  }
  const host = String(parsed.hostname || '').toLowerCase();
  const db = decodeURIComponent(String(parsed.pathname || '').replace(/^\//, ''));
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    return { ok: false, reason: 'REFUSED_NON_LOCAL_HOST' };
  }
  if (/supabase\.co|pooler\.supabase/i.test(String(raw))) {
    return { ok: false, reason: 'REFUSED_SUPABASE' };
  }
  if (db !== 'consent_isolated') {
    return { ok: false, reason: 'REFUSED_DATABASE_NAME' };
  }
  return { ok: true, host: host, database: db };
}

function splitSql(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let dollar = null;
  while (i < sql.length) {
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        buf += dollar;
        i += dollar.length;
        dollar = null;
        continue;
      }
      buf += sql[i];
      i += 1;
      continue;
    }
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl < 0 ? sql.length : nl + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === "'") {
      buf += sql[i];
      i += 1;
      while (i < sql.length) {
        buf += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            buf += sql[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (sql[i] === '$') {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) {
        dollar = m[0];
        buf += dollar;
        i += dollar.length;
        continue;
      }
    }
    if (sql[i] === ';') {
      if (meaningful(buf)) out.push(buf.trim());
      buf = '';
      i += 1;
      continue;
    }
    buf += sql[i];
    i += 1;
  }
  if (meaningful(buf)) out.push(buf.trim());
  return out;
}

function meaningful(stmt) {
  const noBlock = String(stmt).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const noLine = noBlock.replace(/--[^\n]*/g, ' ');
  return noLine.trim().length > 0;
}

async function applyFile(client, fileName) {
  const abs = path.join(ROOT, 'supabase', fileName);
  const sql = fs.readFileSync(abs, 'utf8');
  const parts = splitSql(sql);
  for (let i = 0; i < parts.length; i++) {
    try {
      await client.query(parts[i]);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      throw new Error(fileName + ' statement ' + (i + 1) + ': ' + msg);
    }
  }
}

function newId() {
  return crypto.randomUUID();
}

function consentSql() {
  return (
    'INSERT INTO public.user_legal_consents (' +
    'user_id, age_requirement_confirmed_at, age_policy_version, age_gate_method,' +
    'sensitive_political_consented_at, sensitive_political_policy_version,' +
    'territory_disclosure_consented_at, territory_disclosure_policy_version,' +
    'political_profile_visibility) VALUES (' +
    '$1, now(), \'age-policy-v1\', \'SELF_DECLARE\',' +
    'now(), \'sensitive-political-v1\', now(), \'territory-disclosure-v1\', \'private\') ' +
    'ON CONFLICT (user_id) DO UPDATE SET ' +
    'age_requirement_confirmed_at = EXCLUDED.age_requirement_confirmed_at,' +
    'age_policy_version = EXCLUDED.age_policy_version,' +
    'sensitive_political_consented_at = EXCLUDED.sensitive_political_consented_at,' +
    'sensitive_political_policy_version = EXCLUDED.sensitive_political_policy_version,' +
    'territory_disclosure_consented_at = EXCLUDED.territory_disclosure_consented_at,' +
    'territory_disclosure_policy_version = EXCLUDED.territory_disclosure_policy_version,' +
    'updated_at = now()'
  );
}

async function seedUser(client, withConsent) {
  const id = newId();
  await client.query(
    'INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, \'{}\'::jsonb)',
    [id, id + '@consent-it.invalid'],
  );
  if (withConsent) await client.query(consentSql(), [id]);
  return id;
}

function planFor(batchId, userId, signal) {
  return {
    batchId: batchId,
    processedAt: new Date().toISOString(),
    users: [{ userId: userId, combinedSignal: signal }],
  };
}

async function alignCount(client, userId) {
  const r = await client.query('SELECT count(*)::int AS n FROM public.user_alignment_state WHERE user_id = $1', [userId]);
  return r.rows[0].n;
}

async function bootstrap(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query(
    "DO $$ BEGIN " +
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF; " +
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; " +
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; " +
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres NOLOGIN; END IF; " +
      'END $$;',
  );
  await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  await client.query(
    'CREATE TABLE IF NOT EXISTS auth.users (' +
      'id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, created_at timestamptz NOT NULL DEFAULT now())',
  );
  await client.query(
    'CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ ' +
      "SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$",
  );
  await client.query(
    'CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ ' +
      "SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$",
  );
  for (let i = 0; i < PREREQUISITE_SQL.length; i++) {
    await applyFile(client, PREREQUISITE_SQL[i]);
  }
  for (let passNo = 1; passNo <= 2; passNo++) {
    for (let i = 0; i < FIVE_SQL.length; i++) {
      await applyFile(client, FIVE_SQL[i]);
    }
  }
}

async function expectDenied(client, roleName, sql, params) {
  await client.query('BEGIN');
  try {
    await client.query('SAVEPOINT unauth');
    try {
      await client.query('SET LOCAL ROLE ' + roleName);
      await client.query(sql, params);
      return false;
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT unauth');
      return /permission denied|42501/i.test(String(e && e.message ? e.message : e));
    }
  } finally {
    await client.query('ROLLBACK');
  }
}

async function runScenarios(adminUrl) {
  const created = [];
  const client = new Client({ connectionString: adminUrl });
  const other = new Client({ connectionString: adminUrl });
  await client.connect();
  await other.connect();
  await client.query("SET lock_timeout = '8s'");
  await other.query("SET lock_timeout = '8s'");
  try {
    const ver = await client.query('SELECT current_setting(\'server_version\') AS v, current_database() AS d, inet_server_addr() AS addr');
    const addr = ver.rows[0].addr == null ? '' : String(ver.rows[0].addr);
    ok(
      'connection is local consent_isolated',
      ver.rows[0].d === 'consent_isolated' && (addr === '' || addr.indexOf('127.') === 0 || addr === '::1'),
      'db=' + ver.rows[0].d,
    );
    const existing = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    if (existing.rows[0].n > 0) {
      throw new Error('REFUSED_NONEMPTY_PUBLIC');
    }
    await bootstrap(client);
    ok('rerun SQL', true);

    const dob = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_legal_consents' " +
        "AND (column_name ILIKE '%birth%' OR column_name ILIKE '%dob%' OR column_name = 'date_of_birth')",
    );
    const ageCol = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_legal_consents' AND column_name = 'age_requirement_confirmed_at'",
    );
    const signupId = await seedUser(client, false);
    created.push(signupId);
    const profile = await client.query('SELECT territory FROM public.profiles WHERE id = $1', [signupId]);
    ok(
      'signup and age check kept',
      profile.rows[0] && profile.rows[0].territory === 'CENTRAL' && dob.rows.length === 0 && ageCol.rows.length === 1,
      'territory=' + (profile.rows[0] && profile.rows[0].territory),
    );

    const userA = await seedUser(client, true);
    created.push(userA);
    await client.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [userA]);
    const consent = await client.query(
      'SELECT sensitive_political_consented_at, territory_disclosure_consented_at FROM public.user_legal_consents WHERE user_id = $1',
      [userA],
    );
    ok(
      'consent and withdrawal',
      (await alignCount(client, userA)) === 0 &&
        consent.rows[0] &&
        consent.rows[0].sensitive_political_consented_at == null &&
        consent.rows[0].territory_disclosure_consented_at == null,
    );

    await client.query('BEGIN');
    const rolled = await seedUser(client, true);
    await client.query(
      'SELECT public.apply_alignment_score_batch($1::jsonb)',
      [planFor('roll-' + rolled, rolled, 12)],
    );
    await client.query('ROLLBACK');
    const rolledGone = await client.query('SELECT 1 FROM auth.users WHERE id = $1', [rolled]);
    ok('rollback', rolledGone.rowCount === 0);

    const calcFirst = await seedUser(client, true);
    const withdrawFirst = await seedUser(client, true);
    created.push(calcFirst, withdrawFirst);
    await client.query('BEGIN');
    const batchHeld = client.query('SELECT public.apply_alignment_score_batch($1::jsonb)', [
      planFor('calc-first-' + calcFirst, calcFirst, 20),
    ]);
    await new Promise(function (resolve) { setTimeout(resolve, 150); });
    const withdrawWaiting = (async function () {
      await other.query('BEGIN');
      await other.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [calcFirst]);
      await other.query('COMMIT');
    })();
    await batchHeld;
    await client.query('COMMIT');
    await withdrawWaiting;
    ok('calculation vs withdrawal same user ends with no alignment', (await alignCount(client, calcFirst)) === 0);

    await client.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [withdrawFirst]);
    const afterWithdraw = await client.query('SELECT public.apply_alignment_score_batch($1::jsonb)', [
      planFor('after-withdraw-' + withdrawFirst, withdrawFirst, 15),
    ]);
    ok(
      'withdrawal before calculation skips new rows',
      afterWithdraw.rows[0].apply_alignment_score_batch.skippedUsers >= 1 &&
        (await alignCount(client, withdrawFirst)) === 0,
    );

    const actor = await seedUser(client, true);
    const author = await seedUser(client, true);
    created.push(actor, author);
    const post = await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content) VALUES ($1, 'CENTRAL', 't', 'body') RETURNING id",
      [author],
    );
    const postId = post.rows[0].id;
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [actor]);
    const createdRx = await client.query(
      "SELECT public.toggle_board_reaction('POST', $1::uuid, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL') AS r",
      [postId],
    );
    await client.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [actor]);
    const kept = await client.query(
      'SELECT count(*)::int AS n FROM public.board_reactions WHERE actor_user_id = $1 AND cancelled_at IS NULL',
      [actor],
    );
    const counts = await client.query('SELECT earth_positive_count FROM public.board_posts WHERE id = $1', [postId]);
    ok(
      'reaction vs withdrawal keeps existing reaction and count',
      createdRx.rows[0].r.action === 'CREATED' && kept.rows[0].n === 1 && counts.rows[0].earth_positive_count === 1,
    );

    const lateUser = await seedUser(client, true);
    created.push(lateUser);
    const before = await client.query(
      'SELECT updated_at::text AS updated_at FROM public.user_legal_consents WHERE user_id = $1',
      [lateUser],
    );
    const oldUpdated = before.rows[0].updated_at;
    await client.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [lateUser]);
    const late = await client.query(
      'UPDATE public.user_legal_consents SET sensitive_political_consented_at = now(), ' +
        "sensitive_political_policy_version = 'sensitive-political-v1', updated_at = now() " +
        'WHERE user_id = $1 AND updated_at = $2::timestamptz',
      [lateUser, oldUpdated],
    );
    const fresh = await client.query(
      'SELECT updated_at::text AS updated_at FROM public.user_legal_consents WHERE user_id = $1',
      [lateUser],
    );
    const recon = await client.query(
      'UPDATE public.user_legal_consents SET ' +
        'age_requirement_confirmed_at = now(), age_policy_version = \'age-policy-v1\',' +
        'sensitive_political_consented_at = now(), sensitive_political_policy_version = \'sensitive-political-v1\',' +
        'territory_disclosure_consented_at = now(), territory_disclosure_policy_version = \'territory-disclosure-v1\',' +
        'updated_at = now() WHERE user_id = $1 AND updated_at = $2::timestamptz',
      [lateUser, fresh.rows[0].updated_at],
    );
    const reconBatch = await client.query('SELECT public.apply_alignment_score_batch($1::jsonb)', [
      planFor('recon-' + lateUser, lateUser, 8),
    ]);
    ok(
      're-consent vs late request',
      late.rowCount === 0 && recon.rowCount === 1 && reconBatch.rows[0].apply_alignment_score_batch.processedUsers === 1,
    );

    const gone = await seedUser(client, true);
    created.push(gone);
    await client.query('SELECT public.apply_alignment_score_batch($1::jsonb)', [planFor('del-' + gone, gone, 4)]);
    const auditId = newId();
    await client.query(
      'INSERT INTO public.admin_moderation_audit_events (id, actor_user_id, action_type, target_type, target_id, target_user_id, reason_code) ' +
        "VALUES ($1, $2, 'HIDE', 'POST', $3, $2, 'TEST')",
      [auditId, gone, newId()],
    );
    const holdId = newId();
    await client.query(
      'INSERT INTO public.legal_hold_operator_events (id, action_type, target_type, target_id, actor_user_id, reason) ' +
        "VALUES ($1, 'HOLD_SET', 'ADMIN_AUDIT', $2, $3, 'keep')",
      [holdId, auditId, gone],
    );
    await client.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [gone]);
    await client.query('SELECT public.withdraw_account_anonymize($1::uuid)', [gone]);
    await client.query('DELETE FROM auth.users WHERE id = $1', [gone]);
    created.splice(created.indexOf(gone), 1);
    const audit = await client.query(
      'SELECT actor_user_id, target_user_id, action_type, reason_code FROM public.admin_moderation_audit_events WHERE id = $1',
      [auditId],
    );
    const hold = await client.query(
      'SELECT actor_user_id, action_type, reason FROM public.legal_hold_operator_events WHERE id = $1',
      [holdId],
    );
    const consentGone = await client.query('SELECT 1 FROM public.user_legal_consents WHERE user_id = $1', [gone]);
    ok(
      'withdrawal vs account deletion',
      (await alignCount(client, gone)) === 0 && consentGone.rowCount === 0 && audit.rows.length === 1,
    );
    ok(
      'audit-history withdrawal',
      audit.rows[0] && audit.rows[0].actor_user_id == null && audit.rows[0].action_type === 'HIDE' && audit.rows[0].reason_code === 'TEST',
    );
    ok(
      'legal_hold kept',
      hold.rows[0] && hold.rows[0].action_type === 'HOLD_SET' && hold.rows[0].reason === 'keep' && hold.rows[0].actor_user_id == null,
    );

    const deniedUser = await seedUser(client, true);
    created.push(deniedUser);
    const denyWithdraw = await expectDenied(
      client,
      'authenticated',
      'SELECT public.withdraw_sensitive_political_consent($1::uuid)',
      [deniedUser],
    );
    const denyBatch = await expectDenied(
      client,
      'anon',
      'SELECT public.apply_alignment_score_batch($1::jsonb)',
      [planFor('denied-' + deniedUser, deniedUser, 1)],
    );
    ok('unauthorized RPC rejected', denyWithdraw && denyBatch);

    const bare = await seedUser(client, false);
    created.push(bare);
    const barePost = await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content) VALUES ($1, 'CENTRAL', 't2', 'body') RETURNING id",
      [author],
    );
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [bare]);
    await client.query(
      "SELECT public.toggle_board_reaction('POST', $1::uuid, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL')",
      [barePost.rows[0].id],
    );
    const snap = await client.query(
      'SELECT actor_territory_at_reaction, actor_alignment_score_at_reaction FROM public.board_reactions WHERE actor_user_id = $1 AND post_id = $2',
      [bare, barePost.rows[0].id],
    );
    const bareCount = await client.query('SELECT earth_positive_count FROM public.board_posts WHERE id = $1', [barePost.rows[0].id]);
    ok(
      'territory snapshot NULL',
      snap.rows[0] && snap.rows[0].actor_territory_at_reaction == null && snap.rows[0].actor_alignment_score_at_reaction == null &&
        bareCount.rows[0].earth_positive_count === 1,
    );

    const cancelUser = await seedUser(client, true);
    created.push(cancelUser);
    const cancelPost = await client.query(
      "INSERT INTO public.board_posts (author_user_id, territory, title, content) VALUES ($1, 'CENTRAL', 't3', 'body') RETURNING id",
      [author],
    );
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [cancelUser]);
    await client.query("SELECT public.toggle_board_reaction('POST', $1::uuid, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL')", [
      cancelPost.rows[0].id,
    ]);
    await client.query("SELECT public.toggle_board_reaction('POST', $1::uuid, 'LIKE', 'CENTRAL', 'EARTH', 'CENTRAL')", [
      cancelPost.rows[0].id,
    ]);
    const cancelRow = await client.query(
      'SELECT cancelled_at FROM public.board_reactions WHERE actor_user_id = $1 AND post_id = $2',
      [cancelUser, cancelPost.rows[0].id],
    );
    const cancelCount = await client.query('SELECT earth_positive_count FROM public.board_posts WHERE id = $1', [
      cancelPost.rows[0].id,
    ]);
    ok(
      'reaction counts and cancel kept',
      cancelRow.rows.length === 1 && cancelRow.rows[0].cancelled_at != null && cancelCount.rows[0].earth_positive_count === 0,
    );

    const idem = await seedUser(client, true);
    created.push(idem);
    const idemPlan = planFor('idem-' + idem, idem, 6);
    const first = await client.query('SELECT public.apply_alignment_score_batch($1::jsonb) AS r', [idemPlan]);
    const second = await client.query('SELECT public.apply_alignment_score_batch($1::jsonb) AS r', [idemPlan]);
    const hist = await client.query('SELECT count(*)::int AS n FROM public.alignment_history WHERE user_id = $1', [idem]);
    ok(
      'batch idempotency',
      first.rows[0].r.skipped === false && second.rows[0].r.skipReason === 'ALREADY_APPLIED' && hist.rows[0].n === 1,
    );

    const lockUser = await seedUser(client, true);
    created.push(lockUser);
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM public.user_legal_consents WHERE user_id = $1 FOR UPDATE', [lockUser]);
    const waitStart = Date.now();
    const waiter = other.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [lockUser]);
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const releasedAt = Date.now();
    await client.query('COMMIT');
    await waiter;
    ok('lock wait', Date.now() >= releasedAt && releasedAt - waitStart >= 300);

    const left = await seedUser(client, true);
    const right = await seedUser(client, true);
    created.push(left, right);
    await client.query('BEGIN');
    await other.query('BEGIN');
    await client.query('SELECT 1 FROM public.user_legal_consents WHERE user_id = $1 FOR UPDATE', [left]);
    await other.query('SELECT 1 FROM public.user_legal_consents WHERE user_id = $1 FOR UPDATE', [right]);
    const cross1 = client.query('SELECT 1 FROM public.user_legal_consents WHERE user_id = $1 FOR UPDATE', [right]);
    const cross2 = other.query('SELECT 1 FROM public.user_legal_consents WHERE user_id = $1 FOR UPDATE', [left]);
    const cross = await Promise.allSettled([cross1, cross2]);
    const sawDeadlock = cross.some(function (item) {
      return item.status === 'rejected' && isDeadlock(item.reason);
    });
    await client.query('ROLLBACK');
    await other.query('ROLLBACK');
    const safeUser = await seedUser(client, true);
    created.push(safeUser);
    await client.query('BEGIN');
    let productDeadlock = false;
    const safeBatch = client.query('SELECT public.apply_alignment_score_batch($1::jsonb)', [
      planFor('safe-' + safeUser, safeUser, 3),
    ]).catch(function (e) {
      if (isDeadlock(e)) productDeadlock = true;
      throw e;
    });
    await new Promise(function (resolve) { setTimeout(resolve, 150); });
    const withdrawWhileBatchOpen = (async function () {
      try {
        await other.query('BEGIN');
        await other.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [safeUser]);
        await other.query('COMMIT');
      } catch (e) {
        if (isDeadlock(e)) productDeadlock = true;
        try { await other.query('ROLLBACK'); } catch (ignore) { /* clear */ }
      }
    })();
    try {
      await safeBatch;
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (ignore) { /* clear */ }
    }
    await withdrawWhileBatchOpen;
    ok('lock wait and deadlock', sawDeadlock && !productDeadlock && (await alignCount(client, safeUser)) === 0);
  } finally {
    try { await client.query('ROLLBACK'); } catch (e) { /* already clear */ }
    try { await other.query('ROLLBACK'); } catch (e) { /* already clear */ }
    if (created.length) {
      try {
        await client.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [created]);
      } catch (e) {
        console.log('CLEANUP_WARN fixture delete failed');
      }
    }
    await client.end();
    await other.end();
  }
}

async function main() {
  const target = isolatedTarget(process.env.CONSENT_ISOLATED_DATABASE_URL);
  if (!target.ok) {
    printUnverified(target.reason);
    process.exit(0);
  }
  try {
    await runScenarios(process.env.CONSENT_ISOLATED_DATABASE_URL);
  } catch (e) {
    failed += 1;
    console.log('FAIL script — ' + String(e && e.message ? e.message : e));
  }
  console.log('RESULT:', failed ? 'FAIL' : 'PASS');
  console.log('passed:', passed, 'failed:', failed);
  process.exit(failed ? 1 : 0);
}

module.exports = {
  isolatedTarget: isolatedTarget,
  runScenarios: runScenarios,
  SCENARIOS: SCENARIOS,
};

if (require.main === module) {
  main();
}
