#!/usr/bin/env node
'use strict';
/**
 * Achievement ops wiring guards (no Production mutation).
 * node tools/test-achievement-ops-wiring.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) {
    console.log('PASS', name);
    passed += 1;
  } else {
    console.log('FAIL', name);
    failed += 1;
  }
}

const defsSrc = read('public/achievement-definitions.js');
const vm = require('vm');
const sandbox = {};
vm.runInNewContext(defsSrc, sandbox, { filename: 'achievement-definitions.js' });
const defs = sandbox.ACHIEVEMENT_DEFINITIONS || [];
function def(id) {
  return defs.find(function (d) { return d.id === id; });
}

ok('H. record-builder PERMANENT_ONCE', def('record-builder').persistenceType === 'PERMANENT_ONCE' && def('record-builder').isSeasonal === false);
ok('I. conversation-bridge PERMANENT_ONCE', def('conversation-bridge').persistenceType === 'PERMANENT_ONCE' && def('conversation-bridge').isSeasonal === false);
ok('beta-citizen BLOCKED', def('beta-citizen').implementationStatus === 'BLOCKED');
ok('beta-citizen no hardcoded dates', !/20\d{2}-\d{2}-\d{2}/.test(def('beta-citizen').notes || ''));

const boardSvc = read('server/board-service.js');
ok('J. alien post skips Earth XP', /isAlienInternalTerritory\(territory\)/.test(boardSvc) && /applyPostCreatedXp/.test(boardSvc));
ok('K. alien comment skips Earth XP', /isAlienInternalTerritory\(targetPost\.territory\)/.test(boardSvc));
ok('L. alien empathy no Earth Fame', /ALIEN_INTERNAL_NO_EARTH_FAME/.test(boardSvc));
ok('M. alien skips evaluateAfterPostCreated when internal', boardSvc.indexOf('if (!isAlienInternalTerritory(territory))') >= 0);
ok('F. empathy returns newlyGrantedAchievements', /newlyGrantedAchievements/.test(boardSvc) && /evaluateAfterEmpathyReceived/.test(boardSvc));

const boardRoutes = read('server/board-routes.js');
ok('F. empathy route includes newlyGrantedAchievements', /newlyGrantedAchievements: result\.newlyGrantedAchievements/.test(boardRoutes));

const daily = read('server/daily-issue-routes.js');
ok('G. Daily Issue XP level-up → territory-citizen', /evaluateAfterLevelUp/.test(daily) && /applyIssueCommentCreatedXp/.test(daily));

const mig = read('supabase/migration_achievement_service_role_select_v1.sql');
ok('migration grants service_role SELECT', /GRANT SELECT ON TABLE public\.user_achievements TO service_role/.test(mig));
ok('migration mark_user_achievement_notified(text,bigint)', /mark_user_achievement_notified\(\s*p_achievement_key text,\s*p_acquisition_sequence bigint/s.test(mig));
ok('migration no DROP/TRUNCATE/DELETE', !/\bTRUNCATE\b|\bDROP TABLE\b|\bDELETE FROM\b/i.test(mig.replace(/--[^\n]*/g, '')));

const coreSrc = read('shared/production-public-migration-core.js');
ok('migration id in production-public-migration-core', /achievement_service_role_select_v1/.test(coreSrc));

const xp = require('../shared/progression-xp-core');
ok('A. POST +25', xp.XP_REWARDS.POST_CREATED === 25);
ok('N. board comment +12', xp.XP_REWARDS.BOARD_COMMENT_CREATED === 12);
ok('N. issue comment +10', xp.XP_REWARDS.ISSUE_COMMENT_CREATED === 10);

console.log('---');
console.log('passed:', passed, 'failed:', failed);
process.exit(failed ? 1 : 0);
