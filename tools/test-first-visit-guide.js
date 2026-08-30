#!/usr/bin/env node
'use strict';

/**
 * 신규 회원 첫 방문 안내 — 노출 규칙 · 문구 · 저장 · 회귀 정적 검증
 */

const fs = require('fs');
const path = require('path');

const core = require('../shared/first-visit-guide-core');
const { createFirstVisitGuideService, isMissingColumnError } = require('../server/first-visit-guide-service');
const { createFirstVisitGuideRouter } = require('../server/first-visit-guide-routes');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const root = path.join(__dirname, '..');
const read = function (rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
};

function forbiddenHits(text) {
  const src = String(text || '');
  const hits = [];
  if (/\b360\b/.test(src)) hits.push('360');
  if (/\b160\b/.test(src)) hits.push('160');
  if (/가중치/.test(src)) hits.push('가중치');
  if (/원점수/.test(src)) hits.push('원점수');
  if (/연속\s*2회/.test(src)) hits.push('연속 2회');
  if (/일일\s*제한/.test(src)) hits.push('일일 제한');
  if (/\+0\.8|\-1\.2|\+1\.2|\-0\.8/.test(src)) hits.push('반응 증감 수치');
  return hits;
}

// 1. 기존 회원은 자동 노출하지 않음
assert(
  core.shouldAutoShow({
    eligibleAt: null,
    completedAt: null,
    sessionPending: false,
    justFinishedSignupFlow: false,
  }) === false,
  'existing member without eligible skips auto guide',
);

// 2. 신규(eligible) 미완료는 노출
assert(
  core.shouldAutoShow({
    eligibleAt: '2026-08-30T00:00:00.000Z',
    completedAt: null,
  }) === true,
  'eligible pending shows guide',
);

// 3. 완료하면 재노출 없음
assert(
  core.shouldAutoShow({
    eligibleAt: '2026-08-30T00:00:00.000Z',
    completedAt: '2026-08-30T00:05:00.000Z',
    sessionPending: true,
  }) === false,
  'completed never auto-shows again',
);

// 4. 가입 직후 세션/플래그만으로도 노출 (컬럼 미적용 폴백)
assert(
  core.shouldAutoShow({
    eligibleAt: null,
    completedAt: null,
    justFinishedSignupFlow: true,
  }) === true,
  'just finished signup shows guide',
);
assert(
  core.shouldAutoShow({
    eligibleAt: null,
    completedAt: null,
    sessionPending: true,
  }) === true,
  'session pending shows guide',
);

// 5. 가입 전에는 노출 조건이 없음
assert(
  core.shouldAutoShow({}) === false,
  'empty state does not show before signup',
);

// 6. 중앙광장 힌트는 가이드 완료 후 1회
assert(
  core.shouldShowCentralHint({
    completedAt: '2026-08-30T00:05:00.000Z',
    centralHintSeenAt: null,
  }) === true,
  'hint after guide complete',
);
assert(
  core.shouldShowCentralHint({
    completedAt: '2026-08-30T00:05:00.000Z',
    centralHintSeenAt: '2026-08-30T00:06:00.000Z',
  }) === false,
  'hint not repeated after seen',
);
assert(
  core.shouldShowCentralHint({
    completedAt: null,
    justFinishedGuide: false,
  }) === false,
  'existing member does not get central hint',
);

// 7. 마지막 버튼 · 중앙광장 진입
assert(core.STEPS.length === 3, 'three steps');
assert(core.STEPS[2].nextLabel === '중앙광장 시작하기', 'final button label');
assert(core.CENTRAL_TERRITORY_ID === 'COMMON', 'central plaza id');

// 8. 온보딩 문구에 내부 계산 수치 없음
const copyHits = forbiddenHits(core.allCopyText());
assert(copyHits.length === 0, 'first-visit copy leaks ' + copyHits.join(','));

// 9. 상세 도움말에도 성향 계산식/수치 없음
const guideSrc = read('public/permissions-guide.js');
const guideHits = forbiddenHits(guideSrc);
assert(guideHits.length === 0, 'permissions-guide leaks ' + guideHits.join(','));
assert(guideSrc.indexOf('점수가 +360') === -1, 'no +360 territory move copy');
assert(guideSrc.indexOf('SentenceArena 이용 안내') !== -1, 'help has basic usage');
assert(guideSrc.indexOf('개척영토') !== -1 && guideSrc.indexOf('수호영토') !== -1, 'help has three territories');
assert(guideSrc.indexOf('외계행성은 정치성향 영토가 아닙니다') !== -1, 'help explains alien');
assert(guideSrc.indexOf('공감') !== -1 && guideSrc.indexOf('좋아요') !== -1, 'help explains reactions');
assert(guideSrc.indexOf('일반 신고') !== -1, 'help explains reports');
assert(guideSrc.indexOf('질서·개혁') === -1, 'old faction labels removed from help');

// 10. 잘못된 문구 / 게스트 문구
const index = read('public/index.html');
assert(index.indexOf('← 영토 지도로') !== -1, 'board back uses 영토 지도로');
assert(index.indexOf('영토 선택으로') === -1, 'no 영토 선택으로');
assert(index.indexOf('게스트로 둘러보는 중') !== -1, 'guest label user-facing');
assert(index.indexOf('소셜 로그인 없이 UI만') === -1, 'dev guest copy removed');
assert(index.indexOf('first-visit-guide-core.js') !== -1, 'core script loaded');
assert(index.indexOf('first-visit-guide-ui.js') !== -1, 'ui script loaded');
assert(index.indexOf('id="sc-central-first-hint"') !== -1, 'central hint in board');
assert(index.indexOf('ScFirstVisitGuideUI.onBoardOpened') !== -1, 'goBoard notifies first-visit UI');

const entry = read('public/app-entry.js');
assert(entry.indexOf('showFirstVisitGuide') !== -1, 'entry has first visit');
assert(entry.indexOf('enterCentralPlazaFromGuide') !== -1, 'entry enters central plaza');
assert(/afterActivityName[\s\S]{0,400}showFirstVisitGuide/.test(entry), 'activity name → first visit');
assert(/needsFirstVisitGuide[\s\S]{0,250}showFirstVisitGuide/.test(entry), 'eligible returning new member sees guide');
assert(/needsActivityNameOnboarding[\s\S]{0,200}showActivityName/.test(entry), 'activity name still before first visit');
assert(entry.indexOf('auth.js') === -1, 'app-entry does not load auth.js internals');

const ui = read('public/first-visit-guide-ui.js');
assert(ui.indexOf('중앙광장 시작하기') === -1 || core.STEPS[2].nextLabel === '중앙광장 시작하기', 'final CTA from core');
assert(ui.indexOf('/api/me/first-visit/complete') !== -1, 'complete API used');
assert(ui.indexOf('goBoard') === -1, 'UI does not open board itself');

// 11. SQL additive, 기존 행 미변경
const sql = read('supabase/migration_first_visit_guide_v1.sql');
assert(/ADD COLUMN IF NOT EXISTS first_visit_guide_eligible_at/.test(sql), 'eligible column');
assert(/ADD COLUMN IF NOT EXISTS first_visit_guide_completed_at/.test(sql), 'completed column');
assert(/ADD COLUMN IF NOT EXISTS central_plaza_hint_seen_at/.test(sql), 'hint column');
const sqlBody = sql.replace(/--[^\n]*/g, '');
assert(!/\bDROP TABLE\b/.test(sqlBody), 'no drop table');
assert(!/\bTRUNCATE\b/.test(sqlBody), 'no truncate');
assert(!/UPDATE public\.profiles SET/.test(sqlBody), 'no backfill update');
assert(/PROFILES_FIRST_VISIT_GUIDE_CLIENT_WRITE_FORBIDDEN/.test(sql), 'client write protected');

const migCore = read('shared/production-public-migration-core.js');
assert(/migration_first_visit_guide_v1\.sql/.test(migCore), 'catalog includes first visit sql');

// 12. 성향 계산 / 자동 영토 이동 / auth.js 미변경 경로
assert(read('public/auth.js').indexOf('first-visit') === -1, 'auth.js has no first-visit');
assert(read('shared/political-alignment-bidirectional-sim-core.js').indexOf('first_visit_guide') === -1, 'alignment sim untouched');
const betaFiles = [
  'shared/political-alignment-gradual-sim-core.js',
  'public/alignment-territory-rules.js',
  'public/political-orientation-simulation.js',
].filter(function (rel) {
  return fs.existsSync(path.join(root, rel));
});
betaFiles.forEach(function (rel) {
  const src = read(rel);
  assert(src.indexOf('first_visit_guide') === -1, rel + ' not coupled to first visit');
});

// 13. 서비스: 컬럼 없으면 실패하지 않음
assert(isMissingColumnError({ code: 'PGRST204' }) === true, 'PGRST204 is missing column');
assert(isMissingColumnError({ code: '42703' }) === true, '42703 is missing column');

function makeAdmin(store, missing) {
  return {
    from: function () {
      const self = {
        _patch: null,
        select: function () {
          return self;
        },
        eq: function (k, v) {
          self._id = v;
          return self;
        },
        is: function (col, val) {
          self._is = [col, val];
          return self;
        },
        update: function (patch) {
          self._patch = patch;
          return self;
        },
        maybeSingle: async function () {
          if (missing) return { data: null, error: { code: 'PGRST204', message: 'column does not exist' } };
          return { data: store[self._id] || {}, error: null };
        },
        then: function (resolve, reject) {
          return (async function () {
            if (missing) return { data: null, error: { code: 'PGRST204', message: 'column does not exist' } };
            const row = store[self._id] || (store[self._id] = {});
            if (self._patch) {
              Object.keys(self._patch).forEach(function (k) {
                if (self._is && self._is[0] === k && row[k] != null) return;
                if (row[k] == null) row[k] = self._patch[k];
              });
            }
            return { data: row, error: null };
          })().then(resolve, reject);
        },
      };
      return self;
    },
  };
}

(async function () {
  const store = {};
  const svc = createFirstVisitGuideService({
    getAdminClient: function () {
      return makeAdmin(store, false);
    },
  });
  const elig = await svc.markEligible('user-new');
  assert(elig.ok && elig.persisted, 'eligible persisted');
  const state1 = await svc.loadState('user-new');
  assert(state1.shouldShowGuide === true, 'new member should see guide');
  const done = await svc.markGuideCompleted('user-new');
  assert(done.ok && done.persisted, 'complete persisted');
  const state2 = await svc.loadState('user-new');
  assert(state2.shouldShowGuide === false, 'completed hides guide');
  const again = await svc.markGuideCompleted('user-new');
  assert(again.ok, 'second complete does not throw');
  assert(store['user-new'].first_visit_guide_completed_at === state2.completedAt, 'completed_at not overwritten');

  const missingSvc = createFirstVisitGuideService({
    getAdminClient: function () {
      return makeAdmin({}, true);
    },
  });
  const miss = await missingSvc.markEligible('user-x');
  assert(miss.ok === true && miss.persisted === false, 'missing column is soft fail');
  const missState = await missingSvc.loadState('user-x');
  assert(missState.shouldShowGuide === false, 'missing column reads as not eligible');

  const legacy = { id: 'legacy', signup_completed_at: '2026-01-01T00:00:00.000Z' };
  const pub = core.toPublicFromProfile(legacy);
  assert(pub.shouldShowGuide === false, 'legacy profile without eligible is existing user');

  const router = createFirstVisitGuideRouter({
    resolveActor: async function () {
      return { userId: 'user-new' };
    },
    service: svc,
  });
  assert(typeof router === 'function', 'router is express handler');

  console.log('PASS first-visit guide');
})().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
