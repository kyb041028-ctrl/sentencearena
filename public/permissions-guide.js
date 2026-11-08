/**
 * 레벨·명성·영토 안내 (상단 탭 화면 — 세계관 규칙 중심)
 */
(function (global) {
  'use strict';

  var SUB_TABS = [
    { id: 'level', label: '레벨' },
    { id: 'rank', label: '명성' },
    { id: 'citizen-rank', label: '계급 안내' },
    { id: 'election', label: '선거·탄핵' },
    { id: 'board', label: '이용 안내' },
    { id: 'world', label: '영토' },
    { id: 'faq', label: '자주 묻는 질문' },
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
        growth = '경험치는 계속 쌓입니다. 계급은 레벨과 따로 정합니다';
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
      '</strong> — 진보·보수 영토의 글을 <strong>관측(열람)</strong>할 수 있습니다.</li>' +
      '<li><strong>Lv.' +
      rankLv +
      '</strong> — 활동 경험이 더 쌓입니다. 계급은 이 레벨로 정하지 않습니다. 계급 안내를 보세요.</li>' +
      '<li>레벨과 성향은 별개입니다. 영토 깊숙이 <strong>참여(글·댓글)</strong>하려면 해당 영토에서의 활동이 더 필요합니다.</li>' +
      '</ul></section>'
    );
  }

  function renderRankPanel() {
    return (
      '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">명성 — 커뮤니티 영향력</h3>' +
      '<p class="perm-guide__lead">명성 점수는 다른 사람의 호응으로 쌓입니다. 정치 성향이나 외계영토 체류와는 별개입니다. 시민 계급은 명성 점수만으로 정하지 않습니다. 다섯 단계는 <strong>계급 안내</strong>에 있습니다.</p>' +
      '</section>'
    );
  }

  function renderCitizenRankPanel(english) {
    if (english) {
      return (
        '<section class="perm-guide__section">' +
        '<h3 class="perm-guide__h">Rank guide</h3>' +
        '<p class="perm-guide__lead">The English words below are temporary explanations. Official English rank names are not set. Korea and the United States use the same rules, and each country counts its own members.</p>' +
        '<table class="perm-guide__table"><thead><tr><th>Order</th><th>Temporary wording</th><th>Meaning and seats</th></tr></thead><tbody>' +
        '<tr><td>1</td><td>Citizen</td><td>Default rank. At least 70% of the people who are left after the higher fixed seats.</td></tr>' +
        '<tr><td>2</td><td>Debater</td><td>At most 30% of those remaining people.</td></tr>' +
        '<tr><td>3</td><td>Elder</td><td>At most 50 people in one territory.</td></tr>' +
        '<tr><td>4</td><td>Representative</td><td>At most 10 people in one territory. An elected leader is not part of this 10.</td></tr>' +
        '<tr><td>5</td><td>Leader</td><td>One elected seat in the progressive territory and one in the conservative territory. The seat starts empty.</td></tr>' +
        '</tbody></table>' +
        '<ul class="perm-guide__list">' +
        '<li>A seat stays empty when not enough people qualify.</li>' +
        '<li>Promotion and keeping a rank depend on how other people evaluate you, more than on how much you post.</li>' +
        '<li>The mix is fame 45%, unique positive evaluators 30%, evaluation reactions 15%, and followers 10%, using the last 90 days plus cumulative fame. The exact normalization is not set, so this screen does not show a personal score.</li>' +
        '<li>The first time you qualify, unique positive evaluators must reach max(10, ceil(territory population × 0.02)) for Debater, max(50, ceil(territory population × 0.05)) for Elder, and max(100, ceil(territory population × 0.10)) for Representative. Each rank checks that only once.</li>' +
        '<li>Ranks refresh on Wednesday at 00:00. The clock timezone is not set. Promotion and demotion happen when that refresh finishes. A tie keeps the current rank. A cap cannot be exceeded.</li>' +
        '<li>The leader is chosen by election, not by this weekly score.</li>' +
        '</ul></section>'
      );
    }
    return (
      '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">계급 안내</h3>' +
      '<p class="perm-guide__lead">시민 계급은 다섯 단계입니다. 한국과 미국은 같은 제도이고, 회원·인구·평가·정원은 나라마다 따로 셉니다.</p>' +
      '<table class="perm-guide__table"><thead><tr><th>순서</th><th>명칭</th><th>의미와 최대 인원</th></tr></thead><tbody>' +
      '<tr><td>1</td><td><strong>시민</strong></td><td>기본 계급. 고정 자리를 뺀 잔여 인원의 최소 70%.</td></tr>' +
      '<tr><td>2</td><td><strong>논객</strong></td><td>잔여 인원의 최대 30%.</td></tr>' +
      '<tr><td>3</td><td><strong>원로</strong></td><td>영토당 최대 50명.</td></tr>' +
      '<tr><td>4</td><td><strong>대표</strong></td><td>영토당 최대 10명. 당선된 지도자는 이 10명에 넣지 않습니다.</td></tr>' +
      '<tr><td>5</td><td><strong>지도자</strong></td><td>진보 영토 1명, 보수 영토 1명. 선거로 뽑으며 처음에는 비어 있습니다.</td></tr>' +
      '</tbody></table>' +
      '<ul class="perm-guide__list">' +
      '<li>자격 인원이 모자라면 그 자리는 채우지 않습니다.</li>' +
      '<li>승급과 유지는 내가 쓴 글의 양보다 다른 사람의 평가를 더 봅니다.</li>' +
      '<li>상대평가는 명성 45%, 고유 긍정 평가자 30%, 평가 반응 15%, 팔로워 10%입니다. 최근 90일 평가와 누적 명성을 함께 봅니다. 정규화 산식은 정해지지 않아서 이 화면은 개인 점수를 보여 주지 않습니다.</li>' +
      '<li>최초 자격은 누적 고유 긍정 평가자입니다. 논객은 max(10, ceil(영토인구 × 0.02)), 원로는 max(50, ceil(영토인구 × 0.05)), 대표는 max(100, ceil(영토인구 × 0.10))입니다. 계급마다 처음 한 번만 봅니다.</li>' +
      '<li>평가는 매주 수요일 00:00에 갱신되고, 끝나면 바로 오르거나 내려갑니다. 시간대는 정해지지 않았습니다. 동점이면 기존 계급을 유지합니다. 정원은 넘길 수 없습니다.</li>' +
      '<li>지도자는 이 주간 점수가 아니라 선거로 뽑습니다.</li>' +
      '</ul></section>'
    );
  }

  function renderElectionPanel(english) {
    if (english) {
      return (
        '<section class="perm-guide__section">' +
        '<h3 class="perm-guide__h">Elections and impeachment</h3>' +
        '<p class="perm-guide__lead">Not available yet. You can read the rules. There is no way to vote or file from this screen.</p>' +
        '<ul class="perm-guide__list">' +
        '<li>A leader election opens when that territory has at least 1,000 valid members. A valid member wrote a post or comment there in the last 30 days.</li>' +
        '<li>Only a representative who asks to run can be a candidate. Every valid member of that territory has one vote. The vote lasts 48 hours. A sole candidate wins. The term is one season and a person may serve again. The season length and dates are not set.</li>' +
        '<li>Only a current representative may propose impeachment. Representatives vote for 24 hours. At least 5 of them must cast a yes or no, and a majority of those votes must be yes, before every citizen votes. Abstentions are not counted.</li>' +
        '<li>The citizen vote lasts 48 hours. The voter roll is fixed when it starts. It passes only when at least 20% of the voters take part and a majority of the valid votes are yes. A tie fails. Failure blocks the same proposal for 28 days. Passage removes the leader at once.</li>' +
        '<li>After removal the seat stays empty for 7 days, then 3 days of filing, 2 days of checks, and a 48-hour election.</li>' +
        '<li>The progressive leader and the conservative leader announce a topic on alternate Mondays. Each side submits the title and text from the previous Friday through Sunday. It is posted for open discussion on that country\'s central board. A vacant side skips that week, and the rotation stays. This is separate from the automatic Daily Issue.</li>' +
        '</ul></section>'
      );
    }
    return (
      '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">선거 · 탄핵</h3>' +
      '<p class="perm-guide__lead">준비 중. 규칙만 읽을 수 있습니다. 이 화면에서 투표하거나 신청할 수 없습니다.</p>' +
      '<ul class="perm-guide__list">' +
      '<li>지도자 선거는 그 영토의 유효 인구가 1000명 이상일 때 열립니다. 유효 인구는 최근 30일 안에 그 영토에서 글 또는 댓글을 쓴 회원입니다.</li>' +
      '<li>후보는 대표 가운데 출마를 희망한 사람만입니다. 그 영토의 유효 회원은 1인 1표입니다. 선거는 48시간입니다. 후보가 한 명이면 자동 당선입니다. 임기는 시즌 단위이고 연임할 수 있습니다. 시즌 길이와 날짜는 정해지지 않았습니다.</li>' +
      '<li>탄핵은 현직 대표만 발의합니다. 대표 의결은 24시간입니다. 찬반을 실제로 표한 대표가 최소 5명이고, 그 참여자 과반이 찬성이면 시민 투표로 넘어갑니다. 기권과 무응답은 표 수에서 뺍니다.</li>' +
      '<li>시민 투표는 48시간입니다. 유권자 명부는 시작할 때 고정합니다. 유권자의 20% 이상이 참여하고 유효표의 찬성이 과반이면 가결입니다. 동률은 부결입니다. 부결되면 같은 발의는 28일 동안 다시 할 수 없습니다. 가결되면 바로 해임합니다.</li>' +
      '<li>해임 뒤 7일은 공석입니다. 그다음 후보 접수 3일, 검증 2일, 재선거 48시간입니다.</li>' +
      '<li>대표의제는 진보 지도자와 보수 지도자가 월요일마다 번갈아 냅니다. 각 진영은 격주입니다. 직전 금요일부터 일요일까지 제목과 본문을 냅니다. 그 나라의 중앙 게시판에 자유 토론으로 올립니다. 공석인 차례는 내지 않고, 순서는 유지합니다. 자동 Daily Issue와는 별개입니다.</li>' +
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
      '<li>영토 지도에서 진보영토·중앙광장·보수영토·외계영토를 오갈 수 있습니다.</li>' +
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
      '<h4 class="perm-guide__subh">진보 · 중앙 · 보수</h4>' +
      '<ul class="perm-guide__list">' +
      '<li><strong>진보영토</strong> — 진보 성향을 가진 이용자들이 소속될 수 있는 영토입니다.</li>' +
      '<li><strong>중앙광장</strong> — 조정·중재·협력의 중심 공간입니다. 신규 회원은 여기서 시작합니다.</li>' +
      '<li><strong>보수영토</strong> — 보수 성향을 가진 이용자들이 소속될 수 있는 영토입니다.</li>' +
      '</ul>' +
      '<h4 class="perm-guide__subh">외계영토</h4>' +
      '<ul class="perm-guide__list">' +
      '<li>외계영토는 정치성향 영토가 아닙니다. 정치적 견해 때문에 이동하는 곳이 아닙니다.</li>' +
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
      '<li>로그인 회원은 상단 <strong>제재 및 이의제기</strong>에서 본인 제재와 이의 결과를 확인할 수 있습니다.</li>' +
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
        name: '진보영토',
        body: '진보 성향을 가진 이용자들이 소속될 수 있는 영토입니다. 이용자가 골라 들어가는 곳이 아닙니다.',
      },
      {
        name: '보수영토',
        body: '보수 성향을 가진 이용자들이 소속될 수 있는 영토입니다. 이용자가 골라 들어가는 곳이 아닙니다.',
      },
      {
        name: '외계영토',
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

  function renderFaqPanel() {
    var questions = [
      ['SentenceArena는 어떤 곳인가요?', '서로 다른 의견을 읽고, 글과 댓글로 이야기하는 토론 공간입니다. 중앙광장에서 시작해 다른 시민들과 의견을 나눠보세요.'],
      ['처음인데 무엇부터 하면 되나요?', '중앙광장에 들어가 관심 있는 글을 읽어보세요. 첫 시민 안내에서는 화면에서 눌러야 할 곳을 차례로 알려드립니다. 안내는 건너뛸 수 있습니다.'],
      ['처음 안내를 다시 볼 수 있나요?', '로그인한 뒤 이 화면 위쪽의 ‘첫 시민 안내 다시 보기’를 누르면 됩니다. 안내 중 반응 연습은 실제 게시글 반응이나 성장 기록에 남지 않습니다.'],
      ['좋아요·싫어요와 공감은 어떻게 다른가요?', '좋아요·싫어요는 의견에 대한 반응입니다. 공감은 별도의 표현이며, 성향에 영향을 주지 않아요. 다른 시민에게 받은 공감은 명성으로 이어집니다.'],
      ['레벨과 명성, 계급은 같은 건가요?', '다릅니다. 레벨은 활동 경험이고, 명성은 받은 호응입니다. 계급은 시민, 논객, 원로, 대표, 지도자의 다섯 단계입니다. 선거와 탄핵은 준비 중이며, 위쪽 계급 안내와 선거·탄핵에서 규칙을 읽을 수 있습니다.'],
      ['가입할 때 영토를 고르나요?', '아니요. 새 회원은 중앙에서 시작합니다. 성향 정보 처리에 별도로 동의한 경우 관련 활동에 따라 성향과 소속 영토가 달라질 수 있습니다. 레벨이나 명성과는 별개입니다.'],
      ['외계는 특정 성향을 가진 사람의 영토인가요?', '아니요. 외계는 행동에 대한 운영 조치와 관련된 공간입니다. 의견이나 성향 자체는 제재 이유가 아니며, 신고가 많다는 이유만으로 자동 제재되는 것도 아닙니다.'],
      ['가입하지 않고 둘러볼 수 있나요?', '게스트로 둘러볼 수 있습니다. 글·댓글 작성, 반응, 신고 등 참여 기능에는 회원 로그인이 필요합니다.'],
      ['문제가 있는 글은 어디로 신고하나요?', '해당 게시글의 ‘신고’에서 일반 신고를 선택하세요. 단순히 의견이 다르다는 이유로 신고하지 말고, 문제가 된 행동을 기준으로 알려주세요.'],
      ['개인정보나 저작권 침해는 어떻게 요청하나요?', '로그인 후 게시글의 ‘신고’에서 ‘권리침해 처리 요청’을 선택하세요. 일반 신고와 별도 절차입니다. 비회원 본인확인은 준비 중이며, 지금은 로그인한 회원이 소명과 증빙을 갖춰 신청합니다. 권리 당사자 또는 정당한 대리인이 신청합니다.'],
      ['제재에 대해 이의를 제기하려면 어떻게 하나요?', '로그인 후 ‘제재 및 이의제기’에서 본인 제재와 처리 결과를 확인하세요. 이의제기가 가능한 경우 화면의 안내를 따라 신청할 수 있습니다.'],
      ['회원탈퇴는 어디서 하나요?', '로그인 후 ‘설정’을 열고, ‘계정 관리’에서 ‘회원탈퇴’를 누르세요. 계정을 삭제하는 절차이며, 설정의 동의 철회와는 별도입니다. 화면의 안내와 주의사항을 확인하세요.'],
    ];
    return '<section class="perm-guide__section">' +
      '<h3 class="perm-guide__h">자주 묻는 질문</h3>' +
      '<p class="perm-guide__lead">궁금한 질문을 누르면 답변이 펼쳐집니다.</p>' +
      questions.map(function (item) {
        return '<details class="perm-guide__world-card"><summary class="perm-guide__subh">' +
          esc(item[0]) + '</summary><p class="perm-guide__world-text">' + esc(item[1]) + '</p></details>';
      }).join('') +
      '<h4 class="perm-guide__subh">문의하기</h4>' +
      '<p class="perm-guide__world-text">일반 질문, 오류 제보, 로그인 문제는 이메일로 보내주세요.</p>' +
      '<p><a class="sc-btn sc-btn--secondary" href="/inquiry/">문의 페이지로 이동 (로그인 회원)</a></p>' +
      '<p><a class="sc-btn sc-btn--secondary" href="mailto:sentencearena@gmail.com">이메일 문의</a></p>' +
      '<p class="perm-guide__world-text">sentencearena@gmail.com</p>' +
      '<p class="perm-guide__footnote muted">버튼을 누르면 기기의 메일 앱이 열립니다. 열리지 않으면 위 주소를 복사해 이용하는 메일에서 보내주세요. 비밀번호·인증코드는 보내지 말고, 오류 화면의 개인정보는 가려주세요. 이 주소는 일반 문의입니다. 메일을 보내도 동의 철회나 회원탈퇴가 자동으로 처리되지 않습니다.</p>' +
      '<p class="perm-guide__footnote muted">이용약관, 개인정보, 운영정책, 신고, 권리침해, 탈퇴, 동의 철회, 고객지원 안내는 <a href="/legal/">검토용 문서</a>에 있습니다. 법적 최종본이 아니며, 센브릿지(SENBRIDGE)는 사용할 예정인 이름이고 등록된 사업자가 아닙니다.</p>' +
      '</section>';
  }

  function usScreen() {
    return !!(global.SAActivityRegion && global.SAActivityRegion.get() === 'US');
  }

  function renderUsPanel(sub) {
    if (sub === 'citizen-rank') return renderCitizenRankPanel(true);
    if (sub === 'election') return renderElectionPanel(true);
    if (sub === 'rank') {
      return '<section class="perm-guide__section"><h3 class="perm-guide__h">Fame</h3><p class="perm-guide__lead">Fame is recognition from other people. It is not the same as citizen rank. The five ranks are in Rank guide. This screen does not show a Korean member\'s fame score.</p></section>';
    }
    if (sub === 'board') {
      return '<section class="perm-guide__section"><h3 class="perm-guide__h">How to take part</h3><p class="perm-guide__lead">Level is experience from taking part. Territory follows activity, not a choice at signup. Citizen rank is a separate five-step guide. United States tendency scores stay off.</p></section>';
    }
    if (sub === 'world') {
      return '<section class="perm-guide__section"><h3 class="perm-guide__h">Territories and tendency</h3><p class="perm-guide__lead">Progressive Territory, Central Plaza, Conservative Territory, and Alien Territory. Members do not pick a territory at signup. Alien Territory is about conduct, not political tendency. Counts on the map are not mixed with Korean members.</p></section>';
    }
    if (sub === 'faq') {
      return '<section class="perm-guide__section"><h3 class="perm-guide__h">FAQ</h3><p class="perm-guide__lead">Level, fame, and citizen rank are different. The ranks run Citizen, Debater, Elder, Representative, and Leader as temporary English wording. Elections and impeachment are not available yet.</p></section>';
    }
    return '<section class="perm-guide__section"><h3 class="perm-guide__h">Level and experience</h3><p class="perm-guide__lead">Level rises from posts, comments, and issue participation. It does not set citizen rank, and a Korean member\'s experience total is not shown here.</p></section>';
  }

  function renderPanel(sub) {
    if (usScreen()) return renderUsPanel(sub);
    if (sub === 'faq') return renderFaqPanel();
    var d = guideData();
    if (sub === 'rank') return renderRankPanel();
    if (sub === 'citizen-rank') return renderCitizenRankPanel(false);
    if (sub === 'election') return renderElectionPanel(false);
    if (sub === 'board') return renderBoardPanel();
    if (sub === 'world') return renderWorldPanel();
    return renderLevelPanel(d);
  }

  function syncSubTabs() {
    var nav = document.getElementById('perm-guide-subnav');
    if (!nav) return;
    var labels = usScreen()
      ? {
          level: 'Level',
          rank: 'Fame',
          'citizen-rank': 'Rank guide',
          election: 'Elections and impeachment',
          board: 'How to take part',
          world: 'Territories',
          faq: 'FAQ',
        }
      : {
          level: '레벨',
          rank: '명성',
          'citizen-rank': '계급 안내',
          election: '선거·탄핵',
          board: '이용 안내',
          world: '영토',
          faq: '자주 묻는 질문',
        };
    var btns = nav.querySelectorAll('[data-perm-sub]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var on = b.getAttribute('data-perm-sub') === activeSub;
      var key = b.getAttribute('data-perm-sub');
      if (labels[key]) b.textContent = labels[key];
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var panel = document.getElementById('perm-guide-panel');
    if (panel) panel.innerHTML = renderPanel(activeSub);
    if (usScreen()) {
      var intro = document.querySelector('.perm-guide__intro');
      if (intro) {
        intro.textContent = 'This guide is for the United States screen. Korean level, fame, and achievement scores are not shown here.';
      }
    }
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
