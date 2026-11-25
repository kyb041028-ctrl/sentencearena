#!/usr/bin/env node
'use strict';

/**
 * 영토(보드 territory) vs 활동 국가(activity_region) — 계정 공통·미국 미제공 범위.
 * 새 영토 시스템 추가 없음. 정적 설계 + 코어 동작만.
 */

const fs = require('fs');
const path = require('path');
const core = require('../shared/activity-region-core');

const ROOT = path.join(__dirname, '..');
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  const v2 = read('supabase/migration_activity_region_v2.sql');
  const profiles = read('supabase/schema_profiles_identity_history.sql');
  const boardRoutes = read('server/board-routes.js');
  const batch = read('server/alignment-batch-service.js');

  check(
    'profiles는 계정당 하나(영토는 계정 공통)',
    /CREATE TABLE IF NOT EXISTS public\.profiles/.test(profiles) && !/ALTER TABLE\s+public\.profiles/i.test(v2)
  );
  check(
    '활동 국가는 별도 표·열로만 확장',
    v2.indexOf('user_activity_region_profile') !== -1 && v2.indexOf('activity_region') !== -1
  );
  check(
    '미국 성향 배치는 US_SENTENCE_MODEL_MISSING으로 건너뜀',
    batch.indexOf('US_SENTENCE_MODEL_MISSING') !== -1 || core.selectAlignmentBatch({ region: 'US', users: [], reactions: [] }).skipped === true
  );
  const usSkip = core.selectAlignmentBatch({ region: 'US', users: [{ userId: 'a' }], reactions: [] });
  check('미국 영토 점수 배치 미제공(의도적 skip)', usSkip.skipped === true && usSkip.reason === 'US_SENTENCE_MODEL_MISSING');

  check(
    '미국 region-profile API는 tendency null 허용',
    /region === 'US'/.test(boardRoutes) && /tendency/.test(boardRoutes) && /profile\.tendency/.test(boardRoutes)
  );
  check(
    '정치 영토 canonical key는 pioneer/central/guardian/alien',
    !/\breform\b/.test(v2) && !/\border\b/.test(v2)
  );
  check(
    '가입 시 영토 선택 구조 없음(v2)',
    v2.indexOf('signup_territory') === -1
  );

  if (failed) {
    console.log('PHASE17_TERRITORY_SCOPE_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('PHASE17_TERRITORY_SCOPE_OK');
  console.log('US_POLITICAL_TERRITORY_ACTIVITY', 'NOT_IMPLEMENTED', 'alignment-batch-skipped');
  console.log('US_BOARD_TERRITORY', 'SUPPORTED', 'same CENTRAL/PIONEER/GUARDIAN boards filtered by activity_region');
}

main();
