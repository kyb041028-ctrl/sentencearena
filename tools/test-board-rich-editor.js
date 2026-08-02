'use strict';
/**
 * 제한형 리치 본문 단위 테스트
 * node tools/test-board-rich-editor.js
 */

const fs = require('fs');
const path = require('path');
const core = require('../shared/board-rich-content-core');

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
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const editorJs = fs.readFileSync(path.join(__dirname, '../public/board-rich-editor.js'), 'utf8');
  const coreJs = fs.readFileSync(path.join(__dirname, '../shared/board-rich-content-core.js'), 'utf8');

  section('1. Sanitize');
  const dirty =
    '<p>hi<script>alert(1)</script><strong onclick="x">a</strong> ' +
    '<a href="javascript:alert(1)">b</a> <a href="https://ok.com">c</a> ' +
    '<img src=x onerror=alert(1)><iframe src="x"></iframe></p>';
  const clean = core.sanitizeHtml(dirty);
  ok('1. script 제거', !/script/i.test(clean));
  ok('2. onclick 제거', !/onclick/i.test(clean));
  ok('3. javascript URL 차단', !/javascript:/i.test(clean));
  ok('4. https 링크 유지', /href="https:\/\/ok\.com"/.test(clean) && /noopener noreferrer/.test(clean));
  ok('5. iframe/img 제거', !/<iframe/i.test(clean) && !/<img/i.test(clean));
  ok('6. style/class 제거', !/\sstyle=/i.test(clean) && !/\sclass=/i.test(clean));

  section('2. Empty · save format');
  ok('7. 빈 p 빈 문서', core.prepareForSave('<p><br></p>').empty === true);
  ok('8. plain 저장', core.prepareForSave('<p>hello</p>').bodyFormat === 'plain');
  const rich = core.prepareForSave('<p>hello <strong>world</strong></p>');
  ok('9. rich 저장', rich.bodyFormat === 'rich' && /<strong>/.test(rich.body));

  section('3. Plain 호환 · excerpt');
  ok('10. plain excerpt', core.excerptFromBody('hello world', 'plain', 20) === 'hello world');
  const ex = core.excerptFromBody('<p>hello <strong>world</strong> and more text here</p>', 'rich', 20);
  ok('11. rich excerpt no tags', !/</.test(ex) && /hello/.test(ex));
  ok('12. plainToHtml', /<p>/.test(core.plainToHtml('a\n\nb')));
  ok('13. normalizeBodyFormat default plain', core.normalizeBodyFormat(undefined) === 'plain');
  ok('14. isSafeHttpUrl http', core.isSafeHttpUrl('http://a.com') === true);
  ok('15. isSafeHttpUrl reject relative', core.isSafeHttpUrl('/path') === false);

  section('4. Editor module contract');
  ok('16. BoardRichEditor mount', /BoardRichEditor\.mount/.test(editorJs));
  ok('17. toolbar role', /role:\s*'toolbar'|setAttribute\('role',\s*'toolbar'\)/.test(editorJs));
  ok('18. undo/redo history', /_history/.test(editorJs) && /exec\('undo'\)/.test(editorJs));
  ok('19. paste sanitize', /_onPaste/.test(editorJs) && /sanitizeHtml/.test(editorJs));
  ok('20. shortcuts B/I/U', /key === 'b'/.test(editorJs) && /key === 'i'/.test(editorJs) && /key === 'u'/.test(editorJs));
  ok('21. link popup ESC', /Escape/.test(editorJs));
  ok('22. no bare-only editor comment', /히스토리/.test(editorJs));
  ok('23. disallowed free font size absent', !/fontSize|foreColor|backColor|justifyCenter/.test(editorJs));

  section('5. index.html wiring');
  ok('24. rich core script', /board-rich-content-core\.js/.test(indexHtml));
  ok('25. editor script', /board-rich-editor\.js/.test(indexHtml));
  ok('26. editor root', /id="board-rich-editor-root"/.test(indexHtml));
  ok('27. modal ~820px', /min\(820px/.test(indexHtml));
  ok('28. editor min-height 340', /min-height:\s*340px/.test(indexHtml));
  ok('29. bodyFormat normalize', /bodyFormat/.test(indexHtml));
  ok('30. detail rich render', /renderPostBodyElement|is-rich/.test(indexHtml));
  ok('31. photo label', /사진 첨부 · 최대 4장/.test(indexHtml));
  ok('32. category 3-col', /repeat\(3/.test(indexHtml));
  ok('33. factionBattleEnabled untouched keys', /factionBattleEnabled/.test(indexHtml));
  ok('34. debate/light/info cards', /data-category="debate"/.test(indexHtml) && /data-category="light"/.test(indexHtml));
  ok('35. textarea still present', /id="board-body-input"/.test(indexHtml));
  ok('36. core exports sanitize', /sanitizeHtml:\s*sanitizeHtml/.test(coreJs));

  section('6. Allowed tags sample');
  const allowed = core.sanitizeHtml(
    '<h3>T</h3><p><em>e</em><u>u</u><s>s</s></p><blockquote>q</blockquote><ul><li>1</li></ul><ol><li>2</li></ol><hr>',
  );
  ok('37. h3/em/u/s', /<h3>/.test(allowed) && /<em>/.test(allowed) && /<u>/.test(allowed) && /<s>/.test(allowed));
  ok('38. lists quote hr', /<ul>/.test(allowed) && /<ol>/.test(allowed) && /<blockquote>/.test(allowed) && /<hr>/.test(allowed));

  console.log(results.join('\n'));
  console.log('\nRESULT: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}

main();
