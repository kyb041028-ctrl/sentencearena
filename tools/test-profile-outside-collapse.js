'use strict';
/**
 * 프로필 바깥 클릭 접기 UX
 * node tools/test-profile-outside-collapse.js
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
  const UA = fs.readFileSync(path.join(__dirname, '../public/user-achievements.js'), 'utf8');

  const dockBlock = INDEX.slice(
    INDEX.indexOf('/** 처음엔 접어 두고'),
    INDEX.indexOf('function profileStorageKey')
  );

  section('기본 구조·접기 함수');
  ok('1. collapseProfilePanel 존재', /function collapseProfilePanel\s*\(/.test(dockBlock));
  ok('2. 수동 접기 animate:true', /collapseProfilePanel\(\{\s*animate:\s*true,\s*source:\s*'MANUAL_BUTTON'\s*\}\)/.test(dockBlock));
  ok('3. 수동 접기 animation 유지', /playProfileFrameCollapseAnimation\(function/.test(dockBlock));
  ok('3b. 바깥 클릭 animate:false', /collapseProfilePanel\(\{\s*animate:\s*false,\s*source:\s*'OUTSIDE_POINTER'\s*\}\)/.test(dockBlock));
  ok('3c. animate:false 시 animation 미호출 분기', /if \(!animate\)\s*\{[\s\S]*?collapsed = true[\s\S]*?return true[\s\S]*?playProfileFrameCollapseAnimation/.test(dockBlock));
  ok('3d. inspect animate flags', /outsideAnimate:\s*false/.test(dockBlock) && /manualAnimate:\s*true/.test(dockBlock));
  ok('4. isProfilePanelOpen', /function isProfilePanelOpen\s*\(/.test(dockBlock));
  ok('5. pointerdown listener', /addEventListener\('pointerdown',\s*handleProfileOutsideInteraction/.test(dockBlock));
  ok('6. preventDefault 없음(outside handler)', !/handleProfileOutsideInteraction[\s\S]{0,400}preventDefault/.test(dockBlock));
  ok('7. stopPropagation 없음(outside handler)', !/handleProfileOutsideInteraction[\s\S]{0,400}stopPropagation/.test(dockBlock));

  section('판정·예외');
  ok('8. dock.contains 내부 판정', /dock\.contains\(/.test(dockBlock));
  ok('9. interaction surface selector', /data-sc-profile-interaction-surface/.test(dockBlock));
  ok('10. 에디터 활성 예외', /sc-profile-layout-editor-active/.test(dockBlock) && /excludedByEditor/.test(dockBlock));
  ok('11. avatar-dock surface 속성', /id="avatar-dock"[\s\S]{0,200}data-sc-profile-interaction-surface/.test(INDEX));
  ok('12. 열기 탭 surface', /id="avatar-dock-tab"[\s\S]{0,120}data-sc-profile-interaction-surface/.test(INDEX));
  ok('13. 대표 업적 모달 surface', /data-sc-profile-interaction-surface/.test(UA) && /sc-featured-achievement-panel/.test(UA));
  ok('14. 활동 목록 모달 surface', /id="sc-user-content-modal"[\s\S]{0,160}data-sc-profile-interaction-surface/.test(INDEX));
  ok('15. 일반 프로필 모달 surface', /id="sc-profile-modal"[\s\S]{0,80}data-sc-profile-interaction-surface/.test(INDEX));
  ok('16. 팔로우 모달 surface', /id="sc-follow-modal"[\s\S]{0,160}data-sc-profile-interaction-surface/.test(INDEX));
  ok('17. 좌표 에디터 surface', /id="profile-layout-editor"[\s\S]{0,80}data-sc-profile-interaction-surface/.test(INDEX));
  ok('18. 에디터 토글 surface', /id="profile-layout-editor-toggle"[\s\S]{0,120}data-sc-profile-interaction-surface/.test(INDEX));

  section('listener·inspect');
  ok('19. listener 중복 방지 guard', /outsideCollapseListenerRegistered/.test(dockBlock) && /if \(outsideCollapseListenerRegistered\) return/.test(dockBlock));
  ok('20. inspect export', /__scInspectProfileOutsideCollapse/.test(dockBlock));
  ok('21. inspect fields', /listenerRegistered/.test(dockBlock) && /collapseCount/.test(dockBlock) && /excludedByInteractionSurface/.test(dockBlock));
  ok('22. window.collapseProfilePanel 노출', /window\.collapseProfilePanel = collapseProfilePanel/.test(dockBlock));
  ok('23. shouldCollapseProfileOnOutsideInteraction', /function shouldCollapseProfileOnOutsideInteraction/.test(dockBlock));
  ok('24. Escape 미추가(임의)', !/keydown[\s\S]{0,80}Escape[\s\S]{0,80}collapseProfilePanel/.test(dockBlock));
  ok('25. PNG·좌표 에디터 로직 미변경 경로 유지', /function setEditorActive/.test(INDEX) && /applyProfileFramePixelLayout/.test(INDEX));

  section('회귀');
  if (process.env.SC_PROFILE_OUTSIDE_UNIT_ONLY === '1') {
    results.push('\n=== SUMMARY ===');
    results.push('PASS: ' + pass + ' / FAIL: ' + fail);
    console.log(results.join('\n'));
    process.exit(fail ? 1 : 0);
  }

  try {
    runChild('test-user-profile-system.js', 'PASS / 0 FAIL', 180000, { SC_PROFILE_UNIT_ONLY: '1' });
    ok('26. user-profile UNIT_ONLY', true);
  } catch (e) {
    ok('26. user-profile UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-featured-achievement-modal-ui.js', 'FAIL: 0', 180000, {
      SC_FEATURED_MODAL_UNIT_ONLY: '1',
    });
    ok('27. featured-achievement-modal UNIT_ONLY', true);
  } catch (e) {
    ok('27. featured-achievement-modal UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-user-content-system.js', 'PASS / 0 FAIL', 180000, { SC_USER_CONTENT_UNIT_ONLY: '1' });
    ok('28. user-content UNIT_ONLY', true);
  } catch (e) {
    ok('28. user-content UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-user-data-system.js', 'PASS / 0 FAIL', 180000, { SC_USER_DATA_UNIT_ONLY: '1' });
    ok('29. user-data UNIT_ONLY', true);
  } catch (e) {
    ok('29. user-data UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-user-event-system.js', 'PASS / 0 FAIL', 180000, { SC_USER_EVENT_UNIT_ONLY: '1' });
    ok('30. user-event UNIT_ONLY', true);
  } catch (e) {
    ok('30. user-event UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-board-core-system.js', 'failed: 0', 180000, {});
    ok('31. board-core', true);
  } catch (e) {
    ok('31. board-core', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-board-compat-system.js', 'failed: 0', 180000, { SC_SKIP_COMPAT_REGRESSION: '1' });
    ok('32. board-compat', true);
  } catch (e) {
    ok('32. board-compat', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-alien-system.js', 'PASS / 0 FAIL', 180000, { SC_ALIEN_UNIT_ONLY: '1' });
    ok('33. alien-system UNIT_ONLY', true);
  } catch (e) {
    ok('33. alien-system UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-territory-evolution-system.js', 'PASS / 0 FAIL', 180000, { SC_TEVO_UNIT_ONLY: '1' });
    ok('34. territory-evolution UNIT_ONLY', true);
  } catch (e) {
    ok('34. territory-evolution UNIT_ONLY', false, String(e.message || e).slice(0, 200));
  }
  try {
    runChild('test-alignment-supabase-system.js', 'failed: 0', 600000, {
      SC_SKIP_COMPAT_REGRESSION: '1',
    });
    ok('35. alignment (1회)', true);
  } catch (e) {
    ok('35. alignment (1회)', false, String(e.message || e).slice(0, 200));
  }

  results.push('\n=== SUMMARY ===');
  results.push((fail === 0 ? 'PASS' : 'FAIL') + ' / ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log(results.join('\n'));
  process.exit(fail ? 1 : 0);
})();
