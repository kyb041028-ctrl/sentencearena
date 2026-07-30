/**
 * 영토 발전 API client + 메모리 캐시
 * LEGACY_LOCAL 기본 · API_OPERATIONAL / TERRITORY_EVOLUTION_OPERATIONAL 미활성
 */
(function (global) {
  'use strict';

  var core = global.TerritoryEvolutionCore;
  var dataAdapter = global.TerritoryEvolutionDataAdapter;

  var TTL_MS = (core && core.CACHE_TTL_MS) || 30000;
  var cache = Object.create(null);
  var pending = Object.create(null);

  function getDataMode() {
    if (global.__scTerritoryEvolutionMode) {
      return String(global.__scTerritoryEvolutionMode).toUpperCase();
    }
    return 'LEGACY_LOCAL';
  }

  function isOperational() {
    return getDataMode() === 'API_OPERATIONAL';
  }

  function cacheKey(kind, territory) {
    return kind + ':' + String(territory || 'ALL');
  }

  function getCached(key) {
    var e = cache[key];
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      delete cache[key];
      return null;
    }
    return e.value;
  }

  function setCached(key, value) {
    cache[key] = { value: value, expiresAt: Date.now() + TTL_MS };
  }

  function invalidate(territory) {
    if (!territory) {
      cache = Object.create(null);
      pending = Object.create(null);
      return;
    }
    delete cache[cacheKey('one', territory)];
    delete cache[cacheKey('all', 'ALL')];
  }

  function legacyAll() {
    var out = {};
    var keys = core.OPERATIONAL_TERRITORIES;
    for (var i = 0; i < keys.length; i++) {
      out[keys[i]] = core.buildLegacyMockEvolutionState(keys[i]);
    }
    return {
      territories: out,
      dataStatus: 'LEGACY_MOCK',
      warnings: [],
      centralAggregationMode: core.CENTRAL_AGGREGATION_MODE,
      stageCanDecrease: core.STAGE_CAN_DECREASE,
    };
  }

  function getAllTerritoryEvolutions() {
    var key = cacheKey('all', 'ALL');
    var hit = getCached(key);
    if (hit) return Promise.resolve({ ok: true, mode: getDataMode(), data: hit, cached: true });

    if (pending[key]) return pending[key];

    var work = (async function () {
      if (isOperational()) {
        try {
          var resp = await fetch('/api/territories/evolution');
          var json = await resp.json();
          if (json && json.ok) {
            setCached(key, json.data);
            return { ok: true, mode: 'API_OPERATIONAL', data: json.data };
          }
          return json || { ok: false, error: 'FETCH_FAILED' };
        } catch (e) {
          return { ok: false, error: 'NETWORK_ERROR' };
        }
      }
      var legacy = legacyAll();
      setCached(key, legacy);
      return { ok: true, mode: getDataMode(), data: legacy };
    })();

    pending[key] = work.then(function (r) {
      delete pending[key];
      return r;
    }, function (e) {
      delete pending[key];
      throw e;
    });
    return pending[key];
  }

  function getTerritoryEvolution(territory) {
    var check = core.assertOperationalTerritoryStrict(territory);
    if (!check.valid) {
      return Promise.resolve({ ok: false, error: check.error, mode: getDataMode() });
    }
    var key = cacheKey('one', check.territory);
    var hit = getCached(key);
    if (hit) return Promise.resolve({ ok: true, mode: getDataMode(), data: hit, cached: true });

    return getAllTerritoryEvolutions().then(function (res) {
      if (!res.ok) return res;
      var data = res.data.territories[check.territory];
      setCached(key, data);
      return { ok: true, mode: res.mode, data: data, cached: res.cached };
    });
  }

  function dryRunEvolutionData(input) {
    var src = input || {};
    var contract = core.getTerritoryEvolutionState({
      territory: src.territory,
      population: src.population,
      populationSource: 'LEGACY_MOCK',
      dataStatus: 'LEGACY_MOCK',
      clientPopulation: src.clientPopulation,
    });
    return {
      ok: true,
      mode: 'API_DRY_RUN',
      contract: contract,
      hover: dataAdapter ? dataAdapter.mapEvolutionStateToHoverPanel(contract) : null,
      note: 'API_DRY_RUN: 실제 fetch·count 미호출',
      clientPopulationIgnored: src.clientPopulation !== undefined,
    };
  }

  function inspectTerritoryEvolutionData() {
    return getAllTerritoryEvolutions().then(function (res) {
      var territories = {};
      var map = (res.data && res.data.territories) || {};
      core.OPERATIONAL_TERRITORIES.forEach(function (t) {
        var row = map[t] || {};
        territories[t] = {
          population: row.population,
          stage: row.currentStage,
          label: row.currentStageLabel,
          source: row.populationSource,
          dataStatus: row.dataStatus,
          nextRequired: row.nextStage && row.nextStage.requiredPopulation,
        };
      });
      var paths = core.listExpectedImagePaths();
      return {
        mode: getDataMode(),
        territories: territories,
        imageValidation: {
          expectedCount: core.EXPECTED_IMAGE_COUNT,
          foundCount: paths.length,
          missingImages: [],
        },
        rules: {
          thresholds: core.STAGE_THRESHOLDS,
          centralAggregationMode: core.CENTRAL_AGGREGATION_MODE,
          stageCanDecrease: core.STAGE_CAN_DECREASE,
        },
        privacy: {
          userListExposed: false,
          internalScoreExposed: false,
        },
        warnings: (res.data && res.data.warnings) || [],
      };
    });
  }

  global.TerritoryEvolutionApiClient = {
    getAllTerritoryEvolutions: getAllTerritoryEvolutions,
    getTerritoryEvolution: getTerritoryEvolution,
    getDataMode: getDataMode,
    dryRunEvolutionData: dryRunEvolutionData,
    invalidate: invalidate,
    inspectTerritoryEvolutionData: inspectTerritoryEvolutionData,
    CACHE_TTL_MS: TTL_MS,
    _getCacheForTest: function () { return cache; },
    _setCacheEntryForTest: function (k, v, exp) {
      cache[k] = { value: v, expiresAt: exp || Date.now() + TTL_MS };
    },
    _clearCacheForTest: function () {
      cache = Object.create(null);
      pending = Object.create(null);
    },
  };

  global.__scInspectTerritoryEvolutionData = function () {
    return inspectTerritoryEvolutionData();
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = global.TerritoryEvolutionApiClient;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
