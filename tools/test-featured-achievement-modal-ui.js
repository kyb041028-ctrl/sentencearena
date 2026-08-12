'use strict';
/**
 * 대표 업적 선택 모달 UI — 상단 미리보기 · 하단 획득 기록 체크 · 확정 시 저장
 * node tools/test-featured-achievement-modal-ui.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

let pass = 0;
let fail = 0;
const results = [];

function ok(label, condition, detail) {
  if (condition) {
    results.push('  PASS: ' + label);
    pass++;
  } else {
    results.push('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

function section(title) {
  results.push('\n[' + title + ']');
}

function runChild(script, expectNeedle, timeoutMs, env) {
  const out = execFileSync(process.execPath, [path.join(__dirname, script)], {
    encoding: 'utf8',
    timeout: timeoutMs || 120000,
    env: Object.assign({}, process.env, env || {}),
  });
  if (expectNeedle && out.indexOf(expectNeedle) === -1) {
    throw new Error(script + ' missing: ' + expectNeedle + '\n' + out.slice(-2000));
  }
  return out;
}

function loadUserAchievements() {
  const defsCode = fs.readFileSync(
    path.join(__dirname, '../public/achievement-definitions.js'),
    'utf8'
  );
  const achCode = fs.readFileSync(path.join(__dirname, '../public/user-achievements.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    parseInt,
    isFinite,
    Infinity,
    NaN,
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  const sessionMem = {};
  sandbox.sessionStorage = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(sessionMem, k) ? sessionMem[k] : null;
    },
    setItem: function (k, v) {
      sessionMem[k] = String(v);
    },
    removeItem: function (k) {
      delete sessionMem[k];
    },
  };
  sandbox.document = {
    getElementById: function () {
      return null;
    },
    createElement: function (t) {
      return {
        tagName: t,
        style: {},
        classList: {
          add: function () {},
          remove: function () {},
          contains: function () {
            return false;
          },
        },
        setAttribute: function () {},
        getAttribute: function () {
          return null;
        },
        appendChild: function () {},
        querySelector: function () {
          return null;
        },
        addEventListener: function () {},
        textContent: '',
        innerHTML: '',
        hidden: true,
        dataset: {},
      };
    },
    body: {
      appendChild: function () {},
      classList: { add: function () {}, remove: function () {} },
    },
    addEventListener: function () {},
  };
  vm.runInNewContext(defsCode + '\n' + achCode, sandbox);
  return sandbox;
}

(function main() {
  const INDEX = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const UA = fs.readFileSync(path.join(__dirname, '../public/user-achievements.js'), 'utf8');
  const DEFS = fs.readFileSync(
    path.join(__dirname, '../public/achievement-definitions.js'),
    'utf8'
  );

  const previewCss = (INDEX.match(/\.sc-featured-preview\s*\{[\s\S]*?\n\s*\}/) || [''])[0];
  const histRowCss = (INDEX.match(/\.sc-achievement-history-row\s*\{[\s\S]*?\n\s*\}/) || [''])[0];
  const histSelectCss = (INDEX.match(/\.sc-achievement-history-row__select\s*\{[\s\S]*?\n\s*\}/) || [
    '',
  ])[0];
  const histCheckCss = (INDEX.match(/\.sc-achievement-history-row__check\s*\{[\s\S]*?\n\s*\}/) || [
    '',
  ])[0];
  const histCss = (INDEX.match(/\.sc-featured-achievement-panel__history\s*\{[\s\S]*?\n\s*\}/) || [
    '',
  ])[0];
  const bodyCss = (INDEX.match(/\.sc-featured-achievement-panel__body\s*\{[\s\S]*?\n\s*\}/) || [
    '',
  ])[0];
  const previewNameCss = (INDEX.match(/\.sc-featured-preview__name\s*\{[\s\S]*?\n\s*\}/) || [''])[0];

  section('상단 미리보기');
  ok('1. 상단 3슬롯 grid', /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(previewCss));
  ok('2. FEATURED_MAX 루프로 3슬롯', /for \(i = 0; i < FEATURED_MAX; i\+\+\)/.test(UA) && /sc-featured-preview__slot/.test(UA));
  ok('3. 빈 슬롯 문구', /선택 대기/.test(UA) && /is-empty/.test(UA));
  ok('4. 상단 체크박스 없음', !/#sc-featured-preview[\s\S]{0,400}checkbox/.test(UA) && /hasCheckboxes/.test(UA));
  ok('5. 상단 클릭 선택 없음', !/sc-featured-preview[\s\S]{0,200}toggleFeatured/.test(UA));
  ok('6. draft 순서 슬롯 배치', /featuredDraftKeys\[i\]/.test(UA));
  ok('7. 미리보기 제목 2줄', /-webkit-line-clamp:\s*2/.test(previewNameCss));
  ok('8. 슬롯 동일 높이', /min-height:\s*5\.75rem/.test(INDEX));
  ok('9. 상단 선택 목록 DOM 제거', !/id="sc-featured-achievement-list"/.test(UA));
  ok('10. PNG 경로 기존 유지', /\/assets\/achievements\//.test(UA));

  section('하단 선택·draft');
  ok('11. 하단 history 3열 grid', /grid-template-columns:\s*auto minmax\(0,\s*1fr\) 2\.75rem/.test(histRowCss));
  ok('12. selection 우측 고정', /justify-self:\s*end/.test(histSelectCss) && /width:\s*2\.75rem/.test(histSelectCss));
  ok('13. checkbox absolute 없음', !/position:\s*absolute/.test(histCheckCss) && !/position:\s*absolute/.test(histSelectCss));
  ok('14. toggleFeaturedDraftKey 존재', /function toggleFeaturedDraftKey/.test(UA));
  ok('15. 체크 시 setFeaturedAchievementIds 미호출(변경 handler)', /toggleFeaturedDraftKey\(achievementId\)/.test(UA) && !/check\.addEventListener\('change'[\s\S]{0,200}setFeaturedAchievementIds/.test(UA));
  ok('16. 선택 완료 시 confirm/setFeatured', /confirmFeaturedDraftSelection/.test(UA) && /setFeaturedAchievementIds\(featuredDraftKeys/.test(UA));
  ok('17. 닫기는 close만', /data-sc-featured-close[\s\S]{0,120}closeFeaturedAchievementPanel/.test(UA));
  ok('18. 최대 3 안내 문구', /대표 업적은 최대 3개까지 선택할 수 있습니다/.test(UA));
  ok('19. stopPropagation 유지', /stopPropagation/.test(UA));
  ok('20. aria-label 대표 업적', /대표 업적으로 선택/.test(UA));
  ok('21. FEATURED_MAX 3', /var FEATURED_MAX = 3/.test(UA));
  ok('22. 업적 key 정의 유지', /first-post/.test(DEFS) && /category:\s*'ACTIVITY'/.test(DEFS));
  ok('canonical empty helper', /function createEmptyUserAchievementState/.test(UA));
  ok('member/guest buckets', /var memberAchievementState/.test(UA) && /var guestAchievementState/.test(UA));
  ok('no date seed filter', !/isSeedMockAchievementRecord/.test(UA) && !/getOwnedCurrentAchievementRecords/.test(UA));

  section('draft 로직 동작');
  const g = loadUserAchievements();
  ok('23. 모듈 로드', typeof g.toggleFeaturedDraftKey === 'function' && typeof g.confirmFeaturedDraftSelection === 'function');

  // open-like: seed draft via exported helpers after granting via mock reset path
  if (typeof g.__scResetUserAchievementMock === 'function') g.__scResetUserAchievementMock();
  const ids = ['first-post', 'first-comment', 'first-empathy-received', 'steady-footsteps'];
  for (let i = 0; i < 3; i++) {
    g.grantCurrentUserAchievement(ids[i], { source: 'DEBUG' });
  }
  g.grantCurrentUserAchievement(ids[3], {
    source: 'DEBUG',
    seasonId: g.MOCK_TEST_SEASON_ID,
  });
  g.clearFeaturedAchievements();
  const savedCleared = g.getCurrentUserFeaturedAchievementIds();
  ok('24. clear 후 저장값 빈 배열', Array.isArray(savedCleared) && savedCleared.length === 0);

  let t1 = g.toggleFeaturedDraftKey(ids[0]);
  let t2 = g.toggleFeaturedDraftKey(ids[1]);
  ok('25. draft 체크 추가', t1.ok && t2.ok && g.getFeaturedDraftKeys().length === 2);
  ok('26. 체크 중 실제 저장 미변경', g.getCurrentUserFeaturedAchievementIds().length === 0);
  let t3 = g.toggleFeaturedDraftKey(ids[2]);
  ok('27. 3개까지 draft 가능', t3.ok && g.getFeaturedDraftKeys().length === 3);
  let blocked = g.toggleFeaturedDraftKey(ids[3]);
  ok('28. 네 번째 차단', blocked && blocked.ok === false && /최대 3개/.test(blocked.message || ''));
  let un = g.toggleFeaturedDraftKey(ids[0]);
  ok('29. 해제 후 앞쪽 정렬', un.ok && g.getFeaturedDraftKeys()[0] === ids[1] && g.getFeaturedDraftKeys().length === 2);
  let re = g.toggleFeaturedDraftKey(ids[0]);
  ok('30. 재선택 시 마지막 슬롯', re.ok && g.getFeaturedDraftKeys()[2] === ids[0]);
  const confirm = g.confirmFeaturedDraftSelection();
  ok('31. 선택 완료 저장', confirm.ok && g.getCurrentUserFeaturedAchievementIds().length === 3);
  ok('32. 저장 순서 유지', g.getCurrentUserFeaturedAchievementIds().join(',') === g.getFeaturedDraftKeys().join(','));

  const savedSnap = g.getCurrentUserFeaturedAchievementIds().slice();
  g.toggleFeaturedDraftKey(savedSnap[0]);
  ok('33. draft만 변경 시 saved 유지', g.getCurrentUserFeaturedAchievementIds().join(',') === savedSnap.join(','));

  section('실회원 canonical state');
  ok('empty copy', /아직 획득한 업적이 없습니다/.test(UA));
  g.__scResetUserAchievementMock();
  g.__scAuthUserId = '8cead2ab-0000-4000-8000-000000000001';
  g.__scUserProfileCache = { authUser: { id: g.__scAuthUserId } };
  const authCanon = g.getCurrentUserAchievementData();
  ok('auth canonical current 0', Array.isArray(authCanon.currentAchievements) && authCanon.currentAchievements.length === 0);
  ok('auth canonical featured 0', Array.isArray(authCanon.featuredAchievementIds) && authCanon.featuredAchievementIds.length === 0);
  ok('auth history 0', g.getCurrentUserAchievementHistory().length === 0);
  ok('auth owned 0', g.getCurrentUserAchievements().length === 0);
  ok('auth mock id not owned', g.hasCurrentUserAchievement('territory-citizen') === false);
  ok('auth mock id 2 not owned', g.hasCurrentUserAchievement('beta-citizen') === false);
  ok(
    'auth no mock acquiredAt in canonical',
    !authCanon.currentAchievements.some(function (r) {
      return String(r.acquiredAt || '') === '2026-07-10T05:00:00.000Z';
    }),
  );
  const grantSameId = g.grantCurrentUserAchievement('territory-citizen', { source: 'DEBUG' });
  ok('auth can grant former mock id', !!(grantSameId && grantSameId.granted));
  const afterGrantOne = g.getCurrentUserAchievementData();
  ok('auth after 1 grant canonical 1', afterGrantOne.currentAchievements.length === 1);
  ok(
    'auth grant uses real acquiredAt',
    afterGrantOne.currentAchievements[0].achievementId === 'territory-citizen' &&
      String(afterGrantOne.currentAchievements[0].acquiredAt) !== '2026-07-10T05:00:00.000Z',
  );
  g.__scResetUserAchievementMock();
  g.__scAuthUserId = '8cead2ab-0000-4000-8000-000000000001';
  g.__scUserProfileCache = { authUser: { id: g.__scAuthUserId } };
  g.grantCurrentUserAchievement('first-post', { source: 'DEBUG' });
  g.grantCurrentUserAchievement('first-comment', { source: 'DEBUG' });
  const authHist = g.getCurrentUserAchievementHistory();
  const authCanon2 = g.getCurrentUserAchievementData();
  ok('auth granted canonical 2', authCanon2.currentAchievements.length === 2);
  ok('auth granted history 2', authHist.length === 2);
  ok(
    'auth no leftover mock titles',
    !authHist.some(function (h) {
      return h.achievementId === 'empathy-from-many' || h.achievementId === 'beta-citizen';
    }),
  );
  ok(
    'auth no catalog dump',
    !authHist.some(function (h) {
      return h.achievementId === 'steady-footsteps';
    }),
  );
  ok('featured picker uses owned only', g.getCurrentUserFeaturedAchievementIds().length === 0);
  g.__scAuthUserId = null;
  g.__scUserProfileCache = null;
  g.__scResetUserAchievementMock();
  ok('guest mock kept', g.getCurrentUserAchievements().length === 3);
  ok('guest mock id owned', g.hasCurrentUserAchievement('territory-citizen') === true);

  g.__scResetUserAchievementMock();
  g.__scAuthUserId = 'aaaaaaaa-0000-4000-8000-00000000000a';
  g.__scUserProfileCache = { authUser: { id: g.__scAuthUserId } };
  g.grantCurrentUserAchievement('first-post', { source: 'DEBUG' });
  ok('member A granted 1', g.getCurrentUserAchievementData().currentAchievements.length === 1);
  g.__scAuthUserId = 'bbbbbbbb-0000-4000-8000-00000000000b';
  g.__scUserProfileCache = { authUser: { id: g.__scAuthUserId } };
  const memberB = g.getCurrentUserAchievementData();
  ok('member B canonical 0', memberB.currentAchievements.length === 0);
  ok('member B no A grant', g.hasCurrentUserAchievement('first-post') === false);

  g.__scResetUserAchievementMock();
  g.__scAuthUserId = '8cead2ab-0000-4000-8000-000000000001';
  g.__scUserProfileCache = { authUser: { id: g.__scAuthUserId } };
  g.sessionStorage.setItem('sc_sb_guest_ok', '1');
  ok('auth wins leftover guest flag', g.getCurrentUserAchievements().length === 0);
  ok('auth leftover guest not mock', g.hasCurrentUserAchievement('territory-citizen') === false);
  g.grantCurrentUserAchievement('first-comment', { source: 'DEBUG' });
  ok('auth leftover guest still member grant', g.getCurrentUserAchievements().length === 1);
  g.sessionStorage.removeItem('sc_sb_guest_ok');
  g.__scAuthUserId = null;
  g.__scUserProfileCache = null;
  g.__scResetUserAchievementMock();

  section('탭·pagination 유지');
  ok('34. pageSize 5', /HISTORY_PAGE_SIZE = 5/.test(UA));
  ok('35. category 변경 page=1', /historyUiState\.page = 1/.test(UA) && /data-history-category/.test(UA));
  ok('36. history scrollbar 없음', /overflow:\s*visible/.test(histCss) && /max-height:\s*none/.test(histCss));
  ok('37. 본문 단일 scroll', /overflow-y:\s*auto/.test(bodyCss));
  ok('38. pagination 함수 유지', /function renderHistoryPagination/.test(UA));
  ok('39. 정렬 acquiredAt/sequence', /parseAcquiredDate/.test(UA) && /acquisitionSequence/.test(UA));
  ok('40. draft·historyUiState 분리', /var featuredDraftKeys/.test(UA) && /var historyUiState/.test(UA));

  const sampleHistory = [];
  for (let n = 0; n < 11; n++) {
    sampleHistory.push({
      achievementId: 'a' + n,
      category: n % 2 ? 'GROWTH' : 'ACTIVITY',
      acquiredAt: '2026-07-' + String(30 - n).padStart(2, '0') + 'T10:00:00.000Z',
      acquisitionSequence: 11 - n,
    });
  }
  const page1 = g.paginateAcquisitionHistory(sampleHistory, 1, 5);
  ok('41. pagination slice', page1.items.length === 5 && page1.totalPages === 3);

  section('inspect');
  const insp = g.inspectFeaturedAchievementModal();
  ok('42. selectedPreview.slotCount 3', insp.selectedPreview && insp.selectedPreview.slotCount === 3);
  ok('43. acquisitionSelection checkboxSource', insp.acquisitionSelection && insp.acquisitionSelection.checkboxSource === 'ACQUISITION_HISTORY');
  ok('44. savedOnlyOnConfirm', insp.state && insp.state.savedOnlyOnConfirm === true);
  ok('45. selectionPersistsAcrossPages', insp.state.selectionPersistsAcrossPages === true);
  ok('46. history internalScrollbar false', insp.acquisitionHistory.internalScrollbar === false);

  section('회귀 UNIT_ONLY');
  if (process.env.SC_FEATURED_MODAL_UNIT_ONLY === '1') {
    results.push('\n=== SUMMARY ===');
    results.push('PASS: ' + pass + ' / FAIL: ' + fail);
    console.log(results.join('\n'));
    process.exit(fail ? 1 : 0);
  }

  try {
    runChild('test-user-profile-system.js', 'PASS / 0 FAIL', 180000, { SC_PROFILE_UNIT_ONLY: '1' });
    ok('47. user-profile UNIT_ONLY', true);
  } catch (e) {
    ok('47. user-profile UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-user-content-system.js', 'PASS / 0 FAIL', 180000, { SC_USER_CONTENT_UNIT_ONLY: '1' });
    ok('48. user-content UNIT_ONLY', true);
  } catch (e) {
    ok('48. user-content UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-user-data-system.js', 'PASS / 0 FAIL', 180000, { SC_USER_DATA_UNIT_ONLY: '1' });
    ok('49. user-data UNIT_ONLY', true);
  } catch (e) {
    ok('49. user-data UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-user-event-system.js', 'PASS / 0 FAIL', 180000, { SC_USER_EVENT_UNIT_ONLY: '1' });
    ok('50. user-event UNIT_ONLY', true);
  } catch (e) {
    ok('50. user-event UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-board-core-system.js', 'failed: 0', 180000, {});
    ok('51. board-core', true);
  } catch (e) {
    ok('51. board-core', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-board-compat-system.js', 'failed: 0', 180000, { SC_SKIP_COMPAT_REGRESSION: '1' });
    ok('52. board-compat', true);
  } catch (e) {
    ok('52. board-compat', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-alien-system.js', 'PASS / 0 FAIL', 180000, { SC_ALIEN_UNIT_ONLY: '1' });
    ok('53. alien-system UNIT_ONLY', true);
  } catch (e) {
    ok('53. alien-system UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-territory-evolution-system.js', 'PASS / 0 FAIL', 180000, { SC_TEVO_UNIT_ONLY: '1' });
    ok('54. territory-evolution UNIT_ONLY', true);
  } catch (e) {
    ok('54. territory-evolution UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-alignment-supabase-system.js', 'failed: 0', 600000, { SC_SKIP_COMPAT_REGRESSION: '1' });
    ok('55. alignment (1회)', true);
  } catch (e) {
    ok('55. alignment (1회)', false, String(e.message || e).slice(0, 200));
  }

  results.push('\n=== SUMMARY ===');
  results.push((fail === 0 ? 'PASS' : 'FAIL') + ' / ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log(results.join('\n'));
  process.exit(fail ? 1 : 0);
})();
