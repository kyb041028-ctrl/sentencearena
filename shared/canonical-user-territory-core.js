/**
 * Earth membership territory (HOME) — not board view, not ALIEN.
 * I/O 없음. 점수/transition 없음.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CanonicalUserTerritoryCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function canonicalUserTerritoryCoreFactory() {
  'use strict';

  var EARTH_MEMBERSHIP_TERRITORIES = Object.freeze(['PIONEER', 'CENTRAL', 'GUARDIAN']);
  var REJECTED = Object.freeze(['ALIEN', 'KANTAPBIYA']);

  var POLICIES = Object.freeze({
    CURRENT_TERRITORY_CANONICAL_SOURCE: 'profiles.territory',
    TERRITORY_MEMBERSHIP_PERSISTENCE: 'ACTIVE_FOUNDATION',
    TERRITORY_SELECTION_UI: 'NOT_CONNECTED',
    TERRITORY_MOVE: 'NOT_CONNECTED',
    TERRITORY_HISTORY: 'NOT_CONNECTED',
  });

  function isEarthMembershipTerritory(value) {
    return EARTH_MEMBERSHIP_TERRITORIES.indexOf(value) >= 0;
  }

  function normalizeCanonicalMembershipTerritory(value) {
    if (value == null) {
      return { ok: true, territory: null, error: null };
    }
    if (typeof value !== 'string') {
      return { ok: false, territory: null, error: 'TERRITORY_MEMBERSHIP_INVALID' };
    }
    var raw = value.trim();
    if (raw === '') {
      return { ok: true, territory: null, error: null };
    }
    var s = raw.toUpperCase();
    if (isEarthMembershipTerritory(s)) {
      return { ok: true, territory: s, error: null };
    }
    if (REJECTED.indexOf(s) >= 0) {
      return { ok: false, territory: null, error: 'TERRITORY_MEMBERSHIP_ALIEN_FORBIDDEN' };
    }
    return { ok: false, territory: null, error: 'TERRITORY_MEMBERSHIP_INVALID' };
  }

  return {
    EARTH_MEMBERSHIP_TERRITORIES: EARTH_MEMBERSHIP_TERRITORIES,
    CURRENT_TERRITORY_CANONICAL_SOURCE: POLICIES.CURRENT_TERRITORY_CANONICAL_SOURCE,
    TERRITORY_MEMBERSHIP_PERSISTENCE: POLICIES.TERRITORY_MEMBERSHIP_PERSISTENCE,
    TERRITORY_SELECTION_UI: POLICIES.TERRITORY_SELECTION_UI,
    TERRITORY_MOVE: POLICIES.TERRITORY_MOVE,
    TERRITORY_HISTORY: POLICIES.TERRITORY_HISTORY,
    POLICIES: POLICIES,
    isEarthMembershipTerritory: isEarthMembershipTerritory,
    normalizeCanonicalMembershipTerritory: normalizeCanonicalMembershipTerritory,
  };
});
