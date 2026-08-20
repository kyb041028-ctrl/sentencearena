'use strict';

/**
 * 데일리 이슈 HTTP 라우터 (관리자 + 공개)
 * route → validation → auth → review service → repository
 */

const express = require('express');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const reviewService = require('./daily-issue-review-service');
const { createDailyIssueReviewRepository } = require('./daily-issue-review-repository');
const { createAdminAccessGuard } = require('./daily-issue-admin-auth');
const { createMemoryRateLimiter, clientKey } = require('./daily-issue-api-rate-limit');
const errors = require('./daily-issue-api-errors');
const validation = require('./daily-issue-api-validation');
const ser = require('./daily-issue-api-serializers');
const seedCore = require('../shared/daily-issue-alignment-seed-core');
const {
  createDailyIssueAlignmentReactionStore,
  createMemoryDailyIssueAlignmentReactionStore,
} = require('./daily-issue-alignment-reaction-store');
const {
  createDailyIssueCommentStore,
  createMemoryDailyIssueCommentStore,
} = require('./daily-issue-comment-store');
const commentCore = require('../shared/daily-issue-comment-core');
const { resolveCorsAllowlist } = require('./http-cors-config');

function settle(v) {
  if (v && typeof v.then === 'function') return v;
  return Promise.resolve(v);
}

function defaultCorsOrigins() {
  return resolveCorsAllowlist(process.env);
}

function createDailyIssueRouter(options) {
  const opt = options || {};
  const router = express.Router();
  const rateLimiter = opt.rateLimiter || createMemoryRateLimiter({ now: opt.now });
  const adminLimits = Object.assign(
    { listPerMin: 120, mutatePerMin: 30, publicPerMin: 180 },
    opt.rateLimits || {},
  );
  const corsOrigins = opt.corsOrigins || defaultCorsOrigins();
  const adminGuard =
    opt.adminAuthGuard ||
    createAdminAccessGuard({
      supabaseUrl: opt.supabaseUrl,
      supabaseAnonKey: opt.supabaseAnonKey,
      allowedRoles: opt.allowedAdminRoles || ['ADMIN', 'OWNER'],
    });

  let repositoryInstance = opt.repositoryInstance || null;
  let repoReady = null;
  let reactionStoreInstance = opt.reactionStore || null;
  let commentStoreInstance = opt.commentStore || null;
  let pgExecutorInstance = opt.executor || null;

  function getPgExecutor() {
    if (pgExecutorInstance) return pgExecutorInstance;
    const kind = String(opt.repositoryKind || process.env.DAILY_ISSUE_REPOSITORY || 'json').toLowerCase();
    if (kind !== 'db') return null;
    const pg = require('./daily-issue-pg-client');
    pgExecutorInstance = pg.createDailyIssuePgExecutor({
      databaseUrl: opt.databaseUrl,
      schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
    });
    return pgExecutorInstance;
  }

  function getReactionStore() {
    if (reactionStoreInstance) return reactionStoreInstance;
    if (opt.repositoryInstance && !opt.reactionStore) {
      reactionStoreInstance = createMemoryDailyIssueAlignmentReactionStore();
      return reactionStoreInstance;
    }
    const kind = String(opt.repositoryKind || process.env.DAILY_ISSUE_REPOSITORY || 'json').toLowerCase();
    if (kind === 'db') {
      const exec = getPgExecutor();
      if (exec && exec.ok) {
        reactionStoreInstance = createDailyIssueAlignmentReactionStore({
          kind: 'pg',
          executor: exec,
          schemaName: opt.schemaName || exec.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
        });
        return reactionStoreInstance;
      }
    }
    if (kind === 'json') {
      reactionStoreInstance = createDailyIssueAlignmentReactionStore({
        kind: 'json',
        reviewRoot: opt.reviewRoot,
      });
      return reactionStoreInstance;
    }
    reactionStoreInstance = createMemoryDailyIssueAlignmentReactionStore();
    return reactionStoreInstance;
  }

  function getCommentStore() {
    if (commentStoreInstance) return commentStoreInstance;
    if (opt.repositoryInstance && !opt.commentStore) {
      commentStoreInstance = createMemoryDailyIssueCommentStore();
      return commentStoreInstance;
    }
    const kind = String(opt.repositoryKind || process.env.DAILY_ISSUE_REPOSITORY || 'json').toLowerCase();
    if (kind === 'db') {
      const exec = getPgExecutor();
      if (exec && exec.ok) {
        commentStoreInstance = createDailyIssueCommentStore({
          kind: 'pg',
          executor: exec,
          schemaName: opt.schemaName || exec.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
        });
        return commentStoreInstance;
      }
    }
    commentStoreInstance = createMemoryDailyIssueCommentStore();
    return commentStoreInstance;
  }

  async function lookupDisplayNames(userIds) {
    if (typeof opt.lookupDisplayNames === 'function') {
      try {
        return (await opt.lookupDisplayNames(userIds)) || {};
      } catch (_) {
        return {};
      }
    }
    const ids = (userIds || []).map(String).filter(Boolean);
    if (!ids.length) return {};
    const exec = getPgExecutor();
    if (!exec || exec.ok === false || typeof exec.query !== 'function') return {};
    try {
      const res = await exec.query(
        'SELECT id::text AS id, display_name FROM public.profiles WHERE id = ANY($1::uuid[])',
        [ids],
      );
      const map = {};
      (res.rows || []).forEach(function (r) {
        map[String(r.id)] = r.display_name || null;
      });
      return map;
    } catch (_) {
      return {};
    }
  }

  async function applyCommentXpSafe(userId, commentId) {
    if (opt.applyIssueCommentXp === false) return;
    let applyFn = opt.applyIssueCommentXp;
    if (typeof applyFn !== 'function') {
      try {
        applyFn = require('./user-progression-service').applyIssueCommentCreatedXp;
      } catch (_) {
        return;
      }
    }
    try {
      await applyFn(userId, commentId);
    } catch (e) {
      console.error('[daily-issue comment xp]', (e && e.code) || (e && e.message) || e);
    }
  }

  async function loadPublicIssue(id) {
    await ensureRepo();
    const found = await settle(getRepo().getById(id));
    if (!found.ok) return { ok: false, error: 'ITEM_NOT_FOUND' };
    const asOf = (serviceOpts().asOf) || new Date().toISOString();
    const pub = ser.toPublicIssue(found.item, asOf);
    if (!pub) return { ok: false, error: 'ITEM_NOT_FOUND' };
    return { ok: true, item: found.item, pub: pub };
  }

  async function resolvePublicActor(req, res) {
    if (typeof opt.resolveActorFromRequest === 'function') {
      const actor = await opt.resolveActorFromRequest(req, res);
      if (actor && actor.userId) return actor;
    }
    return null;
  }

  function getRepo() {
    if (repositoryInstance) return repositoryInstance;
    if (opt.getRepository) {
      repositoryInstance = opt.getRepository();
      return repositoryInstance;
    }
    const kind = opt.repositoryKind || process.env.DAILY_ISSUE_REPOSITORY || 'json';
    const repoOpts = {
      kind: kind,
      reviewRoot: opt.reviewRoot,
      schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
      executor: opt.executor,
    };
    if (opt.databaseUrl !== undefined) repoOpts.databaseUrl = opt.databaseUrl;
    if (opt.enabled !== undefined) repoOpts.enabled = opt.enabled;
    repositoryInstance = createDailyIssueReviewRepository(repoOpts);
    return repositoryInstance;
  }

  function ensureRepo() {
    if (repoReady) return repoReady;
    const repo = getRepo();
    if (typeof repo.initialize !== 'function') {
      repoReady = Promise.resolve(repo);
      return repoReady;
    }
    repoReady = Promise.resolve(repo.initialize()).then(function (init) {
      if (init && init.ok === false) {
        repoReady = null;
        repositoryInstance = null;
        const err = new Error(init.error || 'DATABASE_UNAVAILABLE');
        err.code = init.error || 'DATABASE_UNAVAILABLE';
        throw err;
      }
      return repo;
    });
    return repoReady;
  }

  function serviceOpts(extra) {
    return Object.assign(
      {
        repositoryInstance: getRepo(),
        asOf: opt.asOf || (opt.now ? new Date(opt.now()).toISOString() : undefined),
      },
      extra || {},
    );
  }

  function applySecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const origin = String((req.headers && req.headers.origin) || '');
    if (origin) {
      if (corsOrigins.indexOf(origin) >= 0) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      } else {
        res.locals.corsDenied = true;
      }
    }
    if (req.method === 'OPTIONS') {
      if (res.locals.corsDenied) {
        return res.status(403).json({
          ok: false,
          requestId: res.locals.requestId,
          error: { code: 'CORS_ORIGIN_DENIED', message: 'Origin not allowed', details: null },
        });
      }
      return res.status(204).end();
    }
    return next();
  }

  function attachRequestId(req, res, next) {
    const id = errors.newRequestId();
    res.locals.requestId = id;
    req.dailyIssueRequestId = id;
    res.setHeader('X-Request-Id', id);
    return next();
  }

  function logLine(level, msg, meta) {
    const safe = Object.assign({}, meta || {});
    delete safe.token;
    delete safe.authorization;
    const line = '[daily-issue-api] ' + level + ' ' + msg + ' ' + JSON.stringify(safe);
    if (level === 'error') console.error(line);
    else console.log(line);
  }

  function handleRouteError(err, req, res) {
    const code = (err && err.code) || 'INTERNAL_ERROR';
    logLine('error', 'route_error', {
      requestId: res.locals.requestId,
      code: code,
      path: req.path,
      method: req.method,
    });
    if (code === 'ADMIN_AUTH_NOT_CONFIGURED') {
      return errors.sendFail(res, code, null, 401);
    }
    return errors.sendFail(res, code);
  }

  router.use(attachRequestId);
  router.use(applySecurityHeaders);

  function rateLimit(bucket, limit) {
    return function (req, res, next) {
      const key = clientKey(req);
      const result = rateLimiter.check(bucket, key, limit, 60000);
      if (!result.ok) {
        res.setHeader('Retry-After', String(Math.ceil((result.retryAfterMs || 60000) / 1000)));
        return errors.sendFail(res, 'RATE_LIMITED');
      }
      return next();
    };
  }

  // ---- Admin routes ----
  function withAdminAuth(handler) {
    return function (req, res) {
      adminGuard(req, res, function (err) {
        if (err) return handleRouteError(err, req, res);
        return handler(req, res).catch(function (e) {
          return handleRouteError(e, req, res);
        });
      });
    };
  }

  async function listAdmin(req, res) {
    if (res.locals.corsDenied && req.headers.origin) {
      return errors.sendFail(res, 'FORBIDDEN', { reason: 'CORS_ORIGIN_DENIED' }, 403);
    }
    await ensureRepo();
    const lim = validation.parseLimit(req.query.limit);
    if (!lim.ok) return errors.sendFail(res, lim.error, lim.details);
    const off = validation.parseOffset(req.query.offset || req.query.cursor);
    if (!off.ok) return errors.sendFail(res, off.error, off.details);
    const st = validation.parseStatus(req.query.status);
    if (!st.ok) return errors.sendFail(res, st.error, st.details);
    const cat = validation.parseCategory(req.query.category);
    if (!cat.ok) return errors.sendFail(res, cat.error, cat.details);

    const listed = await settle(reviewService.listItems(serviceOpts({ status: st.data || undefined })));
    if (!listed.ok) return errors.sendFail(res, listed.error || 'INTERNAL_ERROR');

    // Prefer full list for filters not in slim helper
    const repoList = await settle(getRepo().list({ status: st.data || undefined }));
    if (!repoList.ok) return errors.sendFail(res, repoList.error || 'DATABASE_UNAVAILABLE');
    let items = (repoList.items || []).slice();
    if (cat.data) {
      items = items.filter(function (it) {
        return it.category === cat.data;
      });
    }
    if (req.query.duplicateDecision) {
      const dd = String(req.query.duplicateDecision);
      items = items.filter(function (it) {
        return it.duplicateMeta && it.duplicateMeta.decision === dd;
      });
    }
    if (req.query.publicationDecision) {
      const pd = String(req.query.publicationDecision);
      items = items.filter(function (it) {
        const v =
          it.publicationDecision ||
          (it.lifecycleMeta && it.lifecycleMeta.publicationDecision) ||
          '';
        return v === pd;
      });
    }
    if (
      req.query.postReviewQueue === '1' ||
      req.query.postReviewQueue === 'true' ||
      String(req.query.publishedBy || '') === 'AUTO_MORNING_EDITORIAL'
    ) {
      const actor = require('../shared/daily-issue-publication-decision-core').ACTOR_AUTO_MORNING;
      items = items.filter(function (it) {
        if (!it || it.status !== 'PUBLISHED') return false;
        if (String(it.reviewerId || '') === actor) return true;
        const meta = it.lifecycleMeta || {};
        if (meta.publishedBy === actor || meta.autoMorningPublished === true) return true;
        return false;
      });
    }
    if (req.query.expiresBefore) {
      const before = Date.parse(String(req.query.expiresBefore));
      if (isFinite(before)) {
        items = items.filter(function (it) {
          const e = Date.parse(it.expiresAt || '');
          return isFinite(e) && e <= before;
        });
      }
    }
    const sort = String(req.query.sort || 'queuedAt_desc');
    items.sort(function (a, b) {
      const ta = Date.parse(a.queuedAt || '') || 0;
      const tb = Date.parse(b.queuedAt || '') || 0;
      return sort === 'queuedAt_asc' ? ta - tb : tb - ta;
    });
    const page = items.slice(off.data, off.data + lim.data).map(ser.toAdminListItem);
    logLine('info', 'admin_list', { requestId: res.locals.requestId, count: page.length });
    return errors.sendOk(res, {
      items: page,
      count: page.length,
      total: items.length,
      offset: off.data,
      limit: lim.data,
    });
  }

  async function showAdmin(req, res) {
    await ensureRepo();
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const shown = await settle(reviewService.showItem(idv.data, serviceOpts()));
    if (!shown.ok) return errors.sendFail(res, shown.error || 'ITEM_NOT_FOUND');
    const detail = ser.toAdminDetail(shown.item);
    if (ser.containsForbiddenKeys(detail)) {
      return errors.sendFail(res, 'INTERNAL_ERROR');
    }
    return errors.sendOk(res, { item: detail });
  }

  async function mutate(req, res, toStatus, bodyOpts) {
    await ensureRepo();
    const ct = validation.requireJsonContentType(req);
    if (!ct.ok) return errors.sendFail(res, ct.error);

    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);

    const parsed = validation.parseTransitionBody(req.body, bodyOpts);
    if (!parsed.ok) return errors.sendFail(res, parsed.error, parsed.details);

    const result = await settle(
      reviewService.transitionItem(
        idv.data,
        toStatus,
        serviceOpts({
          expectedStatus: parsed.data.expectedStatus,
          expectedLockVersion: parsed.data.expectedLockVersion,
          reviewer: parsed.data.reviewerId,
          actorId: parsed.data.reviewerId,
          reason: parsed.data.reasonCode,
          reasonText: parsed.data.reasonText,
          action: String(toStatus).toLowerCase(),
          requestId: res.locals.requestId,
        }),
      ),
    );

    if (!result.ok) {
      const details =
        result.reasons || result.message
          ? { reasons: result.reasons || null, message: result.message || null }
          : null;
      return errors.sendFail(res, result.error || 'INTERNAL_ERROR', details);
    }

    logLine('info', 'admin_transition', {
      requestId: res.locals.requestId,
      id: idv.data,
      toStatus: toStatus,
      adminUserId: req.dailyIssueAdmin && req.dailyIssueAdmin.userId,
      adminRole: req.dailyIssueAdmin && req.dailyIssueAdmin.role,
    });
    return errors.sendOk(res, {
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      item: ser.toAdminDetail(result.item),
    });
  }

  async function revalidate(req, res) {
    await ensureRepo();
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const result = await settle(reviewService.revalidateItem(idv.data, serviceOpts()));
    if (!result.ok) return errors.sendFail(res, result.error || 'ITEM_NOT_FOUND');
    return errors.sendOk(res, {
      itemId: result.itemId,
      revalidation: result.revalidation,
    });
  }

  async function history(req, res) {
    await ensureRepo();
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const lim = validation.parseLimit(req.query.limit, 50);
    if (!lim.ok) return errors.sendFail(res, lim.error);
    const off = validation.parseOffset(req.query.offset || req.query.cursor);
    if (!off.ok) return errors.sendFail(res, off.error);

    const hist = await settle(
      reviewService.readHistory(serviceOpts({ entityId: idv.data, limit: lim.data })),
    );
    let events = (hist.events || []).filter(function (e) {
      return e && e.entityId === idv.data;
    });
    events = events.slice(off.data, off.data + lim.data).map(ser.toPublicAuditEvent);
    return errors.sendOk(res, { events: events, count: events.length });
  }

  router.get(
    '/admin/daily-issues/review',
    rateLimit('admin_list', adminLimits.listPerMin),
    withAdminAuth(listAdmin),
  );
  router.get(
    '/admin/daily-issues/review/:id',
    rateLimit('admin_list', adminLimits.listPerMin),
    withAdminAuth(showAdmin),
  );
  router.get(
    '/admin/daily-issues/review/:id/history',
    rateLimit('admin_list', adminLimits.listPerMin),
    withAdminAuth(history),
  );
  router.post(
    '/admin/daily-issues/review/:id/approve',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(function (req, res) {
      return mutate(req, res, lifecycle.REVIEW_STATUS.APPROVED, {});
    }),
  );
  router.post(
    '/admin/daily-issues/review/:id/hold',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(function (req, res) {
      return mutate(req, res, lifecycle.REVIEW_STATUS.HELD, {
        requireReason: true,
        reasonAllowlist: lifecycle.HOLD_REASONS,
        reasonError: 'HOLD_REASON_REQUIRED',
      });
    }),
  );
  router.post(
    '/admin/daily-issues/review/:id/reject',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(function (req, res) {
      return mutate(req, res, lifecycle.REVIEW_STATUS.REJECTED, {
        requireReason: true,
        reasonAllowlist: lifecycle.REJECT_REASONS,
        reasonError: 'REJECT_REASON_REQUIRED',
      });
    }),
  );
  router.post(
    '/admin/daily-issues/review/:id/publish',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(function (req, res) {
      return mutate(req, res, lifecycle.REVIEW_STATUS.PUBLISHED, {});
    }),
  );
  router.post(
    '/admin/daily-issues/review/:id/expire',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(function (req, res) {
      return mutate(req, res, lifecycle.REVIEW_STATUS.EXPIRED, {});
    }),
  );
  router.post(
    '/admin/daily-issues/review/:id/retire',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(function (req, res) {
      return mutate(req, res, lifecycle.REVIEW_STATUS.RETIRED, {
        requireReason: true,
        reasonAllowlist: lifecycle.RETIRE_REASONS,
        reasonError: 'RETIRE_REASON_REQUIRED',
      });
    }),
  );
  router.post(
    '/admin/daily-issues/review/:id/revalidate',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(revalidate),
  );
  router.post(
    '/admin/daily-issues/review/:id/alignment',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(setAlignment),
  );

  async function setAlignment(req, res) {
    await ensureRepo();
    const ct = validation.requireJsonContentType(req);
    if (!ct.ok) return errors.sendFail(res, ct.error);
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const body = req.body || {};
    const parsed = seedCore.parseDirectionStrict(body.alignmentDirection || body.alignment_direction);
    if (!parsed.ok) return errors.sendFail(res, 'ALIGNMENT_DIRECTION_INVALID');
    const result = await settle(
      reviewService.setAlignmentDirection(
        idv.data,
        parsed.value,
        serviceOpts({
          expectedLockVersion: body.expectedLockVersion,
          actorId: (req.dailyIssueAdmin && req.dailyIssueAdmin.userId) || body.reviewerId || 'admin',
          reviewer: body.reviewerId,
        }),
      ),
    );
    if (!result.ok) return errors.sendFail(res, result.error || 'INTERNAL_ERROR');
    return errors.sendOk(res, {
      item: ser.toAdminDetail(result.item),
    });
  }

  // ---- Morning scheduler ops ----
  const morningScheduler = opt.morningScheduler || require('./daily-issue-morning-scheduler-service');

  function morningOpts(extra) {
    return Object.assign(
      {
        repositoryInstance: getRepo(),
        repository: opt.repositoryKind || process.env.DAILY_ISSUE_REPOSITORY,
        reviewRoot: opt.reviewRoot,
        schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
        executor: opt.executor,
        schedulerStore: opt.schedulerStore,
      },
      extra || {},
    );
  }

  async function morningStatus(req, res) {
    await ensureRepo();
    const st = await settle(morningScheduler.getStatus(morningOpts({ asOf: req.query.asOf })));
    if (!st.ok) return errors.sendFail(res, st.error || 'INTERNAL_ERROR');
    return errors.sendOk(res, st);
  }

  async function morningHistory(req, res) {
    await ensureRepo();
    const lim = validation.parseLimit(req.query.limit, 50);
    if (!lim.ok) return errors.sendFail(res, lim.error);
    const off = validation.parseOffset(req.query.offset || req.query.cursor);
    if (!off.ok) return errors.sendFail(res, off.error);
    const hist = await settle(
      morningScheduler.getHistory(
        morningOpts({
          runType: req.query.runType || undefined,
          status: req.query.status || undefined,
          limit: lim.data,
          offset: off.data,
        }),
      ),
    );
    if (!hist.ok) return errors.sendFail(res, hist.error || 'INTERNAL_ERROR');
    return errors.sendOk(res, { items: hist.items || [], total: hist.total != null ? hist.total : (hist.items || []).length });
  }

  async function morningRunCollect(req, res) {
    const gate = morningScheduler.allowManualRun({ allowManual: opt.allowMorningManual === true });
    if (!gate.ok) return errors.sendFail(res, gate.error || 'FORBIDDEN', null, 403);
    await ensureRepo();
    const body = req.body || {};
    const result = await settle(
      morningScheduler.runCollect(
        morningOpts({
          manual: true,
          allowRetryAfterFailure: body.allowRetry === true,
          asOf: body.asOf,
          dateKey: body.dateKey,
          dryRun: body.dryRun === true,
          actorId: body.reviewerId || 'admin-manual',
          collectRunner: opt.collectRunner,
          feedBodies: opt.feedBodies,
        }),
      ),
    );
    return errors.sendOk(res, result);
  }

  async function morningRunPublish(req, res) {
    const gate = morningScheduler.allowManualRun({ allowManual: opt.allowMorningManual === true });
    if (!gate.ok) return errors.sendFail(res, gate.error || 'FORBIDDEN', null, 403);
    await ensureRepo();
    const body = req.body || {};
    const result = await settle(
      morningScheduler.runPublish(
        morningOpts({
          manual: true,
          allowRetryAfterFailure: body.allowRetry === true,
          asOf: body.asOf,
          dateKey: body.dateKey,
          dryRun: body.dryRun === true,
          actorId: body.reviewerId || 'admin-manual',
          // never bypass publication decision; skipCollectGate only if collect already ok or forceCollectGateSkip for tests
          skipCollectGate: body.skipCollectGate === true && opt.allowSkipCollectGate === true,
        }),
      ),
    );
    return errors.sendOk(res, result);
  }

  router.get(
    '/admin/daily-issues/morning/status',
    rateLimit('admin_list', adminLimits.listPerMin),
    withAdminAuth(morningStatus),
  );
  router.get(
    '/admin/daily-issues/morning/history',
    rateLimit('admin_list', adminLimits.listPerMin),
    withAdminAuth(morningHistory),
  );
  router.post(
    '/admin/daily-issues/morning/run-collect',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(morningRunCollect),
  );
  router.post(
    '/admin/daily-issues/morning/run-publish',
    rateLimit('admin_mutate', adminLimits.mutatePerMin),
    withAdminAuth(morningRunPublish),
  );

  // ---- Public routes ----
  async function listPublic(req, res) {
    if (res.locals.corsDenied && req.headers.origin) {
      return errors.sendFail(res, 'FORBIDDEN', { reason: 'CORS_ORIGIN_DENIED' }, 403);
    }
    await ensureRepo();
    const lim = validation.parseLimit(req.query.limit);
    if (!lim.ok) return errors.sendFail(res, lim.error);
    const off = validation.parseOffset(req.query.offset || req.query.cursor);
    if (!off.ok) return errors.sendFail(res, off.error);
    const cat = validation.parseCategory(req.query.category);
    if (!cat.ok) return errors.sendFail(res, cat.error);

    const asOf = (serviceOpts().asOf) || new Date().toISOString();
    const published = await settle(getRepo().getPublishedIssues({}));
    if (!published.ok) return errors.sendFail(res, published.error || 'DATABASE_UNAVAILABLE');

    let items = (published.items || [])
      .map(function (it) {
        return ser.toPublicIssue(it, asOf);
      })
      .filter(Boolean);
    if (items.some(function (it) {
      return ser.containsForbiddenKeys(it) || ser.containsPublicAlignmentLeak(it);
    })) {
      return errors.sendFail(res, 'INTERNAL_ERROR');
    }
    if (cat.data) {
      items = items.filter(function (it) {
        return it.category === cat.data;
      });
    }
    items.sort(function (a, b) {
      return (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0);
    });
    const page = items.slice(off.data, off.data + lim.data);
    return errors.sendOk(res, {
      items: page,
      count: page.length,
      total: items.length,
      offset: off.data,
      limit: lim.data,
    });
  }

  async function showPublic(req, res) {
    await ensureRepo();
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const asOf = (serviceOpts().asOf) || new Date().toISOString();
    const hasBearer = String((req.headers && req.headers.authorization) || '').indexOf('Bearer ') === 0;
    const foundAndActor = await Promise.all([
      settle(getRepo().getById(idv.data)),
      hasBearer ? resolvePublicActor(req, res) : Promise.resolve(null),
    ]);
    const found = foundAndActor[0];
    const actor = foundAndActor[1];
    if (!found.ok) return errors.sendFail(res, 'ITEM_NOT_FOUND');
    const pub = ser.toPublicIssue(found.item, asOf);
    if (!pub) return errors.sendFail(res, 'ITEM_NOT_FOUND');
    if (ser.containsForbiddenKeys(pub) || ser.containsPublicAlignmentLeak(pub)) {
      return errors.sendFail(res, 'INTERNAL_ERROR');
    }
    let viewerReaction = null;
    if (actor && actor.userId) {
      const active = await getReactionStore().getActive(actor.userId, found.item.id);
      viewerReaction = active && active.reactionType ? active.reactionType : null;
    }
    return errors.sendOk(res, { item: pub, viewerReaction: viewerReaction });
  }

  async function togglePublicReaction(req, res) {
    if (res.locals.corsDenied && req.headers.origin) {
      return errors.sendFail(res, 'FORBIDDEN', { reason: 'CORS_ORIGIN_DENIED' }, 403);
    }
    const actor = await resolvePublicActor(req, res);
    if (!actor || !actor.userId) return errors.sendFail(res, 'UNAUTHORIZED', null, 401);
    try {
      const { createLegalGateService } = require('./legal-gate-service');
      await createLegalGateService().assertCompleteForUser(actor.userId);
    } catch (e) {
      return errors.sendFail(res, (e && e.code) || 'LEGAL_GATE_INCOMPLETE', null, (e && e.status) || 403);
    }
    await ensureRepo();
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const reactionType = seedCore.trustedReactionTypeFromBody(req.body || {});
    if (!reactionType) return errors.sendFail(res, 'REACTION_TYPE_INVALID');
    const found = await settle(getRepo().getById(idv.data));
    if (!found.ok) return errors.sendFail(res, 'ITEM_NOT_FOUND');
    const asOf = (serviceOpts().asOf) || new Date().toISOString();
    const pub = ser.toPublicIssue(found.item, asOf);
    if (!pub) return errors.sendFail(res, 'ITEM_NOT_FOUND');
    const direction = seedCore.normalizeDirection(found.item.alignmentDirection);
    const result = await getReactionStore().toggle({
      userId: actor.userId,
      issueId: found.item.id,
      reactionType: reactionType,
      directionSnapshot: direction,
      now: asOf,
    });
    if (!result.ok) return errors.sendFail(res, result.error || 'INTERNAL_ERROR');
    return errors.sendOk(res, {
      issueId: found.item.id,
      reactionType: result.reactionType,
      active: result.active,
    });
  }

  async function listPublicComments(req, res) {
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const loaded = await loadPublicIssue(idv.data);
    if (!loaded.ok) return errors.sendFail(res, loaded.error || 'ITEM_NOT_FOUND');
    const rows = await getCommentStore().listByIssueId(loaded.item.id);
    const hasBearer = String((req.headers && req.headers.authorization) || '').indexOf('Bearer ') === 0;
    const actor = hasBearer ? await resolvePublicActor(req, res) : null;
    const viewerId = actor && actor.userId ? actor.userId : null;
    const names = await lookupDisplayNames(
      rows.map(function (r) {
        return r.userId;
      }),
    );
    const items = rows
      .map(function (row) {
        return commentCore.toPublicComment(row, viewerId, names[String(row.userId)]);
      })
      .filter(Boolean);
    if (items.some(commentCore.containsForbiddenPublicKeys)) {
      return errors.sendFail(res, 'INTERNAL_ERROR');
    }
    return errors.sendOk(res, { items: items, count: items.length });
  }

  async function createPublicComment(req, res) {
    const actor = await resolvePublicActor(req, res);
    if (!actor || !actor.userId) return errors.sendFail(res, 'UNAUTHORIZED', null, 401);
    try {
      const { createLegalGateService } = require('./legal-gate-service');
      await createLegalGateService().assertCompleteForUser(actor.userId);
    } catch (e) {
      return errors.sendFail(res, (e && e.code) || 'LEGAL_GATE_INCOMPLETE', null, (e && e.status) || 403);
    }
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const parsed = commentCore.parseCommentBody(req.body && req.body.body);
    if (!parsed.ok) return errors.sendFail(res, parsed.error);
    const loaded = await loadPublicIssue(idv.data);
    if (!loaded.ok) return errors.sendFail(res, loaded.error || 'ITEM_NOT_FOUND');
    const created = await getCommentStore().create({
      issueId: loaded.item.id,
      userId: actor.userId,
      body: parsed.body,
    });
    if (!created.ok) return errors.sendFail(res, created.error || 'INTERNAL_ERROR');
    await applyCommentXpSafe(actor.userId, created.item.id);
    const names = await lookupDisplayNames([created.item.userId]);
    const item = commentCore.toPublicComment(created.item, actor.userId, names[String(created.item.userId)]);
    if (!item || commentCore.containsForbiddenPublicKeys(item)) {
      return errors.sendFail(res, 'INTERNAL_ERROR');
    }
    return errors.sendOk(res, { item: item }, 201);
  }

  async function deletePublicComment(req, res) {
    const actor = await resolvePublicActor(req, res);
    if (!actor || !actor.userId) return errors.sendFail(res, 'UNAUTHORIZED', null, 401);
    const idv = validation.parseId(req.params.id);
    if (!idv.ok) return errors.sendFail(res, idv.error);
    const cid = validation.parseId(req.params.commentId);
    if (!cid.ok) return errors.sendFail(res, cid.error);
    const loaded = await loadPublicIssue(idv.data);
    if (!loaded.ok) return errors.sendFail(res, loaded.error || 'ITEM_NOT_FOUND');
    const existing = await getCommentStore().getById(cid.data);
    if (!existing || existing.deletedAt) return errors.sendFail(res, 'COMMENT_NOT_FOUND');
    if (String(existing.issueId) !== String(loaded.item.id)) return errors.sendFail(res, 'COMMENT_NOT_FOUND');
    const removed = await getCommentStore().softDelete(cid.data, actor.userId);
    if (!removed.ok) return errors.sendFail(res, removed.error || 'INTERNAL_ERROR');
    return errors.sendOk(res, { deleted: true, id: cid.data });
  }

  function withPublic(handler) {
    return function (req, res) {
      return handler(req, res).catch(function (e) {
        return handleRouteError(e, req, res);
      });
    };
  }

  router.get('/daily-issues', rateLimit('public_list', adminLimits.publicPerMin), withPublic(listPublic));
  router.get('/daily-issues/:id', rateLimit('public_list', adminLimits.publicPerMin), withPublic(showPublic));
  router.get(
    '/daily-issues/:id/comments',
    rateLimit('public_list', adminLimits.publicPerMin),
    withPublic(listPublicComments),
  );
  router.post(
    '/daily-issues/:id/comments',
    rateLimit('public_list', adminLimits.publicPerMin),
    withPublic(createPublicComment),
  );
  router.delete(
    '/daily-issues/:id/comments/:commentId',
    rateLimit('public_list', adminLimits.publicPerMin),
    withPublic(deletePublicComment),
  );
  router.post(
    '/daily-issues/:id/reactions/toggle',
    rateLimit('public_list', adminLimits.publicPerMin),
    withPublic(togglePublicReaction),
  );

  router._test = {
    getRepo: getRepo,
    setRepository: function (repo) {
      repositoryInstance = repo;
    },
    rateLimiter: rateLimiter,
  };

  return router;
}

function createDailyIssueApiApp(options) {
  const expressApp = express();
  expressApp.use(express.json({ limit: '1mb' }));
  expressApp.use('/api', createDailyIssueRouter(options));
  expressApp.use(function (err, req, res, _next) {
    const code = (err && err.code) || 'INTERNAL_ERROR';
    if (!res.headersSent) {
      errors.sendFail(res, code);
    }
  });
  return expressApp;
}

module.exports = {
  createDailyIssueRouter: createDailyIssueRouter,
  createDailyIssueApiApp: createDailyIssueApiApp,
  defaultCorsOrigins: defaultCorsOrigins,
};
