'use strict';

/**
 * 베타 업적 복원 + 중앙 획득 알람 + evaluator + hydrate baseline
 * node tools/test-achievement-restore.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
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

function section(title) {
  console.log('\n[' + title + ']');
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function loadBrowserScript(rel, extraGlobals) {
  const src = read(rel);
  const sandbox = Object.assign(
    {
      window: {},
      globalThis: {},
      document: {
        createElement: function () {
          return {
            style: {},
            classList: { add: function () {}, remove: function () {} },
            setAttribute: function () {},
            appendChild: function () {},
            parentNode: null,
          };
        },
        body: { appendChild: function () {} },
      },
      location: { hostname: 'localhost' },
      matchMedia: function () {
        return { matches: false };
      },
      requestAnimationFrame: function (fn) {
        fn();
      },
      setTimeout: function (fn) {
        fn();
      },
    },
    extraGlobals || {}
  );
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: path.join(root, rel) });
  return sandbox;
}

(async function main() {
  section('정의 11개 · rarity · LEGENDARY 없음');
  const defCore = require('../shared/achievement-definitions-core');
  const keys = defCore.listAchievementKeys();
  ok('1. achievement key 11개', keys.length === 11, String(keys.length));
  ok('2. 중복 key 없음', defCore.validateDefinitionIndex().valid === true);

  const defsSrc = read('public/achievement-definitions.js');
  const expected = [
    ['first-post', '글쓰기 버튼이 눌렸다', 'COMMON', 'VALID_POST_COUNT'],
    ['first-comment', '한마디 거들겠습니다', 'COMMON', 'VALID_COMMENT_ON_OTHERS_POST_COUNT'],
    ['first-empathy-received', '내 말 맞지?', 'COMMON', 'VALID_EMPATHY_RECEIVED_COUNT'],
    ['territory-citizen', '시민증 발급 완료', 'BRONZE', 'LEVEL_REACHED'],
    ['steady-footsteps', '또 왔네, 또 왔어', 'BRONZE', 'DISTINCT_ACTIVE_DAYS_IN_WINDOW'],
    ['record-builder', '할 말이 좀 많습니다', 'BRONZE', 'VALID_POST_COUNT'],
    ['conversation-bridge', '댓글에서 뵙겠습니다', 'BRONZE', 'DISTINCT_POSTS_WITH_VALID_COMMENTS'],
    ['empathy-from-many', '나만 그렇게 생각한 거 아니었어', 'GOLD', 'DISTINCT_USERS_EMPATHY_RECEIVED'],
    ['dialogue-across-territories', '양쪽에서 살아남은 발언', 'GOLD', 'POSITIVE_RESPONSE_FROM_BOTH_TERRITORIES'],
    ['witness-of-an-era', '그때 내가 거기 있었지', 'CRYSTAL', 'TERRITORY_STAGE_ADVANCED_WHILE_MEMBER'],
    ['beta-citizen', '공사 중인데 들어오셨네요', 'CRYSTAL', 'BETA_MEMBER_AND_LEVEL_REACHED'],
  ];
  expected.forEach(function (row, idx) {
    var d = defCore.getAchievementDefinition(row[0]);
    ok(
      '3.' + (idx + 1) + ' ' + row[0],
      d &&
        d.title === row[1] &&
        defsSrc.indexOf("id: '" + row[0] + "'") !== -1 &&
        defsSrc.indexOf("conditionType: '" + row[3] + "'") !== -1,
      d ? d.title : 'missing'
    );
  });
  ok('4. LEGENDARY 신규 업적 0', !/rarity:\s*'LEGENDARY'/.test(defsSrc));

  section('보안 · self-grant 차단');
  const routes = read('server/achievement-persist-routes.js');
  const ua = read('public/user-achievements.js');
  ok('5. POST grant 404', /NOT_FOUND/.test(routes));
  ok('6. CLIENT_GRANT_FORBIDDEN', /CLIENT_GRANT_FORBIDDEN/.test(ua));
  ok('7. grantAchievementForUser 서버 내부', /function grantAchievementForUser/.test(read('server/achievement-persist-service.js')));

  section('evaluator · stats · board hook');
  const evalCore = require('../shared/achievement-evaluation-core');
  const evalSvc = require('../server/achievement-evaluator-service');
  ok('8. TRIGGER_MAP POST_CREATED', evalCore.TRIGGER_MAP.POST_CREATED.indexOf('first-post') !== -1);
  ok('9. evaluator service exists', typeof evalSvc.evaluateAndGrantForDomainEvent === 'function');
  ok('10. board createPost hook', /evaluateAfterPostCreated/.test(read('server/board-service.js')));
  ok('10b. createPost awaits evaluator', /await evaluator\.evaluateAfterPostCreated/.test(read('server/board-service.js')));
  ok('10c. member canonical post helper', /createMemberCanonicalBoardPost/.test(read('public/board-api-client.js')));
  ok('11. board createComment hook', /evaluateAfterCommentCreated/.test(read('server/board-service.js')));

  const levelEval = evalCore.evaluateAchievementCondition(
    defCore.getAchievementDefinition('territory-citizen'),
    { userProgression: { level: 5 }, ownedAchievements: [] }
  );
  ok('12. LEVEL_REACHED level5 PASS', levelEval.eligible === true);

  const postEval = evalCore.evaluateAchievementCondition(
    defCore.getAchievementDefinition('first-post'),
    { achievementStats: { validPostCount: 1 }, ownedAchievements: [] }
  );
  ok('13. VALID_POST_COUNT with stats PASS', postEval.eligible === true);

  const postNoData = evalCore.evaluateAchievementCondition(
    defCore.getAchievementDefinition('first-post'),
    { ownedAchievements: [] }
  );
  ok('14. VALID_POST_COUNT no stats NOT_CONNECTED', postNoData.reason === 'CONDITION_DATA_NOT_CONNECTED');

  const candidate = evalCore.evaluateAchievementCondition(
    defCore.getAchievementDefinition('dialogue-across-territories'),
    { achievementStats: {}, ownedAchievements: [] }
  );
  ok('15. CANDIDATE not auto-grant', candidate.eligible === false);

  const blocked = evalCore.evaluateAchievementCondition(
    defCore.getAchievementDefinition('witness-of-an-era'),
    { achievementStats: {}, ownedAchievements: [] }
  );
  ok('16. BLOCKED not auto-grant', blocked.eligible === false);

  section('중앙 알람 UI · preview helper');
  const alertSrc = read('public/achievement-acquired-alert.js');
  const indexHtml = read('public/index.html');
  ok('17. alert script mounted', indexHtml.indexOf('/achievement-acquired-alert.js') !== -1);
  ok('18. centered CSS', /left:\s*50%/.test(indexHtml) && /top:\s*50%/.test(indexHtml));
  ok('19. z-index safe', /z-index:\s*12100/.test(indexHtml));
  ok('20. preview helper', /__scPreviewAchievementAcquired/.test(alertSrc));
  ok('21. aria-live polite', /aria-live/.test(alertSrc));
  ok('22. reduced motion', /prefers-reduced-motion/.test(indexHtml));

  const alertSandbox = loadBrowserScript('public/achievement-acquired-alert.js', {
    getAchievementDefinition: function (id) {
      return defCore.getAchievementDefinition(id)
        ? {
            id: id,
            name: defCore.getAchievementDefinition(id).title,
            rarity: 'BRONZE',
            conditionType: 'LEVEL_REACHED',
            conditionValue: 5,
          }
        : null;
    },
    getAchievementRarityFrame: function () {
      return '/assets/achievements/rarity-frames/청동.png';
    },
    getAchievementRarityLabel: function () {
      return '청동';
    },
    normalizeAchievementRarity: function (r) {
      return String(r || 'COMMON').toUpperCase();
    },
    enqueueAchievementAcquiredAlert: null,
  });
  var preview = alertSandbox.__scPreviewAchievementAcquired('territory-citizen');
  ok('23. preview localhost ok', preview && preview.ok === true);
  alertSandbox.location = { hostname: 'sentencearena.com' };
  var prodBlock = alertSandbox.__scPreviewAchievementAcquired('territory-citizen');
  ok('24. preview production blocked', prodBlock && prodBlock.reason === 'PRODUCTION_FORBIDDEN');

  section('hydrate baseline · Guest');
  ok('25. memberAlertBaseline', /memberAlertBaseline/.test(ua));
  ok(
    '26. hydrate unnotified FIFO (no blanket first-hydrate suppress)',
    /queueUnnotifiedAcquisitionAlerts/.test(ua) &&
      /acquisitionNotifiedAt/.test(ua) &&
      /markAchievementAcquisitionNotified/.test(ua),
  );
  ok('27. findNewlyAcquiredRecords', /findNewlyAcquiredRecords/.test(ua));
  ok('28. guest grant no centered alert', !/notifyAchievementAcquired\(def, record\)/.test(ua.split('Guest/demo: 로컬 Mock')[1] || ''));
  ok('29. guest mock 3 유지', /territory-citizen/.test(ua) && /empathy-from-many/.test(ua) && /beta-citizen/.test(ua));

  section('rarity frame assets');
  ok('30. 일반 frame', fs.existsSync(path.join(root, 'public/assets/achievements/rarity-frames/일반.png')));
  ok('31. 청동 frame', fs.existsSync(path.join(root, 'public/assets/achievements/rarity-frames/청동.png')));
  ok('32. 황금 frame', fs.existsSync(path.join(root, 'public/assets/achievements/rarity-frames/황금.png')));
  ok('33. 수정 frame', fs.existsSync(path.join(root, 'public/assets/achievements/rarity-frames/수정.png')));
  ok('34. 전설 frame', fs.existsSync(path.join(root, 'public/assets/achievements/rarity-frames/전설.png')));

  section('회귀 · auth/app-entry');
  const { execFileSync } = require('child_process');
  const diffNames = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).split(/\r?\n/);
  ok('35. auth.js unchanged', diffNames.indexOf('public/auth.js') === -1);
  ok('36. app-entry unchanged', diffNames.indexOf('public/app-entry.js') === -1);

  console.log('\n---');
  console.log('TOTAL: ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
