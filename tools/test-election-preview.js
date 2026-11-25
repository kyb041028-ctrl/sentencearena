'use strict';
/**
 * 개발용 선거 미리보기 규칙. 서버와 저장소를 열지 않는다.
 * node tools/test-election-preview.js
 */
const core = require('../shared/election-preview-core');
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
  if (cond) {
    console.log('  PASS: ' + label);
    pass += 1;
  } else {
    console.log('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail += 1;
  }
}

const kr = core.fixture('KR', 'election-open');
const us = core.fixture('US', 'election-open');
ok('eight preview states', core.STATES.length === 8);
ok('KR and US election ids differ', kr.electionId !== us.electionId);
ok('KR and US candidates differ', kr.candidates[0].name !== us.candidates[0].name);
ok('territory keys are pioneer and guardian', kr.territory === 'pioneer' && us.territory === 'guardian');
ok('turnout is a percent only', core.turnoutLabel(kr, 'KR') === '전체 투표율 15%' && !/한결|180/.test(core.turnoutLabel(kr, 'KR')));
ok('open election shows choices', core.showsChoices(kr) === true);
ok('voted election hides choices', core.showsChoices(core.fixture('KR', 'election-voted')) === false);
ok('sole candidate has no choice screen', core.showsChoices({ type: 'leader-election', eligibility: 'eligible', votingStatus: 'open', candidates: [{ id: 'one' }] }) === false);
ok('ineligible has no choices', core.showsChoices(core.fixture('US', 'ineligible')) === false);
var memory = core.createHideMemory();
memory.dismiss('KR', 'preview-member', 'leader-election', '2026-11-08');
ok('hide is not shared with impeachment', memory.isHidden('KR', 'preview-member', 'leader-election', '2026-11-08') === true && memory.isHidden('KR', 'preview-member', 'impeachment', '2026-11-08') === false);
ok('hide is not shared across countries', memory.isHidden('US', 'preview-member', 'leader-election', '2026-11-08') === false);
ok('none is an empty fixture', core.fixture('KR', 'none') === null);
var ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'election-preview.js'), 'utf8');
ok('preview says it is a development simulation', ui.indexOf('개발용 시뮬레이션') >= 0 || core.COPY.KR.sim === '개발용 시뮬레이션');
ok('preview does not call fetch', !/fetch\(/.test(ui));
ok('preview does not claim browser storage blocks a second vote', !/중복투표/.test(ui) && !/localStorage/.test(ui));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
