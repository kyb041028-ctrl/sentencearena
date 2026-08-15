'use strict';

const schema = require('../shared/board-schema-core');
const accessCore = require('../shared/alien-access-core');
const originCore = require('../shared/alien-origin-core');
const { createBoardDataMapper } = require('./board-data-mapper');
const { createUnavailableUserContextAdapter } = require('./board-user-context-adapter');

function createBoardService(options) {
  const opts = options || {};
  const repository = opts.repository;
  const userContext = opts.userContext || createUnavailableUserContextAdapter();
  const alienAccess = opts.alienAccess || null;
  const mapper = opts.mapper || createBoardDataMapper();
  const operational = opts.operational === true;

  if (!repository) {
    const err = new Error('BOARD_REPOSITORY_REQUIRED');
    err.code = 'BOARD_REPOSITORY_REQUIRED';
    throw err;
  }

  function requireUser(actor) {
    if (!actor || !actor.userId) {
      const err = new Error('BOARD_AUTH_REQUIRED');
      err.code = 'BOARD_AUTH_REQUIRED';
      throw err;
    }
    return actor.userId;
  }

  function ensureOperational() {
    if (!operational) {
      const err = new Error('BOARD_API_NOT_ACTIVATED');
      err.code = 'BOARD_API_NOT_ACTIVATED';
      err.message = 'Board operational API is not activated until migration and territory adapter are ready.';
      throw err;
    }
  }

  async function resolveAlienCtx(userId) {
    if (!alienAccess || typeof alienAccess.getAlienUserContext !== 'function') return null;
    return alienAccess.getAlienUserContext(userId);
  }

  async function assertDirectEarthBoardAccess(userId, territory) {
    const ctx = await resolveAlienCtx(userId);
    if (!ctx) return;
    const t = schema.normalizeTerritory(territory);
    if (t === schema.TERRITORY.ALIEN) return;
    const gate = accessCore.assertEarthBoardDirectAccess(ctx);
    if (!gate.allowed) {
      const err = new Error(gate.reason || 'ALIEN_DIRECT_ACCESS_FORBIDDEN');
      err.code = gate.reason || 'ALIEN_DIRECT_ACCESS_FORBIDDEN';
      throw err;
    }
  }

  async function assertAlienPartitionAccess(userId, categoryKey, action) {
    const ctx = await resolveAlienCtx(userId);
    if (!ctx || !ctx.available || !ctx.partitions) return; // legacy fallback
    const partition = originCore.partitionFromCategoryKey(categoryKey);
    const gate = accessCore.canAccessAlienCommunityPartition({
      partition: partition,
      action: action || 'read',
      isAlien: ctx.isAlien,
      moderationStatus: ctx.moderationStatus,
      alienOriginTerritory: ctx.alienOriginTerritory,
    });
    if (!gate.ok) {
      const err = new Error(gate.error || 'ALIEN_COMMUNITY_ACCESS_FORBIDDEN');
      err.code = gate.error || 'ALIEN_COMMUNITY_ACCESS_FORBIDDEN';
      throw err;
    }
  }

  async function createPost(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validatePostInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      err.details = validation.errors;
      throw err;
    }
    const territory = await userContext.getUserTerritory(userId);
    await assertDirectEarthBoardAccess(userId, territory);
    if (territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(userId, snapshot.categoryKey || originCore.CATEGORY_KEY.ALIEN_FREE_PLAZA, 'write');
    }
    const row = await repository.createPost({
      authorUserId: userId,
      territory,
      categoryKey: snapshot.categoryKey == null ? null : snapshot.categoryKey,
      boardStage: snapshot.boardStage == null ? 1 : Number(snapshot.boardStage) || 1,
      title: snapshot.title,
      content: snapshot.content,
      isAnonymous: !!snapshot.isAnonymous,
    });

    var progression = null;
    var progressionError = null;
    try {
      const progressionService = require('./user-progression-service');
      progression = await progressionService.applyPostCreatedXp(userId, row.id);
    } catch (e) {
      progressionError = (e && e.code) || (e && e.message) || 'PROGRESSION_APPLY_FAILED';
      console.error('[board createPost progression]', progressionError, e && e.detail ? e.detail : '');
    }

    var newlyGrantedAchievements = [];
    try {
      const evaluator = require('./achievement-evaluator-service');
      const evalResult = await evaluator.evaluateAfterPostCreated(userId);
      newlyGrantedAchievements = (evalResult && evalResult.granted ? evalResult.granted : [])
        .map(function (g) {
          return g && g.record ? g.record : null;
        })
        .filter(Boolean);
      /* Lv5+ territory-citizen — progression level 확정 후 evaluator가 stats로 조회 */
      if (progression && progression.levelChanged && progression.level >= 5) {
        const levelEval = await evaluator.evaluateAfterLevelUp(userId, progression.level);
        const more = (levelEval && levelEval.granted ? levelEval.granted : [])
          .map(function (g) {
            return g && g.record ? g.record : null;
          })
          .filter(Boolean);
        newlyGrantedAchievements = newlyGrantedAchievements.concat(more);
      }
    } catch (e) {
      console.error('[board createPost achievement]', e && e.message ? e.message : e);
    }

    return {
      post: mapper.mapPostForViewer(row, userId),
      newlyGrantedAchievements: newlyGrantedAchievements,
      progression: progression
        ? {
            level: progression.level,
            xp: progression.xp,
            expPercent: progression.expPercent,
            previousLevel: progression.previousLevel,
            levelChanged: !!progression.levelChanged,
            status: progression.status,
            duplicate: !!progression.duplicate,
            verified: !!progression.verified,
          }
        : null,
      progressionError: progressionError,
      inputUnchanged: JSON.stringify(input || {}) === JSON.stringify(snapshot),
    };
  }

  async function getPost(actor, postId) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    const row = await repository.getPost(postId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (row.territory === schema.TERRITORY.ALIEN && viewerId) {
      await assertAlienPartitionAccess(viewerId, row.categoryKey, 'read');
    }
    const mapped = mapper.mapPostForViewer(row, viewerId);
    await attachCanonicalFeedHydration(mapped, viewerId);
    return mapped;
  }

  function stampCanonicalSource(post) {
    if (!post) return post;
    post.source = 'server_canonical';
    post.canonical = true;
    return post;
  }

  /**
   * list/get 응답에 표시용 display_name + EMPATHY_RECEIVED 공감 상태 첨부.
   * events RLS는 recipient(작성자)만 SELECT 가능하므로 service-role로만 hydrate.
   */
  async function attachCanonicalFeedHydration(posts, viewerId) {
    const list = Array.isArray(posts) ? posts : posts ? [posts] : [];
    list.forEach(stampCanonicalSource);
    if (!list.length) return posts;
    try {
      const persist = require('./achievement-persist-service');
      const sb = persist.getAdminClient();
      const authorIds = [];
      const postIds = [];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p && p.id) postIds.push(p.id);
        const aid = p && p.author && p.author.userId ? String(p.author.userId) : '';
        if (aid && authorIds.indexOf(aid) < 0) authorIds.push(aid);
      }
      if (authorIds.length) {
        const prof = await sb.from('profiles').select('id, display_name').in('id', authorIds);
        const names = {};
        (prof.data || []).forEach((r) => {
          names[r.id] = r.display_name || null;
        });
        list.forEach((p) => {
          if (p && p.author && p.author.userId && names[p.author.userId]) {
            p.author.displayName = names[p.author.userId];
          }
        });
      }
      if (postIds.length) {
        const ev = await sb
          .from('user_progression_events')
          .select('source_id, dedupe_key')
          .eq('event_type', 'EMPATHY_RECEIVED')
          .in('source_id', postIds);
        const byPost = {};
        (ev.data || []).forEach((row) => {
          const pid = String(row.source_id || '');
          const prefix = 'EMPATHY_RECEIVED:' + pid + ':';
          const key = String(row.dedupe_key || '');
          const reactor = key.indexOf(prefix) === 0 ? key.slice(prefix.length) : '';
          if (!byPost[pid]) byPost[pid] = [];
          if (reactor) byPost[pid].push(reactor);
        });
        const viewer = String(viewerId || '').trim();
        list.forEach((p) => {
          if (!p) return;
          const reactors = byPost[p.id] || [];
          p.empathy = {
            count: reactors.length,
            reactorUserIds: reactors,
            viewerReacted: !!(viewer && reactors.indexOf(viewer) >= 0),
          };
        });
      }
    } catch (_) {
      list.forEach((p) => {
        if (p && !p.empathy) {
          p.empathy = { count: 0, reactorUserIds: [], viewerReacted: false };
        }
      });
    }
    return posts;
  }

  async function listPosts(actor, filter) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    const f = filter || {};
    if (viewerId && alienAccess) {
      await assertDirectEarthBoardAccess(viewerId, f.territory || schema.TERRITORY.CENTRAL);
    }
    const rows = await repository.listPosts(f);
    let mapped;
    if (!alienAccess) {
      mapped = rows.map((r) => mapper.mapPostForViewer(r, viewerId));
    } else {
      const ctx = viewerId ? await resolveAlienCtx(viewerId) : null;
      const filtered = rows.filter((r) => {
        if (r.territory !== schema.TERRITORY.ALIEN) return true;
        if (!(ctx && ctx.isAlien)) return false;
        const partition = originCore.partitionFromCategoryKey(r.categoryKey);
        const gate = accessCore.canAccessAlienCommunityPartition({
          partition: partition,
          action: 'read',
          isAlien: ctx.isAlien,
          moderationStatus: ctx.moderationStatus,
          alienOriginTerritory: ctx.alienOriginTerritory,
        });
        return !!gate.ok;
      });
      mapped = filtered.map((r) => mapper.mapPostForViewer(r, viewerId));
    }
    await attachCanonicalFeedHydration(mapped, viewerId);
    return mapped;
  }

  async function updatePost(actor, postId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validatePostInput({
      title: snapshot.title != null ? snapshot.title : 'x',
      content: snapshot.content != null ? snapshot.content : 'x',
    });
    if (snapshot.title != null || snapshot.content != null) {
      if (snapshot.title != null && !String(snapshot.title).trim()) {
        const err = new Error('BOARD_TITLE_REQUIRED');
        err.code = 'BOARD_TITLE_REQUIRED';
        throw err;
      }
      if (snapshot.content != null && !String(snapshot.content).trim()) {
        const err = new Error('BOARD_CONTENT_REQUIRED');
        err.code = 'BOARD_CONTENT_REQUIRED';
        throw err;
      }
    }
    if (!validation.valid && (snapshot.title != null || snapshot.content != null)) {
      // length checks only when provided
      const titleCheck = snapshot.title != null ? schema.validatePostInput({ title: snapshot.title, content: 'ok' }) : { valid: true };
      const contentCheck = snapshot.content != null ? schema.validatePostInput({ title: 'ok', content: snapshot.content }) : { valid: true };
      if (!titleCheck.valid || !contentCheck.valid) {
        const err = new Error((titleCheck.errors && titleCheck.errors[0]) || (contentCheck.errors && contentCheck.errors[0]));
        err.code = err.message;
        throw err;
      }
    }
    const row = await repository.updatePost(postId, snapshot, userId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (row.territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(userId, row.categoryKey, 'write');
    }
    return mapper.mapPostForViewer(row, userId);
  }

  async function deletePost(actor, postId) {
    ensureOperational();
    const userId = requireUser(actor);
    const before = await repository.getPost(postId);
    if (before && before.territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(userId, before.categoryKey, 'write');
    }
    const row = await repository.softDeletePost(postId, userId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    return mapper.mapPostForViewer(row, userId);
  }

  async function createComment(actor, postId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    // 클라이언트 audience_scope 무시
    delete snapshot.audienceScope;
    delete snapshot.audience_scope;
    const validation = schema.validateCommentInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }
    const territory = await userContext.getUserTerritory(userId);
    const targetPost = await repository.getPost(postId);
    if (!targetPost) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (targetPost.status && targetPost.status !== schema.STATUS.ACTIVE) {
      const err = new Error('BOARD_TARGET_NOT_ACTIVE');
      err.code = 'BOARD_TARGET_NOT_ACTIVE';
      throw err;
    }
    if (targetPost.territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(userId, targetPost.categoryKey, 'comment');
    }
    let audienceScope = schema.audienceScopeFromTerritory(territory);
    if (typeof userContext.getAudienceScope === 'function') {
      audienceScope = await userContext.getAudienceScope(userId);
    }
    const alienCtx = await resolveAlienCtx(userId);
    if (alienCtx) {
      const resolved = accessCore.resolveAudienceScopeForWrite(alienCtx, null);
      if (!resolved.ok) {
        const err = new Error(resolved.error || 'ALIEN_WRITE_FORBIDDEN');
        err.code = resolved.error || 'ALIEN_WRITE_FORBIDDEN';
        throw err;
      }
      audienceScope = resolved.scope;
    }
    const row = await repository.createComment({
      postId,
      parentCommentId: snapshot.parentCommentId || null,
      authorUserId: userId,
      territory,
      audienceScope,
      content: snapshot.content,
      isAnonymous: !!snapshot.isAnonymous,
    });

    var progression = null;
    var progressionError = null;
    try {
      const progressionService = require('./user-progression-service');
      progression = await progressionService.applyBoardCommentCreatedXp(userId, row.id);
    } catch (e) {
      progressionError = (e && e.code) || (e && e.message) || 'PROGRESSION_APPLY_FAILED';
      console.error('[board createComment progression]', progressionError, e && e.detail ? e.detail : '');
    }

    var newlyGrantedAchievements = [];
    try {
      const evaluator = require('./achievement-evaluator-service');
      const evalResult = await evaluator.evaluateAfterCommentCreated(userId);
      newlyGrantedAchievements = (evalResult && evalResult.granted ? evalResult.granted : [])
        .map(function (g) {
          return g && g.record ? g.record : null;
        })
        .filter(Boolean);
      if (progression && progression.levelChanged && progression.level >= 5) {
        const levelEval = await evaluator.evaluateAfterLevelUp(userId, progression.level);
        const more = (levelEval && levelEval.granted ? levelEval.granted : [])
          .map(function (g) {
            return g && g.record ? g.record : null;
          })
          .filter(Boolean);
        newlyGrantedAchievements = newlyGrantedAchievements.concat(more);
      }
    } catch (e) {
      console.error('[board createComment achievement]', e && e.message ? e.message : e);
    }

    return {
      comment: mapper.mapCommentForViewer(row, userId),
      newlyGrantedAchievements: newlyGrantedAchievements,
      progression: progression
        ? {
            level: progression.level,
            xp: progression.xp,
            expPercent: progression.expPercent,
            previousLevel: progression.previousLevel,
            levelChanged: !!progression.levelChanged,
            status: progression.status,
            duplicate: !!progression.duplicate,
            verified: !!progression.verified,
          }
        : null,
      progressionError: progressionError,
    };
  }

  async function listComments(actor, postId, options) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    const opts = options || {};
    const targetPost = await repository.getPost(postId);
    if (targetPost && targetPost.territory === schema.TERRITORY.ALIEN && viewerId) {
      await assertAlienPartitionAccess(viewerId, targetPost.categoryKey, 'read');
    }
    let audienceScope = opts.audienceScope || schema.AUDIENCE_SCOPE.EARTH;
    const alienCtx = viewerId ? await resolveAlienCtx(viewerId) : null;
    if (opts.audienceScope === 'ALL' && alienCtx && alienCtx.isAlien) {
      audienceScope = 'ALL';
    } else if (alienCtx && alienCtx.isAlien && opts.audienceScope === schema.AUDIENCE_SCOPE.ALIEN) {
      audienceScope = schema.AUDIENCE_SCOPE.ALIEN;
    } else if (!alienCtx || !alienCtx.isAlien) {
      // 지구 UI 기본: EARTH만
      audienceScope = schema.AUDIENCE_SCOPE.EARTH;
    }
    const rows = await repository.listComments(postId, { audienceScope });
    return rows.map((r) => mapper.mapCommentForViewer(r, viewerId));
  }

  async function updateComment(actor, commentId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validateCommentInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }
    const before = await repository.getComment(commentId);
    if (before) {
      const targetPost = await repository.getPost(before.postId);
      if (targetPost && targetPost.territory === schema.TERRITORY.ALIEN) {
        await assertAlienPartitionAccess(userId, targetPost.categoryKey, 'comment');
      }
    }
    const row = await repository.updateComment(commentId, snapshot, userId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    return mapper.mapCommentForViewer(row, userId);
  }

  async function deleteComment(actor, commentId) {
    ensureOperational();
    const userId = requireUser(actor);
    const before = await repository.getComment(commentId);
    if (before) {
      const targetPost = await repository.getPost(before.postId);
      if (targetPost && targetPost.territory === schema.TERRITORY.ALIEN) {
        await assertAlienPartitionAccess(userId, targetPost.categoryKey, 'comment');
      }
    }
    const row = await repository.softDeleteComment(commentId, userId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    return mapper.mapCommentForViewer(row, userId);
  }

  async function toggleReaction(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validateReactionInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }

    // Ignore client-supplied territory/audienceScope.
    const actorTerritory = await userContext.getUserTerritory(userId);
    let audienceScope = schema.audienceScopeFromTerritory(actorTerritory);
    if (typeof userContext.getAudienceScope === 'function') {
      audienceScope = await userContext.getAudienceScope(userId);
    }
    const alienCtx = await resolveAlienCtx(userId);
    if (alienCtx) {
      const resolved = accessCore.resolveReactionScopeForWrite(alienCtx, snapshot.audienceScope);
      if (!resolved.ok) {
        const err = new Error(resolved.error || 'ALIEN_REACTION_FORBIDDEN');
        err.code = resolved.error || 'ALIEN_REACTION_FORBIDDEN';
        throw err;
      }
      audienceScope = resolved.scope;
    }

    let targetAuthorUserId;
    let targetPostForPartition = null;
    let targetAuthorTerritory;
    if (snapshot.targetType === schema.TARGET_TYPE.POST) {
      const post = await repository.getPost(snapshot.targetId);
      if (!post) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = post.authorUserId;
      targetPostForPartition = post;
    } else {
      const comment = await repository.getComment(snapshot.targetId);
      if (!comment) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = comment.authorUserId;
      targetPostForPartition = await repository.getPost(comment.postId);
    }
    if (targetPostForPartition && targetPostForPartition.territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(userId, targetPostForPartition.categoryKey, 'react');
    }
    targetAuthorTerritory = await userContext.getUserTerritory(targetAuthorUserId);

    return repository.toggleReaction({
      actorUserId: userId,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      reactionType: snapshot.reactionType,
      actorTerritory,
      audienceScope,
      targetAuthorTerritory,
    });
  }

  async function createReport(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    const validation = schema.validateReportInput(snapshot);
    if (!validation.valid) {
      const err = new Error(validation.errors[0]);
      err.code = validation.errors[0];
      throw err;
    }

    let targetAuthorUserId;
    let target;
    if (snapshot.targetType === schema.TARGET_TYPE.POST) {
      target = await repository.getPost(snapshot.targetId);
      if (!target) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      if (target.status !== schema.STATUS.ACTIVE) {
        const err = new Error('BOARD_TARGET_NOT_ACTIVE');
        err.code = 'BOARD_TARGET_NOT_ACTIVE';
        throw err;
      }
      targetAuthorUserId = target.authorUserId;
    } else {
      target = await repository.getComment(snapshot.targetId);
      if (!target) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      if (target.status !== schema.STATUS.ACTIVE) {
        const err = new Error('BOARD_TARGET_NOT_ACTIVE');
        err.code = 'BOARD_TARGET_NOT_ACTIVE';
        throw err;
      }
      targetAuthorUserId = target.authorUserId;
    }

    const row = await repository.createReport({
      reporterUserId: userId,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      targetAuthorUserId,
      reasonCode: snapshot.reasonCode,
      reasonDetail: snapshot.reasonDetail || null,
    });

    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  /**
   * 실회원 타인 canonical 글 공감 → 작성자 reputation_score +1
   * 클라이언트 amount/author 미신뢰. 댓글 공감은 이번 범위 밖.
   */
  async function receivePostEmpathy(actor, postId) {
    ensureOperational();
    const reactorId = requireUser(actor);
    const progressionService = require('./user-progression-service');
    const result = await progressionService.applyEmpathyReceivedFame(reactorId, postId);

    if (result && result.granted === true) {
      try {
        const evaluator = require('./achievement-evaluator-service');
        await evaluator.evaluateAfterEmpathyReceived(result.recipientUserId);
      } catch (e) {
        console.error('[board receivePostEmpathy achievement]', e && e.message ? e.message : e);
      }
    }

    return {
      granted: !!result.granted,
      duplicate: !!result.duplicate,
      reason: result.reason || null,
      recipientUserId: result.recipientUserId,
      fame: result.fame,
      previousFame: result.previousFame,
      fameDelta: result.fameDelta,
      level: result.level,
      xp: result.xp,
      expPercent: result.expPercent,
      verified: !!result.verified,
    };
  }

  return {
    createPost,
    getPost,
    listPosts,
    updatePost,
    deletePost,
    createComment,
    listComments,
    updateComment,
    deleteComment,
    toggleReaction,
    receivePostEmpathy,
    createReport,
  };
}

module.exports = {
  createBoardService,
};
