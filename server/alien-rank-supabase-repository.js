'use strict';

const rankCore = require('../shared/alien-rank-core');

async function getAlienRank(userId) {
  return rankCore.buildAlienRankContract({ userId });
}

async function listAlienRanks() {
  return { items: [], total: 0, calculationEnabled: false };
}

async function getWeeklyLegend() {
  return [];
}

async function listLegendHistory() {
  return [];
}

async function buildRankCalculationInput() {
  return { calculationEnabled: false, note: 'NOT_CONNECTED' };
}

async function healthCheck() {
  return {
    ok: true,
    backend: 'supabase-stub',
    definitionsReady: true,
    calculationEnabled: false,
    weeklyLegendEnabled: false,
  };
}

module.exports = {
  getAlienRank,
  listAlienRanks,
  getWeeklyLegend,
  listLegendHistory,
  buildRankCalculationInput,
  healthCheck,
};
