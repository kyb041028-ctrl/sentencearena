'use strict';

const schema = require('../shared/board-schema-core');
const accessCore = require('../shared/alien-access-core');
const originCore = require('../shared/alien-origin-core');
const reviewCore = require('../shared/board-report-review-core');
const misinfoCore = require('../shared/misinfo-report-core');
const { createBoardDataMapper } = require('./board-data-mapper');
const { createUnavailableUserContextAdapter } = require('./board-user-context-adapter');
const factionBattleCore = require('../shared/faction-battle-core');
const popularPostsCore = require('../shared/popular-posts-core');
const sanctionService = require('./user-sanction-service');
const retentionService = require('./retention-service');
const misinfoAbuse = require('./misinfo-report-abuse-service');

function createBoardService(options) {
  const opts = options || {};
  const repository = opts.repository;
  const userContext = opts.userContext || createUnavailableUserContextAdapter();
  const alienAccess = opts.alienAccess || null;
  const mapper = opts.mapper || createBoardDataMapper();
  const operational = opts.operational === true;
  const onReportCreated = typeof opts.onReportCreated === 'function' ? opts.onReportCreated : null;
  const onBehaviorReviewed = typeof opts.onBehaviorReviewed === 'function' ? opts.onBehaviorReviewed : null;

  if (!repository) {
    const err = new Error('BOARD_REPOSITORY_REQUIRED');
    err.code = 'BOARD_REPOSITORY_REQUIRED';
    throw err;
  }

  function resolveFactionBattleEnabled(territory, input) {
    if (territory !== schema.TERRITORY.CENTRAL && territory !== schema.TERRITORY.ALIEN) return false;
    const key = String((input && (input.categoryKey || input.category)) || '')
      .trim()
      .toLowerCase();
    if (key === 'light' || key === 'meme') return false;
    return !!(input && input.factionBattleEnabled === true);
  }

  async function attachFactionBattles(posts) {
    const list = Array.isArray(posts) ? posts : posts ? [posts] : [];
    if (!list.length) return;
    const enabled = [];
    let i;
    for (i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      if (!p.factionBattleEnabled || !factionBattleCore.supportsFactionBattleUi(p.territory)) {
        if (p.factionBattleEnabled) p.factionBattleEnabled = false;
        continue;
      }
      enabled.push(p);
    }
    if (!enabled.length) return;
    const ids = enabled.map(function (p) {
      return p.id;
    });
    let comments = [];
    let reactions = [];
    let loaded = false;
    if (
      repository &&
      typeof repository.listCommentsForPosts === 'function' &&
      typeof repository.listReactionsForPosts === 'function' &&
      repository._debug
    ) {
      comments = await repository.listCommentsForPosts(ids);
      reactions = await repository.listReactionsForPosts(ids);
      loaded = true;
    }
    if (!loaded) {
      try {
        const persist = require('./achievement-persist-service');
        const sb = persist.getAdminClient();
        const adminRepo = require('./board-supabase-repository').createBoardSupabaseRepository({
          client: sb,
          mapper: mapper,
        });
        comments = await adminRepo.listCommentsForPosts(ids);
        reactions = await adminRepo.listReactionsForPosts(ids);
        loaded = true;
      } catch (_) {
        comments = [];
        reactions = [];
      }
    }
    const commentsByPost = {};
    const reactionsByPost = {};
    for (i = 0; i < ids.length; i++) {
      commentsByPost[ids[i]] = [];
      reactionsByPost[ids[i]] = [];
    }
    (comments || []).forEach(function (c) {
      if (!c || !c.postId) return;
      if (!commentsByPost[c.postId]) commentsByPost[c.postId] = [];
      commentsByPost[c.postId].push(c);
    });
    const commentPost = {};
    (comments || []).forEach(function (c) {
      if (c && c.id) commentPost[c.id] = c.postId;
    });
    (reactions || []).forEach(function (r) {
      if (!r) return;
      var pid = r.postId;
      if (!pid && r.commentId) pid = commentPost[r.commentId];
      if (!pid || !reactionsByPost[pid]) return;
      reactionsByPost[pid].push(r);
    });
    for (i = 0; i < enabled.length; i++) {
      const p = enabled[i];
      p.factionBattle = factionBattleCore.evaluateLiveFactionBattle({
        postId: p.id,
        boardType: p.territory,
        authorTerritory: p.territory,
        comments: commentsByPost[p.id] || [],
        reactions: reactionsByPost[p.id] || [],
      });
    }
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

  async function assertSanction(userId, kind) {
    await sanctionService.assertAllows(userId, kind);
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

  /** Alien residents may not write/react/edit Earth (CENTRAL/PIONEER/GUARDIAN) content. */
  async function assertAlienMayNotParticipateOnEarth(userId, territory) {
    const t = schema.normalizeTerritory(territory);
    if (t === schema.TERRITORY.ALIEN) return;
    await assertDirectEarthBoardAccess(userId, t || schema.TERRITORY.CENTRAL);
  }

  /** Alien-internal content: no Earth XP / Fame / general achievements. */
  function isAlienInternalTerritory(territory) {
    return schema.normalizeTerritory(territory) === schema.TERRITORY.ALIEN;
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
    await assertSanction(userId, 'WRITE');
    const snapshot = schema.clone(input || {});
    delete snapshot.isOfficial;
    delete snapshot.is_official;
    snapshot.allowOfficialTitle = false;
    const validation = schema.validatePostInput(snapshot);
    if (!validation.valid) {
      const code = validation.errors[0];
      const err = new Error(
        code === schema.BOARD_OFFICIAL_TITLE_RESERVED
          ? schema.BOARD_OFFICIAL_TITLE_RESERVED_MESSAGE
          : code
      );
      err.code = code;
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
      factionBattleEnabled: resolveFactionBattleEnabled(territory, snapshot),
      isOfficial: false,
    });

    var progression = null;
    var progressionError = null;
    var newlyGrantedAchievements = [];
    if (!isAlienInternalTerritory(territory)) {
      try {
        const progressionService = require('./user-progression-service');
        progression = await progressionService.applyPostCreatedXp(userId, row.id);
      } catch (e) {
        progressionError = (e && e.code) || (e && e.message) || 'PROGRESSION_APPLY_FAILED';
        console.error('[board createPost progression]', progressionError, e && e.detail ? e.detail : '');
      }

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
    }

    const mappedCreated = mapper.mapPostForViewer(row, userId);
    await attachCanonicalFeedHydration(mappedCreated, userId);

    return {
      post: mappedCreated,
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
    } else if (viewerId && row.territory !== schema.TERRITORY.ALIEN) {
      // Alien residents must use observation APIs for Earth content, not direct board entry.
      await assertAlienMayNotParticipateOnEarth(viewerId, row.territory);
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
   * EMPATHY 상태는 user_progression_events EMPATHY_RECEIVED (board_reactions 아님).
   * events RLS는 recipient만 SELECT 가능하므로 service-role로만 hydrate.
   */
  async function attachEmpathyFromEvents(sb, items, viewerId) {
    const list = Array.isArray(items) ? items : items ? [items] : [];
    if (!sb || !list.length) return;
    const ids = [];
    list.forEach(function (item) {
      if (item && item.id) ids.push(item.id);
    });
    if (!ids.length) return;
    const ev = await sb
      .from('user_progression_events')
      .select('source_id, dedupe_key')
      .eq('event_type', 'EMPATHY_RECEIVED')
      .in('source_id', ids);
    if (ev.error) return;
    const byTarget = {};
    (ev.data || []).forEach((row) => {
      const sid = String(row.source_id || '');
      const prefix = 'EMPATHY_RECEIVED:' + sid + ':';
      const key = String(row.dedupe_key || '');
      const reactor = key.indexOf(prefix) === 0 ? key.slice(prefix.length) : '';
      if (!byTarget[sid]) byTarget[sid] = [];
      if (reactor) byTarget[sid].push(reactor);
    });
    const viewer = String(viewerId || '').trim();
    list.forEach((item) => {
      if (!item) return;
      const reactors = byTarget[item.id] || [];
      item.empathy = {
        count: reactors.length,
        reactorUserIds: reactors,
        viewerReacted: !!(viewer && reactors.indexOf(viewer) >= 0),
      };
    });
  }

  /**
   * list/get 응답에 표시용 display_name + EMPATHY_RECEIVED 공감 상태 첨부.
   * LIKE/DISLIKE 는 board_reactions (EMPATHY와 분리) · viewer 본인 row + counts 컬럼.
   */
  async function attachViewerEarthReactions(sb, items, viewerId, targetType) {
    const list = Array.isArray(items) ? items : items ? [items] : [];
    const viewer = String(viewerId || '').trim();
    if (!sb || !viewer || !list.length) return;
    const ids = [];
    list.forEach(function (item) {
      if (item && item.id) ids.push(item.id);
    });
    if (!ids.length) return;
    var q = sb
      .from('board_reactions')
      .select('post_id, comment_id, reaction_type, reaction_group')
      .eq('actor_user_id', viewer)
      .eq('target_type', targetType)
      .is('cancelled_at', null);
    if (targetType === 'POST') q = q.in('post_id', ids);
    else q = q.in('comment_id', ids);
    const rx = await q;
    if (rx.error) return;
    const by = {};
    (rx.data || []).forEach(function (row) {
      const id = targetType === 'POST' ? row.post_id : row.comment_id;
      if (!id) return;
      if (!by[id]) {
        by[id] = {
          viewerPositive: false,
          viewerNegative: false,
          positiveType: null,
          negativeType: null,
        };
      }
      if (row.reaction_group === 'POSITIVE') {
        by[id].viewerPositive = true;
        by[id].positiveType = row.reaction_type || null;
      } else if (row.reaction_group === 'NEGATIVE') {
        by[id].viewerNegative = true;
        by[id].negativeType = row.reaction_type || null;
      }
    });
    list.forEach(function (item) {
      if (!item) return;
      const rec = by[item.id] || {};
      item.earthReaction = {
        viewerPositive: !!rec.viewerPositive,
        viewerNegative: !!rec.viewerNegative,
        positiveType: rec.positiveType || null,
        negativeType: rec.negativeType || null,
      };
    });
  }

  async function attachViewerPostReports(sb, items, viewerId) {
    const list = Array.isArray(items) ? items : items ? [items] : [];
    const viewer = String(viewerId || '').trim();
    if (!sb || !viewer || !list.length) return;
    const ids = [];
    list.forEach(function (item) {
      if (item && item.id) ids.push(item.id);
    });
    if (!ids.length) return;
    const rx = await sb
      .from('board_reports')
      .select('post_id')
      .eq('reporter_user_id', viewer)
      .in('post_id', ids)
      .in('status', ['SUBMITTED', 'REVIEWING']);
    if (rx.error) return;
    const set = {};
    (rx.data || []).forEach(function (row) {
      if (row && row.post_id) set[row.post_id] = true;
    });
    list.forEach(function (item) {
      if (!item) return;
      item.viewerReported = !!set[item.id];
    });
  }

  async function attachAuthorPublicFields(items) {
    const list = Array.isArray(items) ? items : items ? [items] : [];
    if (!list.length) return items;
    try {
      const persist = require('./achievement-persist-service');
      const progression = require('./user-progression-service');
      const sb = persist.getAdminClient();
      const authorIds = [];
      list.forEach(function (item) {
        const aid = item && item.author && item.author.userId ? String(item.author.userId) : '';
        if (aid && authorIds.indexOf(aid) < 0) authorIds.push(aid);
      });
      if (!authorIds.length) return items;
      const prof = await sb.from('profiles').select('id, display_name').in('id', authorIds);
      const names = {};
      (prof.data || []).forEach(function (r) {
        names[r.id] = r.display_name || null;
      });
      let levels = {};
      try {
        levels = await progression.loadPublicLevelsByUserIds(authorIds);
      } catch (_) {
        levels = {};
      }
      list.forEach(function (item) {
        if (!item || !item.author || !item.author.userId) return;
        if (names[item.author.userId]) item.author.displayName = names[item.author.userId];
        if (Object.prototype.hasOwnProperty.call(levels, item.author.userId)) {
          item.author.level = levels[item.author.userId];
        }
      });
    } catch (_) {}
    return items;
  }

  async function attachCanonicalFeedHydration(posts, viewerId) {
    const list = Array.isArray(posts) ? posts : posts ? [posts] : [];
    list.forEach(stampCanonicalSource);
    if (!list.length) return posts;
    try {
      const persist = require('./achievement-persist-service');
      const sb = persist.getAdminClient();
      const postIds = [];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p && p.id) postIds.push(p.id);
      }
      await attachAuthorPublicFields(list);
      if (postIds.length) {
        await attachEmpathyFromEvents(sb, list, viewerId);
      }
      await attachViewerEarthReactions(sb, list, viewerId, 'POST');
      await attachViewerPostReports(sb, list, viewerId);
    } catch (_) {
      list.forEach((p) => {
        if (p && !p.empathy) {
          p.empathy = { count: 0, reactorUserIds: [], viewerReacted: false };
        }
      });
    }
    try {
      await attachFactionBattles(list);
    } catch (_) {}
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

  async function loadPopularActivityRepo() {
    if (
      repository &&
      typeof repository.listActivePostReactionsSince === 'function' &&
      typeof repository.listActiveCommentsSince === 'function' &&
      typeof repository.listPostEmpathyEventsSince === 'function' &&
      repository._debug
    ) {
      return repository;
    }
    const persist = require('./achievement-persist-service');
    const sb = persist.getAdminClient();
    return require('./board-supabase-repository').createBoardSupabaseRepository({
      client: sb,
      mapper: mapper,
    });
  }

  async function listPopularPosts(actor, query) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    const src = query || {};
    const period = popularPostsCore.normalizePeriod(src.period);
    const nowMs = src.nowMs != null && isFinite(Number(src.nowMs)) ? Number(src.nowMs) : Date.now();
    const window = popularPostsCore.resolvePeriodWindow(period, nowMs);
    const fromIso = new Date(window.fromMs).toISOString();
    const toIso = new Date(window.toMs).toISOString();
    const territory = popularPostsCore.normalizeEarthTerritory(src.territory || schema.TERRITORY.CENTRAL);
    if (!territory) {
      const err = new Error('BOARD_TERRITORY_INVALID');
      err.code = 'BOARD_TERRITORY_INVALID';
      throw err;
    }
    if (viewerId && alienAccess) {
      await assertDirectEarthBoardAccess(viewerId, territory);
    }
    let boardStage = null;
    if (src.boardStage != null && src.boardStage !== '') {
      const n = Math.floor(Number(src.boardStage));
      if (isFinite(n) && n >= 1) boardStage = n;
    }
    let limit = parseInt(src.limit, 10);
    if (!isFinite(limit) || limit < 1) limit = 8;
    if (limit > 50) limit = 50;

    const activityRepo = await loadPopularActivityRepo();
    const reactions = await activityRepo.listActivePostReactionsSince(fromIso, toIso);
    const comments = await activityRepo.listActiveCommentsSince(fromIso, toIso);
    const empathyEvents = await activityRepo.listPostEmpathyEventsSince(fromIso, toIso);
    const buckets = popularPostsCore.aggregateActivity(
      { reactions: reactions, comments: comments, empathyEvents: empathyEvents },
      window,
    );
    const ids = Object.keys(buckets);
    if (!ids.length) {
      return { period: period, from: fromIso, to: toIso, posts: [] };
    }
    let rows = [];
    if (typeof activityRepo.listPostsByIds === 'function') {
      rows = await activityRepo.listPostsByIds(ids);
    } else {
      const all = await repository.listPosts({ status: schema.STATUS.ACTIVE, territory: territory });
      const want = Object.create(null);
      ids.forEach(function (id) {
        want[id] = true;
      });
      rows = all.filter(function (p) {
        return p && want[p.id];
      });
    }
    const ranked = [];
    let i;
    for (i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.status !== schema.STATUS.ACTIVE) continue;
      if (row.territory !== territory) continue;
      if (boardStage != null && Number(row.boardStage || 1) !== boardStage) continue;
      const scored = buckets[row.id];
      if (!scored || scored.score <= 0) continue;
      ranked.push({ row: row, scored: scored });
    }
    ranked.sort(function (a, b) {
      return popularPostsCore.compareRank(
        { score: a.scored.score, createdAt: a.row.createdAt },
        { score: b.scored.score, createdAt: b.row.createdAt },
      );
    });
    const sliced = ranked.slice(0, limit);
    const mapped = sliced.map(function (item) {
      const p = mapper.mapPostForViewer(item.row, viewerId);
      p.popularScore = item.scored.score;
      p.popularBreakdown = {
        empathyCount: item.scored.empathyCount,
        likeCount: item.scored.likeCount,
        dislikeCount: item.scored.dislikeCount,
        uniqueCommenterCount: item.scored.uniqueCommenterCount,
      };
      return p;
    });
    await attachCanonicalFeedHydration(mapped, viewerId);
    return {
      period: period,
      from: fromIso,
      to: toIso,
      posts: mapped,
    };
  }

  async function updatePost(actor, postId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    await assertSanction(userId, 'WRITE');
    const before = await repository.getPost(postId);
    if (before) {
      if (before.territory === schema.TERRITORY.ALIEN) {
        await assertAlienPartitionAccess(userId, before.categoryKey, 'write');
      } else {
        // Alien: Earth content edits forbidden (own-delete remains allowed separately).
        await assertAlienMayNotParticipateOnEarth(userId, before.territory);
      }
    }
    const snapshot = schema.clone(input || {});
    delete snapshot.isOfficial;
    delete snapshot.is_official;
    if (
      snapshot.title != null &&
      schema.titleStartsWithReservedOfficialMarker(snapshot.title) &&
      !(before && before.isOfficial)
    ) {
      const err = new Error(schema.BOARD_OFFICIAL_TITLE_RESERVED_MESSAGE);
      err.code = schema.BOARD_OFFICIAL_TITLE_RESERVED;
      throw err;
    }
    const validation = schema.validatePostInput({
      title: snapshot.title != null ? snapshot.title : 'x',
      content: snapshot.content != null ? snapshot.content : 'x',
      allowOfficialTitle: !!(before && before.isOfficial),
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
      const titleCheck = snapshot.title != null
        ? schema.validatePostInput({
            title: snapshot.title,
            content: 'ok',
            allowOfficialTitle: !!(before && before.isOfficial),
          })
        : { valid: true };
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
    try {
      await retentionService.captureDeletedContent({
        contentKind: 'POST',
        sourceContentId: (before && before.id) || postId,
        title: before && before.title,
        body: before && before.content,
        createdAt: before && before.createdAt,
        authorUserId: before && before.authorUserId,
        authorDisplayName: before && before.authorDisplayName,
        deleteReason: 'USER_DELETE',
        deletedAt: row.deletedAt || new Date().toISOString(),
      });
    } catch (_) {}
    return mapper.mapPostForViewer(row, userId);
  }

  async function createComment(actor, postId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    await assertSanction(userId, 'WRITE');
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
    } else {
      // Policy: aliens cannot comment on Earth posts (observation is read-only).
      await assertAlienMayNotParticipateOnEarth(userId, targetPost.territory);
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
    var newlyGrantedAchievements = [];
    if (!isAlienInternalTerritory(targetPost.territory)) {
      try {
        const progressionService = require('./user-progression-service');
        progression = await progressionService.applyBoardCommentCreatedXp(userId, row.id);
      } catch (e) {
        progressionError = (e && e.code) || (e && e.message) || 'PROGRESSION_APPLY_FAILED';
        console.error('[board createComment progression]', progressionError, e && e.detail ? e.detail : '');
      }

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
    }

    const mappedComment = mapper.mapCommentForViewer(row, userId);
    await attachAuthorPublicFields([mappedComment]);
    return {
      comment: mappedComment,
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
    } else if (targetPost && viewerId && targetPost.territory !== schema.TERRITORY.ALIEN) {
      await assertAlienMayNotParticipateOnEarth(viewerId, targetPost.territory);
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
    const mapped = rows.map((r) => mapper.mapCommentForViewer(r, viewerId));
    await attachAuthorPublicFields(mapped);
    try {
      const persist = require('./achievement-persist-service');
      const sb = persist.getAdminClient();
      await attachEmpathyFromEvents(sb, mapped, viewerId);
      await attachViewerEarthReactions(sb, mapped, viewerId, 'COMMENT');
    } catch (_) {}
    return mapped;
  }

  async function updateComment(actor, commentId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    await assertSanction(userId, 'WRITE');
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
      } else if (targetPost) {
        await assertAlienMayNotParticipateOnEarth(userId, targetPost.territory);
      }
    }
    const row = await repository.updateComment(commentId, snapshot, userId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    const mappedUpdated = mapper.mapCommentForViewer(row, userId);
    await attachAuthorPublicFields([mappedUpdated]);
    return mappedUpdated;
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
    try {
      await retentionService.captureDeletedContent({
        contentKind: 'COMMENT',
        sourceContentId: (before && before.id) || commentId,
        body: before && before.content,
        createdAt: before && before.createdAt,
        authorUserId: before && before.authorUserId,
        authorDisplayName: before && before.authorDisplayName,
        deleteReason: 'USER_DELETE',
        deletedAt: row.deletedAt || new Date().toISOString(),
      });
    } catch (_) {}
    return mapper.mapCommentForViewer(row, userId);
  }

  async function toggleReaction(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    await assertSanction(userId, 'PARTICIPATE');
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
    } else if (targetPostForPartition) {
      // Policy: no Earth LIKE/DISLIKE for alien residents (not ALIEN-scoped fallback).
      await assertAlienMayNotParticipateOnEarth(userId, targetPostForPartition.territory);
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
    targetAuthorTerritory = await userContext.getUserTerritory(targetAuthorUserId);

    if (typeof userContext.getUserAlignmentScore !== 'function') {
      const err = new Error('BOARD_ALIGNMENT_SCORE_UNAVAILABLE');
      err.code = 'BOARD_ALIGNMENT_SCORE_UNAVAILABLE';
      throw err;
    }
    const actorSnap = await userContext.getUserAlignmentScore(userId);
    const targetSnap = await userContext.getUserAlignmentScore(targetAuthorUserId);
    const actorAlignmentScore = Number(actorSnap);
    const targetAuthorAlignmentScore = Number(targetSnap);
    if (!isFinite(actorAlignmentScore) || !isFinite(targetAuthorAlignmentScore)) {
      const err = new Error('BOARD_ALIGNMENT_SCORE_INVALID');
      err.code = 'BOARD_ALIGNMENT_SCORE_INVALID';
      throw err;
    }

    return repository.toggleReaction({
      actorUserId: userId,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      reactionType: snapshot.reactionType,
      actorTerritory,
      audienceScope,
      targetAuthorTerritory,
      actorAlignmentScore,
      targetAuthorAlignmentScore,
    });
  }

  async function createReport(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    await assertSanction(userId, 'ACCOUNT');
    const snapshot = schema.clone(input || {});
    if (String(snapshot.reasonCode || '').toLowerCase() === 'misinfo') {
      const packed = misinfoCore.packFromInput(snapshot);
      if (!packed.ok) {
        const err = new Error(packed.errors[0] || 'MISINFO_EXCERPT_REQUIRED');
        err.code = packed.errors[0] || 'MISINFO_EXCERPT_REQUIRED';
        throw err;
      }
      snapshot.reasonDetail = packed.encoded;
    }
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

    if (userId === targetAuthorUserId) {
      const err = new Error('BOARD_REPORT_SELF_FORBIDDEN');
      err.code = 'BOARD_REPORT_SELF_FORBIDDEN';
      throw err;
    }

    if (String(snapshot.reasonCode || '').toLowerCase() === 'misinfo') {
      await misinfoAbuse.assertAllowed(userId);
    }

    if (typeof repository.findReporterTargetReport === 'function') {
      const prev = await repository.findReporterTargetReport(userId, snapshot.targetType, snapshot.targetId);
      if (prev) {
        const allowMisinfoResubmit =
          String(snapshot.reasonCode || '').toLowerCase() === 'misinfo' &&
          misinfoCore.canResubmitMisinfo(prev, snapshot);
        if (!allowMisinfoResubmit) {
          const err = new Error('BOARD_REPORT_DUPLICATE');
          err.code = 'BOARD_REPORT_DUPLICATE';
          throw err;
        }
      }
    }

    const row = await repository.createReport({
      reporterUserId: userId,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      targetAuthorUserId,
      reasonCode: snapshot.reasonCode,
      reasonDetail: snapshot.reasonDetail || null,
    });

    let moderation = null;
    if (onReportCreated) {
      try {
        moderation = await onReportCreated(row);
      } catch (hookErr) {
        moderation = {
          ok: false,
          error: (hookErr && hookErr.code) || (hookErr && hookErr.message) || 'ALIEN_MODERATION_HOOK_FAILED',
        };
      }
    }

    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      targetAuthorUserId: row.targetAuthorUserId,
      reasonCode: row.reasonCode,
      targetType: row.targetType,
      postId: row.postId,
      commentId: row.commentId,
      moderation: moderation,
    };
  }

  async function getReport(actor, reportId) {
    ensureOperational();
    void actor;
    if (typeof repository.getReport !== 'function') return null;
    return repository.getReport(reportId);
  }

  async function listReports(actor, filter) {
    ensureOperational();
    void actor;
    if (typeof repository.listReports !== 'function') return [];
    return repository.listReports(filter || {});
  }

  async function reviewReport(actor, reportId, patch) {
    ensureOperational();
    const reviewerId = requireUser(actor);
    if (typeof repository.updateReportReview !== 'function') {
      const err = new Error('BOARD_REPORT_REVIEW_UNAVAILABLE');
      err.code = 'BOARD_REPORT_REVIEW_UNAVAILABLE';
      throw err;
    }
    return repository.updateReportReview(reportId, Object.assign({}, patch || {}, { reviewedBy: reviewerId }));
  }

  async function listReportBehaviors(actor, filter) {
    const rows = await listReports(actor, filter || {});
    return reviewCore.groupReportsByBehavior(rows);
  }

  async function reviewBehavior(actor, behaviorKey, patch) {
    ensureOperational();
    requireUser(actor);
    const parsed = reviewCore.parseBehaviorKey(behaviorKey);
    if (!parsed.ok) {
      const err = new Error(parsed.error || 'BEHAVIOR_KEY_INVALID');
      err.code = parsed.error || 'BEHAVIOR_KEY_INVALID';
      throw err;
    }
    const src = patch || {};
    let nextStatus = String(src.status || '').trim().toUpperCase();
    let noteInput = src.resolutionNote;
    if (src.misinfoDecision) {
      const decision = String(src.misinfoDecision || '').trim().toUpperCase();
      if (misinfoCore.DECISION_TO_STATUS[decision]) {
        nextStatus = misinfoCore.DECISION_TO_STATUS[decision];
        noteInput = misinfoCore.operatorNote(decision, {
          electionRelated: !!src.electionRelated,
          agencyNote: src.agencyNote,
          note: src.resolutionNote,
        });
      }
    }
    if (!reviewCore.isAllowedReviewStatus(nextStatus)) {
      const err = new Error('BOARD_REPORT_STATUS_INVALID');
      err.code = 'BOARD_REPORT_STATUS_INVALID';
      throw err;
    }
    const rows = await listReports(actor, {});
    const matched = (rows || []).filter(function (row) {
      return reviewCore.reportMatchesBehavior(row, parsed);
    });
    if (!matched.length) {
      const err = new Error('BOARD_BEHAVIOR_NOT_FOUND');
      err.code = 'BOARD_BEHAVIOR_NOT_FOUND';
      throw err;
    }
    const prevGroup = reviewCore.groupReportsByBehavior(matched)[0];
    const prevStatus = prevGroup && prevGroup.status;
    const note = reviewCore.resolutionNoteForStatus(nextStatus, prevStatus, noteInput);
    const updated = [];
    for (let i = 0; i < matched.length; i++) {
      updated.push(await reviewReport(actor, matched[i].id, {
        status: nextStatus,
        resolutionNote: note,
      }));
    }
    const grouped = reviewCore.groupReportsByBehavior(updated)[0] || null;
    for (let r = 0; r < updated.length; r++) {
      try { await retentionService.syncReportReview(updated[r]); } catch (_) {}
    }
    let alien = null;
    if (onBehaviorReviewed) {
      try {
        alien = await onBehaviorReviewed({
          behaviorKey: parsed.behaviorKey,
          status: nextStatus,
          resolutionNote: note,
          targetAuthorUserId: grouped && grouped.targetAuthorUserId,
          primaryReasonCode: grouped && grouped.primaryReasonCode,
          sanctionClass: grouped && grouped.sanctionClass,
          operatorSanction: src.operatorSanction || src.operatorAction || 'AUTO',
          severeCode: src.severeCode || null,
          massHarm: !!src.massHarm,
          operatorUserId: requireUser(actor),
        });
      } catch (hookErr) {
        if (hookErr && (hookErr.status === 409 || hookErr.code === 'SANCTION_BEHAVIOR_ALREADY_SANCTIONED' || hookErr.code === 'APPEAL_ALREADY_DECIDED')) {
          throw hookErr;
        }
        alien = {
          ok: false,
          error: (hookErr && hookErr.code) || (hookErr && hookErr.message) || 'ALIEN_REVIEW_HOOK_FAILED',
        };
      }
    }
    const hideNeeded = !!(alien && alien.sanction && alien.sanction.hideContent);
    if (hideNeeded) {
      try { await operatorHideTarget(parsed.behaviorKey); } catch (_) {}
    }
    return { behavior: grouped, alien: alien, sanction: alien && alien.sanction ? alien.sanction : alien };
  }

  async function operatorHideTarget(behaviorKey) {
    const parsed = reviewCore.parseBehaviorKey(behaviorKey);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (typeof repository.operatorHidePost !== 'function' && typeof repository.operatorHideComment !== 'function') {
      return { ok: false, error: 'BOARD_HIDE_UNAVAILABLE' };
    }
    if (parsed.targetType === 'POST' && typeof repository.operatorHidePost === 'function') {
      const row = await repository.operatorHidePost(parsed.targetId);
      return { ok: true, post: row };
    }
    if (parsed.targetType === 'COMMENT' && typeof repository.operatorHideComment === 'function') {
      const row = await repository.operatorHideComment(parsed.targetId);
      return { ok: true, comment: row };
    }
    return { ok: false, error: 'BOARD_HIDE_UNAVAILABLE' };
  }

  function emptyAlienEmpathyResult(authorUserId) {
    return {
      granted: false,
      revoked: false,
      duplicate: false,
      reason: 'ALIEN_INTERNAL_NO_EARTH_FAME',
      recipientUserId: authorUserId || null,
      fame: null,
      previousFame: null,
      fameDelta: 0,
      level: null,
      xp: null,
      expPercent: null,
      verified: false,
      newlyGrantedAchievements: [],
    };
  }

  function mapEmpathyProgressionResult(result, extra) {
    return Object.assign(
      {
        granted: !!result.granted,
        revoked: !!result.revoked,
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
        newlyGrantedAchievements: [],
      },
      extra || {},
    );
  }

  async function grantEmpathyAchievements(result) {
    var newlyGrantedAchievements = [];
    if (!(result && result.granted === true)) return newlyGrantedAchievements;
    try {
      const evaluator = require('./achievement-evaluator-service');
      const evalResult = await evaluator.evaluateAfterEmpathyReceived(result.recipientUserId);
      newlyGrantedAchievements = (evalResult && evalResult.granted ? evalResult.granted : [])
        .map(function (g) {
          return g && g.record ? g.record : null;
        })
        .filter(Boolean);
    } catch (e) {
      console.error('[board empathy achievement]', e && e.message ? e.message : e);
    }
    return newlyGrantedAchievements;
  }

  /**
   * 실회원 타인 canonical 글 공감 → 작성자 reputation_score +1
   * 클라이언트 amount/author 미신뢰.
   */
  async function receivePostEmpathy(actor, postId) {
    ensureOperational();
    const reactorId = requireUser(actor);
    await assertSanction(reactorId, 'PARTICIPATE');
    const post = await repository.getPost(postId);
    if (!post) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (post.territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(reactorId, post.categoryKey, 'react');
    } else {
      await assertAlienMayNotParticipateOnEarth(reactorId, post.territory);
    }

    /* Alien-internal content: no Earth Fame / general achievements. */
    if (isAlienInternalTerritory(post.territory)) {
      return emptyAlienEmpathyResult(post.authorUserId);
    }

    const progressionService = require('./user-progression-service');
    const result = await progressionService.applyEmpathyReceivedFame(reactorId, postId, {
      targetType: 'POST',
    });
    const newlyGrantedAchievements = await grantEmpathyAchievements(result);
    return mapEmpathyProgressionResult(result, { newlyGrantedAchievements: newlyGrantedAchievements });
  }

  /**
   * 기존 EMPATHY 가 실제로 제거된 경우에만 작성자 명성 -1.
   * 업적은 회수하지 않음 (first-empathy-received PERMANENT_ONCE).
   */
  async function revokePostEmpathy(actor, postId) {
    ensureOperational();
    const reactorId = requireUser(actor);
    await assertSanction(reactorId, 'PARTICIPATE');
    const post = await repository.getPost(postId);
    if (!post) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (post.territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(reactorId, post.categoryKey, 'react');
    } else {
      await assertAlienMayNotParticipateOnEarth(reactorId, post.territory);
    }
    if (isAlienInternalTerritory(post.territory)) {
      return emptyAlienEmpathyResult(post.authorUserId);
    }
    const progressionService = require('./user-progression-service');
    const result = await progressionService.revokeEmpathyReceivedFame(reactorId, postId, {
      targetType: 'POST',
    });
    return mapEmpathyProgressionResult(result);
  }

  async function resolveCommentEmpathyContext(reactorId, commentId) {
    const comment = await repository.getComment(commentId);
    if (!comment) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    const post = await repository.getPost(comment.postId);
    if (!post) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (post.territory === schema.TERRITORY.ALIEN) {
      await assertAlienPartitionAccess(reactorId, post.categoryKey, 'react');
    } else {
      await assertAlienMayNotParticipateOnEarth(reactorId, post.territory);
    }
    return { comment: comment, post: post };
  }

  /**
   * 실회원 타인 canonical 댓글/대댓글 공감 → 댓글 작성자 reputation_score +1
   * 대댓글은 board_comments 동일 행 (parent_comment_id). 별도 저장소 없음.
   */
  async function receiveCommentEmpathy(actor, commentId) {
    ensureOperational();
    const reactorId = requireUser(actor);
    await assertSanction(reactorId, 'PARTICIPATE');
    const ctx = await resolveCommentEmpathyContext(reactorId, commentId);
    if (isAlienInternalTerritory(ctx.post.territory)) {
      return emptyAlienEmpathyResult(ctx.comment.authorUserId);
    }
    const progressionService = require('./user-progression-service');
    const result = await progressionService.applyEmpathyReceivedFame(reactorId, commentId, {
      targetType: 'COMMENT',
    });
    const newlyGrantedAchievements = await grantEmpathyAchievements(result);
    return mapEmpathyProgressionResult(result, { newlyGrantedAchievements: newlyGrantedAchievements });
  }

  async function revokeCommentEmpathy(actor, commentId) {
    ensureOperational();
    const reactorId = requireUser(actor);
    await assertSanction(reactorId, 'PARTICIPATE');
    const ctx = await resolveCommentEmpathyContext(reactorId, commentId);
    if (isAlienInternalTerritory(ctx.post.territory)) {
      return emptyAlienEmpathyResult(ctx.comment.authorUserId);
    }
    const progressionService = require('./user-progression-service');
    const result = await progressionService.revokeEmpathyReceivedFame(reactorId, commentId, {
      targetType: 'COMMENT',
    });
    return mapEmpathyProgressionResult(result);
  }

  return {
    createPost,
    getPost,
    listPosts,
    listPopularPosts,
    updatePost,
    deletePost,
    createComment,
    listComments,
    updateComment,
    deleteComment,
    toggleReaction,
    receivePostEmpathy,
    revokePostEmpathy,
    receiveCommentEmpathy,
    revokeCommentEmpathy,
    createReport,
    getReport,
    listReports,
    listReportBehaviors,
    reviewReport,
    reviewBehavior,
    operatorHideTarget,
  };
}

module.exports = {
  createBoardService,
};
