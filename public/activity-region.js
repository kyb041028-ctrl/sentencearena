/**
 * 활동 국가 화면.
 * 한국 저장 키는 그대로 두고, 미국만 ::US 키를 쓴다.
 * 인증 세션 키는 나누지 않는다.
 */
(function () {
  var core = window.ActivityRegionCore;
  if (!core || !window.localStorage) return;

  var EXPLICIT_KEY = 'sa_activity_region_explicit';

  function readExplicit() {
    try {
      return core.normalizeRegion(localStorage.getItem(EXPLICIT_KEY));
    } catch (err) {
      return null;
    }
  }

  var pathRegion = core.pathRegion(window.location.pathname);
  var explicit = readExplicit();
  if (!pathRegion && explicit) {
    window.location.replace(explicit === 'US' ? '/us' : '/kr');
    return;
  }

  var region = pathRegion || explicit || 'KR';
  var pending = !pathRegion && !explicit;
  if (pending) document.documentElement.classList.add('sa-region-pending');

  if (region === 'US') {
    document.documentElement.lang = 'en';
    var proto = window.Storage && window.Storage.prototype;
    if (proto && !proto.__saRegionScoped) {
      var getItem = proto.getItem;
      var setItem = proto.setItem;
      var removeItem = proto.removeItem;
      proto.getItem = function (key) {
        if (this === window.localStorage && core.isScopedStorageKey(key)) {
          return getItem.call(this, core.storageKey(key, 'US'));
        }
        return getItem.call(this, key);
      };
      proto.setItem = function (key, value) {
        if (this === window.localStorage && core.isScopedStorageKey(key)) {
          return setItem.call(this, core.storageKey(key, 'US'), value);
        }
        return setItem.call(this, key, value);
      };
      proto.removeItem = function (key) {
        if (this === window.localStorage && core.isScopedStorageKey(key)) {
          return removeItem.call(this, core.storageKey(key, 'US'));
        }
        return removeItem.call(this, key);
      };
      proto.__saRegionScoped = true;
    }
  }

  var TEXT = {
    'app-title': 'SentenceArena',
    'tab-main': 'Territories',
    'tab-guide': 'Guide',
    'tab-history': 'History',
    'guest': 'Look around as guest',
    'login': 'Log in',
    'signup': 'Sign up',
    'lead': 'Enter the arena.',
    'activity': 'Recent activity',
    'signup-label': 'First activity country, not nationality',
    'guest-hint': 'You can look around without an account.',
  };

  var PHRASE = {
    '문장이 영토를 만들고': 'Sentences build territories',
    '토론이 세계를 움직인다': 'Debate moves the world',
    '성향은 흐름일 뿐,': 'Tendency is only a current,',
    '제재의 기준은 행동입니다.': 'Conduct is the line for action.',
    '접속중입니다..': 'Connecting...',
    '게스트로 둘러보는 중': 'Looking around as a guest',
    '나가기': 'Leave',
    '로그아웃': 'Log out',
    '로그인': 'Log in',
    '회원가입': 'Sign up',
    '회원가입하기': 'Create an account',
    '처음 화면으로': 'Back to the start',
    '글쓰기': 'Write',
    '자유 글쓰기': 'Write a free post',
    '첫 글 쓰기': 'Write the first post',
    '운영': 'Staff',
    '게시판으로 이동': 'Open the board',
    '← 영토 지도로': '← Territory map',
    '영토 지도로': 'Territory map',
    '현재 단계': 'Current stage',
    '다음 단계까지': 'To the next stage',
    '발전 진행': 'Progress',
    '인구': 'Population',
    '실제 인구': 'Live population',
    '집계 중': 'Counting',
    '최고 단계': 'Highest stage',
    '운영 인구 연결 없음. 로컬 폴백 수치입니다.': 'No live population connection. These are local fallback numbers.',
    '운영 인구 연결 없음.': 'No live population connection.',
    '아직 기록된 활동이 없습니다.': 'No activity yet.',
    '접기': 'Collapse',
    '펼치기': 'Expand',
    '명성 : 참여자': 'Reputation: no United States score yet',
    '시민': 'Citizen',
    '주민': 'resident',
    '아바타 변경': 'Change avatar',
    '성향 지도': 'Tendency map',
    '성향 한눈에 보기': 'Tendency at a glance',
    '활동에 따라 네 축 성향이 변합니다.': 'United States tendency scores stay off.',
    '상세 수치는 차트에 마우스를 올리면 표시됩니다.': 'United States tendency scores stay off (US_SENTENCE_MODEL_MISSING).',
    '집계 중': 'Counting',
    '성장 · 명성 · 영토 안내': 'Level, reputation, and territory',
    '레벨': 'Level',
    '가입된 계정이 없습니다.': 'No account was found.',
    '회원가입을 진행해주세요.': 'Please sign up.',
    '로그인할 계정을 선택하세요.': 'Choose an account to log in.',
    '회원가입 후 이용할 수 있습니다.': 'Sign up to use this.',
    '로그인한 회원만 동의 상태를 확인할 수 있습니다.': 'Only a signed-in member can check consent.',
    '명성 : —': 'Reputation: no United States score yet',
    '대화하는 사람': 'No United States profile yet',
    '명성': 'Reputation',
    '영토': 'Territory',
    '광장 대화': 'Plaza chat',
    '전체채팅': 'All chat',
    '해당소속채팅': 'Territory chat',
    '광장의 짧은 대화가 이곳에 흐릅니다.': 'Short plaza notes show up here.',
    '첫 인사를 남겨보세요.': 'Leave the first hello.',
    '전송': 'Send',
    '데일리 이슈': 'Daily issue',
    '일간': 'Day',
    '주간': 'Week',
    '월간': 'Month',
    '아직 인기글이 없습니다.': 'No popular posts yet.',
    '새로운 토론이 시작되면 이곳에 표시됩니다.': 'New debate will show up here.',
    '실시간 영토 현황': 'Live territory',
    '나의 성향': 'Tendency',
    '나의 성향 지도: 중립': 'United States tendency scores stay off (US_SENTENCE_MODEL_MISSING).',
    '[RTS] 실시간 여론 이동': 'Live movement',
    '진보 1단 핫 TOP3': 'Progressive hot posts',
    '보수 1단 핫 TOP3': 'Conservative hot posts',
    '표시할 핫글이 없습니다.': 'No popular posts yet.',
    '진보 · TOP3': 'Progressive · top 3',
    '보수 · TOP3': 'Conservative · top 3',
    '표시할 글이 없습니다.': 'No posts to show.',
    '게시글': 'Posts',
    '· 자유 토론': '· Open debate',
    '· 정보·분석': '· Briefing',
    '· 유머·가벼운글': '· Light',
    '첫 시민 안내 다시 보기': 'Show the first-visit guide again',
    '준비중': 'Not ready',
    '팔로워': 'Followers',
    '방문자': 'Visitor',
    '개인정보 및 동의': 'Privacy and consent',
    '정치 관련 정보 처리 / 소속 영토 공개': 'Political information and territory visibility',
    '동의 상태를 확인하는 중...': 'Checking consent...',
    '동의 철회': 'Withdraw consent',
    '계정 관리': 'Account',
    '계정을 삭제하는 회원탈퇴입니다. 위의 동의 철회와 별도입니다.': 'Deleting an account is separate from withdrawing consent.',
    '회원탈퇴': 'Delete account',
    '모두 읽음': 'Mark all read',
    '새 알림이 없습니다.': 'No alerts yet.',
    '이용 안내': 'How to use',
    '자주 묻는 질문': 'FAQ',
    '영토 선택': 'Choose a territory',
    '프로필': 'Profile',
    '대화': 'Chat',
    '랭킹': 'Ranking',
    '기록': 'Record',
    '설정': 'Settings',
    '알림': 'Alerts',
    'UI 편집': 'Edit layout',
    '대표 에디터': 'Lead editor',
    '최신글': 'Latest',
    '인기글': 'Popular',
    '토론중': 'In debate',
    '신규': 'New',
    '전체': 'All',
    '자유 토론': 'Open debate',
    '유머·가벼운글': 'Light',
    '정보·분석': 'Briefing',
    '글 성격': 'Post type',
    '눈팅 모드': 'Read only',
    '읽기만 가능합니다. 글쓰기·댓글·반응은 해금 후 이용할 수 있습니다.': 'Reading is open. Writing, comments, and reactions unlock later.',
    '확인': 'OK',
    '취소': 'Cancel',
    '등록': 'Post',
    '닫기': 'Close',
    '이전': 'Previous',
    '다음': 'Next',
    '팔로우': 'Follow',
    '댓글': 'Comments',
    '공감': 'Agree',
    '추천': 'Upvote',
    '비추천': 'Downvote',
    '저장': 'Save',
    '공유': 'Share',
    '신고': 'Report',
    '제목': 'Title',
    '광장 정보': 'Plaza info',
    '영토 성장': 'Territory growth',
    '최근 댓글 글': 'Recent comments',
    '토론 활발': 'Active debate',
    '새 글': 'New posts',
    '아직 등록된 글이 없습니다.': 'No posts yet.',
    '첫 번째 이야기를 남겨보세요.': 'Leave the first note.',
    '이 범위에 댓글이 없습니다.': 'No comments in this range.',
    '이 범위에 댓글이나 공감이 있는 글이 없습니다.': 'No active posts in this range.',
    '이 범위에 글이 없습니다.': 'No posts in this range.',
    '1단계 눈팅 모드': 'Stage 1 is read only',
    '2단계 눈팅 모드': 'Stage 2 is read only',
    '좌표 에디터': 'Layout editor',
    '〈 이전': '〈 Previous',
    '다음 〉': 'Next 〉',
    '현재 활동 유저': 'People here now',
    '명': ' people',
    '원시': 'Primitive',
    '고대': 'Ancient',
    '중세': 'Medieval',
    '근대': 'Modern',
    '현대': 'Present',
    '미래': 'Future',
    '문명탄생': 'First spark',
    '문명형성': 'Forming',
    '문명발전': 'Growing',
    '문명확장': 'Spreading',
    '문명번영': 'Thriving',
    '문명포화': 'Full',
    '진보영토': core.US_TERRITORY_LABELS.pioneer,
    '중앙광장': core.US_TERRITORY_LABELS.central,
    '보수영토': core.US_TERRITORY_LABELS.guardian,
    '외계영토': core.US_TERRITORY_LABELS.alien,
    '진보': 'Progressive',
    '보수': 'Conservative',
    '외계': 'Alien',
    '중앙': 'Central',
    '새로운 가능성과 변화를 이야기하는 공간': 'A room for change and what could be next',
    '서로 다른 관점이 만나 대화하는 공간': 'A room where different views still talk',
    '원칙과 질서, 지켜야 할 가치를 이야기하는 공간': 'A room for rules worth keeping',
    '기존의 틀을 벗어나 자유롭게 관찰하고 이야기하는 공간': 'A room for watching conduct, apart from political tendency',
    '1 · 개방구역': '1 · Open zone',
    '2 · 심화토론': '2 · Deeper debate',
    '3 · 상위구역': '3 · Upper zone',
    '4 · 지도층': '4 · Leadership',
  };

  var PART = [
    ['진보영토', core.US_TERRITORY_LABELS.pioneer],
    ['보수영토', core.US_TERRITORY_LABELS.guardian],
    ['외계영토', core.US_TERRITORY_LABELS.alien],
    ['중앙광장', core.US_TERRITORY_LABELS.central],
    ['개방구역', 'Open zone'],
    ['심화토론', 'Deeper debate'],
    ['상위구역', 'Upper zone'],
    ['지도층', 'Leadership'],
    ['광장', 'Plaza'],
  ];

  function translateRaw(raw) {
    if (!raw) return raw;
    var trimmed = String(raw).trim();
    if (!trimmed) return raw;
    if (PHRASE[trimmed]) return String(raw).replace(trimmed, PHRASE[trimmed]);
    var more = trimmed.match(/^([\d,]+)명 더 필요$/);
    if (more) return String(raw).replace(trimmed, more[1] + ' more people');
    var fallback = trimmed.match(/^([\d,]+)명 · 폴백$/);
    if (fallback) return String(raw).replace(trimmed, fallback[1] + ' people · fallback');
    var people = trimmed.match(/^([\d,]+)명$/);
    if (people) return String(raw).replace(trimmed, people[1] + ' people');
    var stage = trimmed.match(/^단계 (\d+)$/);
    if (stage) return String(raw).replace(trimmed, 'Stage ' + stage[1]);
    return raw;
  }

  function applyEnglish(root) {
    if (region !== 'US' || !root || !root.querySelectorAll) return;
    document.documentElement.lang = 'en';
    document.title = 'SentenceArena';
    var marked = root.querySelectorAll('[data-sa-i18n]');
    for (var i = 0; i < marked.length; i++) {
      var key = marked[i].getAttribute('data-sa-i18n');
      if (TEXT[key] && marked[i].textContent !== TEXT[key]) marked[i].textContent = TEXT[key];
    }
    var skip = 'script, style, noscript, textarea, input, select, option, [data-sa-region], [data-sa-us-score]';
    var contentSkip = '.board__item-title, .board__item-snippet, .board-post-detail__body, .board__comment, .board__comments';
    var partRoot = '#board-title, #board-stage-tabs, #board-kanta-tagline, .sc-tcard__name, [data-sc-tdetail-name]';
    if (!document.createTreeWalker) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || parent.closest(skip)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (var t = 0; t < texts.length; t++) {
      var node = texts[t];
      var parent = node.parentElement;
      var inContent = parent && parent.closest(contentSkip);
      var next = inContent ? node.nodeValue : translateRaw(node.nodeValue);
      if (!inContent && parent && parent.closest(partRoot)) {
        for (var p = 0; p < PART.length; p++) {
          if (next.indexOf(PART[p][0]) !== -1) next = next.split(PART[p][0]).join(PART[p][1]);
        }
      }
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    var activeUsers = document.getElementById('board-active-users');
    if (activeUsers) {
      var bits = activeUsers.childNodes;
      for (var b = 0; b < bits.length; b++) {
        if (bits[b].nodeType === 3 && String(bits[b].nodeValue).trim() === 'people') bits[b].nodeValue = '';
      }
    }
  }

  function markButtons() {
    var buttons = document.querySelectorAll('[data-sa-region]');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-sa-region') === region;
      buttons[i].classList.toggle('is-active', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var select = document.getElementById('sa-activity-region-signup');
    if (select) select.value = region;
  }

  function choose(next) {
    var regionNext = core.normalizeRegion(next);
    if (!regionNext || regionNext === region) return;
    try {
      localStorage.setItem(EXPLICIT_KEY, regionNext);
    } catch (err) {}
    var body = JSON.stringify({ region: regionNext });
    fetch('/api/activity-region', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    }).catch(function () {}).then(function () {
      window.location.assign(regionNext === 'US' ? '/us' : '/kr');
    });
  }

  window.SAActivityRegion = {
    get: function () { return region; },
    choose: choose,
    labels: region === 'US' ? core.US_TERRITORY_LABELS : null,
  };

  function boot() {
    markButtons();
    applyEnglish(document);
    var buttons = document.querySelectorAll('[data-sa-region]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (event) {
        choose(event.currentTarget.getAttribute('data-sa-region'));
      });
    }
    var select = document.getElementById('sa-activity-region-signup');
    if (select) {
      select.addEventListener('change', function () {
        choose(select.value);
      });
    }
    if (region === 'US' && window.MutationObserver) {
      var watch = document.body;
      var queued = false;
      var observer = new MutationObserver(function () {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(function () {
          queued = false;
          applyEnglish(document);
        });
      });
      observer.observe(watch, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  if (pending) {
    fetch('/api/activity-region', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var detected = data && core.normalizeRegion(data.region);
        if (!detected) return;
        if (data.explicit) {
          try { localStorage.setItem(EXPLICIT_KEY, detected); } catch (err) {}
        }
        if (detected !== region) {
          window.location.replace(detected === 'US' ? '/us' : '/kr');
        }
      })
      .catch(function () {})
      .then(function () {
        document.documentElement.classList.remove('sa-region-pending');
      });
  }
})();
