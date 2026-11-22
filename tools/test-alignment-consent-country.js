'use strict';

/**
 * 정치성향 기록과 국가별 동의 철회. 격리 Postgres만.
 * node tools/test-alignment-consent-country.js
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createLegalGateService } = require('../server/legal-gate-service');
const { createLegalGateRouter } = require('../server/legal-gate-routes');
const territory = require('../server/canonical-user-territory-service');
const regionCore = require('../shared/activity-region-core');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function line(ok, name, detail) {
  return (ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : '');
}

function request(app, method, pathName, headers, bodyObj) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      const payload = bodyObj != null ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
      const hdrs = Object.assign({}, headers || {});
      if (payload) {
        hdrs['Content-Type'] = 'application/json';
        hdrs['Content-Length'] = String(payload.length);
      }
      const req = require('http').request({
        hostname: '127.0.0.1', port: port, path: pathName, method: method, headers: hdrs,
      }, function (res) {
        let raw = '';
        res.on('data', function (chunk) { raw += chunk; });
        res.on('end', function () {
          server.close();
          let body = null;
          try { body = JSON.parse(raw); } catch (_) { body = raw; }
          resolve({ status: res.statusCode, body: body });
        });
      });
      req.on('error', function () { server.close(); resolve({ status: 0, body: null }); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function pgAdmin(query) {
  return {
    from: function (table) {
      const state = { table: table, filters: {}, payload: null, mode: '' };
      const api = {
        update: function (payload) { state.mode = 'update'; state.payload = payload; return api; },
        upsert: function (payload) { state.mode = 'upsert'; state.payload = payload; return api; },
        eq: function (col, val) { state.filters[col] = val; return api; },
        select: function () { return api.run(); },
        run: async function () {
          const cols = Object.keys(state.payload || {});
          const params = cols.map(function (key) { return state.payload[key]; });
          let sql = 'UPDATE public.' + state.table + ' SET ' + cols.map(function (key, i) {
            return key + ' = $' + (i + 1);
          }).join(', ');
          const where = Object.keys(state.filters);
          where.forEach(function (key, i) {
            params.push(state.filters[key]);
            sql += (i === 0 ? ' WHERE ' : ' AND ') + key + ' = $' + params.length;
          });
          sql += ' RETURNING user_id';
          const res = await query(sql, params);
          return { data: res.rows, error: null };
        },
      };
      return api;
    },
    rpc: async function (name, args) {
      if (name !== 'withdraw_sensitive_political_consent') return { error: { message: 'UNEXPECTED_RPC' } };
      await query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [args.p_user_id]);
      return { error: null };
    },
  };
}

async function counts(client, userId) {
  const score = await client.query('SELECT score::text AS score FROM public.user_alignment_state WHERE user_id = $1', [userId]);
  const history = await client.query('SELECT count(*)::int AS n FROM public.alignment_territory_history WHERE user_id = $1', [userId]);
  const places = await client.query(
    'SELECT activity_region, territory, xp FROM public.user_activity_region_profile WHERE user_id = $1 ORDER BY activity_region',
    [userId]
  );
  const us = await client.query(
    `SELECT sensitive_political_consented_at IS NOT NULL AS sensitive, terms_consented_at IS NOT NULL AS terms
     FROM public.user_activity_region_legal_consents WHERE user_id = $1 AND activity_region = 'US'`,
    [userId]
  );
  const notes = await client.query(
    'SELECT activity_region FROM public.user_notifications WHERE user_id = $1 ORDER BY activity_region',
    [userId]
  );
  return {
    score: score.rows[0] ? score.rows[0].score : null,
    history: history.rows[0].n,
    places: places.rows,
    us: us.rows[0] || null,
    notes: notes.rows.map(function (row) { return row.activity_region; }),
  };
}

async function main() {
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN alignment-consent-country: pg module missing\n');
    process.exit(0);
  }
  const adminDb = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await adminDb.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN alignment-consent-country: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'leader_election_iso_align_' + process.pid;
  const lines = [];
  let client;
  try {
    await adminDb.query('CREATE DATABASE ' + dbName);
    client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
    await client.connect();
    await client.query(`
      CREATE TABLE public.user_alignment_state (
        user_id uuid PRIMARY KEY,
        score numeric,
        previous_signal numeric
      );
      CREATE TABLE public.alignment_history (
        history_id text PRIMARY KEY,
        user_id uuid,
        previous_score numeric,
        next_score numeric
      );
      CREATE TABLE public.alignment_territory_history (
        history_id text PRIMARY KEY,
        user_id uuid,
        reason text
      );
      CREATE TABLE public.user_legal_consents (
        user_id uuid PRIMARY KEY,
        age_requirement_confirmed_at timestamptz,
        sensitive_political_consented_at timestamptz,
        sensitive_political_policy_version text,
        territory_disclosure_consented_at timestamptz,
        territory_disclosure_policy_version text,
        political_profile_visibility text,
        updated_at timestamptz
      );
      CREATE TABLE public.user_activity_region_legal_consents (
        user_id uuid NOT NULL,
        activity_region text NOT NULL,
        terms_consented_at timestamptz,
        sensitive_political_consented_at timestamptz,
        sensitive_political_policy_version text,
        sensitive_applies_to text,
        territory_disclosure_consented_at timestamptz,
        territory_disclosure_policy_version text,
        territory_disclosure_applies_to text,
        marketing_opt_in boolean NOT NULL DEFAULT false,
        updated_at timestamptz,
        PRIMARY KEY (user_id, activity_region)
      );
      CREATE TABLE public.user_activity_region_profile (
        user_id uuid NOT NULL,
        activity_region text NOT NULL,
        territory text,
        xp bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, activity_region)
      );
      CREATE TABLE public.user_notifications (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        activity_region text
      );
    `);
    const withdrawSql = fs.readFileSync(path.join(__dirname, '../supabase/migration_sensitive_consent_withdraw_tx_v1.sql'), 'utf8');
    await client.query(withdrawSql.slice(0, withdrawSql.indexOf('REVOKE ALL')));
    await client.query(
      `INSERT INTO public.user_alignment_state (user_id, score, previous_signal) VALUES ($1, 7.5, 1)`,
      [A]
    );
    await client.query(
      `INSERT INTO public.alignment_history (history_id, user_id, previous_score, next_score) VALUES ('h1', $1, 0, 7.5)`,
      [A]
    );
    await client.query(
      `INSERT INTO public.alignment_territory_history (history_id, user_id, reason) VALUES ('t1', $1, 'ALIGNMENT')`,
      [A]
    );
    await client.query(
      `INSERT INTO public.user_legal_consents
        (user_id, sensitive_political_consented_at, sensitive_political_policy_version, political_profile_visibility)
       VALUES ($1, now(), 'sensitive-political-v1', 'private')`,
      [A]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_legal_consents
        (user_id, activity_region, terms_consented_at, sensitive_political_consented_at, sensitive_applies_to,
         territory_disclosure_consented_at, territory_disclosure_applies_to)
       VALUES ($1, 'US', now(), now(), 'US', now(), 'US')`,
      [A]
    );
    await client.query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory, xp)
       VALUES ($1, 'KR', 'pioneer', 11), ($1, 'US', 'guardian', 12)`,
      [A]
    );
    await client.query(
      `INSERT INTO public.user_notifications (id, user_id, activity_region)
       VALUES ('11111111-1111-4111-8111-111111111111', $1, 'KR'),
              ('22222222-2222-4222-8222-222222222222', $1, 'US')`,
      [A]
    );
    const q = function (sql, params) { return client.query(sql, params); };
    const krScore = await territory.getCountryAlignmentScore(A, 'KR', { query: q });
    const usScore = await territory.getCountryAlignmentScore(A, 'US', { query: q });
    const noCountry = await territory.getCountryAlignmentScore(A, '', { query: q });
    lines.push(line(krScore.available === true && krScore.score === 7.5, '1-kr-alignment-record', 'function'));
    lines.push(line(
      usScore.reason === 'US_ALIGNMENT_INACTIVE' && usScore.score == null && usScore.available === false,
      '2-us-does-not-read-kr-score',
      'function'
    ));
    const usBatch = regionCore.selectAlignmentBatch({
      region: 'US',
      users: [{ userId: A, activityRegion: 'KR' }],
      reactions: [{ id: 'kr', activity_region: 'KR' }],
    });
    lines.push(line(
      usBatch.skipped === true && usBatch.reason === 'US_SENTENCE_MODEL_MISSING' && usBatch.users.length === 0,
      '3-us-batch-makes-no-score',
      'function'
    ));
    lines.push(line(noCountry.reason === 'COUNTRY_REQUIRED', '7-missing-country-read', 'function'));

    const service = createLegalGateService({
      query: q,
      getAdminClient: function () { return pgAdmin(q); },
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createLegalGateRouter({
      service: service,
      resolveActor: async function (req) {
        const id = req.headers['x-sc-user-id'];
        return id ? { userId: String(id) } : null;
      },
    }));
    const bare = await request(app, 'POST', '/api/me/legal/withdraw-sensitive-consent', { 'x-sc-user-id': A }, {});
    const bareUs = await request(app, 'POST', '/api/me/legal/withdraw-us-sensitive-consent', { 'x-sc-user-id': A }, {});
    const afterBare = await counts(client, A);
    lines.push(line(
      bare.status === 400 && bare.body.error === 'COUNTRY_REQUIRED' &&
      bareUs.status === 400 && bareUs.body.error === 'COUNTRY_REQUIRED' &&
      afterBare.score === '7.5' && afterBare.history === 1,
      '7-missing-country-withdraw-blocked',
      'route'
    ));
    const wrong = await request(app, 'POST', '/api/me/legal/withdraw-sensitive-consent', {
      'x-sc-user-id': A,
      cookie: 'sa_ar=US; sa_ar_x=1',
    }, { activityRegion: 'US' });
    const wrongOther = await request(app, 'POST', '/api/me/legal/withdraw-us-sensitive-consent', {
      'x-sc-user-id': A,
      cookie: 'sa_ar=KR; sa_ar_x=1',
    }, { activityRegion: 'KR' });
    const afterWrong = await counts(client, A);
    lines.push(line(
      wrong.status === 403 && wrong.body.error === 'COUNTRY_MISMATCH' &&
      wrongOther.status === 403 &&
      afterWrong.score === '7.5' && afterWrong.us.sensitive === true,
      '8-other-country-api-does-not-delete',
      'route'
    ));

    const usWithdrawn = await service.withdrawUsSensitiveConsent(A);
    const afterUs = await counts(client, A);
    lines.push(line(
      usWithdrawn.sensitiveConsented === false && afterUs.score === '7.5' && afterUs.history === 1 &&
      afterUs.us.terms === true && afterUs.us.sensitive === false,
      '4-us-withdraw-keeps-kr-alignment',
      'service'
    ));
    lines.push(line(
      afterUs.places[0].territory === 'pioneer' && afterUs.places[1].territory === 'guardian' &&
      Number(afterUs.places[0].xp) === 11 && Number(afterUs.places[1].xp) === 12,
      '5-us-withdraw-keeps-country-territory',
      'service'
    ));

    await service.withdrawSensitiveConsent(A);
    const afterKr = await counts(client, A);
    lines.push(line(
      afterKr.score == null && afterKr.history === 0 &&
      afterKr.us.terms === true && afterKr.places[1].territory === 'guardian' &&
      afterKr.notes.join(',') === 'KR,US',
      '6-kr-withdraw-keeps-us-records',
      'service-calls-sql'
    ));

    await client.query(
      `INSERT INTO public.user_alignment_state (user_id, score) VALUES ($1, 7.5)`,
      [A]
    );
    await client.query(
      `INSERT INTO public.alignment_territory_history (history_id, user_id, reason) VALUES ('t2', $1, 'ALIGNMENT')`,
      [A]
    );
    await client.query('SELECT public.withdraw_sensitive_political_consent($1::uuid)', [A]);
    const afterSql = await counts(client, A);
    lines.push(line(
      afterSql.score == null && afterSql.history === 0 && Number(afterSql.places[1].xp) === 12 && afterSql.us.terms === true,
      '6b-direct-sql-still-kr-policy-and-leaves-us',
      'sql'
    ));
    const krBatch = regionCore.selectAlignmentBatch({
      region: 'KR',
      users: [
        { userId: A, activityRegion: 'KR' },
        { userId: A, activityRegion: 'US' },
      ],
      reactions: [],
    });
    lines.push(line(
      krBatch.skipped === false && krBatch.users.length === 1 && krBatch.users[0].activityRegion === 'KR',
      '9-kr-batch-keeps-kr-rows-only',
      'function'
    ));
    lines.push(line(
      afterSql.places[0].territory === 'pioneer' && afterSql.notes.length === 2,
      '10-territory-and-notices-remain',
      'sql'
    ));
  } finally {
    if (client) await client.end().catch(function () {});
    await adminDb.query('DROP DATABASE IF EXISTS ' + dbName).catch(function () {});
    await adminDb.end().catch(function () {});
  }
  const failed = lines.filter(function (item) { return item.indexOf('FAIL') === 0; });
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write((failed.length ? 'FAIL ' : 'PASS ') + lines.length + '\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch(function (err) {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
