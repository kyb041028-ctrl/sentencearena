'use strict';
/**
 * 영토 인원 Supabase repository
 * Earth: profiles.territory COUNT AND citizenship_status != KANTAPBIYA_RESIDENT
 * ALIEN: citizenship_status = KANTAPBIYA_RESIDENT COUNT
 * GROUP BY RPC/migration 없음 — PostgREST head count
 */

const core = require('../shared/territory-evolution-core');

const EARTH_TERRITORIES = Object.freeze(['PIONEER', 'CENTRAL', 'GUARDIAN']);
const ALIEN_CITIZENSHIP = 'KANTAPBIYA_RESIDENT';

let _adminClient = null;
let _packCache = null;
let _packCacheAt = 0;

function setAdminClient(client) {
  _adminClient = client;
}

function invalidateEarthCountCache() {
  _packCache = null;
  _packCacheAt = 0;
}

function unavailable(territory, warning) {
  return {
    population: null,
    available: false,
    source: core.POPULATION_SOURCE.UNAVAILABLE,
    updatedAt: null,
    warnings: [warning],
  };
}

async function countExactEarth(client, territory) {
  const res = await client
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('territory', territory)
    .neq('citizenship_status', ALIEN_CITIZENSHIP);
  if (res && res.error) {
    const err = new Error(res.error.message || 'COUNT_FAILED');
    err.code = 'COUNT_FAILED';
    throw err;
  }
  const n = res && typeof res.count === 'number' ? res.count : 0;
  return Math.max(0, Math.floor(n));
}

async function countExactAlien(client) {
  const res = await client
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('citizenship_status', ALIEN_CITIZENSHIP);
  if (res && res.error) {
    const err = new Error(res.error.message || 'COUNT_FAILED');
    err.code = 'COUNT_FAILED';
    throw err;
  }
  const n = res && typeof res.count === 'number' ? res.count : 0;
  return Math.max(0, Math.floor(n));
}

async function fetchPopulationPack(options) {
  const opts = options || {};
  const ttl = opts.ttlMs != null ? opts.ttlMs : core.CACHE_TTL_MS;
  if (!opts.force && _packCache && Date.now() - _packCacheAt < ttl) {
    return {
      counts: Object.assign({}, _packCache.counts),
      updatedAt: _packCache.updatedAt,
      cached: true,
    };
  }
  if (!_adminClient) {
    return null;
  }
  const earthPairs = await Promise.all(
    EARTH_TERRITORIES.map(function (t) {
      return countExactEarth(_adminClient, t).then(function (n) {
        return [t, n];
      });
    }),
  );
  const alienCount = await countExactAlien(_adminClient);
  const counts = { PIONEER: 0, CENTRAL: 0, GUARDIAN: 0, ALIEN: alienCount };
  earthPairs.forEach(function (row) {
    counts[row[0]] = row[1];
  });
  const updatedAt = new Date().toISOString();
  _packCache = { counts: counts, updatedAt: updatedAt };
  _packCacheAt = Date.now();
  return { counts: Object.assign({}, counts), updatedAt: updatedAt, cached: false };
}

async function countUsersByTerritory(territory) {
  const check = core.assertOperationalTerritoryStrict(territory);
  if (!check.valid) {
    return unavailable(null, check.error);
  }
  if (!_adminClient) {
    return Object.assign(unavailable(check.territory, 'SUPABASE_CLIENT_NOT_CONFIGURED'), {
      sqlPlan: { note: 'NOT_EXECUTED', territory: check.territory, aggregation: 'EARTH_TOTAL' },
    });
  }
  try {
    const pack = await fetchPopulationPack();
    if (!pack) return unavailable(check.territory, 'SUPABASE_CLIENT_NOT_CONFIGURED');
    return {
      population: pack.counts[check.territory],
      available: true,
      source: core.POPULATION_SOURCE.OPERATIONAL_USER_DATA,
      updatedAt: pack.updatedAt,
      warnings: [],
      cached: !!pack.cached,
    };
  } catch (e) {
    return unavailable(check.territory, 'COUNT_FAILED');
  }
}

async function countAllUsersByTerritory(options) {
  const out = {};
  if (!_adminClient) {
    core.OPERATIONAL_TERRITORIES.forEach(function (t) {
      out[t] = unavailable(t, 'SUPABASE_CLIENT_NOT_CONFIGURED');
    });
    return out;
  }
  let pack = null;
  try {
    pack = await fetchPopulationPack(options);
  } catch (e) {
    console.warn(
      '[territory-population] COUNT_FAILED',
      (e && e.code) || 'COUNT_FAILED',
      String((e && e.message) || '').slice(0, 180),
    );
    core.OPERATIONAL_TERRITORIES.forEach(function (t) {
      out[t] = unavailable(t, 'COUNT_FAILED');
    });
    return out;
  }
  core.OPERATIONAL_TERRITORIES.forEach(function (t) {
    out[t] = {
      population: pack.counts[t],
      available: true,
      source: core.POPULATION_SOURCE.OPERATIONAL_USER_DATA,
      updatedAt: pack.updatedAt,
      warnings: [],
      cached: !!pack.cached,
    };
  });
  return out;
}

async function getPopulationSnapshot() {
  const territories = await countAllUsersByTerritory({ force: true });
  const earth = (territories.CENTRAL && territories.CENTRAL.population) || 0;
  const pioneer = (territories.PIONEER && territories.PIONEER.population) || 0;
  const guardian = (territories.GUARDIAN && territories.GUARDIAN.population) || 0;
  const alien = (territories.ALIEN && territories.ALIEN.population) || 0;
  return {
    calculatedAt: territories.CENTRAL && territories.CENTRAL.updatedAt,
    source: core.POPULATION_SOURCE.OPERATIONAL_USER_DATA,
    territories: territories,
    earthTotal: earth + pioneer + guardian,
    alienOnly: alien,
    note: 'ALIEN_CITIZENSHIP_COUNT',
  };
}

async function healthCheck() {
  return {
    ok: true,
    mode: 'supabase-profiles-count',
    connected: !!_adminClient,
    liveCountEnabled: !!_adminClient,
    alienLiveCount: true,
  };
}

module.exports = {
  setAdminClient,
  invalidateEarthCountCache: invalidateEarthCountCache,
  invalidatePopulationCache: invalidateEarthCountCache,
  countUsersByTerritory,
  countAllUsersByTerritory,
  getPopulationSnapshot,
  healthCheck,
  EARTH_TERRITORIES: EARTH_TERRITORIES,
  ALIEN_CITIZENSHIP: ALIEN_CITIZENSHIP,
};
