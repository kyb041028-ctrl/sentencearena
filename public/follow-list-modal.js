/**
 * 센텐스아레나 — Follow System v1 (팔로워·팔로잉 목록 모달 · 팔로잉 탭 언팔로우)
 * 데이터: FollowSystem · 표시: resolveDisplayName · 프로필: openUserProfile
 */
(function (global) {
  'use strict';

  var TAB_FOLLOWERS = 'followers';
  var TAB_FOLLOWING = 'following';
  var currentTab = TAB_FOLLOWERS;

  var TERRITORY_DATA_ATTR = {
    COMMON: 'centrist',
    CENTRIST: 'centrist',
    PROGRESSIVE: 'reform',
    CONSERVATIVE: 'order',
    KANTAPBIYA: 'alien',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function trim(s) {
    return String(s || '').trim();
  }

  function meId() {
    return String((global.__scPlayer && global.__scPlayer.userId) || 'guest').trim() || 'guest';
  }

  function followSystem() {
    return global.FollowSystem || null;
  }

  function resolveDisplayName(userId) {
    if (typeof global.resolveDisplayName === 'function') {
      return global.resolveDisplayName(userId) || trim(userId);
    }
    return trim(userId);
  }

  function territoryIdToDataTerritory(tid) {
    var key = String(tid || 'COMMON').trim().toUpperCase() || 'COMMON';
    return TERRITORY_DATA_ATTR[key] || 'centrist';
  }

  function uniqSortedUserIds(ids) {
    var seen = {};
    var out = [];
    (ids || []).forEach(function (raw) {
      var id = trim(raw);
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    out.sort(function (a, b) {
      var na = resolveDisplayName(a);
      var nb = resolveDisplayName(b);
      return String(na).localeCompare(String(nb), 'ko');
    });
    return out;
  }

  function getListsForUser(userId) {
    var id = trim(userId) || meId();
    var fs = followSystem();
    if (!fs) {
      return { followers: [], following: [] };
    }
    return {
      followers: uniqSortedUserIds(
        typeof fs.getFollowers === 'function' ? fs.getFollowers(id) : [],
      ),
      following: uniqSortedUserIds(
        typeof fs.getFollowing === 'function' ? fs.getFollowing(id) : [],
      ),
    };
  }

  global.__scFollowLists = function (userId) {
    return getListsForUser(userId);
  };

  function buildCitizenThumb(userId) {
    var span = document.createElement('span');
    span.className = 'sc-search-modal__thumb board__author-thumb';
    var url =
      typeof global.__scGetProfilePhotoDataUrl === 'function'
        ? global.__scGetProfilePhotoDataUrl(userId)
        : '';
    if (url) {
      var im = document.createElement('img');
      im.src = url;
      im.alt = '';
      im.className = 'board__author-thumb-img';
      span.appendChild(im);
    } else {
      span.classList.add('board__author-thumb--empty');
      span.setAttribute('aria-hidden', 'true');
    }
    return span;
  }

  function buildCitizenMeta(userId) {
    var P = global.PlayerProgression;
    if (!P) return null;
    var meta = document.createElement('span');
    meta.className = 'sc-search-modal__meta muted';
    var parts = [];
    if (typeof P.getState === 'function' && typeof P.territoryLabelKo === 'function') {
      var st = P.getState(userId);
      if (st && st.territoryId) {
        var badge = document.createElement('span');
        badge.className = 'sc-badge sc-search-modal__terr';
        badge.dataset.territory = territoryIdToDataTerritory(st.territoryId);
        badge.textContent = P.territoryLabelKo(st.territoryId);
        parts.push(badge);
      }
    }
    if (typeof P.getDisplay === 'function') {
      var d = P.getDisplay(userId);
      if (d && d.level != null) {
        var lv = document.createElement('span');
        lv.textContent = 'Lv.' + d.level;
        parts.push(lv);
      }
      if (d && d.rankShort) {
        var rep = document.createElement('span');
        rep.textContent = '명성 ' + d.rankShort;
        parts.push(rep);
      }
    }
    if (!parts.length) return null;
    parts.forEach(function (node, idx) {
      meta.appendChild(node);
      if (idx < parts.length - 1) {
        meta.appendChild(document.createTextNode(' · '));
      }
    });
    return meta;
  }

  function showToast(message) {
    if (typeof global.showScShareToast === 'function') {
      global.showScShareToast(message);
    }
  }

  function wireUnfollowButton(btn, userId) {
    var id = trim(userId);
    if (!btn || !id) return;
    var label = resolveDisplayName(id);
    btn.type = 'button';
    btn.className = 'board__follow-btn is-following sc-follow-modal__unfollow';
    btn.textContent = '언팔로우';
    btn.setAttribute('aria-label', label + ' 시민 언팔로우');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var fs = followSystem();
      if (!fs || typeof fs.toggleFollow !== 'function') return;
      if (typeof fs.isFollowing === 'function' && !fs.isFollowing(id)) {
        renderList();
        return;
      }
      var result = fs.toggleFollow(id);
      if (!result || !result.ok) return;
      renderList();
      showToast('언팔로우했습니다.');
    });
  }

  function wireCitizenProfileLink(anchor, userId) {
    var id = trim(userId);
    if (!anchor || !id) return;
    anchor.classList.add('sc-user-profile-link');
    anchor.setAttribute('role', 'button');
    anchor.setAttribute('tabindex', '0');
    anchor.setAttribute('title', '클릭해서 유저 프로필 보기');
    var label = resolveDisplayName(id);
    anchor.setAttribute('aria-label', label + ' — 클릭해서 유저 프로필 보기');
    function openProfile(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      closeModal();
      if (typeof global.openUserProfile === 'function') {
        global.openUserProfile(id);
      }
    }
    anchor.addEventListener('click', openProfile);
    anchor.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        openProfile(ev);
      }
    });
  }

  function renderList() {
    var listEl = el('sc-follow-modal-list');
    var emptyEl = el('sc-follow-modal-empty');
    if (!listEl) return;

    listEl.textContent = '';
    var lists = getListsForUser(meId());
    var ids =
      currentTab === TAB_FOLLOWING ? lists.following : lists.followers;

    if (!ids.length) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent =
          currentTab === TAB_FOLLOWING
            ? '아직 팔로우한 시민이 없습니다.'
            : '아직 팔로워가 없습니다.';
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    ids.forEach(function (userId) {
      var li = document.createElement('li');
      li.className = 'sc-search-modal__item';
      li.setAttribute('role', 'listitem');

      var thumb = buildCitizenThumb(userId);
      wireCitizenProfileLink(thumb, userId);

      var body = document.createElement('div');
      body.className = 'sc-search-modal__item-body';

      var nameEl = document.createElement('span');
      nameEl.className = 'sc-search-modal__name';
      nameEl.textContent = resolveDisplayName(userId);
      wireCitizenProfileLink(nameEl, userId);

      body.appendChild(nameEl);
      var meta = buildCitizenMeta(userId);
      if (meta) body.appendChild(meta);

      li.appendChild(thumb);
      li.appendChild(body);
      if (currentTab === TAB_FOLLOWING) {
        var unfollowBtn = document.createElement('button');
        wireUnfollowButton(unfollowBtn, userId);
        li.appendChild(unfollowBtn);
      }
      listEl.appendChild(li);
    });
  }

  function normalizeTab(tab) {
    return tab === TAB_FOLLOWING ? TAB_FOLLOWING : TAB_FOLLOWERS;
  }

  function setActiveTab(tab) {
    currentTab = normalizeTab(tab);
    var tabs = document.querySelectorAll('.sc-follow-modal__tab');
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === currentTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderList();
  }

  function openModal(tab) {
    var modal = el('sc-follow-modal');
    if (!modal) return;
    setActiveTab(tab);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    var modal = el('sc-follow-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  function initUi() {
    var btnFollowers = el('avatar-dock-follow-followers');
    var btnFollowing = el('avatar-dock-follow-following');
    var btnClose = el('sc-follow-modal-close');
    var backdrop = el('sc-follow-modal-backdrop');
    var modal = el('sc-follow-modal');
    var tabs = document.querySelectorAll('.sc-follow-modal__tab');

    if (btnFollowers) {
      btnFollowers.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openModal(TAB_FOLLOWERS);
      });
    }
    if (btnFollowing) {
      btnFollowing.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openModal(TAB_FOLLOWING);
      });
    }
    if (btnClose) {
      btnClose.addEventListener('click', function (ev) {
        ev.preventDefault();
        closeModal();
      });
    }
    if (backdrop) {
      backdrop.addEventListener('click', closeModal);
    }
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActiveTab(btn.getAttribute('data-tab'));
      });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!modal || modal.hidden) return;
      closeModal();
    });
  }

  global.FollowListModal = {
    open: openModal,
    close: closeModal,
    render: renderList,
    setTab: setActiveTab,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUi);
  } else {
    initUi();
  }
})(typeof window !== 'undefined' ? window : this);
