#!/usr/bin/env node
/**
 * Offline bidirectional political-alignment simulation.
 * Does not read/write live DB, scheduler, territory, env, or tracked production files.
 * Does not modify the five protected gradual-sim files.
 *
 * node tools/run-bidirectional-alignment-simulation.js --quick
 * node tools/run-bidirectional-alignment-simulation.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../shared/political-alignment-bidirectional-sim-core');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.cache', 'bidirectional-alignment-sim');

function parseArg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.find(function (a) {
    return a.indexOf(prefix) === 0;
  });
  if (!hit) return fallback;
  return hit.slice(prefix.length);
}

function hasFlag(name) {
  return process.argv.indexOf('--' + name) >= 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function rollAction(rng, probs) {
  const x = rng();
  if (x < probs.LIKE) return 'LIKE';
  if (x < probs.LIKE + probs.DISLIKE) return 'DISLIKE';
  return 'NONE';
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  let i;
  for (i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function seoulIso(dayIndex) {
  const start = Date.parse('2026-01-08T17:00:00+09:00');
  return new Date(start + dayIndex * 86400000).toISOString();
}

function stayIsoBeforeStart() {
  return new Date(Date.parse('2026-01-01T17:00:00+09:00')).toISOString();
}

const ACTUALS = ['PIONEER', 'CENTRAL', 'GUARDIAN'];
const STARTS = ['PIONEER', 'CENTRAL', 'GUARDIAN'];
const INTENSITIES = ['weak', 'mid', 'strong'];
const ACTIVITIES = ['low', 'mid', 'high'];

function makeUsers(rng, perCell) {
  const users = [];
  let id = 0;
  let a;
  let s;
  let iv;
  let act;
  for (a = 0; a < ACTUALS.length; a++) {
    for (s = 0; s < STARTS.length; s++) {
      for (iv = 0; iv < INTENSITIES.length; iv++) {
        for (act = 0; act < ACTIVITIES.length; act++) {
          let n;
          for (n = 0; n < perCell; n++) {
            const actual = ACTUALS[a];
            const start = STARTS[s];
            const intensity = INTENSITIES[iv];
            const activity = ACTIVITIES[act];
            const writer = activity !== 'low' && (intensity === 'strong' || rng() < 0.35);
            users.push({
              id: 'u' + id,
              actual: actual,
              startTerritory: start,
              territory: start,
              score: core.startScoreForTerritory(start),
              previousSignal: 0,
              pendingTerritory: null,
              pendingCount: 0,
              pendingStartedAt: null,
              lastTerritoryChangedAt: stayIsoBeforeStart(),
              intensity: intensity,
              activity: activity,
              writer: writer,
              dailySeries: [],
              moveHistory: [],
              moveCount: 0,
              lastMoveDay: null,
              judgedDay: null,
              movedToActualDay: null,
              reachedCentralDay: null,
              dailyCapHits: 0,
              pairCapHits: 0,
              reactorCapHits: 0,
              likeCount: 0,
              dislikeCount: 0,
              sameExpectedLike: 0,
              crossExpectedDislike: 0,
              reactionCount: 0,
              authorRecvAbs: 0,
              actorSelfAbs: 0,
              wrotePosts: 0,
              receivedReactions: 0,
              flippedAt: null,
              selfDirection: null,
              selfDirectionStreak: 0,
              selfDirectionLastDate: null,
              daySelfSigned: [],
            });
            id += 1;
          }
        }
      }
    }
  }
  return users;
}

function cloneUsers(users) {
  return users.map(function (u) {
    const c = Object.assign({}, u);
    c.dailySeries = [];
    c.moveHistory = [];
    c.score = core.startScoreForTerritory(u.startTerritory);
    c.territory = u.startTerritory;
    c.previousSignal = 0;
    c.pendingTerritory = null;
    c.pendingCount = 0;
    c.pendingStartedAt = null;
    c.lastTerritoryChangedAt = stayIsoBeforeStart();
    c.judgedDay = null;
    c.movedToActualDay = null;
    c.reachedCentralDay = null;
    c.dailyCapHits = 0;
    c.pairCapHits = 0;
    c.reactorCapHits = 0;
    c.likeCount = 0;
    c.dislikeCount = 0;
    c.sameExpectedLike = 0;
    c.crossExpectedDislike = 0;
    c.reactionCount = 0;
    c.authorRecvAbs = 0;
    c.actorSelfAbs = 0;
    c.wrotePosts = 0;
    c.receivedReactions = 0;
    c.flippedAt = null;
    c.lastRawDelta = 0;
    c.lastCappedDelta = 0;
    c.selfDirection = null;
    c.selfDirectionStreak = 0;
    c.selfDirectionLastDate = null;
    c.daySelfSigned = [];
    return c;
  });
}

function seedPosts(users, rng, count) {
  const posts = [];
  const writers = users.filter(function (u) {
    return u.writer;
  });
  const pool = writers.length ? writers : users;
  let i;
  for (i = 0; i < count; i++) {
    const author = pool[i % pool.length];
    let lean = author.actual;
    if (rng() < 0.08) lean = pick(rng, ACTUALS);
    posts.push({ id: 'p' + i, authorId: author.id, lean: lean, alive: true });
    author.wrotePosts += 1;
  }
  return posts;
}

function userById(users) {
  const map = {};
  let i;
  for (i = 0; i < users.length; i++) map[users[i].id] = users[i];
  return map;
}

function applyOneReaction(opts) {
  const model = opts.model;
  const ctx = opts.ctx;
  const day = opts.day;
  const actor = opts.actor;
  const author = opts.author;
  const isLike = opts.isLike;
  if (!actor || !author || actor.id === author.id) return;
  if (author.territory === 'ALIEN' || actor.territory === 'ALIEN') return;

  const input = {
    isLike: isLike,
    reactorTerritory: actor.territory,
    authorTerritory: author.territory,
    authorScore: author.score,
    reactorScore: actor.score,
    selfReaction: false,
  };

  let authorSigned = 0;
  let actorSigned = 0;
  let absAuthorMag = 0;

  if (model.mode === 'LEGACY_PRODUCTION') {
    const pack = core.computeLegacyProductionPair(input);
    authorSigned = pack.authorRecv.signed;
    actorSigned = pack.actorSelf.signed;
    absAuthorMag = Math.abs(authorSigned);
  } else if (model.mode === 'PRODUCTION') {
    const pack = core.computeProductionPair(input);
    authorSigned = pack.authorRecv.signed;
    actorSigned = pack.actorSelf.signed;
    absAuthorMag = Math.abs(authorSigned);
    if (model.accel) {
      if (!Array.isArray(actor.daySelfSigned)) actor.daySelfSigned = [];
      if (actorSigned) actor.daySelfSigned.push(actorSigned);
      const acc = core.betaV1.applyActorSelfAcceleration(actorSigned, {
        streakDays: actor.selfDirectionStreak || 0,
        currentTerritory: actor.territory,
        score: actor.score,
      });
      actorSigned = acc.signed;
    }
  } else {
    const authorPack = core.computeNewAuthorSigned(input, model.weights);
    authorSigned = authorPack.signed;
    absAuthorMag = authorPack.absMagRatio * core.BASE_UNIT;
    if (model.reactorShare > 0) {
      const rp = core.computeNewReactorSigned(input, authorPack, model.reactorShare, model.centralDislikeMode || 'ZERO');
      actorSigned = rp.signed;
    }
  }

  if (model.reactorDailyCap != null && actorSigned) {
    const rKey = actor.id + '#r@' + day;
    const prior = ctx.reactorDaily[rKey] || 0;
    const capped = core.betaV1.applySignedDailyCap(prior, actorSigned, model.reactorDailyCap);
    if (capped.capHit) actor.reactorCapHits += 1;
    ctx.reactorDaily[rKey] = capped.nextSum;
    actorSigned = capped.stored;
  }

  const authorCap = core.applyCaps(ctx, author.id, actor.id, day, authorSigned, model.communityDailyCap, core.LIVE.pair7dCap);
  const actorCap = core.applyCaps(ctx, actor.id, author.id, day, actorSigned, model.communityDailyCap, core.LIVE.pair7dCap);
  if (authorCap.dailyHit || actorCap.dailyHit) {
    if (authorCap.dailyHit) author.dailyCapHits += 1;
    if (actorCap.dailyHit) actor.dailyCapHits += 1;
  }
  if (authorCap.pairHit) author.pairCapHits += 1;
  if (actorCap.pairHit) actor.pairCapHits += 1;

  author.dailySeries[day] = (author.dailySeries[day] || 0) + authorCap.stored;
  actor.dailySeries[day] = (actor.dailySeries[day] || 0) + actorCap.stored;
  author.authorRecvAbs += Math.abs(authorCap.stored);
  actor.actorSelfAbs += Math.abs(actorCap.stored);
  author.receivedReactions += 1;
  actor.reactionCount += 1;
  if (isLike) actor.likeCount += 1;
  else actor.dislikeCount += 1;

  if (isLike && actor.territory === author.territory) actor.sameExpectedLike += 1;
  if (!isLike && actor.territory !== author.territory && actor.territory !== 'CENTRAL' && author.territory !== 'CENTRAL') {
    actor.crossExpectedDislike += 1;
  }
  return absAuthorMag;
}

function simulateWorld(baseUsers, model, rng, days, extra) {
  const users = cloneUsers(baseUsers);
  const byId = userById(users);
  const posts = seedPosts(users, rng, Math.max(40, Math.floor(users.length * 0.25)));
  const ctx = { pair: {}, daily: {}, reactorDaily: {} };
  const checkpoints = extra && extra.checkpoints ? extra.checkpoints : [1, 3, 7, 14, 30, 60, 99, 120, 180];
  const snap = {};
  const behaviorShiftDay = extra && extra.behaviorShiftDay != null ? extra.behaviorShiftDay : null;
  const terror = extra && extra.terror ? extra.terror : null;

  let day;
  for (day = 0; day < days; day++) {
    const iso = seoulIso(day);
    let i;
    for (i = 0; i < users.length; i++) {
      users[i].dayIso = iso;
      if (users[i].dailySeries[day] == null) users[i].dailySeries[day] = 0;
    }

    if (behaviorShiftDay != null && day === behaviorShiftDay) {
      for (i = 0; i < users.length; i++) {
        if (users[i].flipTo) {
          users[i].actual = users[i].flipTo;
          users[i].flippedAt = day;
        }
      }
    }

    for (i = 0; i < users.length; i++) {
      const u = users[i];
      if (!u.writer) continue;
      if (rng() < (u.intensity === 'strong' ? 0.45 : u.activity === 'high' ? 0.28 : 0.12)) {
        let lean = u.actual;
        if (rng() < 0.08) lean = pick(rng, ACTUALS);
        posts.push({ id: 'p' + posts.length, authorId: u.id, lean: lean, alive: true });
        u.wrotePosts += 1;
      }
    }

    const livePosts = posts.filter(function (p) {
      return p.alive && byId[p.authorId];
    });

    if (terror && terror.nAttackers) {
      const victim = byId[terror.victimId];
      const attackers = terror.attackerIds.map(function (id) {
        return byId[id];
      });
      let t;
      for (t = 0; t < attackers.length; t++) {
        if (!victim || !attackers[t]) continue;
        applyOneReaction({
          model: model,
          ctx: ctx,
          day: day,
          actor: attackers[t],
          author: victim,
          isLike: false,
        });
      }
      if (terror.victimKeepsNormal) {
        const friends = terror.friendIds || [];
        let f;
        for (f = 0; f < friends.length; f++) {
          const fr = byId[friends[f]];
          if (!fr) continue;
          applyOneReaction({
            model: model,
            ctx: ctx,
            day: day,
            actor: fr,
            author: victim,
            isLike: true,
          });
        }
      }
    } else {
      for (i = 0; i < users.length; i++) {
        const actor = users[i];
        const n = core.activityCount(actor.activity);
        let k;
        for (k = 0; k < n; k++) {
          if (!livePosts.length) break;
          const post = livePosts[Math.floor(rng() * livePosts.length)];
          const author = byId[post.authorId];
          if (!author || author.id === actor.id) continue;
          const probs = core.reactionProbs(actor.actual, actor.intensity, post.lean);
          const action = rollAction(rng, probs);
          if (action === 'NONE') continue;
          applyOneReaction({
            model: model,
            ctx: ctx,
            day: day,
            actor: actor,
            author: author,
            isLike: action === 'LIKE',
          });
        }
      }
    }

    for (i = 0; i < users.length; i++) {
      const u = users[i];
      if (model.accel) {
        const next = core.betaV1.applyCompletedSelfDirectionDay(
          {
            direction: u.selfDirection,
            streak: u.selfDirectionStreak,
            lastDate: u.selfDirectionLastDate,
          },
          'd' + day,
          u.daySelfSigned || []
        );
        u.selfDirection = next.direction;
        u.selfDirectionStreak = next.streak;
        u.selfDirectionLastDate = next.lastDate;
        u.daySelfSigned = [];
      }
      const ev = core.applyDayScoreAndTerritory(u, u.dailySeries[day] || 0, day, model.batchCap);
      if (model.accel && ev && ev.resetSelfDirectionStreak) {
        u.selfDirection = null;
        u.selfDirectionStreak = 0;
      }
      if (u.judgedDay == null && core.judgedBand(u.score) === u.actual) u.judgedDay = day + 1;
      if (u.reachedCentralDay == null && u.territory === 'CENTRAL' && u.startTerritory !== 'CENTRAL') {
        u.reachedCentralDay = day + 1;
      }
      if (u.movedToActualDay == null && u.territory === u.actual) u.movedToActualDay = day + 1;
    }

    if (checkpoints.indexOf(day + 1) >= 0) {
      snap[day + 1] = summarizeUsers(users, day + 1);
    }
  }

  return { users: users, snapshots: snap, posts: posts.length };
}

function groupKey(u) {
  return u.actual + '/' + u.startTerritory;
}

function summarizeUsers(users, horizon) {
  let correctTerr = 0;
  let correctJudge = 0;
  let wrongOpposite = 0;
  let centralStuck = 0;
  let extremeOver = 0;
  let matchN = 0;
  let matchStay = 0;
  const byGroup = {};
  const failReasons = {};
  let i;
  for (i = 0; i < users.length; i++) {
    const u = users[i];
    const judged = core.judgedBand(u.score);
    if (u.startTerritory === u.actual) {
      matchN += 1;
      if (u.territory === u.actual) matchStay += 1;
    }
    if (u.territory === u.actual) correctTerr += 1;
    if (judged === u.actual) correctJudge += 1;
    if (u.actual !== 'CENTRAL' && u.territory !== 'CENTRAL' && u.territory !== u.actual) wrongOpposite += 1;
    if (u.actual !== 'CENTRAL' && u.territory === 'CENTRAL') centralStuck += 1;
    if (u.actual === 'CENTRAL' && u.territory !== 'CENTRAL') extremeOver += 1;
    const gk = groupKey(u);
    if (!byGroup[gk]) byGroup[gk] = { n: 0, moved: 0, judged: 0, high: { n: 0, movedDays: [], judgedDays: [], moved30: 0, moved60: 0, moved99: 0, fail: 0 } };
    const g = byGroup[gk];
    g.n += 1;
    if (u.territory === u.actual) g.moved += 1;
    if (judged === u.actual) g.judged += 1;
    if (u.activity === 'high' && u.startTerritory !== u.actual) {
      g.high.n += 1;
      if (u.movedToActualDay != null) {
        g.high.movedDays.push(u.movedToActualDay);
        if (u.movedToActualDay <= 30) g.high.moved30 += 1;
        if (u.movedToActualDay <= 60) g.high.moved60 += 1;
        if (u.movedToActualDay <= 99) g.high.moved99 += 1;
      } else {
        g.high.fail += 1;
      }
      if (u.judgedDay != null) g.high.judgedDays.push(u.judgedDay);
    }
    if (horizon >= 99 && u.territory !== u.actual) {
      const rs = core.classifyFailure(u, horizon);
      let r;
      for (r = 0; r < rs.length; r++) failReasons[rs[r]] = (failReasons[rs[r]] || 0) + 1;
    }
  }
  return {
    horizon: horizon,
    n: users.length,
    territoryAccuracy: pct(correctTerr, users.length),
    matchStayPct: pct(matchStay, matchN),
    judgeAccuracy: pct(correctJudge, users.length),
    wrongOppositePct: pct(wrongOpposite, users.length),
    centralStuckPct: pct(centralStuck, users.length),
    centralOverMovePct: pct(extremeOver, users.length),
    byGroup: byGroup,
    failReasons: failReasons,
  };
}

function collapseHigh(g) {
  if (!g || !g.high) return null;
  const md = g.high.movedDays.slice().sort(function (a, b) { return a - b; });
  const jd = g.high.judgedDays.slice().sort(function (a, b) { return a - b; });
  return {
    n: g.high.n,
    judgedMedian: median(jd),
    judgedP90: percentile(jd, 90),
    moveMedian: median(md),
    moveMean: md.length ? Math.round(mean(md) * 10) / 10 : null,
    moveP75: percentile(md, 75),
    moveP90: percentile(md, 90),
    moveP95: percentile(md, 95),
    success30: pct(g.high.moved30, g.high.n),
    success60: pct(g.high.moved60, g.high.n),
    success99: pct(g.high.moved99, g.high.n),
    fail: pct(g.high.fail, g.high.n),
  };
}

function mergeNums(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  return a;
}

function avg(arr) {
  const nums = arr.filter(function (x) { return x != null && isFinite(x); });
  if (!nums.length) return null;
  return Math.round(mean(nums) * 10) / 10;
}

const MODELS = [
  { id: 'MODEL_A', mode: 'LEGACY_PRODUCTION', reactorShare: 1, accel: false, label: '현재 Production 80/120 반응자100%' },
  { id: 'MODEL_B', mode: 'PRODUCTION', reactorShare: 0.25, accel: false, label: '0.7/1.0/1.3 반응자25% 가속없음' },
  { id: 'MODEL_C', mode: 'PRODUCTION', reactorShare: 0.25, accel: true, label: '0.7/1.0/1.3 반응자25% + 가속' },
];

function attachCaps(model, communityDailyCap, reactorDailyCap, batchCap) {
  const m = Object.assign({}, model);
  m.communityDailyCap = communityDailyCap == null ? core.LIVE.communityDailyCap : communityDailyCap;
  if (reactorDailyCap != null) m.reactorDailyCap = reactorDailyCap;
  else if (m.mode === 'PRODUCTION') m.reactorDailyCap = 60;
  else m.reactorDailyCap = reactorDailyCap;
  m.batchCap = batchCap == null ? core.LIVE.batchCap : batchCap;
  return m;
}

function runTerror(model, nAttackers, days, victimKeepsNormal, rng) {
  const users = [];
  const victim = {
    id: 'victim',
    actual: 'PIONEER',
    startTerritory: 'PIONEER',
    territory: 'PIONEER',
    score: 420,
    previousSignal: 0,
    pendingTerritory: null,
    pendingCount: 0,
    pendingStartedAt: null,
    lastTerritoryChangedAt: stayIsoBeforeStart(),
    intensity: 'strong',
    activity: 'high',
    writer: true,
    dailySeries: [],
    moveHistory: [],
    moveCount: 0,
    lastMoveDay: null,
    judgedDay: null,
    movedToActualDay: 0,
    reachedCentralDay: null,
    dailyCapHits: 0,
    pairCapHits: 0,
    reactorCapHits: 0,
    likeCount: 0,
    dislikeCount: 0,
    sameExpectedLike: 0,
    crossExpectedDislike: 0,
    reactionCount: 0,
    authorRecvAbs: 0,
    actorSelfAbs: 0,
    wrotePosts: 1,
    receivedReactions: 0,
    flippedAt: null,
  };
  users.push(victim);
  const attackerIds = [];
  const friendIds = [];
  let i;
  for (i = 0; i < nAttackers; i++) {
    const id = 'atk' + i;
    attackerIds.push(id);
    users.push({
      id: id,
      actual: 'GUARDIAN',
      startTerritory: 'GUARDIAN',
      territory: 'GUARDIAN',
      score: -420,
      previousSignal: 0,
      pendingTerritory: null,
      pendingCount: 0,
      pendingStartedAt: null,
      lastTerritoryChangedAt: stayIsoBeforeStart(),
      intensity: 'strong',
      activity: 'high',
      writer: false,
      dailySeries: [],
      moveHistory: [],
      moveCount: 0,
      lastMoveDay: null,
      judgedDay: null,
      movedToActualDay: 0,
      reachedCentralDay: null,
      dailyCapHits: 0,
      pairCapHits: 0,
      reactorCapHits: 0,
      likeCount: 0,
      dislikeCount: 0,
      sameExpectedLike: 0,
      crossExpectedDislike: 0,
      reactionCount: 0,
      authorRecvAbs: 0,
      actorSelfAbs: 0,
      wrotePosts: 0,
      receivedReactions: 0,
      flippedAt: null,
    });
  }
  if (victimKeepsNormal) {
    for (i = 0; i < 12; i++) {
      const id = 'fr' + i;
      friendIds.push(id);
      users.push({
        id: id,
        actual: 'PIONEER',
        startTerritory: 'PIONEER',
        territory: 'PIONEER',
        score: 420,
        previousSignal: 0,
        pendingTerritory: null,
        pendingCount: 0,
        pendingStartedAt: null,
        lastTerritoryChangedAt: stayIsoBeforeStart(),
        intensity: 'mid',
        activity: 'mid',
        writer: false,
        dailySeries: [],
        moveHistory: [],
        moveCount: 0,
        lastMoveDay: null,
        judgedDay: null,
        movedToActualDay: 0,
        reachedCentralDay: null,
        dailyCapHits: 0,
        pairCapHits: 0,
        reactorCapHits: 0,
        likeCount: 0,
        dislikeCount: 0,
        sameExpectedLike: 0,
        crossExpectedDislike: 0,
        reactionCount: 0,
        authorRecvAbs: 0,
        actorSelfAbs: 0,
        wrotePosts: 0,
        receivedReactions: 0,
        flippedAt: null,
      });
    }
  }
  const world = simulateWorld(users, attachCaps(model), rng, days, {
    checkpoints: [1, 7, 30],
    terror: {
      nAttackers: nAttackers,
      victimId: 'victim',
      attackerIds: attackerIds,
      friendIds: friendIds,
      victimKeepsNormal: !!victimKeepsNormal,
    },
  });
  const v = world.users[0];
  const atk = world.users.filter(function (u) { return u.id.indexOf('atk') === 0; });
  const atkMean = mean(atk.map(function (u) { return u.score; }));
  return {
    n: nAttackers,
    days: days,
    victimStart: 420,
    victimScore: Math.round(v.score * 10) / 10,
    victimDelta: Math.round((v.score - 420) * 10) / 10,
    victimTerritory: v.territory,
    victimDailyCapHits: v.dailyCapHits,
    attackerMeanScore: Math.round(atkMean * 10) / 10,
    attackerDelta: Math.round((atkMean + 420) * 10) / 10,
    withNormalSupport: !!victimKeepsNormal,
  };
}

function runCrossLike(model, days, rng) {
  const users = [];
  users.push({
    id: 'author',
    actual: 'PIONEER',
    startTerritory: 'PIONEER',
    territory: 'PIONEER',
    score: 420,
    previousSignal: 0,
    pendingTerritory: null,
    pendingCount: 0,
    pendingStartedAt: null,
    lastTerritoryChangedAt: stayIsoBeforeStart(),
    intensity: 'mid',
    activity: 'mid',
    writer: true,
    dailySeries: [],
    moveHistory: [],
    moveCount: 0,
    lastMoveDay: null,
    judgedDay: null,
    movedToActualDay: 0,
    reachedCentralDay: null,
    dailyCapHits: 0,
    pairCapHits: 0,
    reactorCapHits: 0,
    likeCount: 0,
    dislikeCount: 0,
    sameExpectedLike: 0,
    crossExpectedDislike: 0,
    reactionCount: 0,
    authorRecvAbs: 0,
    actorSelfAbs: 0,
    wrotePosts: 1,
    receivedReactions: 0,
    flippedAt: null,
  });
  let i;
  for (i = 0; i < 20; i++) {
    users.push({
      id: 'g' + i,
      actual: 'GUARDIAN',
      startTerritory: 'GUARDIAN',
      territory: 'GUARDIAN',
      score: -420,
      previousSignal: 0,
      pendingTerritory: null,
      pendingCount: 0,
      pendingStartedAt: null,
      lastTerritoryChangedAt: stayIsoBeforeStart(),
      intensity: 'mid',
      activity: 'mid',
      writer: false,
      dailySeries: [],
      moveHistory: [],
      moveCount: 0,
      lastMoveDay: null,
      judgedDay: null,
      movedToActualDay: 0,
      reachedCentralDay: null,
      dailyCapHits: 0,
      pairCapHits: 0,
      reactorCapHits: 0,
      likeCount: 0,
      dislikeCount: 0,
      sameExpectedLike: 0,
      crossExpectedDislike: 0,
      reactionCount: 0,
      authorRecvAbs: 0,
      actorSelfAbs: 0,
      wrotePosts: 0,
      receivedReactions: 0,
      flippedAt: null,
    });
  }
  const world = simulateWorld(users, attachCaps(model), rng, days, {
    checkpoints: [7, 14, 30, 60, 99],
    terror: {
      nAttackers: 20,
      victimId: 'author',
      attackerIds: users.slice(1).map(function (u) { return u.id; }),
      friendIds: [],
      victimKeepsNormal: false,
      likeNotDislike: true,
    },
  });
  return world;
}

function runSameFactionDislike(model, nAttackers, days, rng) {
  const users = [];
  users.push(makeBare('victim', 'PIONEER', 'PIONEER', 'strong', 'high', true));
  const attackerIds = [];
  let i;
  for (i = 0; i < nAttackers; i++) {
    const id = 'atk' + i;
    attackerIds.push(id);
    users.push(makeBare(id, 'PIONEER', 'PIONEER', 'strong', 'high', false));
  }
  const cloned = cloneUsers(users);
  const byId = userById(cloned);
  const ctx = { pair: {}, daily: {}, reactorDaily: {} };
  const mdl = attachCaps(model);
  let day;
  for (day = 0; day < days; day++) {
    const iso = seoulIso(day);
    for (i = 0; i < cloned.length; i++) {
      cloned[i].dayIso = iso;
      if (cloned[i].dailySeries[day] == null) cloned[i].dailySeries[day] = 0;
    }
    for (i = 0; i < attackerIds.length; i++) {
      applyOneReaction({
        model: mdl,
        ctx: ctx,
        day: day,
        actor: byId[attackerIds[i]],
        author: byId.victim,
        isLike: false,
      });
    }
    for (i = 0; i < cloned.length; i++) {
      core.applyDayScoreAndTerritory(cloned[i], cloned[i].dailySeries[day] || 0, day, mdl.batchCap);
    }
  }
  const v = byId.victim;
  return {
    n: nAttackers,
    days: days,
    victimScore: Math.round(v.score * 10) / 10,
    victimDelta: Math.round((v.score - 420) * 10) / 10,
    victimTerritory: v.territory,
    dailyCapHits: v.dailyCapHits,
  };
}

function applyLikesInstead(model, n, days, rng) {
  const users = [];
  const author = Object.assign({}, makeBare('author', 'PIONEER', 'PIONEER', 'mid', 'mid', true));
  users.push(author);
  const ids = [];
  let i;
  for (i = 0; i < n; i++) {
    const id = 'g' + i;
    ids.push(id);
    users.push(makeBare(id, 'GUARDIAN', 'GUARDIAN', 'mid', 'mid', false));
  }
  const cloned = cloneUsers(users);
  const byId = userById(cloned);
  const ctx = { pair: {}, daily: {}, reactorDaily: {} };
  let day;
  for (day = 0; day < days; day++) {
    const iso = seoulIso(day);
    for (i = 0; i < cloned.length; i++) {
      cloned[i].dayIso = iso;
      if (cloned[i].dailySeries[day] == null) cloned[i].dailySeries[day] = 0;
    }
    for (i = 0; i < ids.length; i++) {
      applyOneReaction({
        model: attachCaps(model),
        ctx: ctx,
        day: day,
        actor: byId[ids[i]],
        author: byId.author,
        isLike: true,
      });
    }
    for (i = 0; i < cloned.length; i++) {
      core.applyDayScoreAndTerritory(cloned[i], cloned[i].dailySeries[day] || 0, day, model.batchCap || core.LIVE.batchCap);
    }
  }
  const reactors = cloned.filter(function (u) { return u.id !== 'author'; });
  return {
    authorScore: Math.round(cloned[0].score * 10) / 10,
    authorDelta: Math.round((cloned[0].score - 420) * 10) / 10,
    authorTerritory: cloned[0].territory,
    reactorMean: Math.round(mean(reactors.map(function (u) { return u.score; })) * 10) / 10,
    reactorDelta: Math.round((mean(reactors.map(function (u) { return u.score; })) + 420) * 10) / 10,
  };
}

function makeBare(id, actual, start, intensity, activity, writer) {
  return {
    id: id,
    actual: actual,
    startTerritory: start,
    territory: start,
    score: core.startScoreForTerritory(start),
    previousSignal: 0,
    pendingTerritory: null,
    pendingCount: 0,
    pendingStartedAt: null,
    lastTerritoryChangedAt: stayIsoBeforeStart(),
    intensity: intensity,
    activity: activity,
    writer: writer,
    dailySeries: [],
    moveHistory: [],
    moveCount: 0,
    lastMoveDay: null,
    judgedDay: null,
    movedToActualDay: start === actual ? 0 : null,
    reachedCentralDay: null,
    dailyCapHits: 0,
    pairCapHits: 0,
    reactorCapHits: 0,
    likeCount: 0,
    dislikeCount: 0,
    sameExpectedLike: 0,
    crossExpectedDislike: 0,
    reactionCount: 0,
    authorRecvAbs: 0,
    actorSelfAbs: 0,
    wrotePosts: writer ? 1 : 0,
    receivedReactions: 0,
    flippedAt: null,
    selfDirection: null,
    selfDirectionStreak: 0,
    selfDirectionLastDate: null,
    daySelfSigned: [],
  };
}

function main() {
  const quick = hasFlag('quick');
  const perCell = Number(parseArg('perCell', quick ? 2 : 8));
  const days = Number(parseArg('days', quick ? 99 : 180));
  const seedList = String(parseArg('seeds', quick ? '101,202,303' : '101,202,303,404,505,606,707,808,909,1010,1111,1212'))
    .split(',')
    .map(function (s) { return Number(s.trim()); })
    .filter(function (n) { return isFinite(n); });
  const phase2 = !quick;

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const templateRng = mulberry32(99991);
  const templateUsers = makeUsers(templateRng, perCell);

  const modelReports = [];
  let mi;
  for (mi = 0; mi < MODELS.length; mi++) {
    const model = attachCaps(MODELS[mi]);
    const acc = [];
    const stay = [];
    const judge = [];
    const opposite = [];
    const stuck = [];
    const over = [];
    const byHorizon = { 30: [], 60: [], 99: [], 180: [] };
    const groupHigh = {};
    const failMix = {};
    let si;
    for (si = 0; si < seedList.length; si++) {
      const rng = mulberry32(seedList[si] * 17 + mi * 31);
      const world = simulateWorld(templateUsers, model, rng, days, {});
      const lastH = days;
      const sLast = world.snapshots[lastH] || summarizeUsers(world.users, lastH);
      acc.push(sLast.territoryAccuracy);
      stay.push(sLast.matchStayPct);
      judge.push(sLast.judgeAccuracy);
      opposite.push(sLast.wrongOppositePct);
      stuck.push(sLast.centralStuckPct);
      over.push(sLast.centralOverMovePct);
      [30, 60, 99, 180].forEach(function (h) {
        if (world.snapshots[h]) byHorizon[h].push(world.snapshots[h].territoryAccuracy);
      });
      Object.keys(sLast.byGroup).forEach(function (gk) {
        if (!groupHigh[gk]) groupHigh[gk] = [];
        groupHigh[gk].push(collapseHigh(sLast.byGroup[gk]));
      });
      const fr = (world.snapshots[99] || sLast).failReasons || {};
      Object.keys(fr).forEach(function (k) {
        failMix[k] = (failMix[k] || 0) + fr[k];
      });
      process.stdout.write('.');
    }
    const highOut = {};
    Object.keys(groupHigh).forEach(function (gk) {
      const rows = groupHigh[gk].filter(Boolean);
      highOut[gk] = {
        judgedMedian: avg(rows.map(function (r) { return r.judgedMedian; })),
        moveMedian: avg(rows.map(function (r) { return r.moveMedian; })),
        moveP90: avg(rows.map(function (r) { return r.moveP90; })),
        success30: avg(rows.map(function (r) { return r.success30; })),
        success60: avg(rows.map(function (r) { return r.success60; })),
        success99: avg(rows.map(function (r) { return r.success99; })),
        fail: avg(rows.map(function (r) { return r.fail; })),
      };
    });
    modelReports.push({
      id: model.id,
      label: MODELS[mi].label,
      reactorShare: MODELS[mi].reactorShare,
      users: templateUsers.length,
      seeds: seedList.length,
      territoryAccuracy: avg(acc),
      matchStay: avg(stay),
      judgeAccuracy: avg(judge),
      wrongOpposite: avg(opposite),
      centralStuck: avg(stuck),
      centralOverMove: avg(over),
      acc30: avg(byHorizon[30]),
      acc60: avg(byHorizon[60]),
      acc99: avg(byHorizon[99]),
      acc180: avg(byHorizon[180]),
      highMismatch: highOut,
      failMix: failMix,
    });
  }

  const recModel = MODELS.filter(function (m) { return m.id === 'MODEL_B'; })[0];
  const terrorOut = {};
  const terrorNs = [5, 10, 30, 100];
  let ti;
  for (ti = 0; ti < terrorNs.length; ti++) {
    const n = terrorNs[ti];
    terrorOut[n] = {};
    [1, 7, 30].forEach(function (d) {
      const rowsA = [];
      const rowsB = [];
      let s;
      for (s = 0; s < Math.min(seedList.length, 6); s++) {
        rowsA.push(runTerror(recModel, n, d, false, mulberry32(8000 + n * 10 + s)));
        rowsB.push(runTerror(recModel, n, d, true, mulberry32(9000 + n * 10 + s)));
      }
      terrorOut[n][d] = {
        attackOnlyDelta: avg(rowsA.map(function (r) { return r.victimDelta; })),
        attackOnlyTerr: rowsA.map(function (r) { return r.victimTerritory; }).join(','),
        withSupportDelta: avg(rowsB.map(function (r) { return r.victimDelta; })),
        attackerDelta: avg(rowsA.map(function (r) { return r.attackerDelta; })),
        dailyCapHits: avg(rowsA.map(function (r) { return r.victimDailyCapHits; })),
      };
    });
  }

  const internalOut = {};
  [10, 30].forEach(function (n) {
    internalOut[n] = {};
    [7, 30].forEach(function (d) {
      const rows = [];
      let s;
      for (s = 0; s < Math.min(seedList.length, 4); s++) {
        rows.push(runSameFactionDislike(recModel, n, d, mulberry32(6100 + n + d + s)));
      }
      internalOut[n][d] = {
        victimDelta: avg(rows.map(function (r) { return r.victimDelta; })),
        victimTerritory: rows.map(function (r) { return r.victimTerritory; }).join(','),
      };
    });
  });

  const likeOut = {};
  [7, 30, 60, 99].forEach(function (d) {
    const rows = [];
    let s;
    for (s = 0; s < Math.min(seedList.length, 6); s++) {
      rows.push(applyLikesInstead(attachCaps(recModel), 20, d, mulberry32(7000 + d + s)));
    }
    likeOut[d] = {
      authorDelta: avg(rows.map(function (r) { return r.authorDelta; })),
      reactorDelta: avg(rows.map(function (r) { return r.reactorDelta; })),
      authorTerritory: rows[rows.length - 1].authorTerritory,
    };
  });

  const weightCompare = [];
  if (phase2) {
    const weightSets = [
      { id: 'W_0812', expected: 0.8, mid: 1.0, unexpected: 1.2 },
      { id: 'W_0713', expected: 0.7, mid: 1.0, unexpected: 1.3 },
      { id: 'W_0614', expected: 0.6, mid: 1.0, unexpected: 1.4 },
    ];
    const shares = [0.2, 0.25, 0.3];
    let wi;
    for (wi = 0; wi < weightSets.length; wi++) {
      let sh;
      for (sh = 0; sh < shares.length; sh++) {
        const mdl = attachCaps({
          id: weightSets[wi].id + '_R' + Math.round(shares[sh] * 100),
          mode: 'NEW',
          reactorShare: shares[sh],
          weights: weightSets[wi],
        });
        const acc = [];
        const over = [];
        let s;
        for (s = 0; s < Math.min(seedList.length, 6); s++) {
          const world = simulateWorld(templateUsers, mdl, mulberry32(5000 + wi * 100 + sh * 10 + s), Math.min(days, 99), {});
          const snap = world.snapshots[99] || summarizeUsers(world.users, 99);
          acc.push(snap.territoryAccuracy);
          over.push(snap.centralOverMovePct);
        }
        weightCompare.push({
          id: mdl.id,
          acc99: avg(acc),
          centralOver: avg(over),
        });
        process.stdout.write('w');
      }
    }
  }

  const capCompare = [];
  if (phase2) {
    const caps = [180, 240, 300, 360];
    const rCaps = [null, 30, 45, 60, 90];
    let ci;
    for (ci = 0; ci < caps.length; ci++) {
      const mdl = attachCaps(Object.assign({}, recModel), caps[ci], 60);
      const acc = [];
      const over = [];
      let s;
      for (s = 0; s < 3; s++) {
        const world = simulateWorld(templateUsers, mdl, mulberry32(4000 + caps[ci] + s), Math.min(days, 99), {});
        const snap = world.snapshots[99] || summarizeUsers(world.users, 99);
        acc.push(snap.territoryAccuracy);
        over.push(snap.centralOverMovePct);
      }
      capCompare.push({ communityCap: caps[ci], reactorCap: 60, acc99: avg(acc), centralOver: avg(over) });
    }
    for (ci = 0; ci < rCaps.length; ci++) {
      const mdl = attachCaps(Object.assign({}, recModel), 240, rCaps[ci]);
      const acc = [];
      const terror30 = runTerror(mdl, 30, 30, false, mulberry32(4100 + ci));
      let s;
      for (s = 0; s < 3; s++) {
        const world = simulateWorld(templateUsers, mdl, mulberry32(4200 + ci * 10 + s), Math.min(days, 99), {});
        const snap = world.snapshots[99] || summarizeUsers(world.users, 99);
        acc.push(snap.territoryAccuracy);
      }
      capCompare.push({
        communityCap: 240,
        reactorCap: rCaps[ci],
        acc99: avg(acc),
        terror30victimDelta: terror30.victimDelta,
      });
    }
  }

  const shiftOut = {};
  if (phase2) {
    const shiftUsers = cloneUsers(templateUsers).map(function (u, idx) {
      if (u.actual === 'PIONEER' && u.activity === 'high' && idx % 3 === 0) u.flipTo = 'CENTRAL';
      if (u.actual === 'GUARDIAN' && u.activity === 'high' && idx % 3 === 0) u.flipTo = 'PIONEER';
      return u;
    });
    const world = simulateWorld(shiftUsers, attachCaps(recModel), mulberry32(33001), Math.min(days, 120), {
      behaviorShiftDay: 60,
      checkpoints: [60, 90, 99, 120],
    });
    const after = world.users.filter(function (u) { return u.flippedAt === 60; });
    const p2c = after.filter(function (u) { return u.flipTo === 'CENTRAL'; });
    const g2p = after.filter(function (u) { return u.flipTo === 'PIONEER'; });
    shiftOut.pioneerToCentralAt120 = pct(p2c.filter(function (u) { return u.territory === 'CENTRAL'; }).length, p2c.length);
    shiftOut.guardianToPioneerAt120 = pct(g2p.filter(function (u) { return u.territory === 'PIONEER'; }).length, g2p.length);
    shiftOut.sampleP2C = p2c.length;
    shiftOut.sampleG2P = g2p.length;
  }

  const toggleNote = {
    production: 'board_reactions cancelled_at IS NULL only. Unique active row per actor+target+group. Toggle cannot stack.',
    sim: 'Each (actor,author,day) contribution is one signed event after caps. Cancel/re-press is not double-counted.',
  };

  const report = {
    head: '8a9a729',
    generatedAt: new Date().toISOString(),
    quick: quick,
    users: templateUsers.length,
    perCell: perCell,
    days: days,
    seeds: seedList,
    live: core.LIVE,
    models: modelReports,
    terror: terrorOut,
    internalDislike: internalOut,
    crossLike: likeOut,
    weightCompare: weightCompare,
    capCompare: capCompare,
    behaviorShift: shiftOut,
    toggleNote: toggleNote,
    commentPolicy: 'COMMENT_WRITE=0. Comment LIKE/DISLIKE uses same author-received path as posts (board_reactions target_author). Sim treats extra posts as reaction targets; comment text has no stored political direction.',
  };

  const jsonPath = path.join(OUT_DIR, quick ? 'summary-quick.json' : 'summary.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('bidirectional-alignment-sim');
  lines.push('users: ' + templateUsers.length);
  lines.push('seeds: ' + seedList.join(','));
  lines.push('days: ' + days);
  modelReports.forEach(function (m) {
    lines.push(
      m.id +
        ' terrAcc=' +
        m.territoryAccuracy +
        ' 30/60/99/180=' +
        [m.acc30, m.acc60, m.acc99, m.acc180].join('/') +
        ' opposite=' +
        m.wrongOpposite +
        ' centralOver=' +
        m.centralOverMove
    );
    ['PIONEER/CENTRAL', 'PIONEER/GUARDIAN', 'GUARDIAN/CENTRAL', 'GUARDIAN/PIONEER', 'CENTRAL/CENTRAL'].forEach(function (gk) {
      const h = m.highMismatch && m.highMismatch[gk];
      if (!h) return;
      lines.push(
        '  high ' +
          gk +
          ' moveMed=' +
          h.moveMedian +
          ' p90=' +
          h.moveP90 +
          ' s30=' +
          h.success30 +
          ' s60=' +
          h.success60
      );
    });
  });
  const csvPath = path.join(OUT_DIR, quick ? 'models-quick.csv' : 'models.csv');
  const csv = ['model,terrAcc,matchStay,judgeAcc,acc30,acc60,acc99,acc180,wrongOpposite,centralStuck,centralOver']
    .concat(
      modelReports.map(function (m) {
        return [m.id, m.territoryAccuracy, m.matchStay, m.judgeAccuracy, m.acc30, m.acc60, m.acc99, m.acc180, m.wrongOpposite, m.centralStuck, m.centralOverMove].join(',');
      })
    )
    .join('\n');
  fs.writeFileSync(csvPath, csv);
  fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), lines.join('\n'));
  console.log('\nWROTE ' + jsonPath);
  console.log(lines.join('\n'));
}

main();
