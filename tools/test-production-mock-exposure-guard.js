'use strict';
/**
 * Production Mock 노출 차단 (오픈베타 6항목)
 * node tools/test-production-mock-exposure-guard.js
 */

const fs = require('fs');
const path = require('path');

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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const indexHtml = read('public/index.html');
const evoApi = read('public/territory-evolution-api-client.js');
const evoPop = read('public/territory-evolution-population.js');
const evoHover = read('public/territory-evolution-hover.js');
const factionUi = read('public/faction-battle-ui.js');
const rankJs = read('public/rank-leaderboard.js');

console.log('\n[A/B 실회원 board demo/seed]');
ok(
  'A. 실회원 getPosts demo concat 제거',
  /실회원: server canonical만/.test(indexHtml) &&
    !/return copy\.concat\(getDisplayOnlyPosts/.test(indexHtml),
);
ok(
  'B. refreshBoardView Guest만 데모 재충전',
  /Guest만 데모 글 보정/.test(indexHtml) &&
    /if \(!isAuthenticatedBoardMember\(\)\) \{/.test(indexHtml) &&
    /ensureCommonDemoPostsFilled/.test(indexHtml),
);
ok(
  'C. Guest demo 식별 유지',
  /id\.indexOf\('demo_'\) === 0/.test(indexHtml) &&
    /id\.indexOf\('seed_'\) === 0/.test(indexHtml) &&
    /ensureCommonDemoPostsFilled/.test(indexHtml),
);

console.log('\n[D/E/F 타인 프로필]');
ok(
  'D. createOtherUserProfileBase 존재',
  /function createOtherUserProfileBase/.test(indexHtml),
);
ok(
  'E. buildUserProfileDataForModal 실회원 타인 SC_PROFILE clone 금지',
  /SC_PROFILE_DATA\(Guest Mock\) clone 금지/.test(indexHtml) &&
    /createOtherUserProfileBase\(\)/.test(indexHtml),
);
ok(
  'F. 실회원 타인 achievements 빈 배열',
  /Guest Mock 대표업적 미적용/.test(indexHtml) &&
    /profile\.achievements = \[\]/.test(indexHtml),
);
ok(
  'F2. Guest ProfileFrame에 Level12/fame3450 없음',
  /guestProgressionEmpty:\s*true/.test(indexHtml) &&
    /var SC_PROFILE_DATA = \{/.test(indexHtml) &&
    !/level: 12/.test(indexHtml) &&
    !/fame: 3450/.test(indexHtml),
);

console.log('\n[G/H/I 영토 evolution]');
ok(
  'G. live 성공 시 setTerritoryEvolutionDirectCounts',
  /applyLiveDirectCounts/.test(evoApi) && /setTerritoryEvolutionDirectCounts/.test(evoPop),
);
ok(
  'H. API 실패 시 실회원 LEGACY_MOCK 미사용',
  /allowLegacyMockFallback/.test(evoApi) &&
    /markUnavailableLocal/.test(evoApi) &&
    /buildUnavailableEvolutionViewModel/.test(evoApi) &&
    /allowTerritoryEvolutionMockFallback/.test(evoPop),
);
ok(
  'I. 실패 시 가짜 발전단계 없음 (UNAVAILABLE)',
  /dataStatus: 'UNAVAILABLE'/.test(evoApi) || /POPULATION_UNAVAILABLE/.test(evoHover),
);
ok(
  'I2. hover UNAVAILABLE 표시 —',
  /unavailable \? '—'/.test(evoHover) || /state\.dataStatus === 'UNAVAILABLE'/.test(evoHover),
);

console.log('\n[J/K 진영 전황]');
ok(
  'J. 실회원 MOCK 전황 숨김',
  /isAuthenticatedMemberViewer/.test(factionUi) &&
    /snapshot\.dataStatus === 'MOCK'/.test(factionUi) &&
    /return false/.test(factionUi),
);
ok(
  'K. Guest 체험용 전황 aria',
  /체험용 전황/.test(factionUi) && /체험용 전황/.test(indexHtml),
);
ok(
  'K2. 실회원 작성폼 전황 모드는 LIVE만 (MOCK을 실집계처럼 켜지 않음)',
  /실회원: 진영 토론 선택 → 서버 LIVE 전황/.test(indexHtml) &&
    /MOCK을 실집계처럼 켜지 않음/.test(indexHtml),
);

console.log('\n[L/M 명성 순위]');
ok(
  'L. 실회원 전체 명성 순위 숨김',
  /Production 실회원: localStorage 기반/.test(rankJs) &&
    /syncRankEntryVisibility/.test(rankJs) &&
    /isAuthenticatedMemberViewer/.test(rankJs),
);
ok(
  'M. Guest 체험용 명성 예시',
  /체험용 명성 예시/.test(rankJs) && /guestDemoTitle/.test(rankJs),
);

console.log('\n[N/O/P 정치성향]');
ok(
  'N. 실회원 프로필 localStorage 성향 미사용',
  /sc_political_scores_v1|user_alignment_state\.score/.test(indexHtml) &&
    /alignmentDataUnavailable = true/.test(indexHtml),
);
ok(
  'O. 34/33/33 실회원 기본 금지',
  /createAuthenticatedProfileBase/.test(indexHtml) &&
    /alignmentDataUnavailable: true/.test(indexHtml) &&
    !/createAuthenticatedProfileBase[\s\S]{0,400}center: 34/.test(indexHtml),
);
ok(
  'P. 타인 politicalAlignmentPrivate 유지',
  /politicalAlignmentPrivate: true/.test(indexHtml) &&
    /politicalAlignmentPrivate/.test(indexHtml),
);

console.log('\n[Activity HUD 문구]');
ok(
  'Activity 제목 최근 활동',
  /sc-activity-feed-title[\s\S]{0,80}최근 활동/.test(indexHtml) ||
    />최근 활동</.test(indexHtml),
);

console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
process.exit(fail ? 1 : 0);
