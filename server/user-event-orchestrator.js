'use strict';

const eventCore = require('../shared/user-domain-event-core');
const policyCore = require('../shared/user-event-policy-core');
const progCore = require('../shared/user-progression-event-core');
const citizenCore = require('../shared/citizen-rank-evaluation-core');
const achCore = require('../shared/achievement-evaluation-core');
const notifCore = require('../shared/user-notification-core');
const activityCore = require('../shared/user-activity-core');
const cacheCore = require('../shared/user-cache-invalidation-core');
const memoryRepo = require('./user-event-memory-repository');

const MAX_DERIVED_DEPTH = 3;

let _repo = memoryRepo;
let _mode = 'LEGACY_LOCAL';

function setRepository(repo) {
  _repo = repo || memoryRepo;
}

function setDataMode(mode) {
  const m = String(mode || 'LEGACY_LOCAL').toUpperCase();
  if (m === 'API_OPERATIONAL') {
    _mode = 'LEGACY_LOCAL';
    return;
  }
  _mode = m === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL';
}

function getDataMode() {
  return _mode;
}

function isActivated() {
  return false;
}

async function processUserDomainEvent(eventInput, options) {
  const opts = options || {};
  const depth = opts._depth || 0;
  if (depth > MAX_DERIVED_DEPTH) {
    return { ok: false, error: 'DERIVED_DEPTH_EXCEEDED', warnings: ['MAX_DERIVED_DEPTH'] };
  }

  const frozen = eventCore.clone(eventInput);
  void frozen;
  const validation = eventCore.validateDomainEvent(eventInput);
  if (!validation.valid) {
    return { ok: false, error: validation.errors[0], warnings: validation.errors };
  }

  const event = eventCore.buildDomainEvent(eventInput);
  const warnings = [];

  if (await _repo.hasProcessedEvent(event.dedupeKey)) {
    return {
      ok: true,
      skipped: true,
      reason: 'DUPLICATE',
      event: event,
      warnings: ['DEDUPE_HIT'],
    };
  }

  const ctx = await _repo.getUserEventContext(event.userId);
  const owned = await _repo.getOwnedAchievements(event.userId);

  let progressionPlan = null;
  if (policyCore.isProgressionEvent(event.eventType)) {
    progressionPlan = progCore.buildProgressionEventPlan({
      userId: event.userId,
      event: event,
      currentProgression: ctx.progression,
    });
    if (progressionPlan.policy === 'NO_POLICY') warnings.push('PROGRESSION_NO_POLICY');
  }

  const citizenRankPlan = citizenCore.evaluateCitizenRank({
    currentRank: ctx.progression && ctx.progression.citizen_rank,
    userState: ctx,
    eventContext: event,
    batchContext: opts.batchContext || null,
  });

  let achievementEval = { grants: [], eligible: [], unavailable: [], alreadyOwned: [] };
  if (policyCore.isAchievementEvaluationEvent(event.eventType)) {
    let userProgressionForAch = progressionPlan && progressionPlan.nextProgression
      ? progressionPlan.nextProgression : ctx.progression;
    if (event.eventType === eventCore.EVENT_TYPE.LEVEL_UP
      && event.payload && event.payload.levelAfter != null) {
      userProgressionForAch = Object.assign({}, userProgressionForAch || {}, {
        level: event.payload.levelAfter,
      });
    }
    achievementEval = achCore.evaluateAchievementsForDomainEvent(event, {
      event: event,
      userProgression: userProgressionForAch,
      ownedAchievements: owned,
    });
    for (let i = 0; i < achievementEval.grants.length; i++) {
      const seq = await _repo.getNextAchievementSequence(event.userId);
      achievementEval.grants[i].acquisitionSequence = seq;
    }
  }

  const notificationPlans = [];
  const n = notifCore.buildNotificationPlan(event);
  if (n) notificationPlans.push(n);

  const activityPlans = [];
  const a = activityCore.buildActivityEventPlan(event);
  if (a) activityPlans.push(a);

  const derivedEvents = [];
  if (progressionPlan && progressionPlan.generatedDomainEvents) {
    progressionPlan.generatedDomainEvents.forEach(function (de) {
      derivedEvents.push(eventCore.buildDomainEvent(Object.assign({}, de, {
        userId: event.userId,
        occurredAt: event.occurredAt,
        sourceSystem: 'PROGRESSION_DERIVED',
      })));
    });
  }

  const derivedResults = [];
  for (let j = 0; j < derivedEvents.length; j++) {
    const child = await processUserDomainEvent(derivedEvents[j], { _depth: depth + 1 });
    derivedResults.push(child);
  }

  const cachePlan = cacheCore.planCacheInvalidation(event);

  const persistencePlan = {
    shouldPersist: false,
    mode: _mode,
    dedupeKey: event.dedupeKey,
    progression: progressionPlan,
    achievements: achievementEval.grants,
    notifications: notificationPlans,
    activities: activityPlans,
    citizenRank: citizenRankPlan,
    note: 'PERSIST_DISABLED',
  };

  if (_mode === 'API_DRY_RUN' || !persistencePlan.shouldPersist) {
    await _repo.markProcessedDryRun(event.dedupeKey, event.userId);
  }

  return {
    ok: true,
    dryRun: true,
    event: event,
    progressionPlan: progressionPlan,
    citizenRankPlan: citizenRankPlan,
    achievementPlans: achievementEval.grants,
    achievementEvaluation: achievementEval,
    notificationPlans: notificationPlans,
    activityPlans: activityPlans,
    derivedEvents: derivedEvents,
    derivedResults: derivedResults,
    persistencePlan: persistencePlan,
    cacheInvalidationPlan: cachePlan,
    warnings: warnings,
  };
}

async function healthCheck() {
  return {
    mode: _mode,
    activated: isActivated(),
    repository: await _repo.healthCheck(),
  };
}

module.exports = {
  setRepository,
  setDataMode,
  getDataMode,
  isActivated,
  processUserDomainEvent,
  healthCheck,
  MAX_DERIVED_DEPTH,
};
