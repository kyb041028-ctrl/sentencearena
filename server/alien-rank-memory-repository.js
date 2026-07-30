'use strict';

const rankCore = require('../shared/alien-rank-core');

const store = {
  ranks: new Map(),
  legends: [],
};

function _reset() {
  store.ranks.clear();
  store.legends = [];
}

async function getAlienRank(userId) {
  const row = store.ranks.get(userId);
  return rankCore.buildAlienRankContract(row || { userId });
}

async function listAlienRanks(paging) {
  const page = paging || {};
  const limit = Math.min(Math.max(Number(page.limit) || 20, 1), 100);
  const items = Array.from(store.ranks.values()).map((r) => rankCore.buildAlienRankContract(r));
  return { items: items.slice(0, limit), total: items.length, calculationEnabled: false };
}

async function getWeeklyLegend(weekKey) {
  return store.legends.filter((l) => l.weekKey === weekKey);
}

async function listLegendHistory(userId) {
  return store.legends.filter((l) => l.userId === userId);
}

async function buildRankCalculationInput(period) {
  return {
    period: period || null,
    calculationEnabled: false,
    note: 'RANK_FORMULA_NOT_IMPLEMENTED',
  };
}

async function healthCheck() {
  return {
    ok: true,
    definitionsReady: true,
    calculationEnabled: false,
    weeklyLegendEnabled: false,
  };
}

function _seedRank(userId, rank) {
  store.ranks.set(userId, { userId, rank });
}

function _seedLegend(entry) {
  store.legends.push(rankCore.buildLegendHistoryEntry(entry));
}

module.exports = {
  getAlienRank,
  listAlienRanks,
  getWeeklyLegend,
  listLegendHistory,
  buildRankCalculationInput,
  healthCheck,
  _reset,
  _seedRank,
  _seedLegend,
};
