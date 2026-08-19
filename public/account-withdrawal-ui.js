/**
 * SentenceArena account withdrawal UI.
 * Does not change auth.js. Calls existing ScAuth.logout after success.
 */
(function (global) {
  'use strict';

  var POLICY_VERSION =
    (global.AccountWithdrawalCore && global.AccountWithdrawalCore.POLICY_VERSION) || 'withdrawal-v1';
  var WITHDRAWN_DISPLAY_NAME =
    (global.AccountWithdrawalCore && global.AccountWithdrawalCore.WITHDRAWN_DISPLAY_NAME) ||
    '탈퇴한 사용자';

  var USER_SCOPED_MAP_KEYS = [
    'sc_follow_v1',
    'sc_follow_notify_v1',
    'sc_follow_notify_prefs_v1',
    'sc_player_progression_v1',
    'sc_display_names_v1',
    'sc_notifications_v1',
    'sc_activity_feed_v1',
    'sc_bookmarks_v1',
    'sc_reports_v1',
    'sc_daily_issue_stance_v1',
    'sc_daily_issue_seed_reaction_v1',
    'sc_centrist_daily_issue_history_v1',
    'sc_daily_issue_question_fatigue_v1',
    'sc_tendency_history_v2',
    'sc_moderation_v1',
    'sc_territory_user_copy_v1',
    'sc_growth_contrib_v1',
    'sc_align_daily_pct_cap_v1',
    'sc_align_content_gravity_v1',
    'sc_profile_layout_editor_v3',
    'sc_profile_alignment_axis_max_v1',
    'sc_season_archive_v1',
    'sc_season_soft_v1',
    'sc_persistent_meta_v1',
    'sc_activity_throttle_v1',
  ];

  function currentUserId() {
    return String(global.__scAuthUserId || '').trim();
  }

  function isMemberId(id) {
    var s = String(id || '').trim();
    return !!(s && s !== 'guest' && s !== 'guest_demo');
  }

  function safeParse(raw) {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function pruneUidFromValue(value, uid) {
    if (value == null) return { changed: false, value: value, drop: false };
    if (value === uid) return { changed: true, value: null, drop: true };
    if (Array.isArray(value)) {
      var nextArr = [];
      var arrChanged = false;
      for (var i = 0; i < value.length; i++) {
        var item = value[i];
        if (item === uid || String(item) === uid) {
          arrChanged = true;
          continue;
        }
        var nested = pruneUidFromValue(item, uid);
        if (nested.drop) {
          arrChanged = true;
          continue;
        }
        if (nested.changed) arrChanged = true;
        nextArr.push(nested.value);
      }
      return { changed: arrChanged, value: nextArr, drop: false };
    }
    if (typeof value === 'object') {
      var nextObj = {};
      var objChanged = false;
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (key === uid) {
          objChanged = true;
          continue;
        }
        var child = pruneUidFromValue(value[key], uid);
        if (child.drop) {
          objChanged = true;
          continue;
        }
        if (child.changed) objChanged = true;
        nextObj[key] = child.value;
      }
      return { changed: objChanged, value: nextObj, drop: false };
    }
    return { changed: false, value: value, drop: false };
  }

  function scrubLocalUserData(userId) {
    var uid = String(userId || '').trim();
    if (!isMemberId(uid) || !global.localStorage) return;
    var photoKey = 'sc_profile_photo_v1:' + uid.replace(/[^a-zA-Z0-9@._-]/g, '_');
    try {
      global.localStorage.removeItem(photoKey);
      global.localStorage.removeItem('sc_id_photo_v1:' + uid.replace(/[^a-zA-Z0-9@._-]/g, '_'));
      global.localStorage.removeItem('sc_avatar_v1:' + uid.replace(/[^a-zA-Z0-9@._-]/g, '_'));
    } catch (_) {}

    for (var i = 0; i < USER_SCOPED_MAP_KEYS.length; i++) {
      var key = USER_SCOPED_MAP_KEYS[i];
      try {
        var raw = global.localStorage.getItem(key);
        if (!raw) continue;
        var parsed = safeParse(raw);
        if (!parsed || typeof parsed !== 'object') continue;
        var pruned = pruneUidFromValue(parsed, uid);
        if (!pruned.changed) continue;
        global.localStorage.setItem(key, JSON.stringify(pruned.value));
      } catch (_) {}
    }

    try {
      if (global.sessionStorage) {
        global.sessionStorage.removeItem('sc_oauth_sid');
        global.sessionStorage.removeItem('sc_oauth_verifier');
      }
    } catch (_) {}
  }

  function dialogEl() {
    return global.document && global.document.getElementById('sc-withdraw-dialog');
  }

  function setError(msg) {
    var el = global.document && global.document.getElementById('sc-withdraw-error');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function syncSubmitEnabled() {
    var ack = global.document && global.document.getElementById('sc-withdraw-ack');
    var btn = global.document && global.document.getElementById('sc-withdraw-submit');
    if (!btn) return;
    btn.disabled = !(ack && ack.checked);
  }

  function open() {
    if (!isMemberId(currentUserId())) return;
    var dlg = dialogEl();
    if (!dlg) return;
    var ack = global.document.getElementById('sc-withdraw-ack');
    if (ack) ack.checked = false;
    setError('');
    syncSubmitEnabled();
    dlg.hidden = false;
    dlg.setAttribute('aria-hidden', 'false');
    var closeBtn = global.document.getElementById('sc-withdraw-cancel');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    var dlg = dialogEl();
    if (!dlg) return;
    dlg.hidden = true;
    dlg.setAttribute('aria-hidden', 'true');
    setError('');
  }

  function submit() {
    var ack = global.document && global.document.getElementById('sc-withdraw-ack');
    var btn = global.document && global.document.getElementById('sc-withdraw-submit');
    if (!ack || !ack.checked) return;
    if (btn) btn.disabled = true;
    setError('');
    var uid = currentUserId();
    var body = JSON.stringify({
      acknowledged: true,
      policyVersion: POLICY_VERSION,
    });
    var fetchFn =
      global.ScAuth && typeof global.ScAuth.authFetch === 'function'
        ? global.ScAuth.authFetch
        : function (url, opts) {
            return global.fetch(url, opts);
          };
    return fetchFn('/api/me/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, j: j };
        });
      })
      .then(function (pack) {
        if (!pack.j || pack.j.ok !== true) {
          var code = (pack.j && pack.j.error) || 'WITHDRAW_FAILED';
          setError('회원탈퇴를 완료하지 못했습니다. (' + code + ')');
          if (btn) btn.disabled = false;
          syncSubmitEnabled();
          return;
        }
        scrubLocalUserData(uid);
        close();
        if (global.ScAuth && typeof global.ScAuth.logout === 'function') {
          return global.ScAuth.logout().then(function () {
            global.location.assign('/');
          });
        }
        global.location.assign('/');
      })
      .catch(function () {
        setError('회원탈퇴를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        if (btn) btn.disabled = false;
        syncSubmitEnabled();
      });
  }

  function bind() {
    var dlg = dialogEl();
    if (!dlg || dlg.dataset.scWithdrawBound) return;
    dlg.dataset.scWithdrawBound = '1';
    var ack = global.document.getElementById('sc-withdraw-ack');
    var submitBtn = global.document.getElementById('sc-withdraw-submit');
    var cancelBtn = global.document.getElementById('sc-withdraw-cancel');
    var backdrop = dlg.querySelector('[data-sc-withdraw-close]');
    if (ack) ack.addEventListener('change', syncSubmitEnabled);
    if (submitBtn) submitBtn.addEventListener('click', submit);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    global.document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (dlg.hidden) return;
      close();
    });
    var profileWithdraw = global.document.getElementById('sc-profile-modal-withdraw');
    if (profileWithdraw) {
      profileWithdraw.addEventListener('click', function () {
        open();
      });
    }
    syncSubmitEnabled();
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  global.AccountWithdrawalUI = {
    POLICY_VERSION: POLICY_VERSION,
    WITHDRAWN_DISPLAY_NAME: WITHDRAWN_DISPLAY_NAME,
    open: open,
    close: close,
    scrubLocalUserData: scrubLocalUserData,
    bind: bind,
  };
})(typeof window !== 'undefined' ? window : this);
