'use strict';
/**
 * Piper follower stages on a new isolated database only.
 * node tools/test-piper-followers.js
 */
const fs = require('fs');
const path = require('path');
const piper = require('../server/invite-achievement-service');

const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function line(ok, name, detail) {
  return (ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : '');
}

function uuid(n) {
  const hex = n.toString(16).padStart(12, '0');
  return 'cccccccc-cccc-4ccc-8ccc-' + hex;
}

async function main() {
  let Client;
  try { Client = require('pg').Client; }
  catch (_err) {
    process.stdout.write('NOT RUN piper-followers: pg module missing\n');
    process.exit(0);
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 1500 });
  try { await admin.connect(); }
  catch (err) {
    process.stdout.write('NOT RUN piper-followers: ' + String(err && err.message || err) + '\n');
    process.exit(0);
  }
  const dbName = 'piper_followers_iso_' + process.pid;
  const client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + dbName });
  const lines = [];
  try {
    await admin.query('CREATE DATABASE ' + dbName);
    await client.connect();
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/migration_piper_followers_candidate.sql'), 'utf8');
    await client.query(sql);
    async function query(text, params) { return client.query(text, params); }
    async function setFollowers(region, count) {
      await client.query('DELETE FROM public.user_follows WHERE following_user_id = $1 AND activity_region = $2', [TARGET, region]);
      for (let i = 0; i < count; i += 1) {
        await client.query(
          'INSERT INTO public.user_follows (follower_user_id, following_user_id, activity_region) VALUES ($1,$2,$3)',
          [uuid(i + 1), TARGET, region]
        );
      }
    }
    async function row(region) {
      const out = await client.query(
        'SELECT achievement_key, stage, acquisition_notified_at FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = $2 AND achievement_key = $3',
        [TARGET, region, 'piper']
      );
      return out.rows[0] || null;
    }
    const expect = [
      [0, 0], [9, 0], [10, 1], [99, 1], [100, 2], [999, 2], [1000, 3], [9999, 3], [10000, 4],
    ];
    for (let i = 0; i < expect.length; i += 1) {
      const count = expect[i][0];
      const stage = expect[i][1];
      await setFollowers('KR', count);
      const first = await piper.evaluatePiper(query, TARGET, 'KR');
      const again = await piper.evaluatePiper(query, TARGET, 'KR');
      const saved = await row('KR');
      const savedStage = saved ? Number(saved.stage) : 0;
      const rows = await client.query(
        'SELECT count(*)::int AS n FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = $2 AND achievement_key = $3',
        [TARGET, 'KR', 'piper']
      );
      const crossed = count === 10 || count === 100 || count === 1000 || count === 10000;
      lines.push(line(
        first.stage === stage && again.stage === stage && savedStage === stage &&
          first.granted === crossed && again.granted === false &&
          Number(rows.rows[0].n) === (stage ? 1 : 0) &&
          (crossed ? first.notifyStage === stage : first.notifyStage == null),
        'count-' + count + '-stage-' + stage,
        'got ' + first.stage + '/' + savedStage + ' granted ' + first.granted
      ));
    }
    await client.query(
      'INSERT INTO public.user_follows (follower_user_id, following_user_id, activity_region) VALUES ($1,$1,$2)',
      [TARGET, 'KR']
    );
    await client.query(
      'INSERT INTO public.user_follows (follower_user_id, following_user_id, activity_region, cancelled_at) VALUES ($1,$2,$3,now())',
      [OTHER, TARGET, 'KR']
    );
    const extras = await piper.evaluatePiper(query, TARGET, 'KR');
    lines.push(line(extras.stage === 4 && extras.followers === 10000, 'self-and-cancel-excluded', 'followers ' + extras.followers));
    await setFollowers('KR', 9);
    const kept = await piper.evaluatePiper(query, TARGET, 'KR');
    const keptRow = await row('KR');
    lines.push(line(kept.stage === 4 && Number(keptRow.stage) === 4 && kept.granted === false, 'unfollow-keeps-stage', 'stage ' + kept.stage));
    await client.query('DELETE FROM public.user_activity_region_achievement WHERE user_id = $1', [TARGET]);
    await setFollowers('KR', 10000);
    const jumped = await piper.evaluatePiper(query, TARGET, 'KR');
    const jumpRows = await client.query(
      'SELECT count(*)::int AS n FROM public.user_activity_region_achievement WHERE user_id = $1 AND achievement_key = $2',
      [TARGET, 'piper']
    );
    lines.push(line(
      jumped.stage === 4 && jumped.notifyStage === 4 && Number(jumpRows.rows[0].n) === 1,
      'jump-10000-one-row'
    ));
    await client.query(
      'UPDATE public.user_activity_region_achievement SET acquisition_notified_at = $1, stage = 1 WHERE user_id = $2 AND activity_region = $3',
      ['2026-01-01T00:00:00.000Z', TARGET, 'KR']
    );
    await setFollowers('KR', 100);
    const promoted = await piper.evaluatePiper(query, TARGET, 'KR');
    const promotedRow = await row('KR');
    lines.push(line(
      promoted.stage === 2 && promotedRow.acquisition_notified_at &&
        new Date(promotedRow.acquisition_notified_at).toISOString().indexOf('2026-01-01') === 0,
      'promotion-does-not-clear-notified'
    ));
    await setFollowers('US', 1000);
    const us = await piper.evaluatePiper(query, TARGET, 'US');
    const krAfter = await row('KR');
    const usRow = await row('US');
    lines.push(line(
      us.stage === 3 && Number(usRow.stage) === 3 && Number(krAfter.stage) === 2,
      'kr-us-separate',
      'us ' + us.stage + ' kr ' + krAfter.stage
    ));
    await client.query(
      'INSERT INTO public.user_activity_region_achievement (user_id, activity_region, achievement_key, stage) VALUES ($1,$2,$3,$4)',
      [TARGET, 'KR', 'first-post', null]
    );
    await piper.evaluatePiper(query, TARGET, 'KR');
    const other = await client.query(
      'SELECT achievement_key, stage FROM public.user_activity_region_achievement WHERE user_id = $1 AND achievement_key = $2',
      [TARGET, 'first-post']
    );
    lines.push(line(other.rows.length === 1 && other.rows[0].stage == null, 'other-achievement-unchanged'));
    const featured = require('../server/achievement-persist-service');
    let maxRejected = false;
    try {
      await featured.setFeaturedAchievementsForUser({ rpc: async function () { return { data: null, error: null }; } }, TARGET, ['a', 'b', 'c', 'd']);
    } catch (err) {
      maxRejected = err && err.code === 'FEATURED_MAX_EXCEEDED';
    }
    lines.push(line(maxRejected, 'featured-max-3'));
  } catch (err) {
    lines.push('FAIL runner ' + String(err && err.stack || err));
  } finally {
    try { await client.end(); } catch (_e) { /* close */ }
    try {
      await admin.query('DROP DATABASE IF EXISTS ' + dbName);
    } catch (err) {
      lines.push('FAIL drop-isolated ' + String(err && err.message || err));
    }
    try { await admin.end(); } catch (_e) { /* close */ }
  }
  process.stdout.write(lines.join('\n') + '\n');
  if (lines.some(function (item) { return item.indexOf('FAIL') === 0; })) process.exit(1);
}

main();
