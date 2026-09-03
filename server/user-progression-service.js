'use strict';

/**
 * Canonical user_progression — ProfileFrame LEVEL/EXP + POST_CREATED XP.
 * browser localStorage XP·level 신뢰 금지 · service-role only.
 * XP SSOT: shared/progression-xp-core.js
 */

const persist = require('./achievement-persist-service');
const xpCore = require('../shared/progression-xp-core');

const UUID_RE = xpCore.UUID_RE ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_LEVEL = 1;
const DEFAULT_XP = 0;
const DEFAULT_FAME = 0;

function makeError(code, status, extra) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 500;
  if (extra) Object.assign(err, extra);
  return err;
}

function normalizeLevel(value) {
  return xpCore.clampLevel(value);
}

function normalizeXp(value) {
  return xpCore.normalizeXp(value);
}

/** canonical fame = user_progression.reputation_score · 음수 금지 · 기본 0 */
function normalizeFame(value) {
  if (value == null || value === '') return DEFAULT_FAME;
  const n = Math.floor(Number(value));
  if (!isFinite(n) || isNaN(n) || n < 0) return DEFAULT_FAME;
  return n;
}

function computeExpDisplay(level, xp) {
  const prog = xpCore.xpProgressInLevel(level, xp);
  return {
    pct: prog.pct,
    current: prog.current,
    needed: prog.needed,
    isMaxLevel: !!prog.isMaxLevel,
    floor: prog.floor,
    ceiling: prog.ceiling,
  };
}

function buildProgressionResult(uid, row, created, extra) {
  const level = normalizeLevel(row && row.level);
  const xp = normalizeXp(row && row.xp);
  const fame = normalizeFame(row && (row.reputation_score != null ? row.reputation_score : row.fame));
  const display = computeExpDisplay(level, xp);
  return Object.assign(
    {
      userId: uid,
      level: level,
      xp: xp,
      fame: fame,
      expPercent: display.pct,
      progress: display,
      created: !!created,
    },
    extra || {},
  );
}

/**
 * 타인 공개 Level 전용 읽기. INSERT 없음. xp / reputation_score 미조회.
 * 행이 없으면 map에 넣지 않는다 (가짜 1을 서버값처럼 만들지 않음).
 */
async function loadPublicLevelsByUserIds(userIds, client) {
  const ids = [];
  const seen = {};
  (Array.isArray(userIds) ? userIds : []).forEach(function (raw) {
    const id = String(raw || '').trim();
    if (!id || !UUID_RE.test(id) || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  });
  if (!ids.length) return {};
  const sb = client || persist.getAdminClient();
  const selected = await sb.from('user_progression').select('user_id, level').in('user_id', ids);
  if (selected.error) {
    throw makeError('PROGRESSION_PUBLIC_LEVEL_READ_FAILED', 500, {
      detail: selected.error.message,
    });
  }
  const out = {};
  (selected.data || []).forEach(function (row) {
    if (!row || !row.user_id) return;
    if (row.level == null || row.level === '') return;
    const n = Math.floor(Number(row.level));
    if (!isFinite(n) || isNaN(n) || n < 1 || n > 10) return;
    out[String(row.user_id)] = n;
  });
  return out;
}

async function selectProgressionRow(sb, uid) {
  const selected = await sb
    .from('user_progression')
    .select('level, xp, reputation_score, updated_at')
    .eq('user_id', uid)
    .maybeSingle();
  if (selected.error) {
    throw makeError(selected.error.code || 'PROGRESSION_LOAD_FAILED', 500, {
      detail: selected.error.message,
    });
  }
  return selected.data || null;
}

/**
 * RPC 반환값만 믿지 않음 — 별도 SELECT로 영속 확인 후 그 값으로 응답.
 */
async function verifyPersistedProgression(sb, uid, rpcMapped) {
  const row = await selectProgressionRow(sb, uid);
  if (!row) {
    throw makeError('PROGRESSION_PERSIST_MISSING_ROW', 500, {
      detail: 'RPC returned but user_progression row missing on re-SELECT',
    });
  }
  const level = normalizeLevel(row.level);
  const xp = normalizeXp(row.xp);
  const display = computeExpDisplay(level, xp);
  const expectedXp = normalizeXp(rpcMapped && rpcMapped.xp);
  const expectedLevel = normalizeLevel(rpcMapped && rpcMapped.level);
  if (xp !== expectedXp || level !== expectedLevel) {
    throw makeError('PROGRESSION_PERSIST_MISMATCH', 500, {
      detail:
        'RPC claimed xp=' +
        expectedXp +
        ' lv=' +
        expectedLevel +
        ' but SELECT xp=' +
        xp +
        ' lv=' +
        level,
      rpcXp: expectedXp,
      rpcLevel: expectedLevel,
      dbXp: xp,
      dbLevel: level,
    });
  }
  return Object.assign({}, rpcMapped, {
    level: level,
    xp: xp,
    fame: normalizeFame(row.reputation_score),
    expPercent: display.pct,
    progress: display,
    verified: true,
  });
}

async function ensureAndGetProgression(userId) {
  const uid = String(userId || '').trim();
  if (!uid || !UUID_RE.test(uid)) {
    throw makeError('PROGRESSION_USER_ID_INVALID', 400);
  }

  const sb = persist.getAdminClient();
  const existing = await sb
    .from('user_progression')
    .select('level, xp, reputation_score')
    .eq('user_id', uid)
    .maybeSingle();

  if (existing.error) {
    throw makeError(existing.error.code || 'PROGRESSION_LOAD_FAILED', 500, {
      detail: existing.error.message,
    });
  }

  if (existing.data) {
    /* 기존 row 절대 level1/xp0/fame0 으로 UPDATE 하지 않음 */
    return buildProgressionResult(uid, existing.data, false);
  }

  const inserted = await sb
    .from('user_progression')
    .insert({ user_id: uid })
    .select('level, xp, reputation_score')
    .single();

  if (inserted.error) {
    if (String(inserted.error.code || '') === '23505') {
      const again = await sb
        .from('user_progression')
        .select('level, xp, reputation_score')
        .eq('user_id', uid)
        .maybeSingle();
      if (!again.error && again.data) {
        return buildProgressionResult(uid, again.data, false);
      }
    }
    throw makeError(inserted.error.code || 'PROGRESSION_ENSURE_FAILED', 500, {
      detail: inserted.error.message,
    });
  }

  return buildProgressionResult(uid, inserted.data, true);
}

async function ensureAndGetProgressionLevel(userId) {
  return ensureAndGetProgression(userId);
}

function mapRpcToProgression(uid, rpcData) {
  const status = rpcData && rpcData.status ? String(rpcData.status) : 'ERROR';
  const level = normalizeLevel(rpcData && (rpcData.newLevel != null ? rpcData.newLevel : rpcData.level));
  const xp = normalizeXp(rpcData && (rpcData.newXp != null ? rpcData.newXp : rpcData.xp));
  const previousLevel = normalizeLevel(
    rpcData && rpcData.previousLevel != null ? rpcData.previousLevel : level,
  );
  const display = computeExpDisplay(level, xp);
  return {
    userId: uid,
    status: status,
    level: level,
    xp: xp,
    fame: normalizeFame(rpcData && (rpcData.newReputation != null ? rpcData.newReputation : rpcData.fame)),
    expPercent: display.pct,
    progress: display,
    previousLevel: previousLevel,
    levelChanged: !!(rpcData && rpcData.levelChanged) || previousLevel !== level,
    xpDelta: Math.floor(Number(rpcData && rpcData.xpDelta) || 0),
    duplicate: status === 'DUPLICATE',
  };
}

/**
 * 서버 전용 — POST_CREATED XP. amount는 SSOT에서만 결정.
 * @param {string} userId
 * @param {string} postId canonical board_posts.id
 */
async function applyPostCreatedXp(userId, postId) {
  const uid = String(userId || '').trim();
  const pid = String(postId || '').trim();
  if (!uid || !UUID_RE.test(uid)) {
    throw makeError('PROGRESSION_USER_ID_INVALID', 400);
  }
  if (!pid) {
    throw makeError('PROGRESSION_SOURCE_ID_INVALID', 400);
  }

  const amount = xpCore.xpRewardForEvent('POST_CREATED');
  const dedupeKey = xpCore.dedupeKeyForPostCreated(pid);
  const sb = persist.getAdminClient();

  const { data, error } = await sb.rpc('apply_user_progression_event', {
    p_user_id: uid,
    p_event_type: 'POST_CREATED',
    p_amount: amount,
    p_source_type: 'board_post',
    p_source_id: pid,
    p_dedupe_key: dedupeKey,
    p_occurred_at: new Date().toISOString(),
  });

  if (error) {
    throw makeError(error.code || 'PROGRESSION_RPC_FAILED', 500, {
      detail: error.message,
    });
  }

  const mapped = mapRpcToProgression(uid, data);
  if (mapped.status !== 'APPLIED' && mapped.status !== 'DUPLICATE') {
    throw makeError('PROGRESSION_RPC_STATUS_ERROR', 500, {
      detail: 'unexpected rpc status: ' + mapped.status,
    });
  }
  return verifyPersistedProgression(sb, uid, mapped);
}

/**
 * 서버 전용 — BOARD_COMMENT_CREATED XP. amount는 SSOT에서만 결정.
 * @param {string} userId
 * @param {string} commentId canonical board_comments.id
 */
async function applyBoardCommentCreatedXp(userId, commentId) {
  const uid = String(userId || '').trim();
  const cid = String(commentId || '').trim();
  if (!uid || !UUID_RE.test(uid)) {
    throw makeError('PROGRESSION_USER_ID_INVALID', 400);
  }
  if (!cid) {
    throw makeError('PROGRESSION_SOURCE_ID_INVALID', 400);
  }

  const amount = xpCore.xpRewardForEvent('BOARD_COMMENT_CREATED');
  const dedupeKey = xpCore.dedupeKeyForBoardCommentCreated(cid);
  const sb = persist.getAdminClient();

  const { data, error } = await sb.rpc('apply_user_progression_event', {
    p_user_id: uid,
    p_event_type: 'BOARD_COMMENT_CREATED',
    p_amount: amount,
    p_source_type: 'board_comment',
    p_source_id: cid,
    p_dedupe_key: dedupeKey,
    p_occurred_at: new Date().toISOString(),
  });

  if (error) {
    throw makeError(error.code || 'PROGRESSION_RPC_FAILED', 500, {
      detail: error.message,
    });
  }

  const mapped = mapRpcToProgression(uid, data);
  if (mapped.status !== 'APPLIED' && mapped.status !== 'DUPLICATE') {
    throw makeError('PROGRESSION_RPC_STATUS_ERROR', 500, {
      detail: 'unexpected rpc status: ' + mapped.status,
    });
  }
  return verifyPersistedProgression(sb, uid, mapped);
}

/**
 * 서버 전용 — ISSUE_COMMENT_CREATED XP +10. amount는 SSOT에서만 결정.
 * 댓글 저장과 실패 경계를 분리한다. 호출부에서 try/catch.
 * @param {string} userId
 * @param {string} commentId canonical daily_issue_comments.id
 */
async function applyIssueCommentCreatedXp(userId, commentId) {
  const uid = String(userId || '').trim();
  const cid = String(commentId || '').trim();
  if (!uid || !UUID_RE.test(uid)) {
    throw makeError('PROGRESSION_USER_ID_INVALID', 400);
  }
  if (!cid) {
    throw makeError('PROGRESSION_SOURCE_ID_INVALID', 400);
  }

  const amount = xpCore.xpRewardForEvent('ISSUE_COMMENT_CREATED');
  const dedupeKey = xpCore.dedupeKeyForIssueCommentCreated(cid);
  const sb = persist.getAdminClient();

  const { data, error } = await sb.rpc('apply_user_progression_event', {
    p_user_id: uid,
    p_event_type: 'ISSUE_COMMENT_CREATED',
    p_amount: amount,
    p_source_type: 'issue_comment',
    p_source_id: cid,
    p_dedupe_key: dedupeKey,
    p_occurred_at: new Date().toISOString(),
  });

  if (error) {
    throw makeError(error.code || 'PROGRESSION_RPC_FAILED', 500, {
      detail: error.message,
    });
  }

  const mapped = mapRpcToProgression(uid, data);
  if (mapped.status !== 'APPLIED' && mapped.status !== 'DUPLICATE') {
    throw makeError('PROGRESSION_RPC_STATUS_ERROR', 500, {
      detail: 'unexpected rpc status: ' + mapped.status,
    });
  }
  return verifyPersistedProgression(sb, uid, mapped);
}

function normalizeEmpathyTargetType(options) {
  const raw = String((options && options.targetType) || 'POST').trim().toUpperCase();
  if (raw === 'COMMENT') return 'COMMENT';
  return 'POST';
}

function emptyEmpathyFameResult(author, before, extra) {
  const beforeXp = normalizeXp(before && before.xp);
  const beforeLevel = normalizeLevel(before && before.level);
  const beforeFame = normalizeFame(before && before.reputation_score);
  const beforeDisplay = computeExpDisplay(beforeLevel, beforeXp);
  return Object.assign(
    {
      granted: false,
      revoked: false,
      duplicate: false,
      recipientUserId: author,
      fame: beforeFame,
      previousFame: beforeFame,
      fameDelta: 0,
      level: beforeLevel,
      xp: beforeXp,
      expPercent: beforeDisplay.pct,
      verified: false,
    },
    extra || {},
  );
}

/**
 * canonical 게시글/댓글(대댓글 포함) 작성자 조회. 클라이언트 author 미신뢰.
 */
async function loadEmpathyTarget(sb, targetId, targetType) {
  if (targetType === 'COMMENT') {
    const commentRes = await sb
      .from('board_comments')
      .select('id, author_user_id, status, post_id')
      .eq('id', targetId)
      .maybeSingle();
    if (commentRes.error) {
      throw makeError(commentRes.error.code || 'BOARD_COMMENT_LOAD_FAILED', 500, {
        detail: commentRes.error.message,
      });
    }
    if (!commentRes.data) {
      throw makeError('BOARD_COMMENT_NOT_FOUND', 404);
    }
    return {
      targetType: 'COMMENT',
      sourceType: 'board_comment',
      sourceId: String(commentRes.data.id),
      authorUserId: String(commentRes.data.author_user_id || '').trim(),
      status: String(commentRes.data.status || '').toUpperCase(),
      notFoundCode: 'BOARD_COMMENT_NOT_FOUND',
      authorInvalidCode: 'BOARD_COMMENT_AUTHOR_INVALID',
    };
  }

  const postRes = await sb
    .from('board_posts')
    .select('id, author_user_id, status')
    .eq('id', targetId)
    .maybeSingle();
  if (postRes.error) {
    throw makeError(postRes.error.code || 'BOARD_POST_LOAD_FAILED', 500, {
      detail: postRes.error.message,
    });
  }
  if (!postRes.data) {
    throw makeError('BOARD_POST_NOT_FOUND', 404);
  }
  return {
    targetType: 'POST',
    sourceType: 'board_post',
    sourceId: String(postRes.data.id),
    authorUserId: String(postRes.data.author_user_id || '').trim(),
    status: String(postRes.data.status || '').toUpperCase(),
    notFoundCode: 'BOARD_POST_NOT_FOUND',
    authorInvalidCode: 'BOARD_POST_AUTHOR_INVALID',
  };
}

async function prepareEmpathyFameContext(reactorUserId, targetId, options) {
  const reactor = String(reactorUserId || '').trim();
  const tid = String(targetId || '').trim();
  if (!reactor || !UUID_RE.test(reactor)) {
    throw makeError('PROGRESSION_USER_ID_INVALID', 400);
  }
  if (!tid || !UUID_RE.test(tid)) {
    throw makeError('PROGRESSION_SOURCE_ID_INVALID', 400);
  }
  const targetType = normalizeEmpathyTargetType(options);
  const sb = persist.getAdminClient();
  const target = await loadEmpathyTarget(sb, tid, targetType);
  if (target.status !== 'ACTIVE') {
    throw makeError('BOARD_TARGET_NOT_ACTIVE', 400);
  }
  const author = target.authorUserId;
  if (!author || !UUID_RE.test(author)) {
    throw makeError(target.authorInvalidCode, 500);
  }
  await ensureAndGetProgression(author);
  const before = await selectProgressionRow(sb, author);
  const rankCore = require('../shared/user-rank-core');
  return {
    reactor: reactor,
    author: author,
    sb: sb,
    target: target,
    before: before,
    amount: rankCore.fameRewardForEvent('EMPATHY_RECEIVED'),
    dedupeKey: rankCore.dedupeKeyForEmpathyReceived(target.sourceId, reactor),
  };
}

function assertFameDidNotChangeXp(before, verified, eventLabel) {
  const beforeXp = normalizeXp(before && before.xp);
  const beforeLevel = normalizeLevel(before && before.level);
  if (normalizeXp(verified.xp) !== beforeXp || normalizeLevel(verified.level) !== beforeLevel) {
    throw makeError('PROGRESSION_XP_CHANGED_ON_FAME', 500, {
      detail: eventLabel + ' must not change level/xp',
    });
  }
}

/**
 * 타인 canonical 게시글/댓글 공감 OFF→ON → recipient reputation_score +1 (원자 RPC).
 * amount/author는 서버가 board_posts/board_comments 에서 결정. 자기 콘텐츠 금지. LEVEL/XP 불변.
 */
async function applyEmpathyReceivedFame(reactorUserId, targetId, options) {
  const ctx = await prepareEmpathyFameContext(reactorUserId, targetId, options);
  if (ctx.author === ctx.reactor) {
    return emptyEmpathyFameResult(ctx.author, ctx.before, { reason: 'SELF_EMPATHY' });
  }

  const { data, error } = await ctx.sb.rpc('apply_user_progression_event', {
    p_user_id: ctx.author,
    p_event_type: 'EMPATHY_RECEIVED',
    p_amount: ctx.amount,
    p_source_type: ctx.target.sourceType,
    p_source_id: ctx.target.sourceId,
    p_dedupe_key: ctx.dedupeKey,
    p_occurred_at: new Date().toISOString(),
  });

  if (error) {
    throw makeError(error.code || 'PROGRESSION_RPC_FAILED', 500, {
      detail: error.message,
    });
  }

  const mapped = mapRpcToProgression(ctx.author, data);
  if (mapped.status !== 'APPLIED' && mapped.status !== 'DUPLICATE') {
    throw makeError('PROGRESSION_RPC_STATUS_ERROR', 500, {
      detail: 'unexpected rpc status: ' + mapped.status,
    });
  }

  const verified = await verifyPersistedProgression(ctx.sb, ctx.author, mapped);
  assertFameDidNotChangeXp(ctx.before, verified, 'EMPATHY_RECEIVED');

  const fame = normalizeFame(verified.fame);
  const beforeFame = normalizeFame(ctx.before && ctx.before.reputation_score);
  return {
    granted: mapped.status === 'APPLIED',
    revoked: false,
    reason: mapped.status === 'DUPLICATE' ? 'DUPLICATE' : 'APPLIED',
    duplicate: mapped.status === 'DUPLICATE',
    recipientUserId: ctx.author,
    fame: fame,
    previousFame: beforeFame,
    fameDelta: fame - beforeFame,
    level: verified.level,
    xp: verified.xp,
    expPercent: verified.expPercent,
    verified: !!verified.verified,
  };
}

/**
 * 기존 EMPATHY_RECEIVED event 가 실제로 삭제된 1회만 명성 -1.
 * 중복/없는 취소는 NOT_FOUND · 명성 불변. 자기 공감은 원래 +0 이므로 -0.
 */
async function revokeEmpathyReceivedFame(reactorUserId, targetId, options) {
  const ctx = await prepareEmpathyFameContext(reactorUserId, targetId, options);
  if (ctx.author === ctx.reactor) {
    return emptyEmpathyFameResult(ctx.author, ctx.before, { reason: 'SELF_EMPATHY' });
  }

  const { data, error } = await ctx.sb.rpc('revoke_empathy_received_fame', {
    p_user_id: ctx.author,
    p_dedupe_key: ctx.dedupeKey,
  });

  if (error) {
    throw makeError(error.code || 'PROGRESSION_RPC_FAILED', 500, {
      detail: error.message,
    });
  }

  const mapped = mapRpcToProgression(ctx.author, data);
  if (mapped.status !== 'APPLIED' && mapped.status !== 'NOT_FOUND') {
    throw makeError('PROGRESSION_RPC_STATUS_ERROR', 500, {
      detail: 'unexpected rpc status: ' + mapped.status,
    });
  }

  const verified = await verifyPersistedProgression(ctx.sb, ctx.author, mapped);
  assertFameDidNotChangeXp(ctx.before, verified, 'EMPATHY_RECEIVED_REVOKE');

  const fame = normalizeFame(verified.fame);
  const beforeFame = normalizeFame(ctx.before && ctx.before.reputation_score);
  const rpcFame = normalizeFame(mapped.fame);
  if (fame !== rpcFame) {
    throw makeError('PROGRESSION_FAME_PERSIST_MISMATCH', 500, {
      detail: 'RPC fame=' + rpcFame + ' but SELECT fame=' + fame,
    });
  }

  return {
    granted: false,
    revoked: mapped.status === 'APPLIED',
    reason: mapped.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'APPLIED',
    duplicate: false,
    recipientUserId: ctx.author,
    fame: fame,
    previousFame: beforeFame,
    fameDelta: fame - beforeFame,
    level: verified.level,
    xp: verified.xp,
    expPercent: verified.expPercent,
    verified: !!verified.verified,
  };
}

/**
 * canonical event history → expected xp/level (localStorage 금지)
 */
async function reconcileProgressionFromEvents(userId, options) {
  const uid = String(userId || '').trim();
  if (!uid || !UUID_RE.test(uid)) {
    throw makeError('PROGRESSION_USER_ID_INVALID', 400);
  }
  const apply = !!(options && options.apply);
  const sb = persist.getAdminClient();

  const ev = await sb
    .from('user_progression_events')
    .select('event_type, amount, dedupe_key, source_id, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (ev.error) {
    throw makeError(ev.error.code || 'PROGRESSION_EVENTS_LOAD_FAILED', 500, {
      detail: ev.error.message,
    });
  }

  const events = ev.data || [];
  let expectedXp = 0;
  const fameTypes = {
    EMPATHY_RECEIVED: true,
    LIKE_RECEIVED: true,
    FOLLOWER_GAINED: true,
  };
  for (let i = 0; i < events.length; i++) {
    const et = String(events[i].event_type || '');
    if (fameTypes[et]) continue;
    expectedXp += Math.max(0, Math.floor(Number(events[i].amount) || 0));
  }
  expectedXp = normalizeXp(expectedXp);
  const expectedLevel = xpCore.calculateLevelFromXp(expectedXp);

  await ensureAndGetProgression(uid);
  const row = await selectProgressionRow(sb, uid);
  const actualXp = normalizeXp(row && row.xp);
  const actualLevel = normalizeLevel(row && row.level);
  const needsUpdate = actualXp !== expectedXp || actualLevel !== expectedLevel;

  let applied = false;
  if (apply && needsUpdate) {
    const updated = await sb
      .from('user_progression')
      .update({ xp: expectedXp, level: expectedLevel })
      .eq('user_id', uid)
      .select('level, xp')
      .single();
    if (updated.error) {
      throw makeError(updated.error.code || 'PROGRESSION_RECONCILE_FAILED', 500, {
        detail: updated.error.message,
      });
    }
    applied = true;
  }

  const finalRow = apply && needsUpdate ? await selectProgressionRow(sb, uid) : row;
  const display = computeExpDisplay(
    normalizeLevel(finalRow && finalRow.level),
    normalizeXp(finalRow && finalRow.xp),
  );

  return {
    userId: uid,
    eventCount: events.length,
    expectedXp: expectedXp,
    expectedLevel: expectedLevel,
    actualXp: actualXp,
    actualLevel: actualLevel,
    needsUpdate: needsUpdate,
    applied: applied,
    level: normalizeLevel(finalRow && finalRow.level),
    xp: normalizeXp(finalRow && finalRow.xp),
    expPercent: display.pct,
    events: events,
  };
}

module.exports = {
  ensureAndGetProgression,
  ensureAndGetProgressionLevel,
  loadPublicLevelsByUserIds,
  applyPostCreatedXp,
  applyBoardCommentCreatedXp,
  applyIssueCommentCreatedXp,
  applyEmpathyReceivedFame,
  revokeEmpathyReceivedFame,
  reconcileProgressionFromEvents,
  computeExpDisplay,
  normalizeLevel,
  normalizeXp,
  normalizeFame,
  mapRpcToProgression,
  verifyPersistedProgression,
  DEFAULT_LEVEL,
  DEFAULT_XP,
  DEFAULT_FAME,
  UUID_RE,
  xpCore: xpCore,
};
