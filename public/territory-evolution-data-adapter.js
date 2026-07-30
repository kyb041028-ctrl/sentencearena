/**
 * 영토 발전 클라이언트 data adapter
 * API/Mock → hover 패널 데이터 · 기존 UI 필드 유지
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../shared/territory-evolution-core'));
  } else {
    root.TerritoryEvolutionDataAdapter = factory(root.TerritoryEvolutionCore);
  }
})(typeof self !== 'undefined' ? self : this, function territoryEvolutionDataAdapterFactory(core) {
  'use strict';

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * 공용 contract → hover 패널이 쓰던 state shape
   */
  function mapEvolutionStateToHoverPanel(contract) {
    var src = contract || {};
    var frozen = clone(src);
    var evoKey = core.toEvoKey(frozen.territory) || frozen.territoryKey || null;

    if (frozen.dataStatus === 'LOADING') {
      return {
        territoryKey: evoKey,
        population: null,
        stage: null,
        stageLabel: '',
        rangeLabel: '',
        hasNextStage: false,
        remainingPopulation: null,
        progressRatio: null,
        dataStatus: 'LOADING',
        usingMock: false,
      };
    }

    if (
      frozen.dataStatus === 'UNAVAILABLE' ||
      frozen.dataStatus === 'INVALID' ||
      !frozen.populationAvailable
    ) {
      return {
        territoryKey: evoKey,
        population: null,
        stage: null,
        stageLabel: '',
        rangeLabel: '',
        hasNextStage: false,
        remainingPopulation: null,
        progressRatio: null,
        dataStatus: frozen.dataStatus || 'UNAVAILABLE',
        usingMock: false,
        previousStage: frozen.previousStage,
        nextStage: frozen.nextStage,
        currentStageImage: frozen.currentStageImage,
      };
    }

    var rem = frozen.nextStage && frozen.nextStage.available
      ? frozen.nextStage.requiredPopulation
      : (frozen.isMaxStage ? 0 : null);

    var progressRatio = null;
    var progressPercent = null;
    if (frozen.nextStage && frozen.nextStage.available && frozen.currentRange) {
      var curMin = frozen.currentRange.min != null ? frozen.currentRange.min : 0;
      var nextMin = frozen.nextStage.threshold;
      var span = nextMin != null ? nextMin - curMin : 0;
      if (span > 0 && frozen.population != null) {
        progressRatio = (frozen.population - curMin) / span;
        if (progressRatio < 0) progressRatio = 0;
        if (progressRatio > 1) progressRatio = 1;
        progressPercent = progressRatio * 100;
      }
    } else if (frozen.isMaxStage) {
      progressRatio = 1;
      progressPercent = 100;
    }

    return {
      territoryKey: evoKey,
      population: frozen.population,
      stage: frozen.currentStage,
      stageLabel: frozen.currentStageLabel,
      rangeLabel: frozen.currentRange && frozen.currentRange.label,
      hasNextStage: !!(frozen.nextStage && frozen.nextStage.available),
      nextStage: frozen.nextStage && frozen.nextStage.stage,
      nextStageLabel: frozen.nextStage && frozen.nextStage.stageLabel,
      nextStageMinPopulation: frozen.nextStage && frozen.nextStage.threshold,
      remainingPopulation: rem,
      progressRatio: progressRatio,
      progressPercent: progressPercent,
      dataStatus: frozen.dataStatus,
      usingMock: frozen.populationSource === 'LEGACY_MOCK' || frozen.dataStatus === 'LEGACY_MOCK',
      previousStage: frozen.previousStage,
      nextStageDetail: frozen.nextStage,
      currentStageImage: frozen.currentStageImage,
      isMaxStage: !!frozen.isMaxStage,
      isMinStage: !!frozen.isMinStage,
      contract: frozen,
    };
  }

  function mapLegacyEvolutionMockToContract(territoryKey, population) {
    return core.getTerritoryEvolutionState({
      territory: territoryKey,
      population: population,
      populationSource: core.POPULATION_SOURCE.LEGACY_MOCK,
      dataStatus: core.DATA_STATUS.LEGACY_MOCK,
    });
  }

  function buildUnavailableEvolutionViewModel(territory) {
    return core.buildUnavailableEvolutionViewModel(territory);
  }

  function buildPartialEvolutionViewModel(territoriesMap) {
    return {
      dataStatus: core.DATA_STATUS.PARTIAL,
      territories: territoriesMap || {},
    };
  }

  return {
    mapEvolutionStateToHoverPanel: mapEvolutionStateToHoverPanel,
    mapLegacyEvolutionMockToContract: mapLegacyEvolutionMockToContract,
    buildUnavailableEvolutionViewModel: buildUnavailableEvolutionViewModel,
    buildPartialEvolutionViewModel: buildPartialEvolutionViewModel,
  };
});
