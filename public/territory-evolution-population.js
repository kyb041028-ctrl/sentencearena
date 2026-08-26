/**
 * =============================================================================
 * 센텐스아레나 — 영토 발전 인원 집계·단계 정책
 * =============================================================================
 * 확정 정책:
 * - 집계 대상 = 현재 소속 전체 회원 (최근 활동·휴면 무관)
 * - 탈퇴·삭제·게스트 제외
 * - 한 회원은 현재 소속 영토 한 곳에만 집계
 * - 외계 이동 회원 = 이전 영토 제외 · 외계만 포함
 * - originalTerritory / previousTerritory 등은 집계에 사용하지 않음 (삭제·덮어쓰기 금지)
 * - 발전 단계 = 현재 발전 인원으로 매번 재판정 (상승·하락 모두 반영)
 * - highestStage / maxStage 등으로 현재 단계를 보정하지 않음
 *
 * 실데이터: Earth 3영토는 GET /api/territories/evolution → profiles.territory count.
 * ALIEN은 이번 연결 범위 밖이라 Mock 유지.
 * setTerritoryEvolutionDirectCounts()로 live 직접 소속 주입 가능.
 * =============================================================================
 */
(function (global) {
  'use strict';

  /**
   * UI 검증용 임시 Mock 직접 소속 인원 (기본값, 불변).
   * 실제 회원 DB 데이터가 아님. central = 중앙광장 직접 소속.
   */
  var TERRITORY_POPULATION_MOCK_DEFAULTS = Object.freeze({
    pioneer: 820,
    guardian: 2480,
    central: 3830,
    alien: 310,
  });

  /**
   * 현재 Mock 원천 인원 (테스트 중 변경 가능).
   * 호환: 기존 TERRITORY_POPULATION_MOCK_SOURCE 이름 유지.
   */
  var TERRITORY_POPULATION_MOCK_SOURCE = {
    pioneer: TERRITORY_POPULATION_MOCK_DEFAULTS.pioneer,
    guardian: TERRITORY_POPULATION_MOCK_DEFAULTS.guardian,
    central: TERRITORY_POPULATION_MOCK_DEFAULTS.central,
    alien: TERRITORY_POPULATION_MOCK_DEFAULTS.alien,
  };

  /** 게임 영토 ID → 발전 계산 key */
  var GAME_TERRITORY_TO_EVO = Object.freeze({
    PROGRESSIVE: 'pioneer',
    CONSERVATIVE: 'guardian',
    COMMON: 'central',
    KANTAPBIYA: 'alien',
    pioneer: 'pioneer',
    guardian: 'guardian',
    central: 'central',
    alien: 'alien',
  });

  var EVO_KEYS = ['pioneer', 'guardian', 'central', 'alien'];

  /**
   * live directCounts 주입 상태.
   * source: 'mock' | 'live'
   */
  var liveDirectCounts = null;
  var liveMeta = {
    source: 'mock',
    calculatedAt: null,
    note: 'TERRITORY_POPULATION_MOCK_SOURCE',
  };

  function emptyDirectCounts() {
    return { pioneer: 0, guardian: 0, central: 0, alien: 0 };
  }

  function normalizeTerritoryPopulation(value) {
    var number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.max(0, Math.floor(number));
  }

  function normalizeDirectCounts(raw) {
    var src = raw || {};
    return {
      pioneer: normalizeTerritoryPopulation(src.pioneer),
      guardian: normalizeTerritoryPopulation(src.guardian),
      central: normalizeTerritoryPopulation(src.central),
      alien: normalizeTerritoryPopulation(src.alien),
    };
  }

  /**
   * 게임/표시 영토 값을 발전 key로 변환.
   * 알 수 없으면 null (임의 central 배정 금지).
   */
  function mapGameTerritoryToEvoKey(territoryValue) {
    if (territoryValue == null || territoryValue === '') return null;
    var key = String(territoryValue).trim();
    if (!key) return null;
    if (GAME_TERRITORY_TO_EVO[key]) return GAME_TERRITORY_TO_EVO[key];
    var upper = key.toUpperCase();
    if (GAME_TERRITORY_TO_EVO[upper]) return GAME_TERRITORY_TO_EVO[upper];
    return null;
  }

  /**
   * 회원 레코드에서 "현재 소속"만 읽는다.
   * 사용: forcedTerritory(현재 강제 소속) → territoryId → territory → currentTerritory
   * 미사용: originalTerritory, previousTerritory, originTerritory, firstTerritory
   */
  function resolveMemberCurrentTerritoryId(member) {
    if (!member || typeof member !== 'object') return null;
    var candidates = [
      member.forcedTerritory,
      member.territoryId,
      member.territory,
      member.currentTerritory,
    ];
    var i;
    for (i = 0; i < candidates.length; i++) {
      var mapped = mapGameTerritoryToEvoKey(candidates[i]);
      if (mapped) return mapped;
    }
    return null;
  }

  /**
   * 발전 인원 집계에 포함할 회원인지.
   * - 게스트·비로그인 제외
   * - 탈퇴·삭제 제외
   * - 최근 활동/휴면/게시글 수는 보지 않음
   */
  function isMemberCountedInEvolutionCensus(member) {
    if (!member || typeof member !== 'object') return false;
    if (member.isGuest === true || member.guest === true) return false;
    if (member.isAnonymous === true) return false;
    if (member.loggedIn === false) return false;

    if (member.deletedAt || member.withdrawnAt || member.deleted || member.withdrawn) {
      return false;
    }

    var status = member.accountStatus != null ? String(member.accountStatus).toLowerCase() : '';
    if (
      status === 'deleted' ||
      status === 'withdrawn' ||
      status === 'banned_deleted' ||
      status === 'closed'
    ) {
      return false;
    }

    var userStatus = member.status != null ? String(member.status).toLowerCase() : '';
    if (userStatus === 'deleted' || userStatus === 'withdrawn' || userStatus === 'guest') {
      return false;
    }

    return true;
  }

  /**
   * 현재 전체 소속 회원 → 직접 소속 인원.
   * 외계 이동자는 currentTerritory/territoryId 가 alien(KANTAPBIYA)이면
   * 이전 영토가 아닌 alien에만 +1 된다 (역사 필드 무시).
   *
   * @returns {{
   *   directCounts: {pioneer,guardian,central,alien},
   *   counted: number,
   *   skipped: number,
   *   unknownTerritory: number
   * }}
   */
  function aggregateCurrentTerritoryMemberCounts(members) {
    var directCounts = emptyDirectCounts();
    var counted = 0;
    var skipped = 0;
    var unknownTerritory = 0;
    var list = Array.isArray(members) ? members : [];
    var i;

    for (i = 0; i < list.length; i++) {
      var member = list[i];
      if (!isMemberCountedInEvolutionCensus(member)) {
        skipped += 1;
        continue;
      }
      var evoKey = resolveMemberCurrentTerritoryId(member);
      if (!evoKey) {
        unknownTerritory += 1;
        skipped += 1;
        continue;
      }
      directCounts[evoKey] += 1;
      counted += 1;
    }

    return {
      directCounts: directCounts,
      counted: counted,
      skipped: skipped,
      unknownTerritory: unknownTerritory,
      source: 'all-current-members',
    };
  }

  /**
   * 직접 소속 → 영토별 발전 인원.
   * live: CENTRAL = central + pioneer + guardian.
   * Mock fallback: 기존 mock central 값을 표시값으로 유지 (합산하지 않음).
   * ALIEN은 지구 집계에 포함하지 않음.
   */
  function getTerritoryEvolutionPopulation(territoryKey, populationSource) {
    var source = normalizeDirectCounts(
      populationSource || getTerritoryEvolutionDirectCounts()
    );
    if (territoryKey === 'pioneer') return source.pioneer;
    if (territoryKey === 'guardian') return source.guardian;
    if (territoryKey === 'alien') return source.alien;
    if (territoryKey === 'central') {
      if (isTerritoryEvolutionUsingMockSource()) return source.central;
      return source.central + source.pioneer + source.guardian;
    }
    return 0;
  }

  /**
   * live 직접 소속 인원 주입 (API 성공 시).
   * Mock을 "실제 집계처럼" 저장하지 않는다 — live만 보관.
   */
  function setTerritoryEvolutionDirectCounts(directCounts, meta) {
    liveDirectCounts = normalizeDirectCounts(directCounts);
    liveMeta = {
      source: 'live',
      calculatedAt: (meta && meta.calculatedAt) || new Date().toISOString(),
      note: (meta && meta.note) || 'injected-direct-counts',
      rawSource: (meta && meta.source) || 'all-current-members',
    };
    return getTerritoryEvolutionDirectCountsSnapshot();
  }

  /**
   * Production 실회원 경로: Legacy Mock 인구를 쓰지 않음.
   * Guest/비로그인만 Mock fallback 허용.
   */
  function allowTerritoryEvolutionMockFallback() {
    try {
      var authId = global.__scAuthUserId != null ? String(global.__scAuthUserId).trim() : '';
      if (authId) return false;
      var player = global.__scPlayer || {};
      var uid = String(player.userId || '').trim();
      if (uid && uid !== 'guest' && uid !== 'guest_demo') return false;
    } catch (_) {}
    return true;
  }

  /** API 실패 등 — live 해제 후 Mock 없이 UNAVAILABLE */
  function markTerritoryEvolutionPopulationUnavailable(meta) {
    liveDirectCounts = null;
    liveMeta = {
      source: 'unavailable',
      calculatedAt: null,
      note: (meta && meta.note) || 'population-unavailable',
      rawSource: null,
    };
    return getTerritoryEvolutionDirectCountsSnapshot();
  }

  /** live 해제 → Guest는 Mock, 실회원은 unavailable */
  function clearTerritoryEvolutionDirectCounts() {
    liveDirectCounts = null;
    if (allowTerritoryEvolutionMockFallback()) {
      liveMeta = {
        source: 'mock',
        calculatedAt: null,
        note: 'TERRITORY_POPULATION_MOCK_SOURCE',
      };
    } else {
      liveMeta = {
        source: 'unavailable',
        calculatedAt: null,
        note: 'cleared-no-mock',
      };
    }
    return getTerritoryEvolutionDirectCountsSnapshot();
  }

  function getTerritoryEvolutionDirectCounts() {
    if (liveDirectCounts) return normalizeDirectCounts(liveDirectCounts);
    if (allowTerritoryEvolutionMockFallback()) {
      return normalizeDirectCounts(TERRITORY_POPULATION_MOCK_SOURCE);
    }
    return emptyDirectCounts();
  }

  function getTerritoryEvolutionDirectCountsSnapshot() {
    return {
      directCounts: getTerritoryEvolutionDirectCounts(),
      calculatedAt: liveMeta.calculatedAt,
      source: liveMeta.source,
      note: liveMeta.note,
      rawSource: liveMeta.rawSource || null,
      populationAvailable: !!liveDirectCounts || allowTerritoryEvolutionMockFallback(),
    };
  }

  function isTerritoryEvolutionUsingMockSource() {
    if (liveDirectCounts) return false;
    return allowTerritoryEvolutionMockFallback();
  }

  function isTerritoryEvolutionPopulationUnavailable() {
    return !liveDirectCounts && !allowTerritoryEvolutionMockFallback();
  }

  function isKnownMockTerritoryKey(key) {
    return (
      key === 'pioneer' ||
      key === 'guardian' ||
      key === 'central' ||
      key === 'alien'
    );
  }

  /** Mock 원천 1개 변경. live 주입이 있으면 해제하고 Mock 사용. */
  function setTerritoryPopulationMockValue(territoryKey, population) {
    if (!isKnownMockTerritoryKey(territoryKey)) {
      return { ok: false, error: 'unknown-territory-key', territoryKey: territoryKey };
    }
    liveDirectCounts = null;
    liveMeta = {
      source: 'mock',
      calculatedAt: null,
      note: 'TERRITORY_POPULATION_MOCK_SOURCE',
    };
    TERRITORY_POPULATION_MOCK_SOURCE[territoryKey] = normalizeTerritoryPopulation(population);
    return {
      ok: true,
      territoryKey: territoryKey,
      directPopulation: TERRITORY_POPULATION_MOCK_SOURCE[territoryKey],
    };
  }

  /** Mock 원천 일부/전체 변경. 누락 key는 유지. */
  function setTerritoryPopulationMockValues(partial) {
    var src = partial && typeof partial === 'object' ? partial : {};
    var changed = {};
    var i;
    for (i = 0; i < EVO_KEYS.length; i++) {
      var key = EVO_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      var result = setTerritoryPopulationMockValue(key, src[key]);
      if (result.ok) changed[key] = result.directPopulation;
    }
    return {
      ok: true,
      changed: changed,
      directCounts: normalizeDirectCounts(TERRITORY_POPULATION_MOCK_SOURCE),
    };
  }

  /** Mock을 기본값으로 복구 · live 해제 */
  function resetTerritoryPopulationMockSource() {
    liveDirectCounts = null;
    liveMeta = {
      source: 'mock',
      calculatedAt: null,
      note: 'TERRITORY_POPULATION_MOCK_SOURCE',
    };
    TERRITORY_POPULATION_MOCK_SOURCE.pioneer = TERRITORY_POPULATION_MOCK_DEFAULTS.pioneer;
    TERRITORY_POPULATION_MOCK_SOURCE.guardian = TERRITORY_POPULATION_MOCK_DEFAULTS.guardian;
    TERRITORY_POPULATION_MOCK_SOURCE.central = TERRITORY_POPULATION_MOCK_DEFAULTS.central;
    TERRITORY_POPULATION_MOCK_SOURCE.alien = TERRITORY_POPULATION_MOCK_DEFAULTS.alien;
    return {
      ok: true,
      directCounts: normalizeDirectCounts(TERRITORY_POPULATION_MOCK_SOURCE),
    };
  }

  global.TERRITORY_POPULATION_MOCK_DEFAULTS = TERRITORY_POPULATION_MOCK_DEFAULTS;
  global.TERRITORY_POPULATION_MOCK_SOURCE = TERRITORY_POPULATION_MOCK_SOURCE;
  global.GAME_TERRITORY_TO_EVO = GAME_TERRITORY_TO_EVO;
  global.TERRITORY_EVOLUTION_EVO_KEYS = EVO_KEYS;
  global.normalizeTerritoryPopulation = normalizeTerritoryPopulation;
  global.normalizeTerritoryEvolutionDirectCounts = normalizeDirectCounts;
  global.mapGameTerritoryToEvoKey = mapGameTerritoryToEvoKey;
  global.resolveMemberCurrentTerritoryId = resolveMemberCurrentTerritoryId;
  global.isMemberCountedInEvolutionCensus = isMemberCountedInEvolutionCensus;
  global.aggregateCurrentTerritoryMemberCounts = aggregateCurrentTerritoryMemberCounts;
  global.getTerritoryEvolutionPopulation = getTerritoryEvolutionPopulation;
  global.setTerritoryEvolutionDirectCounts = setTerritoryEvolutionDirectCounts;
  global.clearTerritoryEvolutionDirectCounts = clearTerritoryEvolutionDirectCounts;
  global.markTerritoryEvolutionPopulationUnavailable = markTerritoryEvolutionPopulationUnavailable;
  global.allowTerritoryEvolutionMockFallback = allowTerritoryEvolutionMockFallback;
  global.getTerritoryEvolutionDirectCounts = getTerritoryEvolutionDirectCounts;
  global.getTerritoryEvolutionDirectCountsSnapshot = getTerritoryEvolutionDirectCountsSnapshot;
  global.isTerritoryEvolutionUsingMockSource = isTerritoryEvolutionUsingMockSource;
  global.isTerritoryEvolutionPopulationUnavailable = isTerritoryEvolutionPopulationUnavailable;
  global.setTerritoryPopulationMockValue = setTerritoryPopulationMockValue;
  global.setTerritoryPopulationMockValues = setTerritoryPopulationMockValues;
  global.resetTerritoryPopulationMockSource = resetTerritoryPopulationMockSource;
})(typeof window !== 'undefined' ? window : globalThis);
