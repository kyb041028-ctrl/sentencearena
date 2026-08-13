/**
 * 업적 definition Node SSOT — public/achievement-definitions.js 로드
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let _cache = null;

function loadDefinitions() {
  if (_cache) return _cache;
  const file = path.join(__dirname, '../public/achievement-definitions.js');
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = {};
  vm.runInNewContext(src, sandbox, { filename: file });
  _cache = (sandbox.ACHIEVEMENT_DEFINITIONS || []).map(function (d) {
    return {
      achievementKey: d.id,
      title: d.name,
      description: d.description,
      category: d.category,
      conditionType: d.conditionType,
      conditionConfig: d.conditionValue,
      repeatPolicy: d.persistenceType === 'SEASON_REPEATABLE' ? 'ONCE_PER_SEASON'
        : (d.persistenceType === 'PERMANENT_ONCE' ? 'ONCE' : 'ONCE'),
      seasonPolicy: d.isSeasonal ? 'SEASONAL' : 'NON_SEASON',
      iconKey: d.id,
      hidden: !!d.isHidden,
      enabled: d.implementationStatus === 'CONFIRMED',
      definitionVersion: 'BETA_DEFINITIONS_V1',
      implementationStatus: d.implementationStatus,
      canFeature: d.canFeature !== false,
      displayAlias: d.id === 'territory-citizen' ? '당당한 영토시민!' : null,
      conditionHistoryPolicy:
        d.conditionHistoryPolicy === 'RETROACTIVE' || d.conditionHistoryPolicy === 'FORWARD_ONLY'
          ? d.conditionHistoryPolicy
          : 'UNSET',
      retroactivePolicy: d.retroactivePolicy || null,
    };
  });
  return _cache;
}

function listAchievementDefinitions() {
  return loadDefinitions().slice();
}

function getAchievementDefinition(key) {
  return loadDefinitions().find(function (d) { return d.achievementKey === key; }) || null;
}

function listAchievementKeys() {
  return loadDefinitions().map(function (d) { return d.achievementKey; });
}

function validateDefinitionIndex() {
  const defs = loadDefinitions();
  const keys = {};
  const dup = [];
  defs.forEach(function (d) {
    if (keys[d.achievementKey]) dup.push(d.achievementKey);
    keys[d.achievementKey] = true;
  });
  return { total: defs.length, duplicateKeys: dup, valid: dup.length === 0 };
}

module.exports = {
  loadDefinitions,
  listAchievementDefinitions,
  getAchievementDefinition,
  listAchievementKeys,
  validateDefinitionIndex,
  LEVEL5_ACHIEVEMENT_KEY: 'territory-citizen',
};
