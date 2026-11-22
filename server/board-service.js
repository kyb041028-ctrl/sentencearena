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
const auditCore = require('../shared/admin-moderation-audit-core');
const auditService = require('./admin-moderation-audit-service');
const reportResultCore = require('../shared/report-result-notification-core');
const alienModerationService = require('./alien-moderation-service');
const regionScope = require('./activity-region-scope');

function stampStoryScene(records, region, store) {
  if (region !== 'KR' && region !== 'US') return records || [];
  if (region === 'KR' && store !== 'user_achievements' && store !== 'user_activity_region_achievement') return records || [];
  if (region === 'US' && store !== 'user_activity_region_achievement') return records || [];
  return (records || []).map(function (rec) {
    var row = rec && rec.record ? rec.record : rec;
    var id = row && row.achievementId;
    if (id !== 'first-comment' && id !== 'first-empathy-received') return row;
    return Object.assign({}, rec, {
      activityRegion: region,
      contentRegion: region,
      grantStore: store,
      scenePlay: true,
    });
  });
}

function stampTerritoryCitizenScene(records, region, store) {
  if (region !== 'KR' && region !== 'US') return records || [];
  if (region === 'KR' && store !== 'user_achievements' && store !== 'user_activity_region_achievement') return records || [];
  if (region === 'US' && store !== 'user_activity_region_achievement') return records || [];
  return (records || []).map(function (rec) {
    var row = rec && rec.record ? rec.record : rec;
    if (!row || row.achievementId !== 'territory-citizen') return rec;
    return Object.assign({}, row, {
      activityRegion: region,
      contentRegion: region,
      grantStore: store,
      scenePlay: true,
    });
  });
}

function stampFirstPostScene(records, region, store) {
  if (region !== 'KR' && region !== 'US') return records || [];
  if (region === 'KR' && store !== 'user_achievements' && store !== 'user_activity_region_achievement') return records || [];
  if (region === 'US' && store !== 'user_activity_region_achievement') return records || [];
  return (records || []).map(function (rec) {
    if (!rec || rec.achievementId !== 'first-post') return rec;
    return Object.assign({}, rec, {
      activityRegion: region,
      contentRegion: region,
      grantStore: store,
      scenePlay: true,
    });
  });
}

function createBoardService(options) {
  const opts = options || {};
  const repository = opts.repository;
  const userContext = opts.userContext || createUnavailableUserContextAdapter();
  const alienAccess = opts.alienAccess || null;
  const mapper = opts.mapper || createBoardDataMapper();
  const operational = opts.operational === true;
  const onReportCreated = typeof opts.onReportCreated === 'function' ? opts.onReportCreated : null;
  const onBehaviorReviewed = typeof opts.onBehaviorReviewed === 'function' ? opts.onBehaviorReviewed : null;
  const regionLedger = opts.regionLedger || null;
  const regionScores = opts.regionScores || null;
  const countryProgression = opts.countryProgression || null;
  const countryStructure = opts.countryStructure === true;

  async function applyUsScore(userId, eventType, sourceId) {
    if (!regionScores || typeof regionScores.applyEvent !== 'function') return null;
    return regionScores.applyEvent({
      userId: userId,
      region: 'US',
      eventType: eventType,
      sourceId: sourceId,
    });
  }

  async function appendCountryLevelCitizen(userId, region, progression, records) {
    const list = records || [];
    if (!countryProgression || !regionScores || typeof regionScores.evaluateGrants !== 'function') return list;
    if (!progression || progression.status !== 'APPLIED') return list;
    if (!(Number(progression.previousLevel) < 5 && Number(progression.level) >= 5)) return list;
    const grants = await regionScores.evaluateGrants(userId, 'LEVEL_UP', progression.level, region);
    return list.concat(grants.map(function (item) {
      return item && item.record ? item.record : null;
    }).filter(Boolean));
  }

  function scoreWasNew(scored) {
    if (!scored) return false;
    if (scored.status === 'DUPLICATE') return false;
    if (scored.status === 'APPLIED') return true;
    return scored.xpDelta != null || scored.fameDelta != null;
  }

  async function noteCountryActivity(userId, region, eventType, sourceId, text, first) {
    if (region !== 'KR' && region !== 'US') return;
    if (regionScores && typeof regionScores.recordCountrySideEffect === 'function') {
      try {
        await regionScores.recordCountrySideEffect({
          userId: userId,
          region: region,
          eventType: eventType,
          sourceId: sourceId,
          text: text,
        });
      } catch (e) {
        console.error('[board country notice]', e && e.code ? e.code : e);
      }
    }
    if (first === false || !regionLedger) return;
    const item = { userId: userId, activeRegion: region };
    if (eventType === 'POST_CREATED') {
      // 한국 글은 게시판 저장소에만 둔다. 임시 활동 저장소 검색에 복사하면
      // 한국 제목이 그 검색에 섞인다. 미국 글만 기존처럼 활동 저장소에 남긴다.
      if (region === 'US') item.post = { title: text, body: text };
      item.notice = { text: text };
    } else if (eventType === 'BOARD_COMMENT_CREATED') {
      item.comment = { body: text };
      item.notice = { text: text };
    } else if (eventType === 'EMPATHY_RECEIVED') {
      item.reaction = { kind: 'empathy' };
      item.notice = { text: text || 'empathy' };
    }
    try {
      regionLedger.writeActivity(item);
    } catch (e) {
      console.error('[board country feed]', e && e.code ? e.code : e);
    }
  }

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

  async function resolveRegistrationTerritory(userId, snapshot, activityRegion) {
    const authorTerritory = schema.normalizeTerritory(await userContext.getUserTerritory(userId, activityRegion));
    const raw = snapshot.boardTerritory != null ? snapshot.boardTerritory : snapshot.registrationBoard;
    delete snapshot.territory;
    delete snapshot.boardTerritory;
    delete snapshot.registrationBoard;
    delete snapshot.originTerritory;
    delete snapshot.origin_territory;
    if (raw == null || String(raw).trim() === '') return authorTerritory;
    let board;
    try {
      board = schema.normalizeTerritory(raw);
    } catch (e) {
      const err = new Error('BOARD_TERRITORY_INVALID');
      err.code = 'BOARD_TERRITORY_INVALID';
      throw err;
    }
    if (board === authorTerritory) return board;
    if (board === schema.TERRITORY.CENTRAL && authorTerritory !== schema.TERRITORY.ALIEN) {
      await assertDirectEarthBoardAccess(userId, board);
      return board;
    }
    const err = new Error('BOARD_FORBIDDEN');
    err.code = 'BOARD_FORBIDDEN';
    throw err;
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
    const explicitCountry = require('../shared/activity-region-core').normalizeRegion(actor && actor.activityRegion);
    const activityRegion = regionScope.bind(actor, snapshot);
    const territory = await resolveRegistrationTerritory(userId, snapshot, explicitCountry ? activityRegion : undefined);
    await assertDirectEarthBoardAccess(userId, territory);
    if (activityRegion === 'US' && !(repository && repository.supportsActivityRegion === true)) {
      const err = new Error('REGION_SCHEMA_UNAVAILABLE');
      err.code = 'REGION_SCHEMA_UNAVAILABLE';
      throw err;
    }
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
      activityRegion: activityRegion,
    });

    var progression = null;
    var progressionError = null;
    var newlyGrantedAchievements = [];
    if (activityRegion === 'US') {
      try {
        if (countryProgression) {
          progression = await countryProgression.applyEvent({
            userId: userId,
            region: 'US',
            eventType: 'POST_CREATED',
            sourceId: row.id,
          });
          if (regionScores && typeof regionScores.evaluateGrants === 'function') {
            const grants = await regionScores.evaluateGrants(userId, 'POST_CREATED', progression.level);
            progression.achievementsGranted = grants;
            newlyGrantedAchievements = grants.map(function (item) {
              return item && item.record ? item.record : null;
            }).filter(Boolean);
            newlyGrantedAchievements = await appendCountryLevelCitizen(userId, 'US', progression, newlyGrantedAchievements);
          }
        } else {
          progression = await applyUsScore(userId, 'POST_CREATED', row.id);
          newlyGrantedAchievements = progression && progression.achievementsGranted
            ? progression.achievementsGranted
            : [];
        }
      } catch (e) {
        progressionError = (e && e.code) || (e && e.message) || 'REGION_SCORE_APPLY_FAILED';
        console.error('[board createPost us score]', progressionError);
      }
    } else if (!isAlienInternalTerritory(territory)) {
      try {
        if (countryProgression) {
          if (activityRegion !== 'KR' && activityRegion !== 'US') {
            const bad = new Error('COUNTRY_REQUIRED');
            bad.code = 'COUNTRY_REQUIRED';
            throw bad;
          }
          progression = await countryProgression.applyEvent({
            userId: userId,
            region: activityRegion,
            eventType: 'POST_CREATED',
            sourceId: row.id,
          });
          if (regionScores && typeof regionScores.evaluateGrants === 'function') {
            const grants = await regionScores.evaluateGrants(userId, 'POST_CREATED', progression.level, activityRegion);
            newlyGrantedAchievements = grants.map(function (item) {
              return item && item.record ? item.record : null;
            }).filter(Boolean);
            newlyGrantedAchievements = await appendCountryLevelCitizen(userId, activityRegion, progression, newlyGrantedAchievements);
          }
        } else {
          const progressionService = require('./user-progression-service');
          progression = await progressionService.applyPostCreatedXp(userId, row.id);
        }
      } catch (e) {
        progressionError = (e && e.code) || (e && e.message) || 'PROGRESSION_APPLY_FAILED';
        console.error('[board createPost progression]', progressionError, e && e.detail ? e.detail : '');
      }

      try {
        if (countryProgression && newlyGrantedAchievements.length) {
          throw new Error('COUNTRY_GRANT_ALREADY_SET');
        }
        const evaluator = require('./achievement-evaluator-service');
        const beta = await require('./special-achievement-service').grantBetaParticipationSafe(userId, 'KR', 'POST', row.id);
        const evalResult = await evaluator.evaluateAfterPostCreated(userId);
        evalResult.granted = require('./special-achievement-service').grantedRecords(beta).concat(evalResult.granted || []);
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
        if (!e || e.message !== 'COUNTRY_GRANT_ALREADY_SET') {
          console.error('[board createPost achievement]', e && e.message ? e.message : e);
        }
      }
    }
    if ((activityRegion === 'KR' || activityRegion === 'US') && !isAlienInternalTerritory(territory)) {
      await noteCountryActivity(userId, activityRegion, 'POST_CREATED', row.id, row.title, true);
    }

    const mappedCreated = mapper.mapPostForViewer(row, userId);
    await attachCanonicalFeedHydration(mappedCreated, userId);
    if (activityRegion === 'KR' || activityRegion === 'US') await applyCountryAuthorLevels(mappedCreated, activityRegion);
    if (activityRegion === 'KR') {
      newlyGrantedAchievements = stampFirstPostScene(
        newlyGrantedAchievements,
        'KR',
        countryProgression ? 'user_activity_region_achievement' : 'user_achievements'
      );
      newlyGrantedAchievements = stampTerritoryCitizenScene(
        newlyGrantedAchievements,
        'KR',
        countryProgression ? 'user_activity_region_achievement' : 'user_achievements'
      );
    } else if (activityRegion === 'US') {
      newlyGrantedAchievements = stampFirstPostScene(
        newlyGrantedAchievements,
        'US',
        'user_activity_region_achievement'
      );
      newlyGrantedAchievements = stampTerritoryCitizenScene(
        newlyGrantedAchievements,
        'US',
        'user_activity_region_achievement'
      );
    }

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

  async function createOfficialPost(actor, input) {
    ensureOperational();
    const userId = requireUser(actor);
    const snapshot = schema.clone(input || {});
    delete snapshot.isOfficial;
    delete snapshot.is_official;
    snapshot.allowOfficialTitle = true;
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
    const row = await repository.createPost({
      authorUserId: userId,
      territory: schema.TERRITORY.CENTRAL,
      categoryKey: snapshot.categoryKey == null ? 'info' : snapshot.categoryKey,
      boardStage: 1,
      title: snapshot.title,
      content: snapshot.content,
      isAnonymous: false,
      factionBattleEnabled: false,
      isOfficial: true,
    });
    return {
      post: mapper.mapPostForViewer(row, userId),
      newlyGrantedAchievements: [],
      progression: null,
      progressionError: null,
    };
  }

  async function listOfficialPosts(actor) {
    ensureOperational();
    const viewerId = actor && actor.userId ? actor.userId : null;
    let rows;
    if (typeof repository.listOfficialPosts === 'function') {
      rows = await repository.listOfficialPosts({ status: schema.STATUS.ACTIVE });
    } else {
      rows = (await repository.listPosts({ status: schema.STATUS.ACTIVE })).filter(function (p) {
        return p && p.isOfficial === true;
      });
    }
    return rows.map(function (row) {
      return mapper.mapPostForViewer(row, viewerId);
    });
  }

  async function updateOfficialPost(actor, postId, input) {
    ensureOperational();
    requireUser(actor);
    const before = await repository.getPost(postId);
    if (!before || before.isOfficial !== true || before.status !== schema.STATUS.ACTIVE) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    const snapshot = schema.clone(input || {});
    delete snapshot.isOfficial;
    delete snapshot.is_official;
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
    if (snapshot.title != null || snapshot.content != null) {
      const validation = schema.validatePostInput({
        title: snapshot.title != null ? snapshot.title : before.title,
        content: snapshot.content != null ? snapshot.content : before.content,
        allowOfficialTitle: true,
      });
      if (!validation.valid) {
        const err = new Error(validation.errors[0]);
        err.code = err.message;
        throw err;
      }
    }
    const updater = repository.updateOfficialPost || repository.updatePost;
    const row = await updater.call(repository, postId, {
      title: snapshot.title,
      content: snapshot.content,
    }, before.authorUserId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    if (row.isOfficial !== true) {
      const err = new Error('BOARD_OFFICIAL_FLAG_LOST');
      err.code = 'BOARD_OFFICIAL_FLAG_LOST';
      throw err;
    }
    return mapper.mapPostForViewer(row, actor.userId);
  }

  async function deleteOfficialPost(actor, postId) {
    ensureOperational();
    const userId = requireUser(actor);
    const before = await repository.getPost(postId);
    if (!before || before.isOfficial !== true) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    const deleter = repository.softDeleteOfficialPost || repository.softDeletePost;
    const row = await deleter.call(
      repository,
      postId,
      typeof repository.softDeleteOfficialPost === 'function' ? userId : before.authorUserId || userId
    );
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
        deleteReason: 'OPERATOR_DELETE',
      });
    } catch (_) {}
    return mapper.mapPostForViewer(row, userId);
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
    const viewRegion = regionScope.bind(actor, null);
    const rowRegion = regionScope.explicitRegion(row);
    const krMayReadUs = viewRegion === 'KR' && rowRegion === 'US';
    if (!row.isOfficial && !krMayReadUs && !regionScope.visible(row, viewRegion)) {
      const err = new Error('REGION_MISMATCH');
      err.code = 'REGION_MISMATCH';
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
    if (viewRegion === 'KR' || viewRegion === 'US') await applyCountryAuthorLevels(mapped, viewRegion);
    return mapped;
  }

  function stampCanonicalSource(post) {
    if (!post) return post;
    post.source = 'server_canonical';
    post.canonical = true;
    return post;
  }

  async function applyCountryAuthorLevels(items, region) {
    if (region !== 'KR' && region !== 'US') return;
    if (!countryProgression || typeof countryProgression.read !== 'function') return;
    const list = Array.isArray(items) ? items : items ? [items] : [];
    const ids = [];
    list.forEach(function (item) {
      if (!item || !item.author || !item.author.userId) return;
      if (ids.indexOf(item.author.userId) < 0) ids.push(item.author.userId);
    });
    let i;
    for (i = 0; i < ids.length; i++) {
      let profile = null;
      try {
        profile = await countryProgression.read(ids[i], region);
      } catch (err) {
        if (/does not exist/i.test(String(err && err.message || err))) return;
        profile = null;
      }
      const level = profile && profile.stored ? profile.level : null;
      list.forEach(function (item) {
        if (!item || !item.author || item.author.userId !== ids[i]) return;
        if (level == null) delete item.author.level;
        else item.author.level = level;
      });
    }
  }

  async function applyUsAuthorLevels(items) {
    return applyCountryAuthorLevels(items, 'US');
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
    const authorIds = [];
    list.forEach(function (item) {
      const aid = item && item.author && item.author.userId ? String(item.author.userId) : '';
      if (aid && authorIds.indexOf(aid) < 0) authorIds.push(aid);
    });
    if (!authorIds.length) return items;
    const names = {};
    let adminClient = null;
    try {
      adminClient = require('./achievement-persist-service').getAdminClient();
    } catch (_) {
      adminClient = null;
    }
    if (adminClient) {
      try {
        const prof = await adminClient.from('profiles').select('id, display_name').in('id', authorIds);
        (prof.data || []).forEach(function (row) {
          if (row && row.id && row.display_name) names[String(row.id)] = row.display_name;
        });
      } catch (_) {}
    }
    const missing = authorIds.filter(function (id) { return !names[id]; });
    if (missing.length) {
      try {
        const fromPublic = await require('./user-progression-service').loadPublicDisplayNames(missing);
        Object.keys(fromPublic || {}).forEach(function (id) {
          if (fromPublic[id]) names[String(id)] = fromPublic[id];
        });
      } catch (_) {}
    }
    let levels = {};
    if (adminClient) {
      try {
        levels = await require('./user-progression-service').loadPublicLevelsByUserIds(authorIds);
      } catch (_) {
        levels = {};
      }
    }
    list.forEach(function (item) {
      if (!item || !item.author || !item.author.userId) return;
      const id = String(item.author.userId);
      if (names[id]) item.author.displayName = names[id];
      if (Object.prototype.hasOwnProperty.call(levels, id)) item.author.level = levels[id];
    });
    return items;
  }

  async function attachCanonicalFeedHydration(posts, viewerId) {
    const list = Array.isArray(posts) ? posts : posts ? [posts] : [];
    list.forEach(stampCanonicalSource);
    if (!list.length) return posts;
    await attachAuthorPublicFields(list);
    try {
      const persist = require('./achievement-persist-service');
      const sb = persist.getAdminClient();
      const postIds = [];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p && p.id) postIds.push(p.id);
      }
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
    const activityRegion = regionScope.bind(actor, f);
    if (viewerId && alienAccess) {
      await assertDirectEarthBoardAccess(viewerId, f.territory || schema.TERRITORY.CENTRAL);
    }
    const sqlCountry = countryStructure && repository.filtersCountryInSql === true;
    const repoFilter = {
      territory: f.territory,
      status: f.status,
    };
    if (f.authorUserId) repoFilter.authorUserId = f.authorUserId;
    if (f.q != null && String(f.q).trim() !== '') repoFilter.q = f.q;
    if (f.limit != null && f.limit !== '') repoFilter.limit = f.limit;
    if (f.offset != null && f.offset !== '') repoFilter.offset = f.offset;
    if (sqlCountry) {
      repoFilter.countryStructure = true;
      repoFilter.activityRegion = activityRegion;
    }
    const rows = await repository.listPosts(repoFilter);
    const regionRows = sqlCountry ? rows : rows.filter(function (row) {
      if (countryStructure) return regionScope.visible(row, activityRegion);
      return require('../shared/activity-region-core').visibleInRegion(row, activityRegion);
    });
    const matched = sqlCountry || f.q == null ? regionRows : regionRows.filter(function (row) {
      const needle = String(f.q || '').trim().toLowerCase();
      if (!needle) return true;
      return String(row.title || '').toLowerCase().indexOf(needle) !== -1
        || String(row.content || '').toLowerCase().indexOf(needle) !== -1
        || String(row.authorUserId || '').toLowerCase().indexOf(needle) !== -1;
    });
    let queried = matched;
    let totalCount = rows.totalCount != null ? rows.totalCount : matched.length;
    if (!sqlCountry && f.limit != null && f.limit !== '') {
      const size = Math.floor(Number(f.limit));
      const start = f.offset == null || f.offset === '' ? 0 : Math.floor(Number(f.offset));
      const from = start >= 0 ? start : 0;
      queried = matched.slice(from, from + (size >= 0 ? size : 0));
      totalCount = matched.length;
    }
    let mapped;
    if (!alienAccess) {
      mapped = queried.map((r) => mapper.mapPostForViewer(r, viewerId));
    } else {
      const ctx = viewerId ? await resolveAlienCtx(viewerId) : null;
      const filtered = queried.filter((r) => {
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
    if (activityRegion === 'KR' || activityRegion === 'US') await applyCountryAuthorLevels(mapped, activityRegion);
    mapped.totalCount = totalCount;
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
    const activityRegion = regionScope.bind(actor, src);
    const sqlCountry = countryStructure && repository.filtersCountryInSql === true
      && typeof repository.listPopularCandidates === 'function';
    const countryFilter = sqlCountry
      ? { countryStructure: true, activityRegion: activityRegion }
      : null;
    let candidateRows = null;
    const allowedIds = Object.create(null);
    if (sqlCountry) {
      candidateRows = await repository.listPopularCandidates({
        countryStructure: true,
        activityRegion: activityRegion,
        status: schema.STATUS.ACTIVE,
        territory: territory,
        boardStage: boardStage,
      });
      candidateRows.forEach(function (post) {
        if (post && post.id) allowedIds[post.id] = true;
      });
    } else {
      const regionPosts = await repository.listPosts({ status: schema.STATUS.ACTIVE });
      regionPosts.forEach(function (post) {
        if (post && regionScope.visible(post, activityRegion)) allowedIds[post.id] = true;
      });
    }
    const reactions = (await activityRepo.listActivePostReactionsSince(fromIso, toIso, countryFilter)).filter(function (row) {
      return row && allowedIds[row.postId];
    });
    const comments = (await activityRepo.listActiveCommentsSince(fromIso, toIso, countryFilter)).filter(function (row) {
      return row && allowedIds[row.postId];
    });
    const empathyEvents = (await activityRepo.listPostEmpathyEventsSince(fromIso, toIso, countryFilter)).filter(function (row) {
      return row && allowedIds[row.sourceId];
    });
    const buckets = popularPostsCore.aggregateActivity(
      { reactions: reactions, comments: comments, empathyEvents: empathyEvents },
      window,
    );
    const ids = Object.keys(buckets);
    if (!ids.length) {
      return { period: period, from: fromIso, to: toIso, posts: [], total: 0 };
    }
    let rows = [];
    if (candidateRows) {
      rows = candidateRows;
    } else if (typeof activityRepo.listPostsByIds === 'function') {
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
      if (!sqlCountry && !regionScope.visible(row, activityRegion)) continue;
      if (sqlCountry && regionScope.explicitRegion(row) !== activityRegion) continue;
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
    let offset = parseInt(src.offset, 10);
    if (!isFinite(offset) || offset < 0) offset = 0;
    const sliced = ranked.slice(offset, offset + limit);
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
    if (activityRegion === 'KR' || activityRegion === 'US') await applyCountryAuthorLevels(mapped, activityRegion);
    return {
      period: period,
      from: fromIso,
      to: toIso,
      total: ranked.length,
      posts: mapped,
    };
  }

  async function updatePost(actor, postId, input) {
    ensureOperational();
    const userId = requireUser(actor);
    await assertSanction(userId, 'WRITE');
    const before = await repository.getPost(postId);
    if (before && before.isOfficial === true) {
      const err = new Error('BOARD_OFFICIAL_OPERATOR_ONLY');
      err.code = 'BOARD_OFFICIAL_OPERATOR_ONLY';
      throw err;
    }
    if (before && !regionScope.visible(before, regionScope.bind(actor, input))) {
      const err = new Error('REGION_MISMATCH');
      err.code = 'REGION_MISMATCH';
      throw err;
    }
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
    delete snapshot.territory;
    delete snapshot.boardTerritory;
    delete snapshot.registrationBoard;
    delete snapshot.originTerritory;
    delete snapshot.origin_territory;
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
    if (before && before.isOfficial === true) {
      const err = new Error('BOARD_OFFICIAL_OPERATOR_ONLY');
      err.code = 'BOARD_OFFICIAL_OPERATOR_ONLY';
      throw err;
    }
    if (before && !before.isOfficial && !regionScope.visible(before, regionScope.bind(actor, null))) {
      const err = new Error('REGION_MISMATCH');
      err.code = 'REGION_MISMATCH';
      throw err;
    }
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
    const activityRegion = regionScope.bind(actor, snapshot);
    if (!regionScope.visible(targetPost, activityRegion)) {
      const err = new Error('REGION_MISMATCH');
      err.code = 'REGION_MISMATCH';
      throw err;
    }
    if (activityRegion === 'US' && !(repository && repository.supportsActivityRegion === true)) {
      const err = new Error('REGION_SCHEMA_UNAVAILABLE');
      err.code = 'REGION_SCHEMA_UNAVAILABLE';
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
      activityRegion: activityRegion,
    });

    var progression = null;
    var progressionError = null;
    var newlyGrantedAchievements = [];
    if (!isAlienInternalTerritory(targetPost.territory)) {
      try {
        if (countryProgression) {
          if (activityRegion !== 'KR' && activityRegion !== 'US') {
            const bad = new Error('COUNTRY_REQUIRED');
            bad.code = 'COUNTRY_REQUIRED';
            throw bad;
          }
          progression = await countryProgression.applyEvent({
            userId: userId,
            region: activityRegion,
            eventType: 'BOARD_COMMENT_CREATED',
            sourceId: row.id,
          });
          if ((activityRegion === 'KR' || activityRegion === 'US') && regionScores && typeof regionScores.evaluateGrants === 'function') {
            const grants = await regionScores.evaluateGrants(userId, 'BOARD_COMMENT_CREATED', progression.level, activityRegion);
            newlyGrantedAchievements = grants.map(function (item) {
              return item && item.record ? item.record : null;
            }).filter(Boolean);
            newlyGrantedAchievements = await appendCountryLevelCitizen(userId, activityRegion, progression, newlyGrantedAchievements);
          }
        } else if (activityRegion === 'US') {
          progression = await applyUsScore(userId, 'BOARD_COMMENT_CREATED', row.id);
          newlyGrantedAchievements = progression && progression.achievementsGranted
            ? progression.achievementsGranted
            : [];
        } else {
          const progressionService = require('./user-progression-service');
          progression = await progressionService.applyBoardCommentCreatedXp(userId, row.id);
        }
      } catch (e) {
        progressionError = (e && e.code) || (e && e.message) || 'PROGRESSION_APPLY_FAILED';
        console.error('[board createComment progression]', progressionError);
      }
      if (activityRegion === 'KR' || activityRegion === 'US') {
        await noteCountryActivity(userId, activityRegion, 'BOARD_COMMENT_CREATED', row.id, row.content, true);
      }
    }
    if (activityRegion === 'KR' && !countryProgression && !isAlienInternalTerritory(targetPost.territory)) {
      try {
        const evaluator = require('./achievement-evaluator-service');
        const beta = await require('./special-achievement-service').grantBetaParticipationSafe(userId, 'KR', 'BOARD_COMMENT', row.id);
        const evalResult = await evaluator.evaluateAfterCommentCreated(userId);
        evalResult.granted = require('./special-achievement-service').grantedRecords(beta).concat(evalResult.granted || []);
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

    if (activityRegion === 'KR') {
      newlyGrantedAchievements = stampStoryScene(
        newlyGrantedAchievements,
        'KR',
        countryProgression ? 'user_activity_region_achievement' : 'user_achievements'
      );
      newlyGrantedAchievements = stampTerritoryCitizenScene(
        newlyGrantedAchievements,
        'KR',
        countryProgression ? 'user_activity_region_achievement' : 'user_achievements'
      );
    } else if (activityRegion === 'US') {
      newlyGrantedAchievements = stampStoryScene(
        newlyGrantedAchievements,
        'US',
        'user_activity_region_achievement'
      );
      newlyGrantedAchievements = stampTerritoryCitizenScene(
        newlyGrantedAchievements,
        'US',
        'user_activity_region_achievement'
      );
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
    if (targetPost && !regionScope.visible(targetPost, regionScope.bind(actor, null))) {
      const err = new Error('REGION_MISMATCH');
      err.code = 'REGION_MISMATCH';
      throw err;
    }
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
    const commentRegion = targetPost && (targetPost.activityRegion === 'US' || targetPost.activity_region === 'US')
      ? 'US'
      : targetPost && (targetPost.activityRegion === 'KR' || targetPost.activity_region === 'KR')
        ? 'KR'
        : regionScope.bind(actor, null);
    if (commentRegion === 'KR' || commentRegion === 'US') {
      await applyCountryAuthorLevels(mapped, commentRegion);
    }
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
    let contentRow = null;
    if (snapshot.targetType === schema.TARGET_TYPE.POST) {
      const post = await repository.getPost(snapshot.targetId);
      if (!post) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = post.authorUserId;
      targetPostForPartition = post;
      contentRow = post;
    } else {
      const comment = await repository.getComment(snapshot.targetId);
      if (!comment) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      targetAuthorUserId = comment.authorUserId;
      targetPostForPartition = await repository.getPost(comment.postId);
      contentRow = comment;
    }
    const contentCountry = regionScope.explicitRegion(contentRow);
    const requestedCountry = require('../shared/activity-region-core').normalizeRegion(regionScope.requestedFrom(snapshot));
    const actorCountry = require('../shared/activity-region-core').normalizeRegion(actor && actor.activityRegion);
    let activityRegion = contentCountry;
    if (countryStructure) {
      if (!contentCountry) {
        const err = new Error('COUNTRY_REQUIRED');
        err.code = 'COUNTRY_REQUIRED';
        throw err;
      }
      if (requestedCountry && requestedCountry !== contentCountry) {
        const err = new Error('REGION_MISMATCH');
        err.code = 'REGION_MISMATCH';
        throw err;
      }
      if (!requestedCountry && actorCountry && actorCountry !== contentCountry) {
        const err = new Error('REGION_MISMATCH');
        err.code = 'REGION_MISMATCH';
        throw err;
      }
      if (!requestedCountry && !actorCountry) {
        const err = new Error('COUNTRY_REQUIRED');
        err.code = 'COUNTRY_REQUIRED';
        throw err;
      }
    } else {
      activityRegion = regionScope.bind(actor, snapshot);
      if (contentCountry && !regionScope.visible(contentRow, activityRegion)) {
        const err = new Error('REGION_MISMATCH');
        err.code = 'REGION_MISMATCH';
        throw err;
      }
      if (targetPostForPartition && contentRow !== targetPostForPartition &&
          !regionScope.visible(targetPostForPartition, activityRegion)) {
        const err = new Error('REGION_MISMATCH');
        err.code = 'REGION_MISMATCH';
        throw err;
      }
    }
    if (targetPostForPartition && countryStructure &&
        regionScope.explicitRegion(targetPostForPartition) &&
        regionScope.explicitRegion(targetPostForPartition) !== contentCountry) {
      const err = new Error('REGION_MISMATCH');
      err.code = 'REGION_MISMATCH';
      throw err;
    }
    if (activityRegion === 'US' && !(repository && repository.supportsActivityRegion === true)) {
      const err = new Error('REGION_SCHEMA_UNAVAILABLE');
      err.code = 'REGION_SCHEMA_UNAVAILABLE';
      throw err;
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
    async function alignmentCopy(targetUserId) {
      if (contentCountry === 'US') return null;
      if (contentCountry === 'KR') {
        const snap = await userContext.getUserAlignmentScore(targetUserId, 'KR');
        if (snap == null || snap === '') return null;
        const n = Number(snap);
        if (!isFinite(n)) {
          const err = new Error('BOARD_ALIGNMENT_SCORE_INVALID');
          err.code = 'BOARD_ALIGNMENT_SCORE_INVALID';
          throw err;
        }
        return n;
      }
      const snap = await userContext.getUserAlignmentScore(targetUserId);
      const n = Number(snap);
      if (!isFinite(n)) {
        const err = new Error('BOARD_ALIGNMENT_SCORE_INVALID');
        err.code = 'BOARD_ALIGNMENT_SCORE_INVALID';
        throw err;
      }
      return n;
    }
    const actorAlignmentScore = await alignmentCopy(userId);
    const targetAuthorAlignmentScore = await alignmentCopy(targetAuthorUserId);

    const reactionResult = await repository.toggleReaction({
      actorUserId: userId,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      reactionType: snapshot.reactionType,
      actorTerritory,
      audienceScope,
      targetAuthorTerritory,
      actorAlignmentScore,
      targetAuthorAlignmentScore,
      activityRegion: contentCountry,
    });
    if (activityRegion === 'US' && regionLedger) {
      regionLedger.writeActivity({
        userId: userId,
        activeRegion: 'US',
        reaction: { kind: snapshot.reactionType },
      });
    }
    return reactionResult;
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
      if (!regionScope.visible(target, regionScope.bind(actor, null))) {
        const err = new Error('REGION_MISMATCH');
        err.code = 'REGION_MISMATCH';
        throw err;
      }
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
      const commentCountry = regionScope.explicitRegion(target);
      if (commentCountry && regionScope.bind(actor, null) !== commentCountry) {
        const err = new Error('REGION_MISMATCH');
        err.code = 'REGION_MISMATCH';
        throw err;
      }
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

  function pickRepresentativeReportId(reports) {
    const rows = (reports || []).filter(function (row) {
      return row && row.id;
    });
    if (!rows.length) return null;
    rows.sort(function (a, b) {
      return String(a.createdAt || a.created_at || '').localeCompare(String(b.createdAt || b.created_at || ''));
    });
    return rows[rows.length - 1].id;
  }

  function auditReasonFromPrimary(primaryReasonCode) {
    const code = String(primaryReasonCode || '').trim().toLowerCase();
    if (auditCore.isReasonCode(auditCore.ACTION_TYPE.POST_SOFT_DELETE, code)) return code;
    return 'other';
  }

  async function lookupSanctionEventId(userId, behaviorKey) {
    if (!userId || !behaviorKey) return null;
    try {
      const alienMod = require('./alien-moderation-service');
      if (typeof alienMod.listModerationEvents !== 'function') return null;
      const listed = await alienMod.listModerationEvents(userId, { limit: 40 });
      const items = (listed && listed.items) || [];
      for (let i = 0; i < items.length; i++) {
        if (String(items[i].sourceId || '') === String(behaviorKey) && auditCore.isUuid(items[i].id)) {
          return items[i].id;
        }
      }
    } catch (_) {}
    return null;
  }

  async function recordReportLinkedAudit(input) {
    const src = input || {};
    try {
      const packed = auditCore.normalizeWrite({
        actorUserId: src.actorUserId,
        actionType: src.actionType,
        targetType: src.targetType,
        targetId: src.targetId,
        targetUserId: src.targetUserId || null,
        reasonCode: src.reasonCode,
        operatorNote: src.operatorNote || '',
        reportId: src.reportId || null,
        sanctionId: src.sanctionId || null,
      });
      if (!packed.ok) {
        return { ok: false, error: packed.error };
      }
      const row = await auditService.record(packed.event);
      return { ok: true, audit: row };
    } catch (e) {
      return {
        ok: false,
        error: (e && e.code) || (e && e.message) || 'ADMIN_AUDIT_INSERT_FAILED',
        limitation: src.limitation || null,
      };
    }
  }

  async function reviewBehavior(actor, behaviorKey, patch) {
    ensureOperational();
    const actorUserId = requireUser(actor);
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
    const reportId = pickRepresentativeReportId(updated);
    const audits = [];
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
          operatorUserId: actorUserId,
          reportId: reportId,
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
    const sanctionResult = alien && alien.sanction ? alien.sanction : alien;
    const hideNeeded = !!(sanctionResult && sanctionResult.hideContent);
    let hideResult = null;
    if (hideNeeded) {
      try {
        hideResult = await operatorHideTarget(parsed.behaviorKey);
      } catch (_) {
        hideResult = { ok: false, error: 'BOARD_HIDE_FAILED' };
      }
      if (hideResult && hideResult.ok && reportId && auditCore.isUuid(actorUserId)) {
        const reasonCode = auditReasonFromPrimary(grouped && grouped.primaryReasonCode);
        const hideAudit = await recordReportLinkedAudit({
          actorUserId: actorUserId,
          actionType: parsed.targetType === 'COMMENT'
            ? auditCore.ACTION_TYPE.COMMENT_SOFT_DELETE
            : auditCore.ACTION_TYPE.POST_SOFT_DELETE,
          targetType: parsed.targetType === 'COMMENT'
            ? auditCore.TARGET_TYPE.COMMENT
            : auditCore.TARGET_TYPE.POST,
          targetId: parsed.targetId,
          targetUserId: grouped && grouped.targetAuthorUserId,
          reasonCode: reasonCode,
          operatorNote: reasonCode === 'other'
            ? String(note || 'report hide').slice(0, auditCore.NOTE_MAX)
            : String(note || '').slice(0, auditCore.NOTE_MAX),
          reportId: reportId,
        });
        if (hideAudit.ok) audits.push(hideAudit.audit);
        else audits.push({ ok: false, actionType: 'HIDE', error: hideAudit.error });
      }
    }
    if (
      sanctionResult
      && sanctionResult.applied
      && sanctionResult.sanctionType
      && sanctionResult.sanctionType !== 'NONE'
      && reportId
      && auditCore.isUuid(actorUserId)
      && parsed.targetId
    ) {
      const reasonCode = auditReasonFromPrimary(grouped && grouped.primaryReasonCode);
      const sanctionId = await lookupSanctionEventId(
        grouped && grouped.targetAuthorUserId,
        parsed.behaviorKey
      );
      const sancAudit = await recordReportLinkedAudit({
        actorUserId: actorUserId,
        actionType: auditCore.ACTION_TYPE.SANCTION_APPLIED,
        targetType: parsed.targetType === 'COMMENT'
          ? auditCore.TARGET_TYPE.COMMENT
          : auditCore.TARGET_TYPE.POST,
        targetId: parsed.targetId,
        targetUserId: grouped && grouped.targetAuthorUserId,
        reasonCode: reasonCode,
        operatorNote: reasonCode === 'other'
          ? String(note || 'report sanction').slice(0, auditCore.NOTE_MAX)
          : String(note || '').slice(0, auditCore.NOTE_MAX),
        reportId: reportId,
        sanctionId: sanctionId,
        limitation: 'SANCTION_AUDIT_ATOMICITY_LIMITATION',
      });
      if (sancAudit.ok) audits.push(sancAudit.audit);
      else {
        audits.push({
          ok: false,
          actionType: auditCore.ACTION_TYPE.SANCTION_APPLIED,
          error: sancAudit.error,
          limitation: 'SANCTION_AUDIT_ATOMICITY_LIMITATION',
        });
      }
    }
    if (
      nextStatus === 'REJECTED'
      && prevStatus !== 'REJECTED'
      && reportId
      && auditCore.isUuid(actorUserId)
      && parsed.targetId
    ) {
      const reasonCode = auditReasonFromPrimary(grouped && grouped.primaryReasonCode);
      const rejectAudit = await recordReportLinkedAudit({
        actorUserId: actorUserId,
        actionType: auditCore.ACTION_TYPE.REPORT_REJECTED,
        targetType: parsed.targetType === 'COMMENT'
          ? auditCore.TARGET_TYPE.COMMENT
          : auditCore.TARGET_TYPE.POST,
        targetId: parsed.targetId,
        targetUserId: grouped && grouped.targetAuthorUserId,
        reasonCode: reasonCode,
        operatorNote: reasonCode === 'other'
          ? String(note || 'report rejected').slice(0, auditCore.NOTE_MAX)
          : String(note || '').slice(0, auditCore.NOTE_MAX),
        reportId: reportId,
        limitation: 'REPORT_REJECT_AUDIT_ATOMICITY_LIMITATION',
      });
      if (rejectAudit.ok) audits.push(rejectAudit.audit);
      else {
        audits.push({
          ok: false,
          actionType: auditCore.ACTION_TYPE.REPORT_REJECTED,
          error: rejectAudit.error,
          limitation: 'REPORT_REJECT_AUDIT_ATOMICITY_LIMITATION',
        });
      }
    }
    const reportResultNotifications = await notifyReportersOfReviewResult(updated, nextStatus, prevStatus);
    return {
      behavior: grouped,
      alien: alien,
      sanction: sanctionResult,
      reportId: reportId,
      hide: hideResult,
      audits: audits,
      reportResultNotifications: reportResultNotifications,
    };
  }

  function shouldNotifyReportResult(prevStatus, nextStatus) {
    const outcome = reportResultCore.outcomeFromReviewStatus(nextStatus);
    if (!outcome) return false;
    const prev = String(prevStatus || '').trim().toUpperCase();
    const next = String(nextStatus || '').trim().toUpperCase();
    if (next === 'REJECTED') return prev !== 'REJECTED';
    if (next === 'ACCEPTED') return prev !== 'ACCEPTED' && prev !== 'RESOLVED';
    if (next === 'RESOLVED') return prev !== 'ACCEPTED' && prev !== 'RESOLVED';
    return false;
  }

  async function notifyReportersOfReviewResult(reports, nextStatus, prevStatus) {
    if (!shouldNotifyReportResult(prevStatus, nextStatus)) {
      return { sent: 0, skipped: true, items: [] };
    }
    const outcome = reportResultCore.outcomeFromReviewStatus(nextStatus);
    const items = [];
    let sent = 0;
    const seen = Object.create(null);
    for (let i = 0; i < (reports || []).length; i++) {
      const row = reports[i] || {};
      const reportId = String(row.id || '').trim();
      const reporterUserId = String(row.reporterUserId || row.reporter_user_id || '').trim();
      if (!reportId || !reporterUserId) continue;
      if (seen[reportId]) continue;
      seen[reportId] = true;
      const packed = reportResultCore.buildPublicNotification({
        reportId: reportId,
        reporterUserId: reporterUserId,
        outcome: outcome,
      });
      if (!packed.ok) {
        items.push({
          reportId: reportId,
          ok: false,
          error: packed.error,
          limitation: 'REPORT_RESULT_NOTIFICATION_DELIVERY_LIMITATION',
        });
        continue;
      }
      try {
        const issued = await alienModerationService.issueNotification(packed.notification);
        if (!issued || issued.ok === false) {
          items.push({
            reportId: reportId,
            ok: false,
            error: (issued && issued.error) || 'REPORT_RESULT_NOTIFICATION_FAILED',
            limitation: 'REPORT_RESULT_NOTIFICATION_DELIVERY_LIMITATION',
          });
          continue;
        }
        if (!issued.duplicate) sent += 1;
        items.push({
          reportId: reportId,
          ok: true,
          duplicate: !!issued.duplicate,
          outcome: outcome,
        });
      } catch (_) {
        items.push({
          reportId: reportId,
          ok: false,
          error: 'REPORT_RESULT_NOTIFICATION_FAILED',
          limitation: 'REPORT_RESULT_NOTIFICATION_DELIVERY_LIMITATION',
        });
      }
    }
    return { sent: sent, skipped: false, items: items };
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

  async function listAdminPosts(actor, filter) {
    ensureOperational();
    requireUser(actor);
    const f = filter || {};
    const rows = await repository.listPosts({});
    const q = String(f.q || '').trim();
    let out = rows || [];
    if (q) {
      const qLower = q.toLowerCase();
      out = out.filter(function (p) {
        return String(p.id) === q || String(p.title || '').toLowerCase().indexOf(qLower) !== -1;
      });
    }
    const limit = Math.min(100, Math.max(1, Number(f.limit) || 30));
    return out.slice(0, limit);
  }

  async function getAdminPost(actor, postId) {
    ensureOperational();
    requireUser(actor);
    const row = await repository.getPost(postId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    return row;
  }

  function throwAudit(code) {
    const err = new Error(code);
    err.code = code;
    throw err;
  }

  function packOperatorAudit(actorUserId, actionType, target, auditInput, targetType) {
    const src = auditInput || {};
    const packed = auditCore.normalizeWrite({
      actorUserId: actorUserId,
      actionType: actionType,
      targetType: targetType || auditCore.TARGET_TYPE.POST,
      targetId: target && target.id,
      targetUserId: target && target.authorUserId,
      reasonCode: src.reasonCode || src.reason_code,
      operatorNote: src.operatorNote || src.operator_note,
      reportId: src.reportId || src.report_id || null,
      sanctionId: src.sanctionId || src.sanction_id || null,
    });
    if (!packed.ok) throwAudit(packed.error);
    return packed.event;
  }

  async function operatorSoftDeletePost(actor, postId, auditInput) {
    ensureOperational();
    const userId = requireUser(actor);
    if (typeof repository.operatorSoftDeletePost !== 'function' && typeof repository.operatorSoftDeletePostWithAudit !== 'function') {
      const err = new Error('BOARD_OPERATOR_DELETE_UNAVAILABLE');
      err.code = 'BOARD_OPERATOR_DELETE_UNAVAILABLE';
      throw err;
    }
    const before = await repository.getPost(postId);
    if (!before) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    const event = packOperatorAudit(userId, auditCore.ACTION_TYPE.POST_SOFT_DELETE, before, auditInput, auditCore.TARGET_TYPE.POST);
    if (typeof repository.operatorSoftDeletePostWithAudit === 'function') {
      const out = await repository.operatorSoftDeletePostWithAudit(postId, userId, event);
      if (!out || !out.post) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      return out;
    }
    const row = await repository.operatorSoftDeletePost(postId, userId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    try {
      const audit = await auditService.record(event);
      return { post: row, audit: audit };
    } catch (e) {
      if (
        before.status !== schema.STATUS.DELETED
        && before.status !== schema.STATUS.HIDDEN_BY_OPERATOR
        && typeof repository.operatorRestorePost === 'function'
      ) {
        try { await repository.operatorRestorePost(postId); } catch (_) {}
      }
      throw e;
    }
  }

  async function operatorRestorePost(actor, postId, auditInput) {
    ensureOperational();
    const userId = requireUser(actor);
    if (typeof repository.operatorRestorePost !== 'function' && typeof repository.operatorRestorePostWithAudit !== 'function') {
      const err = new Error('BOARD_OPERATOR_RESTORE_UNAVAILABLE');
      err.code = 'BOARD_OPERATOR_RESTORE_UNAVAILABLE';
      throw err;
    }
    const before = await repository.getPost(postId);
    if (!before) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    const event = packOperatorAudit(userId, auditCore.ACTION_TYPE.POST_RESTORE, before, auditInput, auditCore.TARGET_TYPE.POST);
    if (typeof repository.operatorRestorePostWithAudit === 'function') {
      const out = await repository.operatorRestorePostWithAudit(postId, userId, event);
      if (!out || !out.post) {
        const err = new Error('BOARD_POST_NOT_FOUND');
        err.code = 'BOARD_POST_NOT_FOUND';
        throw err;
      }
      return out;
    }
    const row = await repository.operatorRestorePost(postId);
    if (!row) {
      const err = new Error('BOARD_POST_NOT_FOUND');
      err.code = 'BOARD_POST_NOT_FOUND';
      throw err;
    }
    try {
      const audit = await auditService.record(event);
      return { post: row, audit: audit };
    } catch (e) {
      if (
        (before.status === schema.STATUS.DELETED || before.status === schema.STATUS.HIDDEN_BY_OPERATOR)
        && typeof repository.operatorSoftDeletePost === 'function'
      ) {
        try { await repository.operatorSoftDeletePost(postId, before.deletedBy || userId); } catch (_) {}
      }
      throw e;
    }
  }

  async function listAdminComments(actor, filter) {
    ensureOperational();
    requireUser(actor);
    const f = filter || {};
    if (typeof repository.listAdminComments === 'function') {
      return repository.listAdminComments({
        q: f.q,
        commentId: f.commentId,
        postId: f.postId,
        authorUserId: f.authorUserId,
        limit: f.limit,
      });
    }
    const err = new Error('BOARD_OPERATOR_COMMENT_LIST_UNAVAILABLE');
    err.code = 'BOARD_OPERATOR_COMMENT_LIST_UNAVAILABLE';
    throw err;
  }

  async function getAdminComment(actor, commentId) {
    ensureOperational();
    requireUser(actor);
    const row = await repository.getComment(commentId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    return row;
  }

  async function operatorSoftDeleteComment(actor, commentId, auditInput) {
    ensureOperational();
    const userId = requireUser(actor);
    if (typeof repository.operatorSoftDeleteComment !== 'function' && typeof repository.operatorSoftDeleteCommentWithAudit !== 'function') {
      const err = new Error('BOARD_OPERATOR_COMMENT_DELETE_UNAVAILABLE');
      err.code = 'BOARD_OPERATOR_COMMENT_DELETE_UNAVAILABLE';
      throw err;
    }
    const before = await repository.getComment(commentId);
    if (!before) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    const event = packOperatorAudit(
      userId,
      auditCore.ACTION_TYPE.COMMENT_SOFT_DELETE,
      before,
      auditInput,
      auditCore.TARGET_TYPE.COMMENT,
    );
    if (typeof repository.operatorSoftDeleteCommentWithAudit === 'function') {
      const out = await repository.operatorSoftDeleteCommentWithAudit(commentId, userId, event);
      if (!out || !out.comment) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      return out;
    }
    const row = await repository.operatorSoftDeleteComment(commentId, userId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    try {
      const audit = await auditService.record(event);
      return { comment: row, audit: audit };
    } catch (e) {
      if (
        before.status !== schema.STATUS.DELETED
        && before.status !== schema.STATUS.HIDDEN_BY_OPERATOR
        && typeof repository.operatorRestoreComment === 'function'
      ) {
        try { await repository.operatorRestoreComment(commentId); } catch (_) {}
      }
      throw e;
    }
  }

  async function operatorRestoreComment(actor, commentId, auditInput) {
    ensureOperational();
    const userId = requireUser(actor);
    if (typeof repository.operatorRestoreComment !== 'function' && typeof repository.operatorRestoreCommentWithAudit !== 'function') {
      const err = new Error('BOARD_OPERATOR_COMMENT_RESTORE_UNAVAILABLE');
      err.code = 'BOARD_OPERATOR_COMMENT_RESTORE_UNAVAILABLE';
      throw err;
    }
    const before = await repository.getComment(commentId);
    if (!before) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    const event = packOperatorAudit(
      userId,
      auditCore.ACTION_TYPE.COMMENT_RESTORE,
      before,
      auditInput,
      auditCore.TARGET_TYPE.COMMENT,
    );
    if (typeof repository.operatorRestoreCommentWithAudit === 'function') {
      const out = await repository.operatorRestoreCommentWithAudit(commentId, userId, event);
      if (!out || !out.comment) {
        const err = new Error('BOARD_COMMENT_NOT_FOUND');
        err.code = 'BOARD_COMMENT_NOT_FOUND';
        throw err;
      }
      return out;
    }
    const row = await repository.operatorRestoreComment(commentId);
    if (!row) {
      const err = new Error('BOARD_COMMENT_NOT_FOUND');
      err.code = 'BOARD_COMMENT_NOT_FOUND';
      throw err;
    }
    try {
      const audit = await auditService.record(event);
      return { comment: row, audit: audit };
    } catch (e) {
      if (
        (before.status === schema.STATUS.DELETED || before.status === schema.STATUS.HIDDEN_BY_OPERATOR)
        && typeof repository.operatorSoftDeleteComment === 'function'
      ) {
        try { await repository.operatorSoftDeleteComment(commentId, before.deletedBy || userId); } catch (_) {}
      }
      throw e;
    }
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

    const empathyRegion = regionScope.bind(actor, null);
    if (!regionScope.visible(post, empathyRegion)) {
      const err = new Error('REGION_MISMATCH');
      err.code = 'REGION_MISMATCH';
      throw err;
    }
    if (empathyRegion === 'US') {
      if (!(repository && repository.supportsActivityRegion === true)) {
        const err = new Error('REGION_SCHEMA_UNAVAILABLE');
        err.code = 'REGION_SCHEMA_UNAVAILABLE';
        throw err;
      }
      if (reactorId === post.authorUserId) {
        const err = new Error('SELF_EMPATHY');
        err.code = 'SELF_EMPATHY';
        throw err;
      }
      const scored = countryProgression
        ? await countryProgression.applyEvent({
          userId: post.authorUserId,
          region: 'US',
          eventType: 'EMPATHY_RECEIVED',
          sourceId: postId + ':' + reactorId,
        })
        : await applyUsScore(post.authorUserId, 'EMPATHY_RECEIVED', postId + ':' + reactorId);
      if (!scored) {
        const err = new Error('REGION_SCHEMA_UNAVAILABLE');
        err.code = 'REGION_SCHEMA_UNAVAILABLE';
        throw err;
      }
      await noteCountryActivity(
        post.authorUserId,
        'US',
        'EMPATHY_RECEIVED',
        postId + ':' + reactorId,
        'empathy',
        scoreWasNew(scored)
      );
      var usEmpathyGrants = scored.achievementsGranted || [];
      if (countryProgression && regionScores && typeof regionScores.evaluateGrants === 'function') {
        const grants = await regionScores.evaluateGrants(post.authorUserId, 'EMPATHY_RECEIVED', scored.level);
        usEmpathyGrants = grants.map(function (item) {
          return item && item.record ? item.record : null;
        }).filter(Boolean);
        usEmpathyGrants = await appendCountryLevelCitizen(post.authorUserId, 'US', scored, usEmpathyGrants);
      }
      return {
        granted: true,
        revoked: false,
        duplicate: false,
        fame: scored.fame,
        previousFame: scored.fame - (scored.fameDelta || 0),
        fameDelta: scored.fameDelta || 0,
        level: scored.level,
        xp: scored.xp,
        expPercent: null,
        newlyGrantedAchievements: stampTerritoryCitizenScene(
          stampStoryScene(
            usEmpathyGrants,
            'US',
            'user_activity_region_achievement'
          ),
          'US',
          'user_activity_region_achievement'
        ),
      };
    }

    if (countryProgression) {
      if (empathyRegion !== 'KR') {
        const err = new Error('COUNTRY_REQUIRED');
        err.code = 'COUNTRY_REQUIRED';
        throw err;
      }
      const applied = await countryProgression.applyEvent({
        userId: post.authorUserId,
        region: 'KR',
        eventType: 'EMPATHY_RECEIVED',
        sourceId: postId + ':' + reactorId,
      });
      await noteCountryActivity(
        post.authorUserId,
        'KR',
        'EMPATHY_RECEIVED',
        postId + ':' + reactorId,
        'empathy',
        applied.status === 'APPLIED'
      );
      var krEmpathyGrants = [];
      if (applied.status === 'APPLIED' && regionScores && typeof regionScores.evaluateGrants === 'function') {
        const grants = await regionScores.evaluateGrants(post.authorUserId, 'EMPATHY_RECEIVED', applied.level, 'KR');
        krEmpathyGrants = grants.map(function (item) {
          return item && item.record ? item.record : null;
        }).filter(Boolean);
        krEmpathyGrants = await appendCountryLevelCitizen(post.authorUserId, 'KR', applied, krEmpathyGrants);
      } else if (applied.status === 'APPLIED') {
        krEmpathyGrants = await grantEmpathyAchievements({ granted: true, recipientUserId: post.authorUserId });
      }
      return mapEmpathyProgressionResult({
        granted: applied.status === 'APPLIED',
        revoked: false,
        duplicate: applied.status === 'DUPLICATE',
        fame: applied.fame,
        previousFame: applied.fame - applied.fameDelta,
        fameDelta: applied.fameDelta,
        level: applied.level,
        xp: applied.xp,
        expPercent: null,
        verified: true,
        recipientUserId: post.authorUserId,
      }, {
        newlyGrantedAchievements: stampTerritoryCitizenScene(
          stampStoryScene(
            krEmpathyGrants,
            'KR',
            regionScores ? 'user_activity_region_achievement' : 'user_achievements'
          ),
          'KR',
          regionScores ? 'user_activity_region_achievement' : 'user_achievements'
        ),
      });
    }
    const progressionService = require('./user-progression-service');
    const result = await progressionService.applyEmpathyReceivedFame(reactorId, postId, {
      targetType: 'POST',
    });
    const newlyGrantedAchievements = stampStoryScene(
      await grantEmpathyAchievements(result),
      'KR',
      'user_achievements'
    );
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
    const country = regionScope.explicitRegion(post);
    if (!countryProgression) {
      const progressionService = require('./user-progression-service');
      const result = await progressionService.revokeEmpathyReceivedFame(reactorId, postId, {
        targetType: 'POST',
      });
      return mapEmpathyProgressionResult(result);
    }
    if (!country) {
      const err = new Error('COUNTRY_REQUIRED');
      err.code = 'COUNTRY_REQUIRED';
      throw err;
    }
    if (reactorId === post.authorUserId) {
      const current = await countryProgression.read(post.authorUserId, country);
      return mapEmpathyProgressionResult({
        granted: false,
        revoked: false,
        reason: 'SELF_EMPATHY',
        recipientUserId: post.authorUserId,
        fame: current.fame,
        previousFame: current.fame,
        fameDelta: 0,
        level: current.level,
        xp: current.xp,
        verified: true,
      });
    }
    const applied = await countryProgression.revokeEvent({
      userId: post.authorUserId,
      region: country,
      eventType: 'EMPATHY_RECEIVED',
      sourceId: postId + ':' + reactorId,
    });
    return mapEmpathyProgressionResult({
      granted: false,
      revoked: applied.status === 'APPLIED',
      duplicate: false,
      reason: applied.status,
      recipientUserId: post.authorUserId,
      fame: applied.fame,
      previousFame: applied.fame - applied.fameDelta,
      fameDelta: applied.fameDelta,
      level: applied.level,
      xp: applied.xp,
      expPercent: null,
      verified: true,
    });
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
    const country = regionScope.explicitRegion(ctx.comment) || regionScope.explicitRegion(ctx.post);
    if (!countryProgression) {
      const progressionService = require('./user-progression-service');
      const result = await progressionService.applyEmpathyReceivedFame(reactorId, commentId, {
        targetType: 'COMMENT',
      });
      const newlyGrantedAchievements = await grantEmpathyAchievements(result);
      return mapEmpathyProgressionResult(result, { newlyGrantedAchievements: newlyGrantedAchievements });
    }
    if (!country) {
      const err = new Error('COUNTRY_REQUIRED');
      err.code = 'COUNTRY_REQUIRED';
      throw err;
    }
    if (reactorId === ctx.comment.authorUserId) {
      const current = await countryProgression.read(ctx.comment.authorUserId, country);
      return mapEmpathyProgressionResult({
        granted: false,
        revoked: false,
        reason: 'SELF_EMPATHY',
        recipientUserId: ctx.comment.authorUserId,
        fame: current.fame,
        previousFame: current.fame,
        fameDelta: 0,
        level: current.level,
        xp: current.xp,
        verified: true,
      });
    }
    const applied = await countryProgression.applyEvent({
      userId: ctx.comment.authorUserId,
      region: country,
      eventType: 'EMPATHY_RECEIVED',
      sourceId: commentId + ':' + reactorId,
    });
    await noteCountryActivity(
      ctx.comment.authorUserId,
      country,
      'EMPATHY_RECEIVED',
      commentId + ':' + reactorId,
      'empathy',
      applied.status === 'APPLIED'
    );
    var commentEmpathyGrants = [];
    if (applied.status === 'APPLIED' && country === 'KR') {
      commentEmpathyGrants = await grantEmpathyAchievements({
        granted: true,
        recipientUserId: ctx.comment.authorUserId,
      });
      commentEmpathyGrants = await appendCountryLevelCitizen(ctx.comment.authorUserId, 'KR', applied, commentEmpathyGrants);
      commentEmpathyGrants = stampStoryScene(commentEmpathyGrants, 'KR', 'user_achievements');
      commentEmpathyGrants = stampTerritoryCitizenScene(commentEmpathyGrants, 'KR', 'user_activity_region_achievement');
    } else if (applied.status === 'APPLIED' && country === 'US' && regionScores && typeof regionScores.evaluateGrants === 'function') {
      const grants = await regionScores.evaluateGrants(ctx.comment.authorUserId, 'EMPATHY_RECEIVED', applied.level);
      commentEmpathyGrants = await appendCountryLevelCitizen(
        ctx.comment.authorUserId,
        'US',
        applied,
        grants.map(function (item) { return item && item.record ? item.record : null; }).filter(Boolean)
      );
      commentEmpathyGrants = stampStoryScene(
        commentEmpathyGrants,
        'US',
        'user_activity_region_achievement'
      );
      commentEmpathyGrants = stampTerritoryCitizenScene(
        commentEmpathyGrants,
        'US',
        'user_activity_region_achievement'
      );
    }
    return mapEmpathyProgressionResult({
      granted: applied.status === 'APPLIED',
      revoked: false,
      duplicate: applied.status === 'DUPLICATE',
      reason: applied.status,
      recipientUserId: ctx.comment.authorUserId,
      fame: applied.fame,
      previousFame: applied.fame - applied.fameDelta,
      fameDelta: applied.fameDelta,
      level: applied.level,
      xp: applied.xp,
      expPercent: null,
      verified: true,
    }, { newlyGrantedAchievements: commentEmpathyGrants });
  }

  async function revokeCommentEmpathy(actor, commentId) {
    ensureOperational();
    const reactorId = requireUser(actor);
    await assertSanction(reactorId, 'PARTICIPATE');
    const ctx = await resolveCommentEmpathyContext(reactorId, commentId);
    if (isAlienInternalTerritory(ctx.post.territory)) {
      return emptyAlienEmpathyResult(ctx.comment.authorUserId);
    }
    const country = regionScope.explicitRegion(ctx.comment) || regionScope.explicitRegion(ctx.post);
    if (!countryProgression) {
      const progressionService = require('./user-progression-service');
      const result = await progressionService.revokeEmpathyReceivedFame(reactorId, commentId, {
        targetType: 'COMMENT',
      });
      return mapEmpathyProgressionResult(result);
    }
    if (!country) {
      const err = new Error('COUNTRY_REQUIRED');
      err.code = 'COUNTRY_REQUIRED';
      throw err;
    }
    if (reactorId === ctx.comment.authorUserId) {
      const current = await countryProgression.read(ctx.comment.authorUserId, country);
      return mapEmpathyProgressionResult({
        granted: false,
        revoked: false,
        reason: 'SELF_EMPATHY',
        recipientUserId: ctx.comment.authorUserId,
        fame: current.fame,
        previousFame: current.fame,
        fameDelta: 0,
        level: current.level,
        xp: current.xp,
        verified: true,
      });
    }
    const applied = await countryProgression.revokeEvent({
      userId: ctx.comment.authorUserId,
      region: country,
      eventType: 'EMPATHY_RECEIVED',
      sourceId: commentId + ':' + reactorId,
    });
    return mapEmpathyProgressionResult({
      granted: false,
      revoked: applied.status === 'APPLIED',
      reason: applied.status,
      recipientUserId: ctx.comment.authorUserId,
      fame: applied.fame,
      previousFame: applied.fame - applied.fameDelta,
      fameDelta: applied.fameDelta,
      level: applied.level,
      xp: applied.xp,
      expPercent: null,
      verified: true,
    });
  }

  return {
    createPost,
    createOfficialPost,
    listOfficialPosts,
    updateOfficialPost,
    deleteOfficialPost,
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
    listAdminPosts,
    getAdminPost,
    operatorSoftDeletePost,
    operatorRestorePost,
    listAdminComments,
    getAdminComment,
    operatorSoftDeleteComment,
    operatorRestoreComment,
  };
}

module.exports = {
  createBoardService,
};
