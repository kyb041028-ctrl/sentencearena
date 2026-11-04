'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const boardSchema = require('../shared/board-schema-core');
const { createBoardService } = require('./board-service');
const { createBoardMemoryRepository } = require('./board-memory-repository');
const { createBoardSupabaseRepository } = require('./board-supabase-repository');
const { createActivityRegionPgRepository } = require('./activity-region-pg-repository');
const { createActivityRegionScoreRepository } = require('./activity-region-score-repository');
const { createActivityRegionSupabaseScoreRepository } = require('./activity-region-supabase-score-repository');
const { createMockUserContextAdapter, createUnavailableUserContextAdapter } = require('./board-user-context-adapter');
const regionService = require('./activity-region-service');
const { createActivityRegionStore } = require('./activity-region-store');

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
    code === 'BOARD_FORBIDDEN' || code === 'BOARD_OFFICIAL_OPERATOR_ONLY' || code === 'BOARD_REPORT_SELF_FORBIDDEN' || code === 'SELF_EMPATHY' || code === 'LEGAL_GATE_INCOMPLETE' || code === 'SANCTION_WRITE_RESTRICTED' || code === 'SANCTION_ACCOUNT_RESTRICTED' || code === 'SANCTION_TEMP_SUSPENDED' || code === 'SANCTION_PERMANENT_BAN' || code === 'MISINFO_REPORT_RESTRICTED' || code === 'REGION_MISMATCH' || code === 'GUEST_READ_ONLY' ? 403 :
    code === 'BOARD_POST_NOT_FOUND' || code === 'BOARD_COMMENT_NOT_FOUND' ? 404 :
    code === 'BOARD_API_NOT_ACTIVATED' || code === 'BOARD_USER_TERRITORY_UNAVAILABLE' || code === 'REGION_SCHEMA_UNAVAILABLE' ? 503 :
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
  const regionLedger = opts.regionLedger || createActivityRegionStore();
  const userContext = opts.userContext || (
    operational
      ? createUnavailableUserContextAdapter()
      : createMockUserContextAdapter({ defaultTerritory: 'CENTRAL' })
  );
  const pgQuery = typeof opts.pgQuery === 'function' ? opts.pgQuery : null;
  const pgRepo = pgQuery ? createActivityRegionPgRepository({ query: pgQuery }) : null;
  if (pgRepo && opts.activityRegionSchema === false) pgRepo.supportsActivityRegion = false;
  const supabaseAdmin = opts.supabaseAdmin || null;
  const schemaReady = pgRepo
    ? pgRepo.supportsActivityRegion === true
    : opts.activityRegionSchema === true && !!supabaseAdmin;
  const regionScores = opts.regionScores
    || (schemaReady && pgQuery ? createActivityRegionScoreRepository({ query: pgQuery }) : null)
    || (schemaReady && supabaseAdmin
      ? createActivityRegionSupabaseScoreRepository({ client: supabaseAdmin })
      : null);

  // Postgres가 있으면 그 저장소를 쓴다. 없으면 기존처럼 메모리 또는 Supabase 사용자 클라이언트.
  // 미국 쓰기는 서버 관리 클라이언트만 사용한다. 회원 JWT로는 미국 행을 넣지 않는다.
  const useMemory = pgRepo ? false : (opts.useMemory === true || !operational);
  const repository = useMemory ? memoryRepo : pgRepo;

  function supabaseRepo(client, allowRegion) {
    return createBoardSupabaseRepository({
      client: client,
      supportsActivityRegion: allowRegion === true,
    });
  }

  function getService(req, actor) {
    let repo = repository;
    const resolvedActor = actor || req.boardActor;
    if (!useMemory && !pgRepo) {
      if (resolvedActor && resolvedActor.activityRegion === 'US' && schemaReady && supabaseAdmin) {
        repo = supabaseRepo(supabaseAdmin, true);
      } else if (resolvedActor && resolvedActor.supabase) {
        repo = supabaseRepo(resolvedActor.supabase, false);
      } else if (createUserClient) {
        const token = extractBearer(req);
        const userClient = createUserClient(token);
        if (!userClient) {
          const err = new Error('BOARD_AUTH_REQUIRED');
          err.code = 'BOARD_AUTH_REQUIRED';
          throw err;
        }
        repo = supabaseRepo(userClient, false);
      }
    }
    return createBoardService({
      repository: repo || memoryRepo,
      userContext,
      alienAccess: opts.alienAccess || null,
      operational: operational || useMemory || !!pgRepo,
      regionLedger: regionLedger,
      regionScores: regionScores,
      onReportCreated: opts.onReportCreated || null,
      onBehaviorReviewed: opts.onBehaviorReviewed || null,
    });
  }

  function testActorFromHeader(req) {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return null;
    if (String(process.env.SA_TEST_ACTOR_HEADER || '').trim() !== '1') return null;
    if (!useMemory || pgRepo || supabaseAdmin) return null;
    const id = req && req.headers ? req.headers['x-user-id'] : '';
    if (!id) return null;
    return { userId: String(id) };
  }

  async function resolveActor(req, res) {
    if (typeof opts.resolveActorFromRequest === 'function') {
      const fromCookie = await opts.resolveActorFromRequest(req, res);
      if (fromCookie && fromCookie.userId) return fromCookie;
    }
    const token = extractBearer(req);
    if (!token) return testActorFromHeader(req);
    if (opts.resolveActor) return opts.resolveActor(req, token);
    if (!supabaseUrl || !supabaseAnonKey) return testActorFromHeader(req);
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data || !data.user) return null;
    const resolved = await regionService.resolveFromRequestAsync(req, opts.lookup);
    return { userId: data.user.id, activityRegion: resolved.region };
  }

  async function viewerFor(req, actor) {
    const region = (await regionService.resolveFromRequestAsync(req, opts.lookup)).region;
    const asked = req.query && (req.query.activityRegion || req.query.activity_region);
    if (asked != null && asked !== '') {
      const core = require('../shared/activity-region-core');
      const gate = core.assertWriteRegion(region, asked);
      if (!gate.ok) {
        const err = new Error(gate.error);
        err.code = gate.error;
        throw err;
      }
    }
    const bodyAsked = req.body && (req.body.activityRegion || req.body.activity_region);
    if (bodyAsked != null && bodyAsked !== '') {
      const core = require('../shared/activity-region-core');
      const gate = core.assertWriteRegion(region, bodyAsked);
      if (!gate.ok) {
        const err = new Error(gate.error);
        err.code = gate.error;
        throw err;
      }
    }
    if (actor) {
      actor.activityRegion = region;
      return actor;
    }
    return { activityRegion: region };
  }

  function requireLegalMember(req, res, next) {
    const uid = req.boardActor && req.boardActor.userId;
    if (!uid) return publicError(res, { code: 'BOARD_AUTH_REQUIRED' });
    const { createLegalGateService } = require('./legal-gate-service');
    const gate = createLegalGateService();
    const region = req.boardActor && req.boardActor.activityRegion;
    const pending = region === 'US' ? gate.assertUsCompleteForUser(uid) : gate.assertCompleteForUser(uid);
    pending
      .then(function () {
        next();
      })
      .catch(function (e) {
        publicError(res, e);
      });
  }

  function requireActor(req, res, next) {
    resolveActor(req, res)
      .then(async function (actor) {
        if (!actor || !actor.userId) return publicError(res, { code: 'BOARD_AUTH_REQUIRED' });
        try {
          req.boardActor = await viewerFor(req, actor);
        } catch (e) {
          return publicError(res, e);
        }
        next();
      })
      .catch(() => publicError(res, { code: 'BOARD_AUTH_REQUIRED' }));
  }

  function createGuestCentralReadService() {
    const admin = supabaseAdmin || require('./achievement-persist-service').getAdminClient();
    const repo = pgRepo || supabaseRepo(admin, schemaReady);
    return createBoardService({
      repository: repo,
      userContext,
      alienAccess: opts.alienAccess || null,
      operational: true,
      regionLedger: regionLedger,
      regionScores: regionScores,
    });
  }

  router.get('/region-profile', requireActor, async (req, res) => {
    try {
      const region = req.boardActor.activityRegion || 'KR';
      if (region === 'US') {
        if (!regionScores || typeof regionScores.readProfile !== 'function') {
          return publicError(res, { code: 'REGION_SCHEMA_UNAVAILABLE' });
        }
        const profile = await regionScores.readProfile(req.boardActor.userId, 'US');
        return res.json({
          ok: true,
          profile: {
            region: 'US',
            level: profile.level,
            xp: profile.xp,
            fame: profile.fame,
            aura: profile.aura,
            tendency: profile.tendency,
            achievements: profile.achievements || [],
            activity: profile.activity || null,
            stored: profile.stored === true,
          },
        });
      }
      if (!pgQuery && !supabaseAdmin) return publicError(res, { code: 'REGION_SCHEMA_UNAVAILABLE' });
      if (!pgQuery) {
        const found = await supabaseAdmin
          .from('user_progression')
          .select('xp, level, reputation_score')
          .eq('user_id', req.boardActor.userId)
          .maybeSingle();
        if (found && found.error) return publicError(res, { code: 'REGION_SCHEMA_UNAVAILABLE' });
        const row = found && found.data ? found.data : null;
        return res.json({
          ok: true,
          profile: {
            region: 'KR',
            level: row ? Number(row.level) : 0,
            xp: row ? Number(row.xp) : 0,
            fame: row ? Number(row.reputation_score) : 0,
            stored: !!row,
          },
        });
      }
      const found = await pgQuery(
        'SELECT xp, level, reputation_score FROM public.user_progression WHERE user_id = $1',
        [req.boardActor.userId]
      );
      const row = found.rows[0] || null;
      return res.json({
        ok: true,
        profile: {
          region: 'KR',
          level: row ? Number(row.level) : 0,
          xp: row ? Number(row.xp) : 0,
          fame: row ? Number(row.reputation_score) : 0,
          stored: !!row,
        },
      });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.get('/popular', async (req, res) => {
    try {
      const actor = await resolveActor(req, res);
      const viewer = await viewerFor(req, actor);
      let service;
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
      } else {
        service = getService(req, actor);
      }
      const result = await service.listPopularPosts(viewer, {
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
      const viewer = await viewerFor(req, actor);
      let service;
      let listFilter = {
        territory: req.query.territory || undefined,
        status: req.query.status || undefined,
        q: req.query.q || undefined,
      };
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
        listFilter.territory = 'CENTRAL';
        listFilter.status = 'ACTIVE';
      } else {
        service = getService(req, actor);
      }
      const posts = await service.listPosts(viewer, listFilter);
      return res.json({ ok: true, posts });
    } catch (e) {
      return publicError(res, e);
    }
  });

  router.get('/posts/:postId', async (req, res) => {
    try {
      const actor = await resolveActor(req, res);
      const viewer = await viewerFor(req, actor);
      let service;
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
      } else {
        service = getService(req, actor);
      }
      const post = await service.getPost(viewer, req.params.postId);
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
      const viewer = await viewerFor(req, actor);
      let service;
      if (!actor && operational && !useMemory) {
        service = createGuestCentralReadService();
        const post = await service.getPost(viewer, req.params.postId);
        if (!post || post.territory !== 'CENTRAL') {
          return publicError(res, { code: 'BOARD_FORBIDDEN' });
        }
        const comments = await service.listComments(viewer, req.params.postId);
        return res.json({ ok: true, comments });
      }
      service = getService(req, actor);
      const comments = await service.listComments(viewer, req.params.postId);
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
