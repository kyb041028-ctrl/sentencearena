#!/usr/bin/env node
'use strict';
/**
 * ALIEN MODERATION V1 — development DB verification.
 * Creates tagged fixture users/posts/reports only. Restores fixture profiles.
 * Production refused. Does not wait real 7 days.
 *
 *   node tools/verify-alien-moderation-dev-db.js --confirm-dev-db
 *   node tools/verify-alien-moderation-dev-db.js --confirm-dev-db --serve
 */

require('dotenv').config();

const path = require('path');
const express = require('express');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { createBoardService } = require('../server/board-service');
const { createBoardSupabaseRepository } = require('../server/board-supabase-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createAlienModerationSupabaseRepository } = require('../server/alien-moderation-supabase-repository');
const { createAlienCitizenshipWriter } = require('../server/alien-citizenship-writer');
const alienService = require('../server/alien-moderation-service');
const alienRoutes = require('../server/alien-moderation-routes');
const { createBoardRouter } = require('../server/board-routes');
const evoRoutes = require('../server/territory-evolution-routes');
const evoService = require('../server/territory-evolution-service');
const popAdapter = require('../server/territory-population-adapter');
const popSupa = require('../server/territory-population-supabase-repository');
const { resolveAlienModerationV1Enabled } = require('../server/alien-moderation-v1-flag');
const reportCore = require('../shared/alien-report-moderation-core');

const MARKER = 'SC_ALIEN_MOD_VERIFY';
const PORT = Number(process.env.ALIEN_VERIFY_PORT || 3021);
const PASSWORD = 'VerifyPass!2026a';

function argHas(flag) {
  return process.argv.indexOf(flag) !== -1;
}

function fail(code, extra) {
  const err = new Error(code);
  err.code = code;
  if (extra) err.extra = extra;
  throw err;
}

async function ensureUser(admin, email, metadata) {
  const created = await admin.auth.admin.createUser({
    email: email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (created.data && created.data.user && created.data.user.id) {
    return { id: created.data.user.id, created: true, email: email };
  }
  const msg = String((created.error && created.error.message) || '');
  if (!/already|registered|exists/i.test(msg)) {
    fail('FIXTURE_USER_CREATE_FAILED', msg);
  }
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = ((listed.data && listed.data.users) || []).find(function (u) {
    return String(u.email || '').toLowerCase() === email.toLowerCase();
  });
  if (!found) fail('FIXTURE_USER_LOOKUP_FAILED', email);
  return { id: found.id, created: false, email: email };
}

async function snapshotProfile(admin, userId) {
  const { data, error } = await admin
    .from('profiles')
    .select('id, citizenship_status, exile_strike_count, territory')
    .eq('id', userId)
    .maybeSingle();
  if (error) fail('PROFILE_SNAPSHOT_FAILED', error.message);
  return data;
}

async function restoreProfile(admin, snap) {
  if (!snap || !snap.id) return;
  await admin.from('profiles').update({
    citizenship_status: snap.citizenship_status,
    exile_strike_count: snap.exile_strike_count,
    territory: snap.territory,
  }).eq('id', snap.id);
}

async function main() {
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.log(JSON.stringify({ ok: false, error: 'PRODUCTION_REFUSED' }));
    process.exit(1);
  }
  if (!argHas('--confirm-dev-db')) {
    console.log(JSON.stringify({ ok: false, error: 'CONFIRM_REQUIRED' }));
    process.exit(1);
  }

  const apply = spawnSync(process.execPath, [
    path.join(__dirname, 'apply-alien-moderation-v1-migration.js'),
    '--confirm-dev-db',
  ], { encoding: 'utf8', env: process.env });
  if (apply.status !== 0) {
    console.log(JSON.stringify({
      ok: false,
      error: 'MIGRATION_APPLY_FAILED',
      detail: String(apply.stdout || apply.stderr || '').slice(-800),
    }));
    process.exit(1);
  }

  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.log(JSON.stringify({ ok: false, error: 'NO_SERVICE_ROLE' }));
    process.exit(2);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const stamp = Date.now();
  const users = {};
  const snaps = {};
  const createdUserIds = [];
  const reportIds = [];
  let postSimple = null;
  let postOther = null;
  let postPenalty = null;
  let commentId = null;
  const out = {
    ok: false,
    marker: MARKER,
    flagDevelopment: resolveAlienModerationV1Enabled({ NODE_ENV: 'development' }),
    flagProductionDefault: resolveAlienModerationV1Enabled({ NODE_ENV: 'production' }),
  };

  const boardRepo = createBoardSupabaseRepository({ client: admin });
  const modRepo = createAlienModerationSupabaseRepository({ client: admin });
  const territories = {};
  const userContext = createMockUserContextAdapter({
    defaultTerritory: 'CENTRAL',
    territories: territories,
  });

  function onReportCreated(row) {
    return alienService.onReportCreated(row);
  }

  const board = createBoardService({
    repository: boardRepo,
    userContext: userContext,
    operational: true,
    onReportCreated: onReportCreated,
  });

  alienService.setRepository(modRepo);
  alienService.setBoardReportReader(boardRepo);
  alienService.setCitizenshipWriter(createAlienCitizenshipWriter(admin));
  alienService.setV1Enabled(true);
  popSupa.setAdminClient(admin);
  popSupa.invalidateEarthCountCache();
  popAdapter.setRepository(popSupa);
  popAdapter.setDataMode('API_OPERATIONAL');
  evoService.setDataMode('API_OPERATIONAL');

  let nowMs = Date.parse('2026-03-01T00:00:00.000Z');
  alienService.setNow(function () { return new Date(nowMs); });

  async function cleanup() {
    alienService.setNow(function () { return new Date(); });
    try {
      if (reportIds.length) {
        await admin.from('board_reports').delete().in('id', reportIds);
      }
      await admin.from('board_reports').delete().like('reason_detail', '%' + MARKER + '%');
      if (commentId) await admin.from('board_comments').delete().eq('id', commentId);
      const postIds = [postSimple, postOther, postPenalty].filter(Boolean);
      if (postIds.length) {
        await admin.from('board_posts').delete().in('id', postIds);
      }
      const ids = Object.keys(users).map(function (k) { return users[k].id; });
      if (ids.length) {
        await admin.from('user_moderation_notifications').delete().in('user_id', ids);
        await admin.from('user_moderation_events').delete().in('user_id', ids);
        await admin.from('user_moderation_state').delete().in('user_id', ids);
      }
      for (const k of Object.keys(snaps)) {
        await restoreProfile(admin, snaps[k]);
      }
      void createdUserIds;
    } catch (e) {
      out.cleanupError = String(e && e.message ? e.message : e).slice(0, 300);
    }
  }

  try {
    users.target = await ensureUser(admin, 'sc.alien.mod.verify.target@example.com', { sc_fixture: MARKER, role: 'target' });
    users.r1 = await ensureUser(admin, 'sc.alien.mod.verify.r1@example.com', { sc_fixture: MARKER });
    users.r2 = await ensureUser(admin, 'sc.alien.mod.verify.r2@example.com', { sc_fixture: MARKER });
    users.r3 = await ensureUser(admin, 'sc.alien.mod.verify.r3@example.com', { sc_fixture: MARKER });
    users.rOther = await ensureUser(admin, 'sc.alien.mod.verify.ro@example.com', { sc_fixture: MARKER });
    Object.keys(users).forEach(function (k) {
      if (users[k].created) createdUserIds.push(users[k].id);
    });

    for (const k of Object.keys(users)) {
      let snap = await snapshotProfile(admin, users[k].id);
      if (!snap) {
        await admin.from('profiles').upsert({
          id: users[k].id,
          display_name: MARKER,
          home_country: 'KR',
          citizenship_status: 'CITIZEN',
          territory: k === 'target' ? 'PIONEER' : 'CENTRAL',
          exile_strike_count: 0,
        });
        snap = await snapshotProfile(admin, users[k].id);
      }
      snaps[k] = snap;
      const territory = k === 'target' ? 'PIONEER' : 'CENTRAL';
      territories[users[k].id] = territory;
      await admin.from('profiles').update({
        territory: territory,
        citizenship_status: 'CITIZEN',
        exile_strike_count: 0,
      }).eq('id', users[k].id);
    }
    await admin.from('board_reports').delete().eq('target_author_user_id', users.target.id);
    await admin.from('user_moderation_notifications').delete().in('user_id', Object.keys(users).map(function (k) { return users[k].id; }));
    await admin.from('user_moderation_events').delete().in('user_id', Object.keys(users).map(function (k) { return users[k].id; }));
    await admin.from('user_moderation_state').delete().in('user_id', Object.keys(users).map(function (k) { return users[k].id; }));

    const pop0 = await evoService.getAllTerritoryEvolutions();
    out.popBefore = pop0.directCounts;

    const simplePost = await board.createPost({ userId: users.target.id }, {
      title: MARKER + ' simple target post title ok',
      content: MARKER + ' simple target post body for reports. long enough.',
      isAnonymous: false,
    });
    postSimple = simplePost.post.id;
    const otherPost = await board.createPost({ userId: users.target.id }, {
      title: MARKER + ' other target post title ok',
      content: MARKER + ' other target post body for admin immediate.',
      isAnonymous: false,
    });
    postOther = otherPost.post.id;
    const penaltyPost = await board.createPost({ userId: users.target.id }, {
      title: MARKER + ' penalty ladder post title ok',
      content: MARKER + ' penalty ladder body for later trips.',
      isAnonymous: false,
    });
    postPenalty = penaltyPost.post.id;
    const comment = await board.createComment({ userId: users.target.id }, postSimple, {
      content: MARKER + ' comment body for comment report.',
    });
    commentId = comment.comment.id;

    async function report(reporterId, targetType, targetId, reasonCode, detail) {
      const row = await board.createReport({ userId: reporterId }, {
        targetType: targetType,
        targetId: targetId,
        reasonCode: reasonCode,
        reasonDetail: detail || null,
      });
      if (row && row.id) reportIds.push(row.id);
      return row;
    }

    const r1 = await report(users.r1.id, 'POST', postSimple, 'abuse', null);
    out.simple1 = {
      status: r1.status,
      simpleCount: r1.moderation && r1.moderation.simpleCount,
      action: r1.moderation && r1.moderation.action,
      warningIssued: r1.moderation && r1.moderation.warningIssued,
    };
    const inbox1 = await alienService.listInbox(users.target.id);
    out.simple1.notification = inbox1.some(function (n) { return n.type === 'alien_warn'; });
    const st1 = await alienService.getFullModerationState(users.target.id);
    out.simple1.citizenship = st1.citizenshipStatus;

    let dupCode = null;
    try {
      await report(users.r1.id, 'POST', postSimple, 'abuse', null);
    } catch (e) { dupCode = e && e.code; }
    out.duplicate = dupCode;

    let selfCode = null;
    try {
      await report(users.target.id, 'POST', postSimple, 'abuse', null);
    } catch (e) { selfCode = e && e.code; }
    out.selfReport = selfCode;

    const rejected = await report(users.rOther.id, 'COMMENT', commentId, 'baiting', null);
    await board.reviewReport({ userId: users.r1.id }, rejected.id, { status: 'REJECTED', resolutionNote: MARKER });
    const afterReject = await alienService.onReportCreated(Object.assign({}, rejected, { status: 'REJECTED' }));
    out.rejected = {
      simpleCount: afterReject.simpleCount,
      action: afterReject.action,
      citizenship: (await alienService.getFullModerationState(users.target.id)).citizenshipStatus,
    };

    const r2 = await report(users.r2.id, 'POST', postSimple, 'spam', null);
    out.simple2 = {
      simpleCount: r2.moderation && r2.moderation.simpleCount,
      action: r2.moderation && r2.moderation.action,
      citizenship: (await alienService.getFullModerationState(users.target.id)).citizenshipStatus,
    };

    const otherAuto = await report(users.rOther.id, 'POST', postOther, 'other', MARKER + ' 운영자 판단 요청');
    out.otherAuto = {
      action: otherAuto.moderation && otherAuto.moderation.action,
      autoTransfer: otherAuto.moderation && otherAuto.moderation.autoTransfer,
      simpleCount: otherAuto.moderation && otherAuto.moderation.simpleCount,
      citizenship: (await alienService.getFullModerationState(users.target.id)).citizenshipStatus,
    };

    const r3 = await report(users.r3.id, 'POST', postSimple, 'misinfo', null);
    const st3 = await alienService.getFullModerationState(users.target.id);
    const prof3 = await snapshotProfile(admin, users.target.id);
    out.simple3 = {
      simpleCount: r3.moderation && r3.moderation.simpleCount,
      action: r3.moderation && r3.moderation.action,
      citizenship: st3.citizenshipStatus,
      profileCitizenship: prof3.citizenship_status,
      tripCount: st3.strikeCount,
      profileStrike: prof3.exile_strike_count,
      returnPolicy: st3.returnPolicy,
      enteredAt: st3.enteredAt,
      releaseEligibleAt: st3.releaseEligibleAt,
      earthTerritory: st3.earthTerritory,
      profileTerritory: prof3.territory,
    };
    const hist3 = await modRepo.listModerationEvents(users.target.id, { limit: 20 });
    out.simple3.history = (hist3.items || []).map(function (e) {
      return e.transferReason || e.eventType;
    });

    const replay = await alienService.onReportCreated({
      id: r3.id,
      targetAuthorUserId: users.target.id,
      reporterUserId: users.r3.id,
      reasonCode: 'misinfo',
      status: 'SUBMITTED',
    });
    const stReplay = await alienService.getFullModerationState(users.target.id);
    out.idempotentReplay = {
      duplicate: !!replay.duplicate || replay.alreadyAlien === true,
      tripCount: stReplay.strikeCount,
    };

    popSupa.invalidateEarthCountCache();
    const popAlien = await evoService.getAllTerritoryEvolutions();
    out.popDuringAlien = popAlien.directCounts;
    out.popAlienHud = popAlien.territories.ALIEN && popAlien.territories.ALIEN.population;
    out.popEarthPioneer = popAlien.directCounts.PIONEER;
    out.popCentralEvo = popAlien.territories.CENTRAL && popAlien.territories.CENTRAL.population;
    out.mock310 = out.popAlienHud === 310 && (out.popBefore.ALIEN !== 310);

    const tooSoon = await alienService.returnToEarth(users.target.id, {
      now: new Date(nowMs + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    out.returnTooSoon = { ok: tooSoon.ok, error: tooSoon.error };

    nowMs = nowMs + 8 * 24 * 60 * 60 * 1000;
    const returned = await alienService.returnToEarth(users.target.id);
    const stRet = await alienService.getFullModerationState(users.target.id);
    const profRet = await snapshotProfile(admin, users.target.id);
    out.returned = {
      ok: returned.ok,
      citizenship: stRet.citizenshipStatus,
      profileCitizenship: profRet.citizenship_status,
      tripCount: stRet.strikeCount,
      territory: profRet.territory,
      cycleStartAt: stRet.cycleStartAt,
    };

    const adminImmediate = await alienService.applyAdminReportAction(otherAuto, 'IMMEDIATE_ALIEN', 'admin-verify');
    const stImm = await alienService.getFullModerationState(users.target.id);
    out.adminImmediate = {
      ok: adminImmediate.ok,
      citizenship: stImm.citizenshipStatus,
      tripCount: stImm.strikeCount,
      returnPolicy: stImm.returnPolicy,
      durationDays: adminImmediate.durationDays,
      transferReason: adminImmediate.transferReason,
    };
    const histImm = await modRepo.listModerationEvents(users.target.id, { limit: 20 });
    out.adminImmediate.historyHasAdmin = (histImm.items || []).some(function (e) {
      return e.transferReason === 'ADMIN_IMMEDIATE_ALIEN';
    });

    nowMs = nowMs + 16 * 24 * 60 * 60 * 1000;
    await alienService.returnToEarth(users.target.id);
    const other2 = await report(users.r1.id, 'POST', postPenalty, 'other', MARKER + ' trip3');
    await alienService.applyAdminReportAction(other2, 'IMMEDIATE_ALIEN', 'admin-verify');
    const st30 = await alienService.getFullModerationState(users.target.id);
    out.trip3policy = { strike: st30.strikeCount, returnPolicy: st30.returnPolicy, durationDays: reportCore.resolveReturnPolicy(st30.strikeCount).durationDays };

    nowMs = nowMs + 31 * 24 * 60 * 60 * 1000;
    await alienService.returnToEarth(users.target.id);
    const other3 = await report(users.r2.id, 'POST', postPenalty, 'other', MARKER + ' trip4');
    await alienService.applyAdminReportAction(other3, 'IMMEDIATE_ALIEN', 'admin-verify');
    const st4 = await alienService.getFullModerationState(users.target.id);
    const pol4 = reportCore.resolveReturnPolicy(st4.strikeCount);
    out.trip4policy = {
      strike: st4.strikeCount,
      returnPolicy: st4.returnPolicy,
      adminReturnOnly: !!pol4.adminReturnOnly,
    };
    const seasonDenied = await alienService.returnToEarth(users.target.id);
    out.seasonEndDenied = { ok: seasonDenied.ok, error: seasonDenied.error };
    const seasonForced = await alienService.returnToEarth(users.target.id, { operatorForced: true });
    const stFinal = await alienService.getFullModerationState(users.target.id);
    const profFinal = await snapshotProfile(admin, users.target.id);
    out.seasonForced = {
      ok: seasonForced.ok,
      citizenship: stFinal.citizenshipStatus,
      territory: profFinal.territory,
      tripKept: stFinal.strikeCount,
    };

    popSupa.invalidateEarthCountCache();
    const popEnd = await evoService.getAllTerritoryEvolutions();
    out.popAfter = popEnd.directCounts;

    out.checks = {
      simple1warn: out.simple1.action === 'WARN' && out.simple1.simpleCount === 1 && out.simple1.notification === true && out.simple1.citizenship === 'CITIZEN',
      simple2earth: out.simple2.action === 'NONE' && out.simple2.simpleCount === 2 && out.simple2.citizenship === 'CITIZEN',
      simple3alien: out.simple3.action === 'TRANSFER' && out.simple3.citizenship === 'KANTAPBIYA_RESIDENT' && out.simple3.profileCitizenship === 'KANTAPBIYA_RESIDENT',
      trip1: out.simple3.tripCount === 1 && out.simple3.returnPolicy === 'DAYS',
      sevenDays: out.simple3.releaseEligibleAt && Date.parse(out.simple3.releaseEligibleAt) - Date.parse(out.simple3.enteredAt) === 7 * 24 * 60 * 60 * 1000,
      territoryKept: out.simple3.profileTerritory === 'PIONEER' && out.returned.territory === 'PIONEER',
      duplicateBlocked: out.duplicate === 'BOARD_REPORT_DUPLICATE',
      selfBlocked: out.selfReport === 'BOARD_REPORT_SELF_FORBIDDEN',
      rejectedExcluded: out.rejected.citizenship === 'CITIZEN' && out.rejected.action !== 'TRANSFER',
      otherNoAuto: out.otherAuto.action === 'ADMIN_REVIEW' && out.otherAuto.citizenship === 'CITIZEN',
      idempotent: out.idempotentReplay.tripCount === 1,
      returnDeniedThenOk: out.returnTooSoon.ok === false && out.returned.ok === true && out.returned.citizenship === 'CITIZEN',
      tripKeptAfterReturn: out.returned.tripCount === 1,
      adminImmediate: out.adminImmediate.ok && out.adminImmediate.tripCount === 2 && out.adminImmediate.durationDays === 15 && out.adminImmediate.historyHasAdmin,
      trip3_30: out.trip3policy.strike === 3 && out.trip3policy.durationDays === 30,
      trip4season: out.trip4policy.adminReturnOnly === true && out.seasonEndDenied.ok === false,
      earthAfter: out.seasonForced.citizenship === 'CITIZEN' && out.seasonForced.territory === 'PIONEER',
      hudNotMockWhenLive: out.popAlienHud !== 310 || out.popDuringAlien.ALIEN === 310,
      flagDevOn: out.flagDevelopment === true,
      flagProdOff: out.flagProductionDefault === false,
    };
    out.ok = Object.keys(out.checks).every(function (k) { return out.checks[k] === true; });
    out.failedChecks = Object.keys(out.checks).filter(function (k) { return !out.checks[k]; });

    if (argHas('--serve')) {
      const browserSimple = await board.createPost({ userId: users.target.id }, {
        title: MARKER + ' browser simple post title ok',
        content: MARKER + ' browser simple post body for live UI reports.',
        isAnonymous: false,
      });
      const browserOther = await board.createPost({ userId: users.target.id }, {
        title: MARKER + ' browser other post title ok',
        content: MARKER + ' browser other post body for admin immediate.',
        isAnonymous: false,
      });
      const browserComment = await board.createComment({ userId: users.target.id }, browserSimple.post.id, {
        content: MARKER + ' browser comment for report.',
      });
      postSimple = browserSimple.post.id;
      postOther = browserOther.post.id;
      commentId = browserComment.comment.id;
      alienService.setNow(function () { return new Date(); });
      const app = express();
      app.use(express.json());
      app.use('/api/board', createBoardRouter({
        useMemory: false,
        operational: true,
        userContext: userContext,
        onReportCreated: onReportCreated,
        resolveActorFromRequest: async function (req) {
          const h = String(req.headers.authorization || '');
          const m = h.match(/^Bearer\s+user:(.+)$/i);
          const userId = m ? m[1].trim() : (req.headers['x-user-id'] ? String(req.headers['x-user-id']) : '');
          if (!userId) return null;
          return { userId: userId, supabase: admin };
        },
      }));
      app.use('/api', alienRoutes);
      app.use('/api/admin/moderation', alienRoutes.mountAdminRoutes({
        adminBypass: true,
        getBoardService: function () { return board; },
      }));
      app.use('/api', evoRoutes);
      app.use(express.static(path.join(__dirname, '..', 'public')));
      app.get('/verify/alien-report.html', function (_req, res) {
        res.type('html').send(buildVerifyHtml({
          postSimple: postSimple,
          postOther: postOther,
          commentId: commentId,
          target: users.target.id,
          r1: users.r1.id,
          r2: users.r2.id,
          r3: users.r3.id,
          rOther: users.rOther.id,
        }));
      });
      await new Promise(function (resolve) {
        const server = app.listen(PORT, '127.0.0.1', function () {
          out.serve = { port: PORT, url: 'http://127.0.0.1:' + PORT + '/verify/alien-report.html' };
          console.log(JSON.stringify(out, null, 2));
          resolve();
        });
        const stop = async function () {
          server.close();
          await cleanup();
          process.exit(out.ok ? 0 : 1);
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
      });
      await new Promise(function () {});
      return;
    }

    await cleanup();
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 1);
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).slice(0, 500);
    out.code = e && e.code;
    await cleanup();
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
}

function buildVerifyHtml(ids) {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Alien moderation live verify</title></head><body>' +
    '<h1>외계 moderation 실DB 검증</h1>' +
    '<form id="report-form">' +
    '<label><input type="radio" name="reason" value="abuse" checked> 욕설 / 인신공격</label>' +
    '<label><input type="radio" name="reason" value="spam"> 도배 / 광고</label>' +
    '<label><input type="radio" name="reason" value="other"> 기타</label>' +
    '<textarea id="detail" maxlength="300"></textarea>' +
    '<button id="submit-report" type="submit">신고</button></form>' +
    '<button id="submit-r2" type="button">2번째 단순신고</button>' +
    '<button id="submit-r3" type="button">3번째 단순신고</button>' +
    '<button id="submit-comment" type="button">댓글 신고</button>' +
    '<button id="submit-other" type="button">기타신고</button>' +
    '<button id="admin-immediate" type="button">즉시 외계행</button>' +
    '<button id="try-return" type="button">복귀 시도</button>' +
    '<ul id="sc-notification-list"></ul>' +
    '<p id="sc-alien-status-banner" hidden data-citizenship="CITIZEN"></p>' +
    '<pre id="evo-hud"></pre><pre id="verify-log"></pre>' +
    '<script>window.__VERIFY=' + JSON.stringify(ids) + ';' +
    'function hdr(uid){return {"Content-Type":"application/json","Authorization":"Bearer user:"+uid};}' +
    'function log(m){var el=document.getElementById("verify-log");el.textContent+=(m+"\\n");}' +
    'function refreshStatus(){return fetch("/api/alien/moderation/status",{headers:hdr(window.__VERIFY.target)}).then(function(r){return r.json()}).then(function(d){var s=d.state||{};var b=document.getElementById("sc-alien-status-banner");b.hidden=s.citizenshipStatus!=="KANTAPBIYA_RESIDENT";b.textContent=(s.citizenshipStatus||"")+" "+(s.returnPolicy||"")+" trip "+(s.strikeCount||0);b.setAttribute("data-citizenship",s.citizenshipStatus||"");});}' +
    'function refreshInbox(){return fetch("/api/alien/moderation/inbox",{headers:hdr(window.__VERIFY.target)}).then(function(r){return r.json()}).then(function(d){(d.notifications||[]).forEach(function(n){var li=document.createElement("li");li.textContent=n.title||n.type;document.getElementById("sc-notification-list").appendChild(li);});});}' +
    'function postReport(uid,targetType,targetId,reason){return fetch("/api/board/reports",{method:"POST",headers:hdr(uid),body:JSON.stringify({targetType:targetType,targetId:targetId,reasonCode:reason,reasonDetail:reason==="other"?"운영자 판단":null})}).then(function(r){return r.json()}).then(function(d){log(JSON.stringify(d));return d;});}' +
    'document.getElementById("report-form").addEventListener("submit",function(e){e.preventDefault();var reason=document.querySelector("input[name=reason]:checked").value;postReport(window.__VERIFY.r1,"POST",window.__VERIFY.postSimple,reason).then(function(){return refreshInbox();}).then(refreshStatus);});' +
    'document.getElementById("submit-r2").addEventListener("click",function(){postReport(window.__VERIFY.r2,"POST",window.__VERIFY.postSimple,"spam").then(refreshStatus);});' +
    'document.getElementById("submit-r3").addEventListener("click",function(){postReport(window.__VERIFY.r3,"POST",window.__VERIFY.postSimple,"misinfo").then(refreshStatus);});' +
    'document.getElementById("submit-comment").addEventListener("click",function(){postReport(window.__VERIFY.r2,"COMMENT",window.__VERIFY.commentId,"abuse").then(refreshStatus);});' +
    'document.getElementById("submit-other").addEventListener("click",function(){postReport(window.__VERIFY.rOther,"POST",window.__VERIFY.postOther,"other").then(refreshStatus);});' +
    'document.getElementById("admin-immediate").addEventListener("click",function(){' +
    'fetch("/api/admin/moderation/reports?classification=OTHER",{headers:hdr("admin")}).then(function(r){return r.json()}).then(function(d){var row=(d.reports||[]).filter(function(x){return x.targetId===window.__VERIFY.postOther||x.postId===window.__VERIFY.postOther;})[0]||(d.reports||[])[0];if(!row){log("no other");return;}' +
    'return fetch("/api/admin/moderation/reports/"+row.id+"/action",{method:"POST",headers:hdr("admin"),body:JSON.stringify({action:"IMMEDIATE_ALIEN"})});}).then(function(r){return r&&r.json&&r.json()}).then(function(d){log("ADMIN "+JSON.stringify(d));return refreshStatus();});});' +
    'document.getElementById("try-return").addEventListener("click",function(){fetch("/api/alien/moderation/return",{method:"POST",headers:hdr(window.__VERIFY.target)}).then(function(r){return r.json()}).then(function(d){log("RETURN "+JSON.stringify(d));});});' +
    'fetch("/api/territories/evolution").then(function(r){return r.json()}).then(function(d){document.getElementById("evo-hud").textContent=JSON.stringify({directCounts:d.data&&d.data.directCounts,alienPop:d.data&&d.data.territories&&d.data.territories.ALIEN&&d.data.territories.ALIEN.population,alienStage:d.data&&d.data.territories&&d.data.territories.ALIEN&&d.data.territories.ALIEN.currentStageLabel,nextRequired:d.data&&d.data.territories&&d.data.territories.ALIEN&&d.data.territories.ALIEN.nextStage&&d.data.territories.ALIEN.nextStage.requiredPopulation},null,2);});' +
    'refreshStatus();' +
    '</script></body></html>';
}

main();
