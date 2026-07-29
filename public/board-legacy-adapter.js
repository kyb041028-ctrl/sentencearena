/**
 * 센텐스크래프트 — localStorage 게시판 ↔ 운영 API 호환 adapter
 * - 원본 localStorage를 덮어쓰지 않음
 * - 변환 결과만 반환 · 손실 필드는 warnings에 기록
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../shared/board-config-core'),
      require('../shared/board-schema-core'),
    );
  } else {
    root.BoardLegacyAdapter = factory(root.BoardConfigCore, root.BoardSchemaCore);
  }
})(typeof self !== 'undefined' ? self : this, function boardLegacyAdapterFactory(config, schema) {
  'use strict';

  if (!config || !schema) {
    throw new Error('BoardConfigCore and BoardSchemaCore are required before board-legacy-adapter.js');
  }

  var BUNDLE_KEY = 'sc_board_bundle_v1';

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function parsePostBucketKey(key) {
    var raw = String(key || '');
    var m = /^(.+)_s(\d+)$/.exec(raw);
    if (!m) return { territoryId: raw || 'COMMON', boardStage: 1 };
    return { territoryId: m[1], boardStage: parseInt(m[2], 10) || 1 };
  }

  function legacyContent(postOrComment) {
    if (!postOrComment || typeof postOrComment !== 'object') return '';
    if (postOrComment.content != null) return String(postOrComment.content);
    if (postOrComment.body != null) return String(postOrComment.body);
    if (postOrComment.text != null) return String(postOrComment.text);
    return '';
  }

  function extractLegacyReactionState(reactions) {
    var src = reactions && typeof reactions === 'object' ? reactions : {};
    var warnings = [];
    return {
      alignment: {
        likes: Array.isArray(src.likes) ? src.likes.slice() : [],
        dislikes: Array.isArray(src.dislikes) ? src.dislikes.slice() : [],
      },
      social: {
        empathy: Array.isArray(src.empathy) ? src.empathy.slice() : [],
      },
      deferredLegacy: {
        planetVoters: Array.isArray(src.planetVoters) ? src.planetVoters.slice() : [],
      },
      warnings: warnings,
    };
  }

  function mapLegacyPostToBoardDraft(legacyPost, context) {
    var ctx = context || {};
    var src = legacyPost || {};
    var warnings = [];
    var content = legacyContent(src);
    var territoryRaw = ctx.territoryId != null ? ctx.territoryId : src.territoryId;
    var territory = config.normalizeBoardTerritory(territoryRaw, { allowLegacy: true });
    if (!territory) {
      warnings.push('BOARD_TERRITORY_INVALID');
    }
    if (src.images && Array.isArray(src.images) && src.images.length) {
      warnings.push('LEGACY_FIELD_IMAGES_NOT_MAPPED');
    }
    if (src.authorRcvAlign != null || src.authorRcvPl != null) {
      warnings.push('LEGACY_FIELD_AUTHOR_SCORES_NOT_MAPPED');
    }
    var draft = {
      title: src.title == null ? '' : String(src.title),
      content: content,
      categoryKey: src.category == null ? (src.categoryKey == null ? null : src.categoryKey) : src.category,
      boardStage: ctx.boardStage == null ? 1 : Number(ctx.boardStage) || 1,
      isAnonymous: !!src.isAnonymous,
      territory: territory,
      legacyId: src.id || null,
      legacyAuthorId: src.authorId || null,
      legacyCreatedAt: src.createdAt || null,
      status: src.status || (src.deleted ? 'DELETED' : 'ACTIVE'),
    };
    var validation = schema.validatePostInput({
      title: draft.title,
      content: draft.content,
      territory: draft.territory,
    });
    if (!validation.valid) warnings = warnings.concat(validation.errors);
    return { draft: draft, warnings: warnings, social: extractLegacyReactionState(src.reactions) };
  }

  function mapLegacyCommentToBoardDraft(legacyComment, context) {
    var ctx = context || {};
    var src = legacyComment || {};
    var warnings = [];
    var content = legacyContent(src);
    var draft = {
      content: content,
      parentCommentId: src.parentCommentId || src.parentId || null,
      isAnonymous: !!src.isAnonymous,
      legacyId: src.id || null,
      legacyAuthorId: src.authorId || null,
      legacyCreatedAt: src.createdAt || null,
      status: src.status || (src.deleted ? 'DELETED' : 'ACTIVE'),
      postLegacyId: ctx.postLegacyId || null,
    };
    var validation = schema.validateCommentInput(draft);
    if (!validation.valid) warnings = warnings.concat(validation.errors);
    return { draft: draft, warnings: warnings, social: extractLegacyReactionState(src.reactions) };
  }

  function mapBoardPostToLegacyViewModel(apiPost, reactionState) {
    var src = apiPost || {};
    var rx = reactionState || {};
    var alignment = rx.alignment || {};
    var social = rx.social || {};
    var deferred = rx.deferredLegacy || {};
    return {
      id: src.legacyId || src.id,
      title: src.title,
      body: src.content,
      category: src.categoryKey || undefined,
      authorId: src.legacyAuthorId || (src.author && src.author.userId) || null,
      createdAt: src.legacyCreatedAt || src.createdAt || null,
      isAnonymous: !!src.isAnonymous,
      deleted: src.status === 'DELETED',
      status: src.status || 'ACTIVE',
      comments: Array.isArray(src.comments) ? src.comments.map(function (c) {
        return mapBoardCommentToLegacyViewModel(c, rx);
      }) : [],
      reactions: {
        likes: Array.isArray(alignment.likes) ? alignment.likes.slice() : [],
        dislikes: Array.isArray(alignment.dislikes) ? alignment.dislikes.slice() : [],
        empathy: Array.isArray(social.empathy) ? social.empathy.slice() : [],
        planetVoters: Array.isArray(deferred.planetVoters) ? deferred.planetVoters.slice() : [],
      },
    };
  }

  function mapBoardCommentToLegacyViewModel(apiComment, reactionState) {
    var src = apiComment || {};
    var rx = reactionState || {};
    var alignment = rx.alignment || {};
    var social = rx.social || {};
    var deferred = rx.deferredLegacy || {};
    return {
      id: src.legacyId || src.id,
      authorId: src.legacyAuthorId || (src.author && src.author.userId) || null,
      text: src.content,
      createdAt: src.legacyCreatedAt || src.createdAt || null,
      parentId: src.parentCommentId || src.parentId || null,
      isAnonymous: !!src.isAnonymous,
      deleted: src.status === 'DELETED',
      status: src.status || 'ACTIVE',
      reactions: {
        likes: Array.isArray(alignment.likes) ? alignment.likes.slice() : [],
        dislikes: Array.isArray(alignment.dislikes) ? alignment.dislikes.slice() : [],
        empathy: Array.isArray(social.empathy) ? social.empathy.slice() : [],
        planetVoters: Array.isArray(deferred.planetVoters) ? deferred.planetVoters.slice() : [],
      },
    };
  }

  function normalizeLegacyBoardBundle(bundle) {
    var src = bundle && typeof bundle === 'object' ? bundle : { posts: {} };
    var out = { posts: {} };
    var warnings = [];
    var postsMap = src.posts && typeof src.posts === 'object' ? src.posts : {};
    Object.keys(postsMap).forEach(function (bucketKey) {
      var bucket = parsePostBucketKey(bucketKey);
      var arr = Array.isArray(postsMap[bucketKey]) ? postsMap[bucketKey] : [];
      out.posts[bucketKey] = arr.map(function (post) {
        var mapped = mapLegacyPostToBoardDraft(post, bucket);
        if (mapped.warnings.length) warnings = warnings.concat(mapped.warnings);
        var legacyView = mapBoardPostToLegacyViewModel(
          Object.assign({}, mapped.draft, { id: post.id, comments: [] }),
          mapped.social,
        );
        legacyView.comments = (Array.isArray(post.comments) ? post.comments : []).map(function (comment) {
          var cm = mapLegacyCommentToBoardDraft(comment, { postLegacyId: post.id });
          if (cm.warnings.length) warnings = warnings.concat(cm.warnings);
          return mapBoardCommentToLegacyViewModel(
            Object.assign({}, cm.draft, { id: comment.id }),
            cm.social,
          );
        });
        return legacyView;
      });
    });
    return { bundle: out, warnings: warnings };
  }

  function inspectLegacyBoardCompatibility(bundleInput) {
    var bundle = bundleInput;
    if (bundle == null && typeof localStorage !== 'undefined') {
      try {
        var raw = localStorage.getItem(BUNDLE_KEY);
        bundle = raw ? JSON.parse(raw) : { posts: {} };
      } catch (_) {
        bundle = { posts: {} };
      }
    }
    if (!bundle || typeof bundle !== 'object') bundle = { posts: {} };

    var report = {
      postCount: 0,
      commentCount: 0,
      legacyTerritoryCounts: {
        COMMON: 0,
        PROGRESSIVE: 0,
        CONSERVATIVE: 0,
        KANTAPBIYA: 0,
      },
      empathyCount: 0,
      planetVoterCount: 0,
      invalidPostCount: 0,
      invalidCommentCount: 0,
      convertiblePostCount: 0,
      convertibleCommentCount: 0,
      warnings: [],
    };

    var postsMap = bundle.posts && typeof bundle.posts === 'object' ? bundle.posts : {};
    Object.keys(postsMap).forEach(function (bucketKey) {
      var bucket = parsePostBucketKey(bucketKey);
      var tid = String(bucket.territoryId || '').toUpperCase();
      if (report.legacyTerritoryCounts[tid] != null) {
        report.legacyTerritoryCounts[tid] += 1;
      }
      var arr = Array.isArray(postsMap[bucketKey]) ? postsMap[bucketKey] : [];
      arr.forEach(function (post) {
        report.postCount += 1;
        var mapped = mapLegacyPostToBoardDraft(post, bucket);
        if (mapped.warnings.length) {
          report.invalidPostCount += 1;
          report.warnings = report.warnings.concat(mapped.warnings);
        } else {
          report.convertiblePostCount += 1;
        }
        var em = mapped.social && mapped.social.social && Array.isArray(mapped.social.social.empathy)
          ? mapped.social.social.empathy
          : (mapped.social && Array.isArray(mapped.social.empathy) ? mapped.social.empathy : []);
        if (em.length) report.empathyCount += em.length;
        var pv = mapped.social && mapped.social.deferredLegacy && Array.isArray(mapped.social.deferredLegacy.planetVoters)
          ? mapped.social.deferredLegacy.planetVoters
          : [];
        if (pv.length) report.planetVoterCount += pv.length;
        (Array.isArray(post.comments) ? post.comments : []).forEach(function (comment) {
          report.commentCount += 1;
          var cm = mapLegacyCommentToBoardDraft(comment, { postLegacyId: post.id });
          if (cm.warnings.length) {
            report.invalidCommentCount += 1;
            report.warnings = report.warnings.concat(cm.warnings);
          } else {
            report.convertibleCommentCount += 1;
          }
          var cem = cm.social && cm.social.social && Array.isArray(cm.social.social.empathy)
            ? cm.social.social.empathy
            : (cm.social && Array.isArray(cm.social.empathy) ? cm.social.empathy : []);
          if (cem.length) report.empathyCount += cem.length;
          var cpv = cm.social && cm.social.deferredLegacy && Array.isArray(cm.social.deferredLegacy.planetVoters)
            ? cm.social.deferredLegacy.planetVoters
            : [];
          if (cpv.length) report.planetVoterCount += cpv.length;
        });
      });
    });

    report.warnings = Array.from(new Set(report.warnings));
    return report;
  }

  if (typeof root !== 'undefined' && root.window) {
    root.window.__scInspectLegacyBoardCompatibility = function () {
      return inspectLegacyBoardCompatibility();
    };
  }

  return {
    BUNDLE_KEY: BUNDLE_KEY,
    parsePostBucketKey: parsePostBucketKey,
    extractLegacyReactionState: extractLegacyReactionState,
    mapLegacyPostToBoardDraft: mapLegacyPostToBoardDraft,
    mapLegacyCommentToBoardDraft: mapLegacyCommentToBoardDraft,
    mapBoardPostToLegacyViewModel: mapBoardPostToLegacyViewModel,
    mapBoardCommentToLegacyViewModel: mapBoardCommentToLegacyViewModel,
    normalizeLegacyBoardBundle: normalizeLegacyBoardBundle,
    inspectLegacyBoardCompatibility: inspectLegacyBoardCompatibility,
  };
});
