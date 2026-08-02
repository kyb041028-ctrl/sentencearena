/**
 * 제한형 게시글 리치 텍스트 에디터 (추가 의존성 없음)
 * - contenteditable + Selection/Range 기반 명령 레이어
 * - 히스토리 · 붙여넣기 sanitize · 툴바 상태 · 링크 다이얼로그
 * - document.execCommand는 보조로만 사용 (단독 래퍼가 아님)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof require === 'function' ? require('../shared/board-rich-content-core') : null);
  } else {
    root.BoardRichEditor = factory(root.BoardRichContentCore);
  }
})(typeof self !== 'undefined' ? self : this, function boardRichEditorFactory(Core) {
  'use strict';

  if (!Core) {
    throw new Error('BoardRichContentCore required');
  }

  var TOOLS = [
    { cmd: 'paragraph', label: '본문', title: '본문', group: 'block' },
    { cmd: 'heading', label: '소제목', title: '소제목', group: 'block' },
    { cmd: 'bold', label: 'B', title: '굵게', aria: '굵게', group: 'inline' },
    { cmd: 'italic', label: 'I', title: '기울임', aria: '기울임', group: 'inline' },
    { cmd: 'underline', label: 'U', title: '밑줄', aria: '밑줄', group: 'inline' },
    { cmd: 'strike', label: 'S', title: '취소선', aria: '취소선', group: 'inline' },
    { cmd: 'quote', label: '“', title: '인용문', aria: '인용문', group: 'block' },
    { cmd: 'ul', label: '•', title: '글머리 목록', aria: '글머리 목록', group: 'list' },
    { cmd: 'ol', label: '1.', title: '번호 목록', aria: '번호 목록', group: 'list' },
    { cmd: 'link', label: '링크', title: '링크', aria: '링크', group: 'link' },
    { cmd: 'hr', label: '―', title: '구분선', aria: '구분선', group: 'insert' },
    { cmd: 'undo', label: '실행취소', title: '실행 취소', aria: '실행 취소', group: 'history' },
    { cmd: 'redo', label: '다시실행', title: '다시 실행', aria: '다시 실행', group: 'history' },
  ];

  function closest(el, sel) {
    if (!el) return null;
    if (el.closest) return el.closest(sel);
    return null;
  }

  function BoardRichEditor(options) {
    this.root = options.root;
    this.textarea = options.textarea || null;
    this.maxLength = options.maxLength || 8000;
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this._history = [];
    this._historyIndex = -1;
    this._suppressHistory = false;
    this._savedRange = null;
    this._linkPopup = null;
    this._linkReturnFocus = null;
    this._btnMap = {};
    this._destroyed = false;

    this._build();
    this.setHtml('');
    this._pushHistory(true);
  }

  BoardRichEditor.prototype._build = function () {
    var self = this;
    var root = this.root;
    root.classList.add('board-rich-editor');
    root.innerHTML = '';

    var toolbar = document.createElement('div');
    toolbar.className = 'board-rich-editor__toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '본문 서식');
    this.toolbar = toolbar;

    var i;
    for (i = 0; i < TOOLS.length; i++) {
      (function (tool) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'board-rich-editor__btn board-rich-editor__btn--' + tool.cmd;
        if (tool.cmd === 'bold') btn.style.fontWeight = '800';
        if (tool.cmd === 'italic') btn.style.fontStyle = 'italic';
        if (tool.cmd === 'underline') btn.style.textDecoration = 'underline';
        if (tool.cmd === 'strike') btn.style.textDecoration = 'line-through';
        btn.textContent = tool.label;
        btn.title = tool.title;
        btn.setAttribute('aria-label', tool.aria || tool.title);
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
        });
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          self.exec(tool.cmd);
        });
        toolbar.appendChild(btn);
        self._btnMap[tool.cmd] = btn;
      })(TOOLS[i]);
    }

    var surface = document.createElement('div');
    surface.className = 'board-rich-editor__surface';
    surface.id = 'board-body-surface';
    surface.setAttribute('contenteditable', 'true');
    surface.setAttribute('role', 'textbox');
    surface.setAttribute('aria-multiline', 'true');
    surface.setAttribute('aria-labelledby', 'board-body-label');
    surface.setAttribute('aria-label', '본문');
    surface.setAttribute('data-placeholder', '내용을 입력하세요');
    surface.spellcheck = true;
    this.surface = surface;

    var desc = document.createElement('p');
    desc.className = 'board-field__hint board-rich-editor__hint';
    desc.id = 'board-rich-editor-hint';
    desc.textContent = '기본 서식만 사용할 수 있습니다. 사진은 아래 첨부로 추가합니다.';
    surface.setAttribute('aria-describedby', 'board-rich-editor-hint');

    root.appendChild(toolbar);
    root.appendChild(surface);
    root.appendChild(desc);

    if (this.textarea) {
      this.textarea.classList.add('board-rich-editor__legacy-ta');
      this.textarea.setAttribute('aria-hidden', 'true');
      this.textarea.tabIndex = -1;
      this.textarea.hidden = true;
    }

    surface.addEventListener('input', function () {
      self._onSurfaceInput();
    });
    surface.addEventListener('keyup', function () {
      self._updateToolbarState();
      self._saveSelection();
    });
    surface.addEventListener('mouseup', function () {
      self._updateToolbarState();
      self._saveSelection();
    });
    surface.addEventListener('focus', function () {
      self._updateToolbarState();
    });
    surface.addEventListener('paste', function (ev) {
      self._onPaste(ev);
    });
    surface.addEventListener('keydown', function (ev) {
      self._onKeyDown(ev);
    });

    document.addEventListener(
      'selectionchange',
      (this._onSelChange = function () {
        if (self._destroyed) return;
        if (!root.contains(document.activeElement) && document.activeElement !== surface) return;
        self._updateToolbarState();
        self._saveSelection();
      }),
    );
  };

  BoardRichEditor.prototype.destroy = function () {
    this._destroyed = true;
    if (this._onSelChange) document.removeEventListener('selectionchange', this._onSelChange);
    this._closeLinkPopup();
  };

  BoardRichEditor.prototype.focus = function () {
    this.surface.focus();
  };

  BoardRichEditor.prototype.getHtml = function () {
    return Core.sanitizeHtml(this.surface.innerHTML);
  };

  BoardRichEditor.prototype.getPlainText = function () {
    return Core.htmlToPlainText(this.surface.innerHTML);
  };

  BoardRichEditor.prototype.isEmpty = function () {
    return Core.isEffectivelyEmpty(this.surface.innerHTML, 'rich');
  };

  BoardRichEditor.prototype.setHtml = function (html) {
    this._suppressHistory = true;
    this.surface.innerHTML = html && String(html).trim() ? Core.sanitizeHtml(html) : '<p><br></p>';
    this._suppressHistory = false;
    this._syncTextarea();
    this._updatePlaceholder();
    this._updateToolbarState();
  };

  BoardRichEditor.prototype.clear = function () {
    this.setHtml('');
    this._history = [];
    this._historyIndex = -1;
    this._pushHistory(true);
  };

  BoardRichEditor.prototype.prepareSave = function () {
    return Core.prepareForSave(this.surface.innerHTML);
  };

  BoardRichEditor.prototype._syncTextarea = function () {
    if (!this.textarea) return;
    var prepared = Core.prepareForSave(this.surface.innerHTML);
    this.textarea.value = prepared.empty ? '' : prepared.body;
    this.textarea.dataset.bodyFormat = prepared.bodyFormat;
  };

  BoardRichEditor.prototype._updatePlaceholder = function () {
    if (this.isEmpty()) this.surface.classList.add('is-empty');
    else this.surface.classList.remove('is-empty');
  };

  BoardRichEditor.prototype._onSurfaceInput = function () {
    var plain = this.getPlainText();
    if (plain.length > this.maxLength) {
      // soft clamp: restore last good history snapshot
      if (this._historyIndex >= 0) {
        this._suppressHistory = true;
        this.surface.innerHTML = this._history[this._historyIndex];
        this._suppressHistory = false;
      }
    }
    this._pushHistory(false);
    this._syncTextarea();
    this._updatePlaceholder();
    this._updateToolbarState();
    if (this.onChange) this.onChange();
  };

  BoardRichEditor.prototype._pushHistory = function (force) {
    if (this._suppressHistory) return;
    var html = this.surface.innerHTML;
    if (!force && this._historyIndex >= 0 && this._history[this._historyIndex] === html) return;
    this._history = this._history.slice(0, this._historyIndex + 1);
    this._history.push(html);
    if (this._history.length > 80) {
      this._history.shift();
    } else {
      this._historyIndex++;
    }
    this._historyIndex = this._history.length - 1;
    this._updateHistoryButtons();
  };

  BoardRichEditor.prototype._restoreHistory = function (idx) {
    if (idx < 0 || idx >= this._history.length) return;
    this._historyIndex = idx;
    this._suppressHistory = true;
    this.surface.innerHTML = this._history[idx];
    this._suppressHistory = false;
    this._syncTextarea();
    this._updatePlaceholder();
    this._updateHistoryButtons();
    this._updateToolbarState();
  };

  BoardRichEditor.prototype._updateHistoryButtons = function () {
    var undoBtn = this._btnMap.undo;
    var redoBtn = this._btnMap.redo;
    if (undoBtn) undoBtn.disabled = this._historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = this._historyIndex >= this._history.length - 1;
  };

  BoardRichEditor.prototype._saveSelection = function () {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (!this.surface.contains(range.commonAncestorContainer)) return;
    this._savedRange = range.cloneRange();
  };

  BoardRichEditor.prototype._restoreSelection = function () {
    if (!this._savedRange) return;
    var sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(this._savedRange);
  };

  BoardRichEditor.prototype._queryCommand = function (cmd) {
    try {
      return document.queryCommandState(cmd);
    } catch (_) {
      return false;
    }
  };

  BoardRichEditor.prototype._blockTag = function () {
    var sel = window.getSelection();
    if (!sel || !sel.anchorNode) return 'P';
    var node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (!node) return 'P';
    var block = closest(node, 'h3,blockquote,li,p,div');
    if (!block || !this.surface.contains(block)) return 'P';
    return String(block.tagName || 'P').toUpperCase();
  };

  BoardRichEditor.prototype._inList = function (type) {
    var sel = window.getSelection();
    if (!sel || !sel.anchorNode) return false;
    var node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    var list = closest(node, type);
    return !!(list && this.surface.contains(list));
  };

  BoardRichEditor.prototype._updateToolbarState = function () {
    var map = this._btnMap;
    function setPressed(btn, on) {
      if (!btn) return;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) btn.classList.add('is-active');
      else btn.classList.remove('is-active');
    }
    setPressed(map.bold, this._queryCommand('bold'));
    setPressed(map.italic, this._queryCommand('italic'));
    setPressed(map.underline, this._queryCommand('underline'));
    setPressed(map.strike, this._queryCommand('strikeThrough'));
    var block = this._blockTag();
    setPressed(map.paragraph, block === 'P' || block === 'DIV');
    setPressed(map.heading, block === 'H3');
    setPressed(map.quote, block === 'BLOCKQUOTE');
    setPressed(map.ul, this._inList('ul'));
    setPressed(map.ol, this._inList('ol'));
    var inLink = false;
    var sel = window.getSelection();
    if (sel && sel.anchorNode) {
      var n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      inLink = !!(closest(n, 'a') && this.surface.contains(closest(n, 'a')));
    }
    setPressed(map.link, inLink);
    this._updateHistoryButtons();
  };

  BoardRichEditor.prototype.exec = function (cmd) {
    this.surface.focus();
    this._restoreSelection();
    switch (cmd) {
      case 'paragraph':
        this._formatBlock('P');
        break;
      case 'heading':
        this._formatBlock(this._blockTag() === 'H3' ? 'P' : 'H3');
        break;
      case 'bold':
        this._toggleInline('bold');
        break;
      case 'italic':
        this._toggleInline('italic');
        break;
      case 'underline':
        this._toggleInline('underline');
        break;
      case 'strike':
        this._toggleInline('strikeThrough');
        break;
      case 'quote':
        this._formatBlock(this._blockTag() === 'BLOCKQUOTE' ? 'P' : 'BLOCKQUOTE');
        break;
      case 'ul':
        this._toggleList('insertUnorderedList');
        break;
      case 'ol':
        this._toggleList('insertOrderedList');
        break;
      case 'link':
        this._openLinkPopup();
        return;
      case 'hr':
        this._insertHr();
        break;
      case 'undo':
        this._restoreHistory(this._historyIndex - 1);
        return;
      case 'redo':
        this._restoreHistory(this._historyIndex + 1);
        return;
      default:
        break;
    }
    this._afterCommand();
  };

  BoardRichEditor.prototype._toggleInline = function (nativeCmd) {
    try {
      document.execCommand(nativeCmd, false, null);
    } catch (_) {}
    // normalize b/i/strike aliases via sanitize pass on blur/save; keep live editing fluid
  };

  BoardRichEditor.prototype._formatBlock = function (tag) {
    var t = String(tag || 'P').toUpperCase();
    try {
      document.execCommand('formatBlock', false, t);
    } catch (_) {
      try {
        document.execCommand('formatBlock', false, '<' + t + '>');
      } catch (__) {}
    }
  };

  BoardRichEditor.prototype._toggleList = function (nativeCmd) {
    try {
      document.execCommand(nativeCmd, false, null);
    } catch (_) {}
  };

  BoardRichEditor.prototype._insertHr = function () {
    try {
      document.execCommand('insertHorizontalRule', false, null);
    } catch (_) {
      var hr = document.createElement('hr');
      var sel = window.getSelection();
      if (sel && sel.rangeCount) {
        var range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(hr);
      }
    }
  };

  BoardRichEditor.prototype._afterCommand = function () {
    // sanitize lightly: strip disallowed attrs/tags from surface without destroying caret if possible
    var html = Core.sanitizeHtml(this.surface.innerHTML);
    if (html !== this.surface.innerHTML) {
      this.surface.innerHTML = html || '<p><br></p>';
    }
    this._pushHistory(false);
    this._syncTextarea();
    this._updatePlaceholder();
    this._updateToolbarState();
    if (this.onChange) this.onChange();
  };

  BoardRichEditor.prototype._onPaste = function (ev) {
    ev.preventDefault();
    var text = '';
    var html = '';
    try {
      html = ev.clipboardData.getData('text/html') || '';
      text = ev.clipboardData.getData('text/plain') || '';
    } catch (_) {}
    var insert = '';
    if (html) {
      insert = Core.sanitizeHtml(html);
    } else {
      insert = Core.plainToHtml(text);
    }
    if (!insert) return;
    try {
      document.execCommand('insertHTML', false, insert);
    } catch (_) {
      var sel = window.getSelection();
      if (sel && sel.rangeCount) {
        var range = sel.getRangeAt(0);
        range.deleteContents();
        var tmp = document.createElement('div');
        tmp.innerHTML = insert;
        var frag = document.createDocumentFragment();
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        range.insertNode(frag);
      }
    }
    this._afterCommand();
  };

  BoardRichEditor.prototype._onKeyDown = function (ev) {
    var mod = ev.metaKey || ev.ctrlKey;
    if (!mod) return;
    var key = String(ev.key || '').toLowerCase();
    if (key === 'b') {
      ev.preventDefault();
      this.exec('bold');
    } else if (key === 'i') {
      ev.preventDefault();
      this.exec('italic');
    } else if (key === 'u') {
      ev.preventDefault();
      this.exec('underline');
    } else if (key === 'z' && ev.shiftKey) {
      ev.preventDefault();
      this.exec('redo');
    } else if (key === 'y') {
      ev.preventDefault();
      this.exec('redo');
    } else if (key === 'z') {
      ev.preventDefault();
      this.exec('undo');
    }
  };

  BoardRichEditor.prototype._closeLinkPopup = function () {
    if (this._linkPopup && this._linkPopup.parentNode) {
      this._linkPopup.parentNode.removeChild(this._linkPopup);
    }
    this._linkPopup = null;
  };

  BoardRichEditor.prototype._openLinkPopup = function () {
    var self = this;
    this._saveSelection();
    this._closeLinkPopup();
    this._linkReturnFocus = this._btnMap.link || this.surface;

    var sel = window.getSelection();
    var existing = null;
    if (sel && sel.anchorNode) {
      var n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      existing = closest(n, 'a');
      if (existing && !this.surface.contains(existing)) existing = null;
    }

    var pop = document.createElement('div');
    pop.className = 'board-rich-editor__link-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '링크 편집');

    var label = document.createElement('label');
    label.className = 'board-rich-editor__link-label';
    label.textContent = 'URL (http/https)';
    var input = document.createElement('input');
    input.type = 'url';
    input.className = 'board-rich-editor__link-input';
    input.placeholder = 'https://';
    input.value = existing ? existing.getAttribute('href') || '' : '';
    label.appendChild(input);

    var err = document.createElement('p');
    err.className = 'board-rich-editor__link-err';
    err.hidden = true;

    var actions = document.createElement('div');
    actions.className = 'board-rich-editor__link-actions';

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'board-btn-primary';
    applyBtn.textContent = existing ? '수정' : '적용';

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '링크 제거';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '취소';

    actions.appendChild(applyBtn);
    actions.appendChild(removeBtn);
    actions.appendChild(cancelBtn);
    pop.appendChild(label);
    pop.appendChild(err);
    pop.appendChild(actions);
    this.root.appendChild(pop);
    this._linkPopup = pop;
    input.focus();
    input.select();

    function finish(focusTarget) {
      self._closeLinkPopup();
      self.surface.focus();
      self._restoreSelection();
      if (focusTarget && focusTarget.focus) {
        try {
          focusTarget.focus();
        } catch (_) {}
      }
    }

    cancelBtn.addEventListener('click', function () {
      finish(self._linkReturnFocus);
    });

    removeBtn.addEventListener('click', function () {
      self._restoreSelection();
      if (existing) {
        try {
          document.execCommand('unlink', false, null);
        } catch (_) {
          unwrapAnchor(existing);
        }
      }
      self._afterCommand();
      finish(self._linkReturnFocus);
    });

    applyBtn.addEventListener('click', function () {
      var url = String(input.value || '').trim();
      var safe = Core.sanitizeHref(url);
      if (!safe) {
        err.hidden = false;
        err.textContent = 'http:// 또는 https:// URL만 허용됩니다.';
        input.focus();
        return;
      }
      self._restoreSelection();
      if (existing) {
        existing.setAttribute('href', safe);
        existing.setAttribute('target', '_blank');
        existing.setAttribute('rel', 'noopener noreferrer');
      } else {
        try {
          document.execCommand('createLink', false, safe);
        } catch (_) {}
        // enforce rel/target
        var anchors = self.surface.querySelectorAll('a[href="' + safe.replace(/"/g, '\\"') + '"]');
        var ai;
        for (ai = 0; ai < anchors.length; ai++) {
          anchors[ai].setAttribute('target', '_blank');
          anchors[ai].setAttribute('rel', 'noopener noreferrer');
        }
      }
      self._afterCommand();
      finish(self.surface);
    });

    pop.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(self._linkReturnFocus);
      }
    });
  };

  function unwrapAnchor(a) {
    if (!a || !a.parentNode) return;
    while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
    a.parentNode.removeChild(a);
  }

  BoardRichEditor.mount = function (options) {
    return new BoardRichEditor(options);
  };

  BoardRichEditor.TOOLS = TOOLS;
  return BoardRichEditor;
});
