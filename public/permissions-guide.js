/**
 * 레벨·명성·영토 안내 (상단 탭 화면 — 세계관 규칙 중심)
 */
(function (global) {
  'use strict';

  var SUB_TABS = [
    { id: 'level', label: '레벨' },
    { id: 'rank', label: '명성' },
    { id: 'board', label: '이용 안내' },
    { id: 'world', label: '영토' },
  ];

  var activeSub = 'level';
  var inited = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function guideData() {
    var P = global.PlayerProgression;
    if (P && typeof P.getPermissionsGuideData === 'function') {
      return P.getPermissionsGuideData();
    }
    return {
      maxLevel: 5,
      lurkUnlockLevel: 3,
      rankUnlockLevel: 4,
      xpRewards: { post_write: 25, board_comment: 12, issue_comment: 10 },
      xpPerLevel: [40, 50, 60, 70, 80],
      levelCumulativeXp: [0, 40, 90, 150, 220, 300],
      rankAbsolute: {
        2: { postLikes: 3, commentLikes: 2, followers: 2 },
        3: { postLikes: 15, commentLikes: 8, followers: 8 },
        4: { postLikes: 40, commentLikes: 20, followers: 20 },
      },
      rankCaps: { politicianMaxRatio: 0.1, chiefsMaxCount: 5 },
    };
  }

  function renderLevelPanel(d) {
    var observeLv = d.lurkUnlockLevel || 3;
    var rankLv = d.rankUnlockLevel || 4;
    var rows = '';
    for (var lv = 1; lv <= d.maxLevel; lv++) {
      var cum = d.levelCumulativeXp[lv - 1] || 0;
      var need = d.xpPerLevel[lv - 1] || 0;
      var growth = '';
      if (lv === 1) {
        growth = '중앙광장에서 활동 시작 · 글·댓글·반응';
      } else if (lv === 2) {
        growth = '영토 활동 지속 · 경험 축적';
      } else if (lv === observeLv) {
        growth = '타 영토 관측 가능 · 다른 영토 게시글 열람';
      } else if (lv === rankLv) {
        growth = '명성 체계 개방 · 명성 등급 표시 시작';
      } else if (lv === d.maxLevel) {
        growth = '성장의 정점 · 활동 범위 최대';
      } else if (lv > observeLv && lv < rankLv) {
        growth = '관측·활동 범위 확장';
      } else if (lv < observeLv) {
        growth = '중앙광장 중심 활동';
      }
      rows +=
        '<tr><td>Lv.' +
        lv +
        '</td><td>' +
        need +
        '</td><td>' +
        cum +
        '+</td><td>' +
        esc(growth || '—') +
        '</td></tr>';
    }
    return (
      '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">성장 — 레벨</h3>' +
      '<p class="perm-guide__lead">글·댓글·이슈에 참여하며 쌓인 <strong>경험</strong>이 레벨을 올립니다. 레벨은 서비스 활동량이며 정치성향 점수와는 별개입니다.</p>' +
      '<table class="perm-guide__table"><thead><tr><th>레벨</th><th>필요 경험</th><th>누적</th><th>열리는 것</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      '<ul class="perm-guide__list">' +
      '<li><strong>Lv.' +
      observeLv +
      '</strong> — 개척·수호 영토의 글을 <strong>관측(열람)</strong>할 수 있습니다.</li>' +
      '<li><strong>Lv.' +
      rankLv +
      '</strong> — <strong>명성 등급</strong>이 프로필에 표시되고, 순위에 반영됩니다.</li>' +
      '<li>레벨과 성향은 별개입니다. 영토 깊숙이 <strong>참여(글·댓글)</strong>하려면 해당 영토에서의 활동이 더 필요합니다.</li>' +
      '</ul></section>'
    );
  }

  function renderRankPanel(d) {
    var abs = d.rankAbsolute;
    function condText(tier) {
      var th = abs[tier];
      if (!th) return '—';
      return (
        '글 호응 ' +
        th.postLikes +
        '+ · 댓글 호응 ' +
        th.commentLikes +
        '+ · 팔로워 ' +
        th.followers +
        '+'
      );
    }
    return (
      '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">명성 — 커뮤니티 영향력</h3>' +
      '<p class="perm-guide__lead">명성은 <strong>받은 호응</strong>으로 쌓입니다. 영토 안에서 영향력이 커질수록 더 높은 등급이 주어집니다. <strong>정치 성향</strong>이나 <strong>외계행성 체류</strong>와는 무관합니다.</p>' +
      '<table class="perm-guide__table"><thead><tr><th>등급</th><th>필요 조건</th><th>안내</th></tr></thead><tbody>' +
      '<tr><td><strong>참여 중</strong></td><td>—</td><td>Lv.' +
      d.rankUnlockLevel +
      ' 전이거나, 명성 여정을 막 시작한 단계</td></tr>' +
      '<tr><td><strong>논객</strong></td><td>' +
      esc(condText(2)) +
      '</td><td>의견이 주목받기 시작한 단계</td></tr>' +
      '<tr><td><strong>대표</strong></td><td>' +
      esc(condText(3)) +
      '</td><td>영토 정원에 따라 자리 조정될 수 있음</td></tr>' +
      '<tr><td><strong>지도자</strong></td><td>' +
      esc(condText(4)) +
      '</td><td>영토당 정해진 자리 · 만석 시 자리 조정</td></tr>' +
      '</tbody></table>' +
      '<ul class="perm-guide__list">' +
      '<li>명성 순위는 커뮤니티 호응을 바탕으로 정해집니다.</li>' +
      '<li>대표·지도자 자리가 꽉 차면 한 단계 낮은 등급으로 <strong>자리 조정</strong>될 수 있습니다.</li>' +
      '<li>남을 깎아 올리는 방식의 순위 경쟁은 없습니다.</li>' +
      '</ul></section>'
    );
  }

  function renderBoardPanel() {
    return (
      '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">SentenceArena 이용 안내</h3>' +
      '<p class="perm-guide__lead">정치·사회 의견을 나누는 커뮤니티입니다. 글을 읽고 반응하며 참여할 수 있습니다.</p>' +
      '<h4 class="perm-guide__subh">기본 이용방법</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>신규 회원은 <strong>중앙광장</strong>에서 시작합니다.</li>' +
      '<li>영토 지도에서 개척영토·중앙광장·수호영토·외계행성을 오갈 수 있습니다.</li>' +
      '<li>글을 읽고 <strong>좋아요 · 싫어요 · 공감</strong>으로 의견을 표현할 수 있습니다.</li>' +
      '<li>현재 소속 영토는 다른 이용자에게 공개됩니다. 정치성향의 세부 점수와 계산 내역은 공개되지 않습니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">좋아요 · 싫어요 · 공감</h4>' +
      '<ul class="perm-guide__list">' +
      '<li><strong>좋아요 · 싫어요</strong>는 성향의 흐름에 영향을 줄 수 있습니다.</li>' +
      '<li><strong>공감</strong>은 정치성향에 영향을 주지 않습니다.</li>' +
      '<li>글·댓글·반응은 레벨·명성·업적 같은 서비스 활동에도 연결될 수 있습니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">성향과 소속 영토</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>활동을 통해 성향 변화가 충분히 누적되면 소속 영토가 변경될 수 있습니다.</li>' +
      '<li>이용자가 영토를 골라 이동하는 구조가 아닙니다. 서비스 활동에 따라 자동으로 달라질 수 있습니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">개척 · 중앙 · 수호</h4>' +
      '<ul class="perm-guide__list">' +
      '<li><strong>개척영토</strong> — 개척 성향을 가진 이용자들이 소속될 수 있는 영토입니다.</li>' +
      '<li><strong>중앙광장</strong> — 조정·중재·협력의 중심 공간입니다. 신규 회원은 여기서 시작합니다.</li>' +
      '<li><strong>수호영토</strong> — 수호 성향을 가진 이용자들이 소속될 수 있는 영토입니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">외계행성</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>외계행성은 정치성향 영토가 아닙니다. 정치적 견해 때문에 이동하는 곳이 아닙니다.</li>' +
      '<li>반복적인 운영정책 위반 등 <strong>행동</strong> 문제와 관련된 관측·제한 영역입니다.</li>' +
      '<li>체류 중에는 지구 영토 일부에서 글·댓글 작성이 제한될 수 있습니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">레벨 · 명성 · 업적</h4>' +
      '<ul class="perm-guide__list">' +
      '<li><strong>레벨</strong>은 글·댓글 등 서비스 활동이 쌓이며 오릅니다. 정치성향 점수와는 별개입니다.</li>' +
      '<li><strong>명성</strong>은 다른 이용자의 호응으로 쌓이는 커뮤니티 영향력입니다.</li>' +
      '<li><strong>업적</strong>은 특정 활동을 달성했을 때 기록되는 표시입니다.</li>' +
      '<li>자세한 단계는 위쪽 <strong>레벨</strong> · <strong>명성</strong> 안내에서 확인할 수 있습니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">신고와 운영정책</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>욕설·광고·분쟁유도는 게시글/댓글의 <strong>일반 신고</strong>를 이용합니다.</li>' +
      '<li>명예훼손·개인정보·사진·저작권 등 본인 권리 문제는 <a href="/rights-infringement/">권리침해 처리 요청</a>으로 신청합니다. 비회원 본인확인은 준비 중이며, 지금은 로그인 회원이 소명과 증빙을 갖춰 신청합니다.</li>' +
      '<li>정치적 견해 자체는 제재 대상이 아닙니다. 반복적인 운영정책 위반 등 행동이 문제일 때만 제한될 수 있습니다.</li>' +
      '</ul></section>'
    );
  }

  function renderWorldPanel() {
    var cards = [
      {
        name: '중앙광장',
        body: '조정·중재·협력의 중심 공간입니다. 모든 신규 회원은 중앙광장에서 시작합니다.',
      },
      {
        name: '개척영토',
        body: '개척 성향을 가진 이용자들이 소속될 수 있는 영토입니다. 이용자가 골라 들어가는 곳이 아닙니다.',
      },
      {
        name: '수호영토',
        body: '수호 성향을 가진 이용자들이 소속될 수 있는 영토입니다. 이용자가 골라 들어가는 곳이 아닙니다.',
      },
      {
        name: '외계행성',
        body: '정치성향 영토가 아닙니다. 정치적 견해 때문에 가는 곳이 아니며, 반복적인 운영정책 위반 등 행동 문제와 관련된 관측·제한 영역입니다.',
      },
    ];
    var html = '';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      html +=
        '<article class="perm-guide__world-card">' +
        '<h4 class="perm-guide__subh">' +
        esc(c.name) +
        '</h4>' +
        '<p class="perm-guide__world-text">' +
        esc(c.body) +
        '</p></article>';
    }
    return (
      '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">영토 소개</h3>' +
      '<p class="perm-guide__lead">센텐스아레나는 활동에 따라 소속 영토가 달라질 수 있는 커뮤니티입니다. 영토를 직접 선택해 이동하는 구조가 아닙니다.</p>' +
      '<div class="perm-guide__world-grid">' +
      html +
      '</div>' +
      '<p class="perm-guide__footnote muted">3·4단계 영토와 추가 공간은 추후 공개됩니다.</p>' +
      '</section>'
    );
  }

  function renderPanel(sub) {
    var d = guideData();
    if (sub === 'rank') return renderRankPanel(d);
    if (sub === 'board') return renderBoardPanel();
    if (sub === 'world') return renderWorldPanel();
    return renderLevelPanel(d);
  }

  function syncSubTabs() {
    var nav = document.getElementById('perm-guide-subnav');
    if (!nav) return;
    var btns = nav.querySelectorAll('[data-perm-sub]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var on = b.getAttribute('data-perm-sub') === activeSub;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var panel = document.getElementById('perm-guide-panel');
    if (panel) panel.innerHTML = renderPanel(activeSub);
  }

  function init() {
    if (inited) return;
    var nav = document.getElementById('perm-guide-subnav');
    if (!nav) return;
    inited = true;
    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-perm-sub]');
      if (!btn) return;
      activeSub = btn.getAttribute('data-perm-sub') || 'level';
      syncSubTabs();
    });
    syncSubTabs();
  }

  function refresh() {
    if (!inited) init();
    else syncSubTabs();
  }

  global.PermissionsGuide = {
    init: init,
    refresh: refresh,
    setSubTab: function (sub) {
      activeSub = sub || 'level';
      syncSubTabs();
    },
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else if (document.getElementById('perm-guide-subnav')) {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : this);
