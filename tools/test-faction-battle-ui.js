'use strict';
/**
 * 진영 전황 UI 단위 테스트
 * SC_FACTION_BATTLE_UNIT_ONLY=1 node tools/test-faction-battle-ui.js
 */

const fs = require('fs');
const path = require('path');
const core = require('../shared/faction-battle-core');

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

function main() {
  const hoverJs = ''; // silence unused
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const uiJs = fs.readFileSync(path.join(__dirname, '../public/faction-battle-ui.js'), 'utf8');
  const coreJs = fs.readFileSync(path.join(__dirname, '../shared/faction-battle-core.js'), 'utf8');

  section('1. 적용 범위');
  ok('1. CENTRAL 지원', core.supportsFactionBattleUi('CENTRAL') === true);
  ok('2. ALIEN 지원', core.supportsFactionBattleUi('ALIEN') === true);
  ok('3. COMMON legacy 지원', core.supportsFactionBattleUi('COMMON') === true);
  ok('4. KANTAPBIYA legacy 지원', core.supportsFactionBattleUi('KANTAPBIYA') === true);
  ok('5. PIONEER 미지원', core.supportsFactionBattleUi('PIONEER') === false);
  ok('6. GUARDIAN 미지원', core.supportsFactionBattleUi('GUARDIAN') === false);
  ok('7. PROGRESSIVE 미지원', core.supportsFactionBattleUi('PROGRESSIVE') === false);
  ok('8. CONSERVATIVE 미지원', core.supportsFactionBattleUi('CONSERVATIVE') === false);

  section('2. Mock·점수');
  const a1 = core.buildDeterministicMockFactions('post_alpha', 'CENTRAL');
  const a2 = core.buildDeterministicMockFactions('post_alpha', 'CENTRAL');
  ok('9. deterministic Mock', JSON.stringify(a1) === JSON.stringify(a2));
  ok('10. dataStatus MOCK', a1.dataStatus === 'MOCK');
  ok('11. Math.random() 호출 없음(core)', !/Math\.random\s*\(/.test(coreJs));
  ok('12. Math.random() 호출 없음(ui)', !/Math\.random\s*\(/.test(uiJs));
  const calc = core.calculateFactionBattleScores(a1.factions);
  ok('13. scores 3진영', Object.keys(calc.scores).length === 3);
  const share = core.normalizeFactionBattleShares(calc.scores);
  const sumShare =
    (share.shares.pioneer || 0) + (share.shares.central || 0) + (share.shares.guardian || 0);
  ok('14. shares ~1', Math.abs(sumShare - (calc.totalScore > 0 ? 1 : 0)) < 0.001);
  ok('15. weights 고정', core.SCORE_WEIGHTS.uniqueReactors === 3 && core.SCORE_WEIGHTS.uniqueCommenters === 4);

  section('3. 상태 판정');
  const insuff = core.determineFactionBattleState(
    core.calculateFactionBattleScores({
      pioneer: { uniqueReactors: 1, positiveReactions: 0, negativeReactions: 0, uniqueCommenters: 0, replyParticipants: 0 },
      central: { uniqueReactors: 0, positiveReactions: 0, negativeReactions: 0, uniqueCommenters: 0, replyParticipants: 0 },
      guardian: { uniqueReactors: 0, positiveReactions: 0, negativeReactions: 0, uniqueCommenters: 0, replyParticipants: 0 },
    })
  );
  ok('16. INSUFFICIENT', insuff.state === 'INSUFFICIENT' && !insuff.winner);

  const dominant = core.determineFactionBattleState(
    core.calculateFactionBattleScores({
      pioneer: { uniqueReactors: 20, positiveReactions: 20, negativeReactions: 10, uniqueCommenters: 12, replyParticipants: 8 },
      central: { uniqueReactors: 2, positiveReactions: 2, negativeReactions: 1, uniqueCommenters: 1, replyParticipants: 1 },
      guardian: { uniqueReactors: 2, positiveReactions: 1, negativeReactions: 1, uniqueCommenters: 1, replyParticipants: 0 },
    })
  );
  ok('17. DOMINANT', dominant.state === 'DOMINANT' && dominant.winner === 'pioneer');

  const leading = core.determineFactionBattleState(
    core.calculateFactionBattleScores({
      pioneer: { uniqueReactors: 8, positiveReactions: 8, negativeReactions: 4, uniqueCommenters: 5, replyParticipants: 3 },
      central: { uniqueReactors: 5, positiveReactions: 5, negativeReactions: 2, uniqueCommenters: 3, replyParticipants: 2 },
      guardian: { uniqueReactors: 3, positiveReactions: 2, negativeReactions: 1, uniqueCommenters: 2, replyParticipants: 1 },
    })
  );
  ok('18. LEADING 또는 DOMINANT', leading.state === 'LEADING' || leading.state === 'DOMINANT');

  const balanced = core.determineFactionBattleState(
    core.calculateFactionBattleScores({
      pioneer: { uniqueReactors: 5, positiveReactions: 5, negativeReactions: 2, uniqueCommenters: 3, replyParticipants: 2 },
      central: { uniqueReactors: 5, positiveReactions: 5, negativeReactions: 2, uniqueCommenters: 3, replyParticipants: 2 },
      guardian: { uniqueReactors: 5, positiveReactions: 5, negativeReactions: 2, uniqueCommenters: 3, replyParticipants: 2 },
    })
  );
  ok('19. BALANCED', balanced.state === 'BALANCED' && !balanced.winner);

  section('4. 용어·독립성');
  ok('20. politics 용어 없음', !/politics|political|orientation|정치성향/.test(coreJs + uiJs));
  ok('21. alignment 계산 미연결', !uiJs.includes('AlignmentScoring') && !coreJs.includes('applyAlignment'));
  ok('22. moderation API 미연결', !/AlienModeration|moderation-service|checkModeration/.test(coreJs + uiJs));

  section('5. UI 배선');
  ok('23. script core', indexHtml.includes('/shared/faction-battle-core.js'));
  ok('24. script ui', indexHtml.includes('/faction-battle-ui.js'));
  ok('25. list strip 연결', indexHtml.includes('appendStripToListItem'));
  ok('26. alien strip 연결', indexHtml.includes('appendStripToAlienRow'));
  ok('27. detail flags 연결', indexHtml.includes('mountDetailFlags'));
  ok('28. cleanup 연결', indexHtml.includes('cleanupDetailFlags'));
  ok('29. strip CSS', indexHtml.includes('sc-faction-battle-strip'));
  ok('30. flag CSS', indexHtml.includes('sc-faction-flag-field'));
  ok('31. list animation 금지 문구/정적', uiJs.includes('animated: false'));
  ok('32. list rAF 없음', !/buildListStrip[\s\S]{0,800}requestAnimationFrame/.test(uiJs));
  ok('33. 숫자 상시 노출 클래스 없음', !indexHtml.includes('sc-faction-battle-strip__pct'));
  ok('34. layer PNG 자산 경로', uiJs.includes('/assets/faction-flags/layers') && uiJs.includes("fallbackMode: 'LAYER_PNG'"));
  ok('34b. pioneer/central/guardian layers', fs.existsSync(path.join(__dirname, '../public/assets/faction-flags/layers/pioneer/cloth.png')) && fs.existsSync(path.join(__dirname, '../public/assets/faction-flags/layers/central/pole.png')) && fs.existsSync(path.join(__dirname, '../public/assets/faction-flags/layers/guardian/tassel.png')));
  ok('35. 신규 PNG 생성 스크립트 미실행', !uiJs.includes('process_flags.py'));
  ok('36. layer drop keyframes', indexHtml.includes('scLayerFlagDrop'));
  ok('37. cloth slices wave', indexHtml.includes('scLayerClothWave') && indexHtml.includes('cloth-slice'));
  ok('38. reduced-motion', indexHtml.includes('prefers-reduced-motion: reduce') && uiJs.includes('prefersReducedMotion'));
  ok('39. inspect', uiJs.includes('__scInspectFactionBattleUi'));
  ok('40. same-post drop 방지', uiJs.includes('playEntrance') && uiJs.includes('dropPlayed'));
  ok('40b. renderBattleStatusFlag 어댑터', indexHtml.includes('/battle-status-flag.js') && indexHtml.includes('/faction-flag-effect.js'));
  ok('40c. 임시 CSS flag 제거', !indexHtml.includes('sc-faction-flag__seg') && !uiJs.includes('sc-faction-flag__pole'));
  ok('40d. 원본 작업 폴더 유지', fs.existsSync(path.join(__dirname, '../faction-flag-animation-assets/README.md')));
  ok('40e. balanced-reference 미사용', !uiJs.includes('balanced-reference'));
  const battleFlagJs = fs.readFileSync(path.join(__dirname, '../public/battle-status-flag.js'), 'utf8');
  ok('40f. BALANCED 상세 깃발 미표시', /status === 'BALANCED'/.test(battleFlagJs) && /return null/.test(battleFlagJs) && !battleFlagJs.includes('BalancedFactionFlagsEffect'));
  ok('40g. mountDetailFlags BALANCED 스킵', uiJs.includes("snapshot.state === 'BALANCED'") && uiJs.includes("mode: 'NONE'"));
  ok('40h. 박빙 스크립트 운영 미로드', !indexHtml.includes('/balanced-faction-flags-effect.js'));
  ok('40i. 단독 깃발 유지', battleFlagJs.includes("status === 'DOMINANT'") && battleFlagJs.includes("status === 'LEADING'") && battleFlagJs.includes('FactionFlagEffect'));
  ok('50. 글 성격 카드 UI', indexHtml.includes('board-category-cards') && indexHtml.includes('data-category="debate"') && indexHtml.includes('data-category="light"') && indexHtml.includes('data-category="info"'));
  ok('51. 진영 토론 토글', indexHtml.includes('board-faction-debate-input') && indexHtml.includes('factionBattleEnabled'));
  ok('52. factionBattleEnabled 게이트', uiJs.includes('shouldShowFactionBattle') && uiJs.includes('factionBattleEnabled === true'));
  ok(
    '52b. 실회원 MOCK 전황 숨김',
    uiJs.includes('isAuthenticatedMemberViewer') &&
      uiJs.includes("snapshot.dataStatus === 'MOCK'"),
  );
  ok('52c. Guest 체험용 전황 라벨', uiJs.includes('체험용 전황'));
  ok('53. normalize 기본 false', indexHtml.includes('p.factionBattleEnabled = p.factionBattleEnabled === true'));
  ok('54. light 카테고리 토론 비활성', indexHtml.includes('isHumorCategoryForFactionDebate') && indexHtml.includes("=== 'light'"));
  ok('55. 기존 category key 유지', indexHtml.includes("value=\"debate\"") && indexHtml.includes('canonicalFreeCategoryId'));

  section('6. 댓글 입력란 위치');
  const detailSrc = (indexHtml.match(/function renderPostDetailContent\(post\) \{[\s\S]*?\n      function findCommentById/) || [''])[0];
  const formIdx = detailSrc.indexOf("className = 'board__comment-form'");
  const bestIdx = detailSrc.indexOf('인기 댓글');
  const reactIdx = detailSrc.indexOf('board-post-detail__react');
  ok('41. comment form 존재', formIdx > 0);
  ok('42. form이 react 뒤', formIdx > reactIdx && reactIdx > 0);
  ok('43. form이 인기댓글 앞', formIdx > 0 && bestIdx > formIdx);
  ok('44. submitComment 유지', detailSrc.includes('submitComment(post.id, taTop.value, null)'));
  ok('45. 진영별 인기댓글 유지', detailSrc.includes('appendDetailFactionCommentBlock'));

  section('7. resolve API');
  const rPioneer = core.resolveFactionBattleForPost('x', 'PIONEER');
  ok('46. pioneer resolve unsupported', rPioneer.supported === false);
  const rCentral = core.resolveFactionBattleForPost('demo_common_1', 'COMMON');
  ok('47. central resolve supported', rCentral.supported === true);
  ok('48. detailMode 유효', ['NONE', 'SINGLE_WINNER', 'BALANCED_THREE'].indexOf(rCentral.detailMode) >= 0);
  const r2 = core.resolveFactionBattleForPost('demo_common_1', 'COMMON');
  ok('49. 동일 postId 동일 결과', JSON.stringify(rCentral.scores) === JSON.stringify(r2.scores));

  void hoverJs;

  console.log('\n=== 진영 전황 UI 테스트 결과 ===');
  results.forEach(function (line) {
    console.log(line);
  });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}

main();
