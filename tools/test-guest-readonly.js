#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const index = read('public/index.html');
const follow = read('public/follow-system.js');
const authJs = read('public/auth.js');

assert(/window\.__scRequireLoggedInMember = requireLoggedInMember/.test(index), 'global login gate exists');
assert(/회원가입 후 이용할 수 있습니다/.test(index), 'guest action notice copy');
assert(!/회원가입 또는 로그인 후 이용할 수 있습니다/.test(index), 'old force-login copy removed');
const gateFn = index.match(/function requireLoggedInMember\(\) \{[\s\S]*?\n      window\.__scRequireLoggedInMember/);
assert(gateFn && gateFn[0].indexOf('showScShareToast') !== -1, 'guest action reuses existing toast');
assert(gateFn && gateFn[0].indexOf('showLoginOnly') === -1, 'guest action does not force login screen');
assert(gateFn && gateFn[0].indexOf('__scShowAuthHome') === -1, 'guest action does not force auth home');
assert(/showLoginOnly/.test(index), 'explicit login screen helper kept');
assert(/__scShowAuthHome/.test(read('public/app-entry.js')), 'explicit auth-home helper kept');

assert(/function requireLoggedInMemberAction/.test(index), 'board helper exists');
assert(
  /function onTogglePostReaction\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '1. guest like/dislike post gated',
);
assert(
  /function onToggleCommentReaction\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '2. guest comment like/dislike gated',
);
assert(
  /function onToggleEmpathyPost\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '3. guest post empathy gated',
);
assert(
  /function onToggleEmpathyComment\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '3b. guest comment empathy gated',
);
assert(
  /function onDailyIssueToggleEmpathy\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  'daily issue empathy gated',
);
assert(
  /function onDailyIssueToggleCommentReaction\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  'daily issue like/dislike gated',
);
assert(
  /function openModal\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '7. guest write modal gated',
);
assert(
  /form\.addEventListener\('submit', function \(ev\) \{\s*ev\.preventDefault\(\);\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '7b. guest write submit gated',
);
assert(
  /function submitComment\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '8. guest comment gated',
);
assert(
  /function submitCentristIssueComment\([^)]*\) \{\s*if \(!requireLoggedInMemberAction\(\)\) return;/.test(index),
  '8b. guest daily-issue comment gated',
);
assert(
  /__scRequireLoggedInMember[\s\S]{0,80}togglePostBookmark/.test(index),
  '9. guest bookmark gated',
);
assert(
  /function toggleFollow\([^)]*\) \{\s*if \(typeof global\.__scRequireLoggedInMember === 'function' && !global\.__scRequireLoggedInMember\(\)\)/.test(
    follow,
  ),
  '9b. guest follow gated',
);
assert(
  /function openPostReportModal\([^)]*\) \{\s*if \(typeof window\.__scRequireLoggedInMember === 'function' && !window\.__scRequireLoggedInMember\(\)\)/.test(
    index,
  ),
  '10. guest report gated',
);
assert(
  /chat-form[\s\S]*__scRequireLoggedInMember[\s\S]*fetch\('\/api\/chat\/messages'/.test(index) ||
    /form\.addEventListener\('submit', async function \(ev\) \{\s*ev\.preventDefault\(\);\s*if \(typeof window\.__scRequireLoggedInMember === 'function' && !window\.__scRequireLoggedInMember\(\)\) \{\s*return;/.test(
      index,
    ),
  'guest chat send gated',
);

assert(
  /isAuthenticatedBoardMember\(\) &&\s*isServerCanonicalPost\(post\)/.test(index),
  '13. member canonical reaction path kept',
);
assert(/toggleMemberCanonicalReaction/.test(index), '13b. member reaction API kept');
assert(/createMemberCanonicalBoardPost/.test(index), '13c. member write API kept');
assert(/createMemberCanonicalBoardComment/.test(index), '13d. member comment API kept');
assert(/createMemberCanonicalBoardReport/.test(index), '13e. member report API kept');
assert(/grantMemberCanonicalPostEmpathy/.test(index), '13f. member empathy API kept');

assert(index.indexOf('applyReactionScoresWithMult') !== -1, '14. alignment apply helper not removed');
assert(read('shared/political-alignment-bidirectional-sim-core.js').indexOf('__scRequireLoggedInMember') === -1, '14b. alignment sim untouched');
assert(read('public/player-progression.js').indexOf('__scRequireLoggedInMember') === -1, '15. progression untouched');
assert(read('server/achievement-evaluator-service.js').indexOf('__scRequireLoggedInMember') === -1, '15b. achievement evaluator untouched');

assert(authJs.indexOf('__scRequireLoggedInMember') === -1, '16. auth.js has no guest-readonly hook');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'public/auth.js'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();
assert(authDiff === '', '16b. auth.js not in working tree diff');

assert(/function hydrateGuestCanonicalFeed|guestCanonicalFeedCache/.test(index), '12. guest read feed kept');

console.log('PASS guest readonly');
