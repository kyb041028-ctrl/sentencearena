'use strict';
/**
 * 최근 세계 활동 — 왼쪽 map 바깥 · LIVE_SCROLL · pagination 제거
 * node tools/test-world-activity-panel.js
 */

const fs = require('fs');
const path = require('path');
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
    timeout: timeoutMs || 180000,
    env: Object.assign({}, process.env, env || {}),
  });
  if (expectNeedle && out.indexOf(expectNeedle) === -1) {
    throw new Error(script + ' missing: ' + expectNeedle + '\n' + out.slice(-2000));
  }
  return out;
}

(function main() {
  const INDEX = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  const feedStart = INDEX.indexOf("var LS_KEY = 'sc_activity_feed_v1'");
  const feedEnd = INDEX.indexOf("window.__scInspectWorldActivityPanel");
  const feedBlock = feedStart >= 0 && feedEnd > feedStart ? INDEX.slice(feedStart, feedEnd + 200) : '';

  const leftStackIdx = INDEX.indexOf('id="sc-left-side-stack"');
  const rightStackIdx = INDEX.indexOf('id="sc-right-side-stack"');
  const activityIdx = INDEX.indexOf('id="sc-activity-feed-panel"');
  const chatIdx = INDEX.indexOf('id="chat-rail"');
  const leftCss = (INDEX.match(/\.sc-left-side-stack\s*\{[^}]+\}/) || [''])[0];
  const listCss = (INDEX.match(/\.sc-activity-feed__list\s*\{[^}]+\}/) || [''])[0];
  const feedCss = (INDEX.match(/\.sc-activity-feed\s*\{[^}]+\}/) || [''])[0];

  section('지도 비침범');
  ok('1. 왼쪽 rail 존재', leftStackIdx > 0 && activityIdx > leftStackIdx);
  ok('2. 오른쪽 stack에 없음', rightStackIdx > 0 && !(activityIdx > rightStackIdx && activityIdx < chatIdx));
  ok('3-5. gap/overlaps 검사', /gapToMap/.test(feedBlock) && /overlapsMap/.test(feedBlock) && /ACTIVITY_GAP_PX = 16/.test(feedBlock));
  ok('6. 음수 margin 없음', !/margin(?:-left|-right)?:\s*-/.test(leftCss) && !/margin(?:-left|-right)?:\s*-/.test(feedCss));
  ok('7. 지도 방향 transform 없음', !/transform:/.test(leftCss) && !/transform:\s*translate/.test(feedCss));
  ok('8. 지도 wrapper·SVG 미변경', /--map-aspect-w:\s*1024/.test(INDEX) && /viewBox="0 0 1600 900"/.test(INDEX));
  ok('9-10. 여백 부족 is-insufficient · 지도 위 미이동', /is-insufficient/.test(INDEX) && /stack\.style\.left = left \+ 'px'/.test(feedBlock));
  ok('JS가 stack에 width/left 직접 설정', /stack\.style\.width = width \+ 'px'/.test(feedBlock));
  ok('로컬 --sc-left-rail-max 그림자 제거', !/--sc-left-rail-max:\s*16\.5rem/.test(leftCss));

  section('위치');
  ok('11. bottom 기준 고정 제거', !/bottom:\s*calc\(var\(--sc-hud-safe-bottom\)\s*\+\s*var\(--sc-hud-tab-h\)/.test(leftCss));
  ok('12. top 기준 배치', /stack\.style\.top = top \+ 'px'/.test(feedBlock) || /applyActivityPanelPos/.test(feedBlock));
  ok('13. ACTIVITY_TOP_OFFSET 0~16', /ACTIVITY_TOP_OFFSET = 4/.test(feedBlock) && !/ACTIVITY_TOP_OFFSET = 110/.test(feedBlock));
  ok('14-16. 수동 위치 우선 (에디터 드래그·자동저장)', /LS_POS_KEY = 'sc_world_activity_panel_pos_v1'/.test(feedBlock) && /saveActivityPanelPos/.test(feedBlock));
  ok('activity panel pos autosave key', /sc_world_activity_panel_pos_v1/.test(feedBlock));
  ok('activity panel drag editor hook', /__scSetActivityPanelLayoutEditorActive/.test(INDEX));
  ok('saved pos preferred in sync', /loadActivityPanelPos\(\)/.test(feedBlock) && /applyActivityPanelPos/.test(feedBlock));
  ok('editor hint autosave', /세계 활동.*자동 저장|자동 저장.*세계 활동|드래그하면 위치가 자동 저장/.test(INDEX));

  section('pagination 제거');
  ok('17-19. 이전/다음/페이지 UI 없음', !/이전 활동 페이지/.test(INDEX) && !/다음 활동 페이지/.test(INDEX) && !/id="sc-activity-feed-pager"/.test(INDEX));
  ok('20. activityPage 제거', !/activityPage/.test(feedBlock));
  ok('21. pageSize slice 없음', !/PAGE_SIZE/.test(feedBlock) && !/getActivityFeedSlice/.test(feedBlock));
  ok('22. pagination enabled:false', /pagination:\s*\{\s*enabled:\s*false/.test(feedBlock));

  section('실시간 목록');
  ok('23-24. unshift prepend', /list\.unshift\(item\)/.test(feedBlock));
  ok('25. MAX_STORE 30', /var MAX_STORE = 30/.test(feedBlock));
  ok('26. dedupe 30초', /var DEDUPE_MS = 30000/.test(feedBlock));
  ok('27-28. 고정 높이', /height:\s*16\.5rem/.test(feedCss) && /max-height:\s*16\.5rem/.test(feedCss));
  ok('29. LIVE_SCROLL', /mode:\s*'LIVE_SCROLL'/.test(feedBlock));

  section('스크롤');
  ok('30. overflow-y auto', /overflow-y:\s*auto/.test(listCss));
  ok('31. overflow-x hidden', /overflow-x:\s*hidden/.test(listCss));
  ok('32. overscroll-behavior contain', /overscroll-behavior:\s*contain/.test(listCss));
  ok('33-34. header 고정·목록만 스크롤', /sc-activity-feed__head[\s\S]*?flex:\s*0 0 auto/.test(INDEX) && /sc-activity-feed__list[\s\S]*?overflow-y:\s*auto/.test(INDEX));
  ok('36-38. scroll preserve', /preserveScroll/.test(feedBlock) && /captureActivityScrollState/.test(feedBlock) && /restoreActivityScrollState/.test(feedBlock));
  ok('39. 접기 후 scroll 유지', /listEl\.scrollTop = prevScroll/.test(feedBlock));

  section('프로필·채팅');
  ok('40-41. z-index 관계', /\.avatar-dock\s*\{[\s\S]*?z-index:\s*50/.test(INDEX) && /\.sc-left-side-stack\s*\{[\s\S]*?z-index:\s*35/.test(INDEX));
  ok('42. outside animate:false', /animate:\s*false,\s*source:\s*'OUTSIDE_POINTER'/.test(INDEX));
  ok('43-45. 채팅 독립·세로 탭 숨김', /sc-right-side-stack[\s\S]{0,200}chat-rail/.test(INDEX.slice(rightStackIdx, rightStackIdx + 400)) && /body\.sc-app-mode \.chat-dock:not\(\.chat-dock--collapsed\) \.chat-rail__tab\s*\{\s*display:\s*none/.test(INDEX));

  section('회귀');
  if (process.env.SC_WORLD_ACTIVITY_UNIT_ONLY === '1') {
    results.push('\n=== SUMMARY ===');
    results.push('PASS: ' + pass + ' / FAIL: ' + fail);
    console.log(results.join('\n'));
    process.exit(fail ? 1 : 0);
  }

  const regs = [
    ['47', 'test-profile-outside-collapse.js', 'PASS', { SC_PROFILE_OUTSIDE_UNIT_ONLY: '1' }],
    ['48', 'test-user-profile-system.js', 'PASS / 0 FAIL', { SC_PROFILE_UNIT_ONLY: '1' }],
    ['49', 'test-featured-achievement-modal-ui.js', 'FAIL: 0', { SC_FEATURED_MODAL_UNIT_ONLY: '1' }],
    ['50', 'test-user-content-system.js', 'PASS / 0 FAIL', { SC_USER_CONTENT_UNIT_ONLY: '1' }],
    ['51', 'test-user-data-system.js', 'PASS / 0 FAIL', { SC_USER_DATA_UNIT_ONLY: '1' }],
    ['52', 'test-user-event-system.js', 'PASS / 0 FAIL', { SC_USER_EVENT_UNIT_ONLY: '1' }],
    ['53', 'test-board-core-system.js', 'failed: 0', {}],
    ['54', 'test-board-compat-system.js', 'failed: 0', { SC_SKIP_COMPAT_REGRESSION: '1' }],
    ['55', 'test-alien-system.js', 'PASS / 0 FAIL', { SC_ALIEN_UNIT_ONLY: '1' }],
    ['56', 'test-territory-evolution-system.js', 'PASS / 0 FAIL', { SC_TEVO_UNIT_ONLY: '1' }],
    ['57', 'test-alignment-supabase-system.js', 'failed: 0', { SC_SKIP_COMPAT_REGRESSION: '1' }],
  ];
  regs.forEach(function (r) {
    try {
      runChild(r[1], r[2], r[0] === '57' ? 900000 : 180000, r[3]);
      ok(r[0] + '. ' + r[1].replace('test-', '').replace('.js', ''), true);
    } catch (e) {
      ok(r[0] + '. ' + r[1].replace('test-', '').replace('.js', ''), false, String(e.message || e).slice(0, 200));
    }
  });

  results.push('\n=== SUMMARY ===');
  results.push((fail === 0 ? 'PASS' : 'FAIL') + ' / ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log(results.join('\n'));
  process.exit(fail ? 1 : 0);
})();
