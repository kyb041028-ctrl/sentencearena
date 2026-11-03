/**
 * 활동 국가 KR/US. 국적(home_country)과 별개다.
 * 브라우저와 Node에서 같은 규칙을 쓴다.
 * IP 주소 자체는 이 모듈에 들어오지 않는다. 서버가 이미 판정한 국가 코드만 받는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ActivityRegionCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var REGIONS = ['KR', 'US'];

  var US_TERRITORY_LABELS = {
    pioneer: 'Progressive Territory',
    central: 'Central Plaza',
    guardian: 'Conservative Territory',
    alien: 'Alien Territory',
  };

  var SCOPED_KEYS = {
    'sc_board_bundle_v1': 1,
    'sc_player_progression_v1': 1,
    'sc_political_scores_v1': 1,
    'sc_tendency_history_v2': 1,
    'sc_follow_v1': 1,
    'sc_follow_notify_v1': 1,
    'sc_follow_notify_prefs_v1': 1,
    'sc_display_names_v1': 1,
    'sc_notifications_v1': 1,
    'sc_activity_feed_v1': 1,
    'sc_bookmarks_v1': 1,
    'sc_reports_v1': 1,
    'sc_daily_issue_seed_reaction_v1': 1,
  };

  var SCOPED_PREFIXES = [
    'sc_profile_photo_v1:',
    'sc_profile_idphoto_v1:',
    'sc_profile_avatar_v1:',
  ];

  function normalizeRegion(value) {
    var s = String(value == null ? '' : value).trim().toUpperCase();
    if (s === 'KR' || s === 'US') return s;
    return null;
  }

  function regionFromLanguage(header) {
    var raw = String(header || '').toLowerCase();
    if (!raw) return null;
    var first = raw.split(',')[0].split(';')[0].trim();
    if (first.indexOf('ko') === 0) return 'KR';
    if (first.indexOf('en') === 0) return 'US';
    return null;
  }

  /**
   * explicit(저장한 선택) > IP 국가(KR/US만) > 브라우저 언어 > KR.
   * IP 조회 실패여도 region은 항상 반환한다.
   */
  function resolveActivityRegion(input) {
    var src = input || {};
    var explicit = normalizeRegion(src.explicit);
    if (explicit) return { region: explicit, source: 'explicit', ok: true };
    if (!src.ipLookupFailed) {
      var ip = normalizeRegion(src.ipCountry);
      if (ip) return { region: ip, source: 'ip', ok: true };
    }
    var lang = regionFromLanguage(src.acceptLanguage);
    if (lang) {
      return {
        region: lang,
        source: src.ipLookupFailed ? 'language-after-ip-failure' : 'language',
        ok: true,
      };
    }
    return {
      region: 'KR',
      source: src.ipLookupFailed ? 'default-after-ip-failure' : 'default',
      ok: true,
    };
  }

  /** 국가가 비어 있는 기존 기록은 KR로 읽는다. */
  function legacyRegion(value) {
    return normalizeRegion(value) || 'KR';
  }

  function profileKey(userId, region) {
    return String(userId || '').trim() + '::' + legacyRegion(region);
  }

  /**
   * 쓰기는 지금 활동 국가만 허용한다.
   * 요청에 다른 국가가 있으면 거절하고, 비어 있으면 활동 국가를 쓴다.
   */
  function assertWriteRegion(activeRegion, requested) {
    var active = normalizeRegion(activeRegion);
    if (!active) return { ok: false, error: 'REGION_UNAVAILABLE' };
    if (requested == null || requested === '') return { ok: true, region: active };
    var want = normalizeRegion(requested);
    if (!want || want !== active) return { ok: false, error: 'REGION_MISMATCH' };
    return { ok: true, region: active };
  }

  function blankProfile(userId, region) {
    return {
      userId: String(userId || ''),
      region: legacyRegion(region),
      level: 1,
      xp: 0,
      fame: 0,
      aura: 0,
      tendency: null,
      day30: 0,
      day99: 0,
      territory: null,
      achievements: [],
      posts: [],
      comments: [],
      reactions: [],
      rank: null,
      feed: [],
      evolution: 0,
      notices: [],
      bookmarks: [],
    };
  }

  /** 저장된 활동 국가. 없거나 비어 있으면 옛 한국 기록이다. */
  function rowRegion(row) {
    if (!row || typeof row !== 'object') return 'KR';
    return legacyRegion(row.activityRegion || row.activity_region);
  }

  function visibleInRegion(row, region) {
    return rowRegion(row) === legacyRegion(region);
  }

  /**
   * 미국 배치는 미국 문장 모델이 없으면 점수를 만들지 않는다.
   * 한국 배치는 한국 기록만 남긴다. 국가가 없는 기록은 한국이다.
   */
  function selectAlignmentBatch(input) {
    var src = input || {};
    var region = normalizeRegion(src.region) || 'KR';
    if (region === 'US') {
      return {
        region: 'US',
        skipped: true,
        reason: 'US_SENTENCE_MODEL_MISSING',
        users: [],
        reactions: [],
      };
    }
    var users = Array.isArray(src.users) ? src.users : [];
    var reactions = Array.isArray(src.reactions) ? src.reactions : [];
    return {
      region: 'KR',
      skipped: false,
      reason: null,
      users: users.filter(function (row) { return rowRegion(row) === 'KR'; }),
      reactions: reactions.filter(function (row) { return rowRegion(row) === 'KR'; }),
    };
  }

  function isScopedStorageKey(key) {
    var k = String(key || '');
    if (SCOPED_KEYS[k]) return true;
    for (var i = 0; i < SCOPED_PREFIXES.length; i++) {
      if (k.indexOf(SCOPED_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function storageKey(key, region) {
    if (legacyRegion(region) !== 'US') return String(key);
    if (!isScopedStorageKey(key)) return String(key);
    return String(key) + '::US';
  }

  function pathRegion(pathname) {
    var p = String(pathname || '');
    if (p === '/us' || p.indexOf('/us/') === 0) return 'US';
    if (p === '/kr' || p.indexOf('/kr/') === 0) return 'KR';
    return null;
  }

  return {
    REGIONS: REGIONS,
    US_TERRITORY_LABELS: US_TERRITORY_LABELS,
    normalizeRegion: normalizeRegion,
    regionFromLanguage: regionFromLanguage,
    resolveActivityRegion: resolveActivityRegion,
    legacyRegion: legacyRegion,
    profileKey: profileKey,
    assertWriteRegion: assertWriteRegion,
    blankProfile: blankProfile,
    rowRegion: rowRegion,
    visibleInRegion: visibleInRegion,
    selectAlignmentBatch: selectAlignmentBatch,
    isScopedStorageKey: isScopedStorageKey,
    storageKey: storageKey,
    pathRegion: pathRegion,
  };
});
