/**
 * 회원 제재 확인 / 이의제기 최소 UI.
 * 기존 GET /api/me/sanction, GET/POST /api/me/sanctions/appeals 만 사용한다.
 */
(function (global) {
  'use strict';

  var core = global.MemberSanctionUiCore;

  function dialogEl() {
    return global.document && global.document.getElementById('sc-sanction-dialog');
  }

  function setStatus(text) {
    var el = global.document && global.document.getElementById('sc-sanction-status');
    if (el) el.textContent = text || '';
  }

  function authFetch(url, opts) {
    if (global.ScAuth && typeof global.ScAuth.authFetch === 'function') {
      return global.ScAuth.authFetch(url, opts);
    }
    return global.fetch(url, opts);
  }

  function requireMember() {
    if (typeof global.__scRequireLoggedInMember === 'function') {
      return global.__scRequireLoggedInMember();
    }
    return true;
  }

  function line(label, value) {
    var p = global.document.createElement('p');
    p.className = 'muted';
    p.textContent = label + ': ' + (value || '-');
    return p;
  }

  function renderNotice(parent, notice, title) {
    if (!notice || !core) return;
    var card = global.document.createElement('article');
    card.className = 'sc-card';
    var h = global.document.createElement('h3');
    h.className = 'sc-section-title';
    h.textContent = title;
    card.appendChild(h);
    card.appendChild(line('제재 종류', core.typeLabel(notice.sanctionType)));
    card.appendChild(line('현재 상태', core.statusLabel(notice.status) || (core.isExpiredNotice(notice) ? '만료' : '적용 중')));
    card.appendChild(line('시작', core.formatDateTime(notice.startsAt) || '-'));
    card.appendChild(line('종료 예정', notice.permanent ? '영구' : (core.formatDateTime(notice.endsAt) || '-')));
    if (notice.policyViolation) card.appendChild(line('사유', notice.policyViolation));
    if (notice.userMessage) {
      var msg = global.document.createElement('p');
      msg.textContent = notice.userMessage;
      card.appendChild(msg);
    }
    card.appendChild(line('이의제기', notice.appealAvailable ? '가능' : '해당 없음'));
    parent.appendChild(card);
  }

  function renderAppeals(parent, appeals) {
    var box = global.document.createElement('section');
    var h = global.document.createElement('h3');
    h.className = 'sc-section-title';
    h.textContent = '이의제기';
    box.appendChild(h);
    if (!(appeals || []).length) {
      var empty = global.document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '이의제기 내역이 없습니다.';
      box.appendChild(empty);
      parent.appendChild(box);
      return;
    }
    (appeals || []).forEach(function (raw) {
      var a = core.sanitizePublic(raw);
      var card = global.document.createElement('article');
      card.className = 'sc-card';
      var title = global.document.createElement('h4');
      title.className = 'sc-section-title';
      title.textContent = core.typeLabel(a.sanctionType) + ' · ' + core.statusLabel(a.status);
      card.appendChild(title);
      if (a.body) card.appendChild(line('제출 내용', a.body));
      card.appendChild(line('처리 결과', core.statusLabel(a.status)));
      if (a.decidedAt) card.appendChild(line('처리 시각', core.formatDateTime(a.decidedAt)));
      if (a.operatorReply) card.appendChild(line('안내', a.operatorReply));
      box.appendChild(card);
    });
    parent.appendChild(box);
  }

  function renderForm(parent, notice, appeals) {
    if (!core.canSubmitAppeal(notice, appeals)) {
      if (core.hasOpenAppeal(appeals, notice && notice.sanctionType)) {
        var pending = global.document.createElement('p');
        pending.className = 'muted';
        pending.textContent = '이미 처리 중인 이의제기가 있습니다.';
        parent.appendChild(pending);
      }
      return;
    }
    var form = global.document.createElement('form');
    form.id = 'sc-sanction-appeal-form';
    var label = global.document.createElement('label');
    label.className = 'sc-sanction-dialog__field';
    label.appendChild(global.document.createTextNode('이의제기 사유'));
    var ta = global.document.createElement('textarea');
    ta.id = 'sc-sanction-appeal-body';
    ta.required = true;
    ta.maxLength = 2000;
    label.appendChild(ta);
    var btn = global.document.createElement('button');
    btn.type = 'submit';
    btn.className = 'sc-btn';
    btn.id = 'sc-sanction-appeal-submit';
    btn.textContent = '이의제기';
    form.appendChild(label);
    form.appendChild(btn);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var body = String(ta.value || '').trim();
      if (!body) {
        setStatus('사유를 입력하세요.');
        return;
      }
      btn.disabled = true;
      authFetch('/api/me/sanctions/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (out) {
          if (out.res.status === 409) {
            setStatus('이미 처리 중인 이의제기가 있습니다.');
            btn.disabled = true;
            return;
          }
          if (!out.res.ok || !out.data || out.data.ok !== true) {
            setStatus((out.data && out.data.error) || '이의제기를 제출하지 못했습니다.');
            btn.disabled = false;
            return;
          }
          setStatus('이의제기를 제출했습니다.');
          load();
        })
        .catch(function () {
          setStatus('이의제기를 제출하지 못했습니다.');
          btn.disabled = false;
        });
    });
    parent.appendChild(form);
  }

  function load() {
    var mount = global.document && global.document.getElementById('sc-sanction-body');
    if (!mount || !core) return;
    mount.textContent = '';
    setStatus('불러오는 중...');
    Promise.all([
      authFetch('/api/me/sanction').then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, j: j };
        });
      }),
      authFetch('/api/me/sanctions/appeals').then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, j: j };
        });
      }),
    ])
      .then(function (packs) {
        var noticePack = packs[0];
        var appealPack = packs[1];
        if (noticePack.status === 401 || appealPack.status === 401) {
          setStatus('회원가입 후 이용할 수 있습니다.');
          return;
        }
        if (!noticePack.j || noticePack.j.ok !== true) {
          setStatus((noticePack.j && noticePack.j.error) || '제재 정보를 불러오지 못했습니다.');
          return;
        }
        var notice = core.sanitizePublic(noticePack.j.sanction || {});
        var appeals = ((appealPack.j && appealPack.j.appeals) || []).map(core.sanitizePublic);
        var hasCurrent = core.isCurrentNotice(notice);
        var expired = core.isExpiredNotice(notice) && String(notice.sanctionType || '').toUpperCase() !== 'NONE';
        if (!hasCurrent && !expired && !appeals.length) {
          var empty = global.document.createElement('p');
          empty.className = 'muted';
          empty.textContent = '현재 적용 중인 제재가 없습니다.';
          mount.appendChild(empty);
        } else {
          if (hasCurrent) {
            renderNotice(
              mount,
              notice,
              core.isActiveRestriction(notice) ? '현재 적용 중인 제재' : '현재 제재'
            );
          } else {
            var none = global.document.createElement('p');
            none.className = 'muted';
            none.textContent = '현재 적용 중인 제재가 없습니다.';
            mount.appendChild(none);
          }
          if (expired) renderNotice(mount, notice, '최근 제재');
          renderAppeals(mount, appeals);
          if (hasCurrent) renderForm(mount, notice, appeals);
        }
        setStatus('');
      })
      .catch(function () {
        setStatus('제재 정보를 불러오지 못했습니다.');
      });
  }

  function open() {
    if (!requireMember()) return;
    var dlg = dialogEl();
    if (!dlg) return;
    dlg.hidden = false;
    dlg.setAttribute('aria-hidden', 'false');
    load();
  }

  function close() {
    var dlg = dialogEl();
    if (!dlg) return;
    dlg.hidden = true;
    dlg.setAttribute('aria-hidden', 'true');
    setStatus('');
  }

  function bind() {
    var dlg = dialogEl();
    if (!dlg || dlg.dataset.scSanctionBound) return;
    dlg.dataset.scSanctionBound = '1';
    var cancel = global.document.getElementById('sc-sanction-close');
    var backdrop = dlg.querySelector('[data-sc-sanction-close]');
    if (cancel) cancel.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    global.document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (dlg.hidden) return;
      close();
    });
  }

  global.MemberSanctionUI = {
    open: open,
    close: close,
    bind: bind,
    load: load,
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', bind);
    } else {
      bind();
    }
  }
})(typeof window !== 'undefined' ? window : this);
