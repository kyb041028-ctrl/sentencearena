'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');
const { isUnavailableDbError } = require('./admin-db-errors');
const { resolveRange } = require('../shared/admin-ops-stats-core');
const hub = require('../shared/admin-hub-core');

const SEARCH_MAX = 60;

async function tryQuery(query, sql, params) {
  try {
    const res = await query(sql, params);
    return { known: true, rows: (res && res.rows) || [] };
  } catch (e) {
    if (isUnavailableDbError(e)) return { known: false, rows: [] };
    throw e;
  }
}

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, function (m) { return '\\' + m; });
}

function buildWhere(search, range) {
  const where = [];
  const params = [];
  if (search) {
    if (hub.isUuid(search)) {
      params.push(search);
      where.push('p.id = $' + params.length + '::uuid');
    } else {
      params.push('%' + escapeLike(search) + '%');
      where.push('p.display_name ILIKE $' + params.length);
    }
  }
  if (range) {
    params.push(range.startIso);
    where.push('p.created_at >= $' + params.length);
    params.push(range.endIso);
    where.push('p.created_at < $' + params.length);
  }
  return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params: params };
}

async function listMembers(query, q) {
  const paging = hub.parsePaging(q);
  const search = String(q.q || '').trim().slice(0, SEARCH_MAX);
  const summaryRange = resolveRange({ now: q.now, preset: q.from || q.to ? 'custom' : String(q.preset || '30d'), from: q.from, to: q.to });
  const filterRange = q.from || q.to ? summaryRange : null;
  const where = buildWhere(search, filterRange);

  let base = await tryQuery(
    query,
    'SELECT p.id, p.display_name, p.created_at, p.territory FROM public.profiles p' + where.sql +
      ' ORDER BY p.created_at DESC, p.id LIMIT ' + paging.pageSize + ' OFFSET ' + paging.offset,
    where.params,
  );
  let territoryKnown = true;
  if (!base.known) {
    base = await tryQuery(
      query,
      'SELECT p.id, p.display_name, p.created_at, NULL::text AS territory FROM public.profiles p' + where.sql +
        ' ORDER BY p.created_at DESC, p.id LIMIT ' + paging.pageSize + ' OFFSET ' + paging.offset,
      where.params,
    );
    territoryKnown = false;
  }
  if (!base.known) return { available: false };

  const total = await tryQuery(query, 'SELECT COUNT(*)::int AS n FROM public.profiles p' + where.sql, where.params);
  const ids = base.rows.map(function (r) { return String(r.id); });
  const progression = ids.length
    ? await tryQuery(query, 'SELECT user_id, level, reputation_score FROM public.user_progression WHERE user_id = ANY($1::uuid[])', [ids])
    : { known: true, rows: [] };
  const sanctions = ids.length
    ? await tryQuery(
      query,
      'SELECT user_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE permanent OR ends_at > now())::int AS active FROM public.user_sanction_records WHERE user_id = ANY($1::uuid[]) GROUP BY user_id',
      [ids],
    )
    : { known: true, rows: [] };
  const activity = ids.length
    ? await tryQuery(
      query,
      'SELECT user_id, MAX(created_at) AS last_at FROM (' +
        'SELECT author_user_id AS user_id, created_at FROM public.board_posts WHERE author_user_id = ANY($1::uuid[]) ' +
        'UNION ALL SELECT author_user_id, created_at FROM public.board_comments WHERE author_user_id = ANY($1::uuid[]) ' +
        'UNION ALL SELECT actor_user_id, created_at FROM public.board_reactions WHERE actor_user_id = ANY($1::uuid[]) AND cancelled_at IS NULL' +
        ') a GROUP BY user_id',
      [ids],
    )
    : { known: true, rows: [] };

  const progMap = new Map(progression.rows.map(function (r) { return [String(r.user_id), r]; }));
  const sanMap = new Map(sanctions.rows.map(function (r) { return [String(r.user_id), r]; }));
  const actMap = new Map(activity.rows.map(function (r) { return [String(r.user_id), r]; }));

  const members = base.rows.map(function (row) {
    const id = String(row.id);
    const prog = progMap.get(id);
    const san = sanMap.get(id);
    const act = actMap.get(id);
    return hub.serializeMember(row, {
      territoryKnown: territoryKnown,
      progressionKnown: progression.known,
      level: prog ? prog.level : null,
      reputation: prog ? prog.reputation_score : null,
      activityKnown: activity.known,
      lastActivityAt: act && act.last_at ? new Date(act.last_at).toISOString() : null,
      sanctionKnown: sanctions.known,
      sanctionCount: san ? san.total : 0,
      activeSanctionCount: san ? san.active : 0,
    });
  });

  const periodSignups = await tryQuery(
    query,
    'SELECT COUNT(*)::int AS n FROM public.profiles WHERE created_at >= $1 AND created_at < $2',
    [summaryRange.startIso, summaryRange.endIso],
  );
  const periodWithdrawals = await tryQuery(
    query,
    "SELECT COUNT(*)::int AS n FROM public.account_withdrawal_audit WHERE withdrawn_at >= $1 AND withdrawn_at < $2 AND result IN ('COMPLETED', 'ANONYMIZED')",
    [summaryRange.startIso, summaryRange.endIso],
  );
  function stat(res) {
    if (!res.known || !res.rows[0]) return { status: 'NOT_CONFIRMED', value: null };
    return { status: 'OK', value: Number(res.rows[0].n) };
  }

  return {
    available: true,
    members: members,
    page: paging.page,
    pageSize: paging.pageSize,
    total: total.known && total.rows[0] ? Number(total.rows[0].n) : null,
    period: {
      from: summaryRange.from,
      to: summaryRange.to,
      timeZone: hub.TIME_ZONE,
      signups: stat(periodSignups),
      withdrawals: stat(periodWithdrawals),
    },
  };
}

async function memberDetail(query, id) {
  const base = await tryQuery(query, 'SELECT p.id, p.display_name, p.created_at, p.territory FROM public.profiles p WHERE p.id = $1::uuid', [id]);
  if (!base.known) return { available: false };
  if (!base.rows.length) return { available: true, member: null };
  const history = await tryQuery(
    query,
    'SELECT sanction_type, starts_at, ends_at, permanent, reason_code, created_at FROM public.user_sanction_records WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 100',
    [id],
  );
  return {
    available: true,
    member: hub.serializeMember(base.rows[0], { sanctionKnown: history.known, sanctionCount: history.rows.length, activeSanctionCount: history.rows.filter(function (r) {
      return r.permanent || (r.ends_at && new Date(r.ends_at).getTime() > Date.now());
    }).length }),
    sanctionHistoryStatus: history.known ? 'OK' : 'NOT_CONFIRMED',
    sanctionHistory: history.rows.map(function (r) {
      return {
        type: r.sanction_type,
        startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null,
        endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
        permanent: r.permanent === true,
        reasonCode: r.reason_code || null,
        createdAt: new Date(r.created_at).toISOString(),
      };
    }),
  };
}

function mountAdminMembersRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  router.use(createAdminAccessGuard(opts.adminAuth || {}));

  function noDb(res) {
    return res.json({ ok: true, available: false, status: 'NOT_CONFIRMED', message: 'DB 연결이 없어 회원 목록을 확인할 수 없습니다.' });
  }

  router.get('/', async function (req, res) {
    try {
      if (typeof opts.query !== 'function') return noDb(res);
      const out = await listMembers(opts.query, Object.assign({}, req.query, { now: opts.now }));
      if (!out.available) return noDb(res);
      return res.json(Object.assign({ ok: true }, out));
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      if (e && (e.code === 'RANGE_INVALID' || e.code === 'RANGE_TOO_LONG')) {
        return res.status(400).json({ ok: false, error: { code: e.code, message: 'Range is invalid' } });
      }
      return res.status(500).json({ ok: false, error: { code: 'MEMBERS_LIST_FAILED', message: 'Members list failed' } });
    }
  });

  router.get('/:id', async function (req, res) {
    try {
      if (!hub.isUuid(req.params.id)) {
        return res.status(400).json({ ok: false, error: { code: 'MEMBER_ID_INVALID', message: 'Member id is invalid' } });
      }
      if (typeof opts.query !== 'function') return noDb(res);
      const out = await memberDetail(opts.query, req.params.id);
      if (!out.available) return noDb(res);
      if (!out.member) return res.status(404).json({ ok: false, error: { code: 'MEMBER_NOT_FOUND', message: 'Member not found' } });
      return res.json(Object.assign({ ok: true }, out));
    } catch (e) {
      return res.status(500).json({ ok: false, error: { code: 'MEMBER_DETAIL_FAILED', message: 'Member detail failed' } });
    }
  });

  return router;
}

module.exports = { mountAdminMembersRoutes: mountAdminMembersRoutes };
