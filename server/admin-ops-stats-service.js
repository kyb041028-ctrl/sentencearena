'use strict';

const { buildAdminOpsStats, resolveRange } = require('../shared/admin-ops-stats-core');

const ACTIVITY_CAP = 20000;

const { isUnavailableDbError: missingRelation } = require('./admin-db-errors');

async function scalar(query, sql, params) {
  try {
    const res = await query(sql, params);
    const row = res && res.rows && res.rows[0];
    if (!row || row.n == null) return null;
    return Number(row.n);
  } catch (e) {
    if (missingRelation(e)) return null;
    throw e;
  }
}

async function rowsOf(query, sql, params) {
  try {
    const res = await query(sql, params);
    return (res && res.rows) || [];
  } catch (e) {
    if (missingRelation(e)) return null;
    throw e;
  }
}

async function loadOperations(query, range) {
  const params = [range.startIso, range.endIso];
  const posts = await scalar(query, 'SELECT COUNT(*)::int AS n FROM public.board_posts WHERE created_at >= $1 AND created_at < $2', params);
  const comments = await scalar(query, 'SELECT COUNT(*)::int AS n FROM public.board_comments WHERE created_at >= $1 AND created_at < $2', params);
  const reactions = await scalar(
    query,
    'SELECT COUNT(*)::int AS n FROM public.board_reactions WHERE cancelled_at IS NULL AND created_at >= $1 AND created_at < $2',
    params,
  );
  const reports = await scalar(query, 'SELECT COUNT(*)::int AS n FROM public.board_reports WHERE created_at >= $1 AND created_at < $2', params);
  const pending = await scalar(
    query,
    "SELECT COUNT(*)::int AS n FROM public.board_reports WHERE status IN ('SUBMITTED', 'REVIEWING')",
    [],
  );
  const sanctions = await scalar(
    query,
    'SELECT COUNT(*)::int AS n FROM public.user_sanction_records WHERE created_at >= $1 AND created_at < $2',
    params,
  );
  const issues = await scalar(
    query,
    "SELECT COUNT(*)::int AS n FROM public.daily_issue_review_items WHERE status = 'PUBLISHED' AND published_at >= $1 AND published_at < $2",
    params,
  );
  const boards = await rowsOf(
    query,
    'SELECT territory AS key, COUNT(*)::int AS posts FROM public.board_posts WHERE created_at >= $1 AND created_at < $2 GROUP BY territory ORDER BY posts DESC LIMIT 8',
    params,
  );
  const dailyPosts = await rowsOf(
    query,
    "SELECT to_char((created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count FROM public.board_posts WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 1",
    params,
  );
  if (posts == null && comments == null && reactions == null) return null;
  return {
    posts: posts,
    comments: comments,
    reactions: reactions,
    reports: reports,
    pendingReports: pending,
    sanctions: sanctions,
    dailyIssuesPublished: issues,
    boards: boards == null ? null : boards.map(function (row) {
      return { key: row.key || 'UNKNOWN', posts: Number(row.posts) || 0 };
    }),
    dailyPosts: dailyPosts == null ? null : dailyPosts.map(function (row) {
      return { date: row.date, count: Number(row.count) || 0 };
    }),
  };
}

async function loadMembers(query, range) {
  const params = [range.startIso, range.endIso];
  const currentMembers = await scalar(query, 'SELECT COUNT(*)::int AS n FROM public.profiles', []);
  const withdrawals = await scalar(
    query,
    "SELECT COUNT(*)::int AS n FROM public.account_withdrawal_audit WHERE withdrawn_at >= $1 AND withdrawn_at < $2 AND result IN ('COMPLETED', 'ANONYMIZED')",
    params,
  );
  const signups = await rowsOf(
    query,
    'SELECT id, created_at FROM public.profiles WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at LIMIT 5000',
    params,
  );
  const activitySql = [
    "SELECT author_user_id AS user_id, created_at, 'post' AS kind FROM public.board_posts WHERE author_user_id IS NOT NULL AND created_at >= $1 AND created_at < $2",
    "SELECT author_user_id AS user_id, created_at, 'comment' AS kind FROM public.board_comments WHERE author_user_id IS NOT NULL AND created_at >= $1 AND created_at < $2",
    "SELECT actor_user_id AS user_id, created_at, 'reaction' AS kind FROM public.board_reactions WHERE actor_user_id IS NOT NULL AND cancelled_at IS NULL AND created_at >= $1 AND created_at < $2",
  ].join(' UNION ALL ');
  const lookbackStart = new Date(Date.parse(range.endIso) - 30 * 86400000).toISOString();
  const activities = await rowsOf(
    query,
    'SELECT user_id, created_at, kind FROM (' + activitySql + ') AS activity WHERE created_at >= $3 ORDER BY created_at LIMIT ' + (ACTIVITY_CAP + 1),
    [lookbackStart < range.startIso ? lookbackStart : range.startIso, range.endIso, lookbackStart < range.startIso ? lookbackStart : range.startIso],
  );
  if (currentMembers == null && signups == null && activities == null) return null;
  if (activities && activities.length > ACTIVITY_CAP) {
    return {
      currentMembers: currentMembers,
      withdrawalsInPeriod: withdrawals,
      signups: [],
      activities: null,
      truncated: true,
    };
  }
  return {
    currentMembers: currentMembers,
    withdrawalsInPeriod: withdrawals,
    signups: (signups || []).map(function (row) {
      return { id: String(row.id), createdAt: new Date(row.created_at).toISOString() };
    }),
    activities: (activities || []).map(function (row) {
      return { userId: String(row.user_id), at: new Date(row.created_at).toISOString(), kind: row.kind };
    }),
  };
}

async function loadVisits(query, range) {
  const rows = await rowsOf(
    query,
    'SELECT occurred_at, visitor_key, actor_type, user_id, kind, channel, utm_source, device_class FROM public.admin_ops_visit_events WHERE occurred_at >= $1 AND occurred_at < $2 ORDER BY occurred_at LIMIT ' + (ACTIVITY_CAP + 1),
    [new Date(Date.parse(range.startIso) - 31 * 86400000).toISOString(), range.endIso],
  );
  if (rows == null) return { collected: false, events: null };
  if (rows.length > ACTIVITY_CAP) return { collected: true, truncated: true, events: [] };
  return {
    collected: true,
    events: rows.map(function (row) {
      return {
        occurredAt: new Date(row.occurred_at).toISOString(),
        visitorKey: row.visitor_key,
        actorType: row.actor_type,
        userId: row.user_id,
        kind: row.kind,
        channel: row.channel,
        utmSource: row.utm_source,
        deviceClass: row.device_class,
      };
    }),
  };
}

async function summarizeAdminOps(options) {
  const opt = options || {};
  const range = resolveRange(opt);
  let members = null;
  let operations = null;
  let visitsCollected = false;
  let visitEvents = null;
  let visitsTruncated = false;
  let memberTruncated = false;
  if (typeof opt.query === 'function') {
    operations = await loadOperations(opt.query, range);
    const memberLoad = await loadMembers(opt.query, range);
    if (memberLoad && memberLoad.truncated) {
      memberTruncated = true;
      members = {
        currentMembers: memberLoad.currentMembers,
        withdrawalsInPeriod: memberLoad.withdrawalsInPeriod,
        signups: [],
        activities: [],
      };
    } else if (memberLoad) {
      members = memberLoad;
    }
    if (opt.visitCollectionEnabled === true) {
      const loaded = await loadVisits(opt.query, range);
      visitsCollected = loaded.collected === true;
      visitsTruncated = loaded.truncated === true;
      visitEvents = loaded.events || [];
    }
  }
  const built = buildAdminOpsStats({
    now: opt.now,
    preset: opt.preset,
    from: opt.from,
    to: opt.to,
    visitsCollected: visitsCollected,
    visitEvents: visitEvents,
    visitsTruncated: visitsTruncated,
    members: members,
    operations: operations,
  });
  if (memberTruncated) {
    const note = '기간 활동이 집계 상한을 넘었습니다.';
    built.members.dau = { status: 'NO_DATA', value: null, note: note };
    built.members.wau = { status: 'NO_DATA', value: null, note: note };
    built.members.mau = { status: 'NO_DATA', value: null, note: note };
    built.members.participation = { status: 'NO_DATA', value: null, note: note };
    built.members.firstActivityConversion = { status: 'NO_DATA', value: null, note: note };
  }
  return built;
}

module.exports = {
  summarizeAdminOps: summarizeAdminOps,
  ACTIVITY_CAP: ACTIVITY_CAP,
};
