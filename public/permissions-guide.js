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
      '<p class="perm-guide__lead">글·댓글·이슈에 참여하며 쌓인 <strong>경험</strong>이 레벨을 올립니다. 레벨이 오를수록 <strong>더 넓은 영토</strong>를 탐색하고, <strong>명성 체계</strong>에 닿을 수 있습니다.</p>' +
      '<table class="perm-guide__table"><thead><tr><th>레벨</th><th>필요 경험</th><th>누적</th><th>열리는 것</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      '<ul class="perm-guide__list">' +
      '<li><strong>Lv.' +
      observeLv +
      '</strong> — 질서·개혁 영토의 글을 <strong>관측(열람)</strong>할 수 있습니다.</li>' +
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
      '<h3 class="perm-guide__h">영토별 이용</h3>' +
      '<p class="perm-guide__lead"><strong>정치 성향</strong>(개척·수호·중앙광장)과 <strong>외계행성</strong>(행동 관측)은 완전히 별개입니다. 아래는 각 공간이 <strong>어떤 곳인지</strong>, <strong>언제 열리는지</strong>만 안내합니다.</p>' +
      '<table class="perm-guide__table"><thead><tr><th>영토</th><th>어떤 공간인가</th><th>어떻게 열리나</th></tr></thead><tbody>' +
      '<tr><td><strong>중앙광장</strong></td><td>모두가 모이는 공용 광장</td><td>처음부터 자유롭게 이용</td></tr>' +
      '<tr><td><strong>수호영토</strong></td><td>안정과 구조를 중시하는 이용자들의 지역</td><td>수호 쪽 활동이 쌓일수록 단계가 열림</td></tr>' +
      '<tr><td><strong>개척영토</strong></td><td>변화와 실험을 선호하는 이용자들의 지역</td><td>개척 쪽 활동이 쌓일수록 단계가 열림</td></tr>' +
      '<tr><td><strong>외계행성</strong></td><td>과열된 행동을 관측·격리하는 특수 구역</td><td>반복적인 과열 행동이 감지되면 일정 기간 이동</td></tr>' +
      '<tr><td><strong>3·4단계</strong></td><td colspan="2">추후 공개</td></tr>' +
      '</tbody></table>' +
      '<h4 class="perm-guide__subh">성향 — 개척 · 수호 · 중앙광장</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>중앙광장·수호·개척에서의 활동이 <strong>나의 성향</strong>을 형성합니다.</li>' +
      '<li>수호·개척 영토는 <strong>해당 성향 활동</strong>이 이어질수록 더 깊은 단계 게시판이 열립니다.</li>' +
      '<li>아직 열리지 않은 단계는 <strong>관측(열람)</strong>만 가능할 수 있습니다.</li>' +
      '<li><strong>공감</strong>은 성향에 영향을 주지 않습니다. <strong>좋아요·싫어요</strong>만 성향에 반영됩니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">외계행성 — 행동 관측</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>정치 성향과 <strong>무관</strong>합니다. 도배·과열·반복 신고 등 <strong>행동</strong>이 문제일 때만 이동합니다.</li>' +
      '<li>체류 중에는 지구 영토 일부에서 <strong>글·댓글 작성이 제한</strong>되고, 기록은 외계행성에서 이어집니다.</li>' +
      '<li>지구 게시판에 남은 흔적은 「외계 관측구역 전용 표현입니다」로 표시될 수 있습니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">지원</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>욕설·광고·분쟁유도는 게시글/댓글의 <strong>일반 신고</strong>를 이용합니다.</li>' +
      '<li>명예훼손·개인정보·사진·저작권 등 본인 권리 문제는 <a href="/rights-infringement/">권리침해 처리 요청</a>으로 신청합니다. 비회원도 신청할 수 있습니다.</li>' +
      '</ul></section>'
    );
  }

  function renderWorldPanel() {
    var cards = [
      {
        name: '중앙광장',
        body: '모든 이용자가 자유롭게 모이는 공용 공간입니다. 처음 만나는 사람들의 이야기, 일상, 논쟁이 이곳에서 시작됩니다.',
      },
      {
        name: '수호영토',
        body: '안정과 구조를 중시하는 이용자들이 모이는 지역입니다. 수호 쪽 성향이 두드러질수록 더 깊은 공간이 열립니다.',
      },
      {
        name: '개척영토',
        body: '변화와 실험을 선호하는 이용자들이 모이는 지역입니다. 개척 쪽 성향이 두드러질수록 더 깊은 공간이 열립니다.',
      },
      {
        name: '외계행성',
        body: '과열된 행동을 관측·격리하는 특수 구역입니다. 정치 성향과는 별개로, 커뮤니티 질서를 지키기 위한 공간입니다.',
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
      '<p class="perm-guide__lead">센텐스아레나는 <strong>영토</strong>마다 다른 분위기와 규칙을 가진 커뮤니티입니다. 어디서 활동하느냐에 따라 열리는 공간이 달라집니다.</p>' +
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
