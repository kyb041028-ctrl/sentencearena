'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const boardSchema = require('../shared/board-schema-core');
const { createBoardService } = require('./board-service');
const { createBoardMemoryRepository } = require('./board-memory-repository');
const { createBoardSupabaseRepository } = require('./board-supabase-repository');
const { createMockUserContextAdapter, createUnavailableUserContextAdapter } = require('./board-user-context-adapter');

function extractBearer(req) {
  const h = req.headers.authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function publicError(res, err) {
  const raw = (err && err.code) || 'BOARD_SERVER_ERROR';
  const alienForbidden =
    raw === 'ALIEN_DIRECT_ACCESS_FORBIDDEN'
    || raw === 'ALIEN_WRITE_FORBIDDEN'
    || raw === 'ALIEN_REACTION_FORBIDDEN'
    || raw === 'ALIEN_EARTH_PARTICIPATE_FORBIDDEN'
    || raw === 'ALIEN_COMMUNITY_ACCESS_FORBIDDEN'
    || raw === 'CONTEXT_UNAVAILABLE'
    || raw === 'ALIEN_CONTEXT_UNAVAILABLE'
    || (typeof raw === 'string' && raw.indexOf('ALIEN_') === 0);
  if (alienForbidden) {
    return res.status(403).json({
      ok: false,
      error: 'ALIEN_EARTH_PARTICIPATE_FORBIDDEN',
    });
  }
  const code = raw;
  const status =
    code === 'BOARD_AUTH_REQUIRED' ? 401 :
    code === 'BOARD_FORBIDDEN' || code === 'BOARD_OFFICIAL_OPERATOR_ONLY' || code === 'BOARD_REPORT_SELF_FORBIDDEN' || code === 'SELF_EMPATHY' || code === 'LEGAL_GATE_INCOMPLETE' || code === 'SANCTION_WRITE_RESTRICTED' || code === 'SANCTION_ACCOUNT_RESTRICTED' || code === 'SANCTION_TEMP_SUSPENDED' || code === 'SANCTION_PERMANENT_BAN' || code === 'MISINFO_REPORT_RESTRICTED' ? 403 :
    code === 'BOARD_POST_NOT_FOUND' || code === 'BOARD_COMMENT_NOT_FOUND' ? 404 :
    code === 'BOARD_API_NOT_ACTIVATED' || code === 'BOARD_USER_TERRITORY_UNAVAILABLE' ? 503 :
    code.startsWith('BOARD_') || code.startsWith('MISINFO_') ? 400 : 500;
  const payload = {
    ok: false,
    error: code,
  };
  if (code === 'BOARD_OFFICIAL_TITLE_RESERVED') {
    payload.message = (err && err.message) || boardSchema.BOARD_OFFICIAL_TITLE_RESERVED_MESSAGE;
  }
  return res.status(status).json(payload);
}

function createBoardRouter(options) {
  const opts = options || {};
  const router = express.Router();
  const supabaseUrl = opts.supabaseUrl || '';
  const supabaseAnonKey = opts.supabaseAnonKey || '';
  const createUserClient = opts.createUserClient;
  const operational = opts.operational === true;

  const memoryRepo = opts.repository || createBoardMemoryRepository();
  const userContext = opts.userContext || (
    operational
      ? createUnavailableUserContextAdapter()
      : createMockUserContextAdapter({ defaultTerritory: 'CENTRAL' })
  );

  // Until migration is applied, routes exist but service stays deactivated unless explicitly enabled with memory mode.
  const useMemory = opts.useMemory === true || !operational;
  const repository = useMemory
    ? memoryRepo
    : null;

  function getService(req, actor) {
    let repo = repository;
    const resolvedActor = actor || req.boardActor;
    if (!useMemory) {
      if (resolvedActor && resolvedActor.supabase) {
        repo = createBoardSupabaseRepository({ client: resolvedActor.supabase });
      } else if (createUserClient) {
        const token = extractBearer(req);
        const userClient = createUserClient(token);
        if (!userClient) {
          const err = new Error('BOARD_AUTH_REQUIRED');
          err.code = 'BOARD_AUTH_REQUIRED';
          throw err;
        }
        repo = createBoardSupabaseRepository({ client: userClient });
      }
    }
    return createBoardService({
      repository: repo || memoryRepo,
      userContext,
      alienAccess: opts.alienAccess || null,
      operational: operational || useMemory,
      onReportCreated: opts.onReportCreated || null,
      onBehaviorReviewed: opts.onBehaviorReviewed || null,
    });
  }

  async function resolveActor(req, res) {
    if (typeof opts.resolveActorFromRequest === 'function') {
      const fromCookie = await opts.resolveActorFromRequest(req, res);
      if (fromCookie && fromCookie.userId) return fromCookie;
    }
    const token = extractBearer(req);
    if (!token) {
      if (useMemory && req.headers['x-user-id']) {
        return { userId: String(req.headers['x-user-id']) };
      }
      return null;
    }
    if (opts.resolveActor) return opts.resolveActor(req, token);
    if (!supabaseUrl || !supabaseAnonKey) {
      if (useMemory && req.headers['x-user-id']) {
        return { userId: String(req.headers['x-user-id']) };
      }
      return null;
    }
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data || !data.user) return null;
    return { userId: data.user.id };
  }

  function requireLegalMember(req, res, next) {
    const uid = req.boardActor && req.boardActor.userId;
    if (!uid) return publicError(res, { code: 'BOARD_AUTH_REQUIRED' });
    const { createLegalGateService } = require('./legal-gate-service');
    createLegalGateService()
      .assertCompleteForUser(uid)
      .then(function () {
        next();
      })
      .catch(function (e) {
        publicError(res, e);
      });
  }

  function requireActor(req, res, next) {
    resolveActor(req, res)
      .then((actor) => {
        if (!actor) return publicError(res, { code: 'BOARD_AUTH_REQUIRED' });
        req.boardActor = actor;
        next();
      })
      .catch(() => publicError(res, { code: 'BOARD_AUTH_REQUIRED' }));
  }

  function createGuestCentralReadService() {
    const persist = require('./achievement-persist-service');
    const adminRepo = createBoardSupabaseRepository({ client: persist.getAdminClient() });
    return createBoardService({
      repository: adminRepo,
      userContext,
      alienAccess: opts.alienAccess || null,
      operational: true,
    });
  }

  router.get('/popular', async (req, res) => {
    try {
      const actor = await resolveActor(req, res);
      let service;
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
      } else {
        service = getService(req, actor);
      }
      const result = await service.listPopularPosts(actor, {
        period: req.query.period,
        territory: req.query.territory,
        boardStage: req.query.boardStage,
        limit: req.query.limit,
      });
      return res.json({
        ok: true,
        period: result.period,
        from: result.from,
        to: result.to,
        posts: result.posts,
      });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.get('/posts', async (req, res) => {
    try {
      const actor = await resolveActor(req, res);
      let service;
      let listFilter = {
        territory: req.query.territory || undefined,
        status: req.query.status || undefined,
      };
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
        listFilter.territory = 'CENTRAL';
        listFilter.status = 'ACTIVE';
      } else {
        service = getService(req, actor);
      }
      const posts = await service.listPosts(actor, listFilter);
      return res.json({ ok: true, posts });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.get('/posts/:postId', async (req, res) => {
    try {
      const actor = await resolveActor(req, res);
      let service;
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
      } else {
        service = getService(req, actor);
      }
      const post = await service.getPost(actor, req.params.postId);
      if (!actor && post && post.territory !== 'CENTRAL') {
        return publicError(res, { code: 'BOARD_FORBIDDEN' });
      }
      return res.json({ ok: true, post });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.post('/posts', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.createPost(req.boardActor, req.body || {});
      return res.status(201).json({
        ok: true,
        post: result.post,
        newlyGrantedAchievements: result.newlyGrantedAchievements || [],
        progression: result.progression || null,
        progressionError: result.progressionError || null,
      });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.patch('/posts/:postId', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const post = await service.updatePost(req.boardActor, req.params.postId, req.body || {});
      return res.json({ ok: true, post });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.delete('/posts/:postId', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const post = await service.deletePost(req.boardActor, req.params.postId);
      return res.json({ ok: true, post });
    } catch (e) {
      return publicError(res, e);
    }
  });

  function empathyJson(result) {
    return {
      ok: true,
      granted: !!result.granted,
      revoked: !!result.revoked,
      duplicate: !!result.duplicate,
      reason: result.reason,
      fame: result.fame,
      previousFame: result.previousFame,
      fameDelta: result.fameDelta,
      level: result.level,
      xp: result.xp,
      expPercent: result.expPercent,
      newlyGrantedAchievements: result.newlyGrantedAchievements || [],
    };
  }

  router.post('/posts/:postId/empathy', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.receivePostEmpathy(req.boardActor, req.params.postId);
      return res.json(empathyJson(result));
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.delete('/posts/:postId/empathy', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.revokePostEmpathy(req.boardActor, req.params.postId);
      return res.json(empathyJson(result));
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.get('/posts/:postId/comments', async (req, res) => {
    try {
      const actor = await resolveActor(req, res);
      let service;
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
        const post = await service.getPost(actor, req.params.postId);
        if (!post || post.territory !== 'CENTRAL') {
          return publicError(res, { code: 'BOARD_FORBIDDEN' });
        }
        const comments = await service.listComments(actor, req.params.postId);
        return res.json({ ok: true, comments });
      }
      service = getService(req, actor);
      const comments = await service.listComments(actor, req.params.postId);
      return res.json({ ok: true, comments });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.post('/posts/:postId/comments', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.createComment(req.boardActor, req.params.postId, req.body || {});
      return res.status(201).json({
        ok: true,
        comment: result.comment,
        newlyGrantedAchievements: result.newlyGrantedAchievements || [],
        progression: result.progression || null,
        progressionError: result.progressionError || null,
      });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.post('/comments/:commentId/empathy', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.receiveCommentEmpathy(req.boardActor, req.params.commentId);
      return res.json(empathyJson(result));
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.delete('/comments/:commentId/empathy', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.revokeCommentEmpathy(req.boardActor, req.params.commentId);
      return res.json(empathyJson(result));
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.patch('/comments/:commentId', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const comment = await service.updateComment(req.boardActor, req.params.commentId, req.body || {});
      return res.json({ ok: true, comment });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.delete('/comments/:commentId', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const comment = await service.deleteComment(req.boardActor, req.params.commentId);
      return res.json({ ok: true, comment });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.post('/reactions/toggle', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.toggleReaction(req.boardActor, req.body || {});
      return res.json({ ok: true, result });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.post('/reports', requireActor, requireLegalMember, async (req, res) => {
    try {
      const service = getService(req);
      const report = await service.createReport(req.boardActor, req.body || {});
      return res.status(201).json({ ok: true, report: boardSchema.mapReportForMember(report) });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.get('/misinfo-restriction', requireActor, requireLegalMember, async (req, res) => {
    try {
      const misinfoAbuse = require('./misinfo-report-abuse-service');
      const out = await misinfoAbuse.publicNotice(req.boardActor && req.boardActor.userId);
      return res.json(out);
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.post('/misinfo-restriction/appeal', requireActor, requireLegalMember, async (req, res) => {
    try {
      const misinfoAbuse = require('./misinfo-report-abuse-service');
      const out = await misinfoAbuse.submitAppeal(req.boardActor && req.boardActor.userId, (req.body && req.body.body) || '');
      return res.status(201).json(out);
    } catch (e) {
      return publicError(res, e);
    }
  });

  return router;
}

module.exports = {
  createBoardRouter,
};
