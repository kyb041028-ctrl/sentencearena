/**
 * 센텐스아레나 — 진영 전황 UI (목록 세력 막대 · 상세 깃발)
 * Mock/UI only. DB/API 미연결.
 */
(function (global) {
  'use strict';

  var Core = global.FactionBattleCore;
  if (!Core) {
    console.warn('[FactionBattleUi] FactionBattleCore missing');
    return;
  }

  var EMBLEM_URLS = {
    pioneer: '/assets/territories/emblems/reform.webp',
    central: '/assets/territories/emblems/centrist.webp',
    guardian: '/assets/territories/emblems/order.webp',
  };

  var LAYER_ROOT = '/assets/faction-flags/layers';

  var FLAG_ASSET_REGISTRY = {
    pioneer: {
      territory: 'pioneer',
      flagAssetUrl: LAYER_ROOT + '/pioneer/cloth.png',
      emblemAssetUrl: EMBLEM_URLS.pioneer,
      colorToken: 'reform',
      fallbackMode: 'LAYER_PNG',
      layers: {
        pole: LAYER_ROOT + '/pioneer/pole.png',
        cloth: LAYER_ROOT + '/pioneer/cloth.png',
        tassel: LAYER_ROOT + '/pioneer/tassel.png',
        base: LAYER_ROOT + '/pioneer/base.png',
        impactRemain: LAYER_ROOT + '/pioneer/impact-remain.png',
      },
    },
    central: {
      territory: 'central',
      flagAssetUrl: LAYER_ROOT + '/central/cloth.png',
      emblemAssetUrl: EMBLEM_URLS.central,
      colorToken: 'centrist',
      fallbackMode: 'LAYER_PNG',
      layers: {
        pole: LAYER_ROOT + '/central/pole.png',
        cloth: LAYER_ROOT + '/central/cloth.png',
        tassel: LAYER_ROOT + '/central/tassel.png',
        base: LAYER_ROOT + '/central/base.png',
        impactRemain: LAYER_ROOT + '/central/impact-remain.png',
      },
    },
    guardian: {
      territory: 'guardian',
      flagAssetUrl: LAYER_ROOT + '/guardian/cloth.png',
      emblemAssetUrl: EMBLEM_URLS.guardian,
      colorToken: 'order',
      fallbackMode: 'LAYER_PNG',
      layers: {
        pole: LAYER_ROOT + '/guardian/pole.png',
        cloth: LAYER_ROOT + '/guardian/cloth.png',
        tassel: LAYER_ROOT + '/guardian/tassel.png',
        base: LAYER_ROOT + '/guardian/base.png',
        impactRemain: LAYER_ROOT + '/guardian/impact-remain.png',
      },
    },
  };

  var detailSession = {
    postId: null,
    dropPlayed: false,
    impactPlayed: false,
    waveActive: false,
    timers: [],
    raf: 0,
    mountEl: null,
    snapshot: null,
    reducedMotion: false,
    boardType: null,
  };

  var inspectMeta = {
    currentBoardType: null,
    supported: false,
    currentPostId: null,
    dataStatus: 'MOCK',
    scores: { pioneer: 0, central: 0, guardian: 0 },
    shares: { pioneer: 0, central: 0, guardian: 0 },
    state: 'INSUFFICIENT',
    winner: null,
    topShare: 0,
    gapToSecond: 0,
    listStrip: { visible: false, segmentCount: 0, animated: false },
    detailFlags: {
      visible: false,
      mode: 'NONE',
      flagCount: 0,
      dropPlayed: false,
      impactPlayed: false,
      waveActive: false,
      reducedMotion: false,
      renderedPostId: null,
    },
  };

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function clearDetailTimers() {
    var i;
    for (i = 0; i < detailSession.timers.length; i++) {
      clearTimeout(detailSession.timers[i]);
    }
    detailSession.timers = [];
    if (detailSession.raf) {
      try {
        cancelAnimationFrame(detailSession.raf);
      } catch (_) {}
      detailSession.raf = 0;
    }
  }

  function scheduleDetail(fn, ms) {
    var t = setTimeout(fn, ms);
    detailSession.timers.push(t);
    return t;
  }

  function supports(boardType) {
    return Core.supportsFactionBattleUi(boardType);
  }

  function isFactionBattleEnabledOnPost(postOrId) {
    if (!postOrId || typeof postOrId !== 'object') return false;
    return postOrId.factionBattleEnabled === true;
  }

  function isAuthenticatedMemberViewer() {
    try {
      var authId = global.__scAuthUserId != null ? String(global.__scAuthUserId).trim() : '';
      if (authId) return true;
      var player = global.__scPlayer || {};
      var uid = String(player.userId || '').trim();
      if (uid && uid !== 'guest' && uid !== 'guest_demo') return true;
    } catch (_) {}
    return false;
  }

  function shouldShowFactionBattle(post, boardType) {
    if (!supports(boardType) || !isFactionBattleEnabledOnPost(post)) return false;
    var snapshot = resolveSnapshot(post, boardType);
    /* Production 실회원: MOCK 전황을 실집계처럼 표시하지 않음 */
    if (isAuthenticatedMemberViewer() && (!snapshot || snapshot.dataStatus === 'MOCK')) {
      return false;
    }
    return true;
  }

  function resolveSnapshot(postOrId, boardType) {
    var postId =
      postOrId && typeof postOrId === 'object' ? String(postOrId.id || '') : String(postOrId || '');
    return Core.resolveFactionBattleForPost(postId, boardType);
  }

  function participationLabel(metrics) {
    var m = metrics || {};
    return (
      (Number(m.uniqueReactors) || 0) +
      (Number(m.uniqueCommenters) || 0) +
      (Number(m.replyParticipants) || 0)
    );
  }

  function ariaForState(snapshot) {
    if (!snapshot || snapshot.state === 'INSUFFICIENT') return '진영 전황 집계 전';
    if (snapshot.state === 'BALANCED') return '세 진영이 비슷하게 참여 중';
    var label = Core.FACTION_LABELS[snapshot.winner] || '';
    if (snapshot.state === 'DOMINANT') return label + ' 진영 압도적 우세';
    return label + ' 진영 우세';
  }

  function buildListStrip(postOrId, boardType) {
    if (!shouldShowFactionBattle(postOrId, boardType)) return null;
    var snapshot = resolveSnapshot(postOrId, boardType);
    var wrap = document.createElement('div');
    wrap.className = 'sc-faction-battle-strip';
    wrap.setAttribute('data-battle-state', snapshot.state);
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'img');
    var aria = ariaForState(snapshot);
    if (!isAuthenticatedMemberViewer() && snapshot.dataStatus === 'MOCK') {
      aria = '체험용 전황 · ' + aria;
      wrap.setAttribute('data-demo', '1');
    }
    wrap.setAttribute('aria-label', aria);

    var track = document.createElement('div');
    track.className = 'sc-faction-battle-strip__track';
    if (snapshot.state === 'INSUFFICIENT') {
      track.classList.add('is-insufficient');
      var neut = document.createElement('span');
      neut.className = 'sc-faction-battle-strip__seg sc-faction-battle-strip__seg--neutral';
      neut.style.flex = '1 1 100%';
      track.appendChild(neut);
    } else {
      var i;
      for (i = 0; i < Core.FACTIONS.length; i++) {
        var key = Core.FACTIONS[i];
        var share = snapshot.shares[key] || 0;
        var pct = Math.max(0, Math.round(share * 1000) / 10);
        var seg = document.createElement('span');
        seg.className = 'sc-faction-battle-strip__seg';
        seg.dataset.faction = key;
        seg.dataset.territory = Core.FACTION_DATA_TERRITORY[key];
        seg.style.flex = (pct <= 0 ? 0.001 : pct) + ' 1 0%';
        if (snapshot.state === 'DOMINANT' && snapshot.winner === key) {
          seg.classList.add('is-dominant');
        }
        if (snapshot.state === 'BALANCED') {
          seg.classList.add('is-balanced');
        }
        track.appendChild(seg);
      }
    }
    wrap.appendChild(track);

    var tipParts = [];
    var ti;
    for (ti = 0; ti < Core.FACTIONS.length; ti++) {
      var fk = Core.FACTIONS[ti];
      tipParts.push(
        Core.FACTION_LABELS[fk] +
          ' 참여 ' +
          participationLabel(snapshot.factions && snapshot.factions[fk])
      );
    }
    wrap.title = tipParts.join('\n');
    wrap.setAttribute('data-tooltip', tipParts.join(' · '));

    inspectMeta.listStrip = {
      visible: true,
      segmentCount: snapshot.state === 'INSUFFICIENT' ? 1 : 3,
      animated: false,
    };

    return wrap;
  }

  function appendStripToListItem(li, post, boardType) {
    if (!li || !shouldShowFactionBattle(post, boardType)) return;
    var strip = buildListStrip(post, boardType);
    if (!strip) return;
    li.classList.add('board__item--with-faction-battle');
    var body = document.createElement('div');
    body.className = 'board__item-faction-main';
    while (li.firstChild) body.appendChild(li.firstChild);
    li.appendChild(body);
    li.appendChild(strip);
  }

  function appendStripToAlienRow(btn, post, boardType) {
    if (!btn || !shouldShowFactionBattle(post, boardType)) return;
    var strip = buildListStrip(post, boardType);
    if (!strip) return;
    strip.classList.add('sc-faction-battle-strip--compact');
    btn.classList.add('centrist-free-feed__row--with-faction');
    var main = document.createElement('span');
    main.className = 'centrist-free-feed__main';
    while (btn.firstChild) main.appendChild(btn.firstChild);
    btn.appendChild(main);
    btn.appendChild(strip);
  }

  function mountDetailFlags(container, postOrId, boardType) {
    if (!container) return null;
    cleanupDetailFlags({ keepSession: true });

    if (!supports(boardType)) {
      inspectMeta.detailFlags = {
        visible: false,
        mode: 'NONE',
        flagCount: 0,
        dropPlayed: false,
        impactPlayed: false,
        waveActive: false,
        reducedMotion: prefersReducedMotion(),
        renderedPostId: null,
      };
      return null;
    }

    var postObj = postOrId && typeof postOrId === 'object' ? postOrId : null;
    if (!isFactionBattleEnabledOnPost(postObj)) {
      inspectMeta.detailFlags = {
        visible: false,
        mode: 'NONE',
        flagCount: 0,
        dropPlayed: false,
        impactPlayed: false,
        waveActive: false,
        reducedMotion: prefersReducedMotion(),
        renderedPostId: postObj ? String(postObj.id || '') : null,
        gatedByFactionDebate: true,
      };
      inspectMeta.currentPostId = postObj ? String(postObj.id || '') : null;
      inspectMeta.supported = true;
      return null;
    }

    var snapshot = resolveSnapshot(postOrId, boardType);
    var postId = snapshot.postId;
    var reduced = prefersReducedMotion();
    var samePost = detailSession.postId === postId && detailSession.dropPlayed;

    if (detailSession.postId !== postId) {
      detailSession.postId = postId;
      detailSession.dropPlayed = false;
      detailSession.impactPlayed = false;
      detailSession.waveActive = false;
      samePost = false;
    }

    detailSession.boardType = Core.normalizeBoardType(boardType);
    detailSession.snapshot = snapshot;
    detailSession.reducedMotion = reduced;

    inspectMeta.currentBoardType = detailSession.boardType;
    inspectMeta.supported = true;
    inspectMeta.currentPostId = postId;
    inspectMeta.dataStatus = snapshot.dataStatus || 'MOCK';
    inspectMeta.scores = Object.assign({}, snapshot.scores);
    inspectMeta.shares = Object.assign({}, snapshot.shares);
    inspectMeta.state = snapshot.state;
    inspectMeta.winner = snapshot.winner;
    inspectMeta.topShare = snapshot.topShare;
    inspectMeta.gapToSecond = snapshot.gapToSecond;

    if (
      snapshot.detailMode === 'NONE' ||
      snapshot.state === 'INSUFFICIENT' ||
      snapshot.state === 'BALANCED'
    ) {
      inspectMeta.detailFlags = {
        visible: false,
        mode: 'NONE',
        flagCount: 0,
        dropPlayed: false,
        impactPlayed: false,
        waveActive: false,
        reducedMotion: reduced,
        renderedPostId: postId,
      };
      return null;
    }

    var playEntrance = !(samePost || reduced);
    var renderFn =
      typeof global.renderBattleStatusFlag === 'function' ? global.renderBattleStatusFlag : null;
    if (!renderFn) {
      console.warn('[FactionBattleUi] renderBattleStatusFlag missing');
      return null;
    }

    var field = renderFn({
      status: snapshot.state,
      faction: snapshot.winner,
      playEntrance: playEntrance,
      instant: !playEntrance,
    });
    if (!field) return null;

    field.setAttribute('role', 'img');
    field.setAttribute('aria-label', ariaForState(snapshot));
    var sr = document.createElement('span');
    sr.className = 'sc-sr-only';
    sr.textContent = ariaForState(snapshot);
    field.insertBefore(sr, field.firstChild);

    container.appendChild(field);
    detailSession.mountEl = field;

    var flagCount = field.querySelectorAll('.flag-effect').length;

    if (playEntrance) {
      detailSession.impactPlayed = false;
      detailSession.waveActive = false;
      detailSession.dropPlayed = false;
      scheduleDetail(function () {
        if (detailSession.postId !== postId) return;
        detailSession.impactPlayed = true;
      }, 560);
      scheduleDetail(function () {
        if (detailSession.postId !== postId) return;
        detailSession.dropPlayed = true;
        detailSession.waveActive = true;
        inspectMeta.detailFlags.dropPlayed = true;
        inspectMeta.detailFlags.impactPlayed = true;
        inspectMeta.detailFlags.waveActive = true;
      }, 900);
    } else {
      detailSession.dropPlayed = true;
      detailSession.impactPlayed = true;
      detailSession.waveActive = !reduced;
    }

    inspectMeta.detailFlags = {
      visible: true,
      mode: snapshot.detailMode,
      flagCount: flagCount,
      dropPlayed: detailSession.dropPlayed,
      impactPlayed: detailSession.impactPlayed,
      waveActive: detailSession.waveActive,
      reducedMotion: reduced,
      renderedPostId: postId,
      effectMode: 'LAYER_PNG',
      playEntrance: playEntrance,
    };

    return field;
  }

  function cleanupDetailFlags(opts) {
    var options = opts || {};
    clearDetailTimers();
    if (detailSession.mountEl && detailSession.mountEl.parentNode) {
      try {
        detailSession.mountEl.parentNode.removeChild(detailSession.mountEl);
      } catch (_) {}
    }
    detailSession.mountEl = null;
    detailSession.waveActive = false;
    if (!options.keepSession) {
      detailSession.postId = null;
      detailSession.dropPlayed = false;
      detailSession.impactPlayed = false;
      detailSession.snapshot = null;
      detailSession.boardType = null;
      inspectMeta.detailFlags = {
        visible: false,
        mode: 'NONE',
        flagCount: 0,
        dropPlayed: false,
        impactPlayed: false,
        waveActive: false,
        reducedMotion: prefersReducedMotion(),
        renderedPostId: null,
      };
      inspectMeta.currentPostId = null;
    }
  }

  function inspect() {
    return {
      currentBoardType: inspectMeta.currentBoardType,
      supported: inspectMeta.supported,
      currentPostId: inspectMeta.currentPostId,
      dataStatus: inspectMeta.dataStatus,
      scores: Object.assign({}, inspectMeta.scores),
      shares: Object.assign({}, inspectMeta.shares),
      state: inspectMeta.state,
      winner: inspectMeta.winner,
      topShare: inspectMeta.topShare,
      gapToSecond: inspectMeta.gapToSecond,
      listStrip: Object.assign({}, inspectMeta.listStrip),
      detailFlags: Object.assign({}, inspectMeta.detailFlags),
      flagAssetRegistry: FLAG_ASSET_REGISTRY,
      scoreWeights: Core.SCORE_WEIGHTS,
      thresholds: Core.THRESHOLDS,
    };
  }

  function noteBoardContext(boardType) {
    inspectMeta.currentBoardType = Core.normalizeBoardType(boardType);
    inspectMeta.supported = supports(boardType);
  }

  global.FactionBattleUi = {
    supports: supports,
    supportsFactionBattleUi: supports,
    shouldShowFactionBattle: shouldShowFactionBattle,
    isFactionBattleEnabledOnPost: isFactionBattleEnabledOnPost,
    getFactionBattleContext: Core.getFactionBattleContext,
    resolveSnapshot: resolveSnapshot,
    buildListStrip: buildListStrip,
    appendStripToListItem: appendStripToListItem,
    appendStripToAlienRow: appendStripToAlienRow,
    mountDetailFlags: mountDetailFlags,
    cleanupDetailFlags: cleanupDetailFlags,
    inspect: inspect,
    noteBoardContext: noteBoardContext,
    FLAG_ASSET_REGISTRY: FLAG_ASSET_REGISTRY,
  };

  global.__scInspectFactionBattleUi = function () {
    return inspect();
  };
})(typeof window !== 'undefined' ? window : this);
