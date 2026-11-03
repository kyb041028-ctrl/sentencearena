/**
 * 개발 환경 전용 게시판 샘플.
 * 메모리에만 둔다. localStorage, 서버, DB, Supabase로 보내지 않는다.
 * localhost / 127.0.0.1 이 아니면 화면 컨트롤을 만들지 않고 샘플도 켜지지 않는다.
 */
(function () {
  var host = String(location.hostname || '');
  var devHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  var TERRITORIES = [
    { id: 'PROGRESSIVE', label: '개척' },
    { id: 'COMMON', label: '중앙' },
    { id: 'CONSERVATIVE', label: '수호' },
    { id: 'KANTAPBIYA', label: '외계' },
  ];
  var THEMES = ['정치', '사회', '일상', '기술', '문화'];
  var COMMENT_PLAN = [0, 15, 1, 2, 0, 3, 12, 4, 9, 5, 14, 6, 0, 8, 11, 7, 13, 2, 10, 1, 15, 0, 9, 3, 12, 4, 8, 6, 11, 7];
  var COMMON_CATS = { 정치: 'debate', 사회: 'debate', 일상: 'light', 기술: 'info', 문화: 'light' };
  var ALIEN_CATS = ['free', 'observe', 'meme', 'diary'];
  var MODE_LABELS = {
    off: '끄기',
    current: '현재 영토만',
    all: '네 영토 전체',
    empty: '0개',
    many: '많은 글',
    comments: '댓글 많은 글',
  };

  var THEME_TITLES = {
    정치: [
      '정책 숫자를 같이 놓고 보는 습관',
      '선거 공약에서 확인해볼 항목',
      '지역 예산 순서를 정하는 기준',
      '토론에서 사실과 의견을 나누는 법',
      '공공 일정 알림을 어떻게 받을까',
      '서로 다른 우선순위를 적는 표',
    ],
    사회: [
      '마을 버스 시간표가 바뀌었을 때',
      '동네 가로등 밝기를 어떻게 정하면 좋을까요',
      '도서관 저녁 개방을 늘리면',
      '학교 앞 통학로를 걷는 속도',
      '재활용 요일을 헷갈리지 않으려면',
      '동네 행사 안내문을 읽는 자리',
    ],
    일상: [
      '비 오는 날 우산 두는 곳',
      '점심 도시락을 싸는 작은 습관',
      '주말에 집을 환기하는 시간',
      '이웃과 인사만 나누는 아침',
      '장보기 목록을 짧게 쓰는 이유',
      '잠들기 전 조명을 낮추면',
    ],
    기술: [
      '휴대폰 알림을 주제별로 묶기',
      '배터리 소모를 줄여 본 설정',
      '가족 사진 폴더를 정리하는 순서',
      '공개 와이파이를 쓸 때의 기본',
      '검색 결과를 출처와 함께 보기',
      '오래된 앱을 지울 때 체크할 것',
    ],
    문화: [
      '동네 전시 한 점을 오래 보기',
      '같은 영화를 다른 점과 함께 말하기',
      '도서관 신간 코너에서 고른 책',
      '주말 공연의 좌석과 시간',
      '지역 축제 프로그램을 비교하기',
      '음악 소리를 나누는 선',
    ],
  };

  var THEME_PARAS = {
    정치: [
      '정책은 방향과 비용을 같은 문단에 적어야 비교가 됩니다. 누가 좋아 보이는지보다, 어떤 숫자가 바뀌는지를 먼저 적습니다.',
      '선거 자료는 제목만 보지 않고 적용 시점과 대상을 확인합니다. 비슷한 약속이라도 시작 시기가 다르면 체감이 다릅니다.',
      '지역 예산은 도로, 돌봄, 교육처럼 생활을 나누어 순서를 적으면 대화가 구체해집니다. 순서가 다르다고 상대의 생활을 부정할 필요는 없습니다.',
      '사실로 확인할 수 있는 내용과 가치 판단을 문장으로 나눕니다. 의견은 의견으로 두고, 확인된 일정과 수치는 따로 적습니다.',
      '공공 일정은 출처와 날짜를 같이 남기면 나중에 다시 찾기 쉽습니다. 전달 과정에서 날짜가 바뀌지 않았는지만 봅니다.',
      '서로 다른 우선순위를 표로 적으면 어디가 다른지 한눈에 들어옵니다. 순위를 맞추는 것이 아니라 차이를 보여주는 표입니다.',
      '회의록은 결론과 보류를 구분합니다. 아직 정하지 않은 일을 정해진 일처럼 적지 않습니다.',
    ],
    사회: [
      '버스 시간이 바뀌면 첫차와 막차, 환승 대기만 적어도 생활의 변화가 보입니다. 불편과 개선을 같은 글로 적습니다.',
      '가로등은 밝기와 위치, 꺼지는 시간을 나누어 이야기할 수 있습니다. 안전을 원하는 사람과 빛을 낮추고 싶은 사람이 같은 거리를 씁니다.',
      '도서관 저녁 개방은 학생과 퇴근 후 방문자에게 다른 의미입니다. 인력과 이용 시간을 같이 적으면 제안이 분명해집니다.',
      '통학로는 속도보다 건너는 위치와 시야가 중요합니다. 직접 걸어 본 시간과 구간을 적으면 제안이 짧아집니다.',
      '재활용 요일은 달력에 한 줄만 적어도 헷갈림이 줄어듭니다. 품목 이름이 바뀌었는지만 확인합니다.',
      '행사 안내문은 장소, 시간, 대상을 먼저 적습니다. 취향에 대한 평은 그 다음에 짧게 붙입니다.',
      '동네 소식은 확인된 것과 전해 들은 것을 구분합니다. 아직 공식 안내가 없으면 그 사실만 적습니다.',
    ],
    일상: [
      '비 오는 날에는 우산을 두는 자리만 정해도 현관이 덜 복잡해집니다. 작은 순서를 글로 남겨 둡니다.',
      '도시락은 메뉴보다 준비 시간을 적는 편이 다음에 도움이 됩니다. 거창한 요리 목록은 필요 없습니다.',
      '환기는 시간을 정해 짧게 해도 방이 달라집니다. 날씨에 따라 창을 여는 폭만 조절합니다.',
      '아침 인사는 길어도 되지 않습니다. 얼굴을 알아보고 하루 일정을 묻는 정도면 충분합니다.',
      '장보기 목록은 빠뜨린 것과 남긴 것을 나눠 적습니다. 다음 장이 짧아집니다.',
      '잠들기 전 조명을 낮추면 같은 방도 다르게 느껴집니다. 취향의 문제라 정답은 없습니다.',
      '주말 계획은 한 가지면 충분할 때가 있습니다. 하지 않은 일을 실패로 적지 않습니다.',
    ],
    기술: [
      '알림은 작업, 소식, 광고로 나누면 개수가 줄지 않아도 구분이 됩니다. 필요한 알림까지 끄라는 뜻은 아닙니다.',
      '배터리 설정은 화면 밝기와 백그라운드 사용을 따로 봅니다. 한 가지를 바꾼 뒤 하루만 관찰합니다.',
      '사진 폴더는 날짜와 행사 이름 중 하나로 통일하면 나중에 찾기 쉽습니다. 전부를 하루에 끝낼 필요는 없습니다.',
      '공개 와이파이는 접속 이름과 잠금 표시를 확인합니다. 개인적인 로그인 화면은 다른 망에서 엽니다.',
      '검색 결과는 제목과 출처, 날짜를 같이 봅니다. 같은 문장이 여러 사이트에 복사된 경우도 있습니다.',
      '오래된 앱은 마지막 사용 날짜와 권한을 보고 지웁니다. 자주 쓰는 도구와 시험 삼아 깐 도구를 구분합니다.',
      '업데이트 안내에는 바뀐 점만 짧게 적혀 있으면 충분합니다. 모든 메뉴를 다시 배울 필요는 없습니다.',
    ],
    문화: [
      '전시 한 점의 제목과 느낀 점을 나눠 적으면 길지 않아도 기록이 됩니다. 해석을 강요하지 않습니다.',
      '같은 영화를 보고도 기억에 남는 장면이 다를 수 있습니다. 다른 점을 비교하되 취향을 점수로 심판하지 않습니다.',
      '신간 코너는 표지보다 목차와 첫 문단을 봅니다. 빌릴지 여부는 그 다음에 정합니다.',
      '공연은 시간과 좌석, 러닝타임이 일정에 영향을 줍니다. 작품 평과 관람 정보를 따로 적습니다.',
      '지역 축제 프로그램은 아이와 어른의 시간표가 다를 수 있습니다. 겹치는 시간만 표시해도 유용합니다.',
      '음악 소리는 공간에 따라 적당한 크기가 다릅니다. 취향을 틀린 취향으로 부르지 않습니다.',
      '문화 행사 후기는 장소와 날짜를 남기면 다음 사람에게 안내가 됩니다. 호오만 적어도 기록은 됩니다.',
    ],
  };

  var mode = 'off';
  var store = null;
  var builtAt = 0;

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ids(prefix, count) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) out.push(prefix + '-' + i);
    return out;
  }

  function commentTotal(post) {
    return post && post.comments ? post.comments.length : 0;
  }

  function normalizeTid(tid) {
    var raw = String(tid || '').trim().toUpperCase();
    if (raw === 'CENTRIST' || raw === 'CENTRAL') return 'COMMON';
    if (raw.indexOf('KANTAPBIYA') === 0) return 'KANTAPBIYA';
    if (raw === 'PIONEER') return 'PROGRESSIVE';
    if (raw === 'GUARDIAN') return 'CONSERVATIVE';
    if (raw === 'ALIEN') return 'KANTAPBIYA';
    return raw || 'COMMON';
  }

  function currentTerritoryId() {
    var section = document.getElementById('board-section');
    var raw = section ? section.getAttribute('data-sc-territory') || '' : '';
    return normalizeTid(raw || 'COMMON');
  }

  function atDayHour(dayOffset, hour, minute) {
    var now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - dayOffset,
      hour,
      minute || 0,
      0,
      0,
    ).toISOString();
  }

  function createdAtFor(index) {
    var now = new Date();
    var daysFromMonday = (now.getDay() + 6) % 7;
    var weekOffset = daysFromMonday > 0 ? daysFromMonday : 1;
    var monthOffset = daysFromMonday + 1;
    if (index < 8) return atDayHour(0, 8 + index, 5 + index);
    if (index < 14) return atDayHour(weekOffset, 9 + (index - 8), 12);
    if (index < 20) return atDayHour(monthOffset, 8 + (index - 14), 20);
    return atDayHour(18 + (index - 20), 11, 30);
  }

  function inPeriod(iso, period) {
    var t = new Date(iso || 0).getTime();
    if (!isFinite(t)) return false;
    var now = new Date();
    var key = String(period || 'day');
    if (key === 'day') {
      var day = new Date(t);
      return (
        day.getFullYear() === now.getFullYear() &&
        day.getMonth() === now.getMonth() &&
        day.getDate() === now.getDate()
      );
    }
    if (key === 'week') {
      var wd = (now.getDay() + 6) % 7;
      var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - wd, 0, 0, 0, 0);
      return t >= start.getTime();
    }
    if (key === 'month') {
      var monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return t >= monthStart.getTime();
    }
    return true;
  }

  function score(post) {
    var reactions = post.reactions || {};
    var empathy = reactions.empathy ? reactions.empathy.length : 0;
    var likes = reactions.likes ? reactions.likes.length : 0;
    var dislikes = reactions.dislikes ? reactions.dislikes.length : 0;
    return empathy * 3 + likes * 2 + commentTotal(post) - dislikes;
  }

  function buildComments(tid, index, total) {
    var comments = [];
    var topCount = total < 2 ? total : Math.ceil(total * 0.6);
    var c;
    var firstId = '';
    for (c = 0; c < total; c++) {
      var home = TERRITORIES[(index + c + 1) % TERRITORIES.length];
      var parentId = c < topCount ? null : firstId;
      var id = 'sample-preview-c-' + tid + '-' + pad(index + 1) + '-' + pad(c + 1);
      if (c === 0) firstId = id;
      comments.push({
        id: id,
        authorId: '샘플-' + home.label + '-댓글' + pad(c + 1),
        authorDisplayName: '샘플-' + home.label + '-댓글' + pad(c + 1),
        text:
          '〔개발용 샘플 댓글〕 실제 회원의 댓글이 아닙니다. ' +
          (parentId ? '위 댓글에 대한 예시 답글입니다.' : '화면에서 댓글 줄과 반응 버튼을 보기 위한 문장입니다.'),
        createdAt: createdAtFor(index),
        parentId: parentId,
        status: 'ACTIVE',
        reactions: {
          likes: ids('sample-c-like-' + id, c % 3),
          dislikes: ids('sample-c-dis-' + id, c % 2),
          planetVoters: [],
          empathy: ids('sample-c-em-' + id, c % 4),
        },
      });
    }
    return comments;
  }

  function empathyCount(index) {
    if (index >= 0 && index <= 4) return 40 - index * 4;
    if (index >= 8 && index <= 12) return 70 - (index - 8) * 4;
    if (index >= 14 && index <= 18) return 100 - (index - 14) * 4;
    return index % 5;
  }

  function buildStore() {
    var next = {};
    var ti;
    for (ti = 0; ti < TERRITORIES.length; ti++) {
      var territory = TERRITORIES[ti];
      var posts = [];
      var i;
      for (i = 0; i < 30; i++) {
        var theme = THEMES[i % THEMES.length];
        var author = TERRITORIES[(ti + i + 1) % TERRITORIES.length];
        var nick = '샘플-' + author.label + '-' + pad(i + 1);
        var paraCount = 2 + (i % 7);
        var parts = [
          '〔개발용 샘플〕 이 글은 화면 배치를 보기 위한 예시입니다. 실제 회원이 쓴 글이 아닙니다.',
        ];
        var pool = THEME_PARAS[theme];
        var p;
        for (p = 0; p < paraCount - 1 && p < pool.length; p++) parts.push(pool[p]);
        var title = '［샘플·' + territory.label + '］ ' + THEME_TITLES[theme][Math.floor(i / 5)];
        if (i === 2) title = '［샘플］ 짧은 제목';
        if (i === 3) {
          title =
            '［샘플·' +
            territory.label +
            '］ 긴 제목 줄바꿈 확인 — 제목이 목록과 상세에서 다음 줄로 넘어가는지 보는 문장입니다. 화면 가장자리에서 잘리지 않고 읽히는지 함께 봅니다';
        }
        if (i === 6) title = '［샘플·' + territory.label + '］ 동네 가로등 밝기를 어떻게 정하면 좋을까요';
        var post = {
          id: 'sample-preview-' + territory.id + '-' + pad(i + 1),
          title: title,
          body: parts.join('\n\n'),
          bodyFormat: 'plain',
          authorId: nick,
          authorDisplayName: nick,
          sampleAuthorTerritory: author.id,
          createdAt: createdAtFor(i),
          images: [],
          comments: buildComments(territory.id, i, COMMENT_PLAN[i]),
          reactions: {
            likes: ids('sample-like-' + territory.id + '-' + i, indexLikes(i)),
            dislikes: ids('sample-dis-' + territory.id + '-' + i, i % 3),
            planetVoters: [],
            empathy: ids('sample-em-' + territory.id + '-' + i, empathyCount(i)),
          },
          authorRcvAlign: 0,
          authorRcvPl: 0,
          factionBattleEnabled: false,
          isOfficial: false,
          factionBattle: null,
          status: 'ACTIVE',
          viewCount: 24 + i * 37 + ti * 3,
          source: 'dev_sample',
          samplePreview: true,
          sampleBoardTerritory: territory.id,
        };
        if (territory.id === 'COMMON') post.category = COMMON_CATS[theme];
        if (territory.id === 'KANTAPBIYA') post.category = ALIEN_CATS[i % ALIEN_CATS.length];
        posts.push(post);
      }
      next[territory.id] = posts;
    }
    store = next;
    builtAt = Date.now();
  }

  function indexLikes(index) {
    if (index >= 0 && index <= 4) return 12 - index;
    if (index >= 8 && index <= 12) return 16 - (index - 8);
    if (index >= 14 && index <= 18) return 20 - (index - 14);
    return index % 4;
  }

  function reviewLabel(tid) {
    if (tid === 'PROGRESSIVE') return '진보';
    if (tid === 'COMMON') return '중앙';
    if (tid === 'CONSERVATIVE') return '보수';
    if (tid === 'KANTAPBIYA') return '외계';
    return '';
  }

  function ensureStore() {
    if (!store) buildStore();
    return store;
  }

  function isActive() {
    return devHost && mode !== 'off';
  }

  function visiblePosts(tid) {
    ensureStore();
    var id = normalizeTid(tid);
    var list = store[id] ? store[id].map(clone) : [];
    if (mode === 'empty') return [];
    if (mode === 'comments') {
      list = list.filter(function (post) {
        return commentTotal(post) >= 8;
      });
    }
    if (mode === 'current' && id !== currentTerritoryId()) return [];
    if (mode === 'current' || mode === 'all' || mode === 'many' || mode === 'comments') return list;
    return [];
  }

  function postsFor(tid, stage) {
    if (!isActive()) return [];
    var st = Math.floor(Number(stage) || 1);
    if (st !== 1) return [];
    return visiblePosts(tid);
  }

  function sortByScore(rows) {
    rows.sort(function (a, b) {
      var delta = score(b) - score(a);
      if (delta !== 0) return delta;
      var timeDelta = new Date(b.createdAt) - new Date(a.createdAt);
      if (timeDelta !== 0) return timeDelta;
      return String(a.id).localeCompare(String(b.id));
    });
    return rows;
  }

  function hotPosts(tid, period, limit) {
    if (!isActive()) return [];
    var rows = visiblePosts(tid).filter(function (post) {
      return inPeriod(post.createdAt, period || 'day');
    });
    sortByScore(rows);
    var lim = Math.max(0, Math.floor(Number(limit) || 3));
    return rows.slice(0, lim);
  }

  function rankedPosts(period, limit) {
    if (!isActive()) return [];
    var rows = [];
    var ti;
    for (ti = 0; ti < TERRITORIES.length; ti++) {
      var tid = TERRITORIES[ti].id;
      var list = visiblePosts(tid);
      var i;
      for (i = 0; i < list.length; i++) {
        if (!inPeriod(list[i].createdAt, period || 'day')) continue;
        list[i].sampleBoardTerritory = tid;
        list[i].sampleTerritoryLabel = reviewLabel(tid);
        rows.push(list[i]);
      }
    }
    sortByScore(rows);
    var lim = Math.max(0, Math.floor(Number(limit) || 5));
    return rows.slice(0, lim);
  }

  var DAILY_TOPICS = [
    {
      title: '생활물가',
      summary: '〔개발용 샘플〕 장바구니와 공공요금처럼 매일 체감하는 가격 이야기를 모아 둔 예시입니다. 저장되지 않습니다.',
    },
    {
      title: '인공지능과 일자리',
      summary: '〔개발용 샘플〕 도구가 일을 돕는 자리와 사람이 판단하는 자리를 나눠 보는 예시입니다. 저장되지 않습니다.',
    },
    {
      title: '청년 주거비',
      summary: '〔개발용 샘플〕 월세, 보증금, 통근 시간을 같이 적는 주거 이야기 예시입니다. 저장되지 않습니다.',
    },
    {
      title: '지방 교통',
      summary: '〔개발용 샘플〕 버스 시간과 환승, 저녁 막차를 적는 이동 이야기 예시입니다. 저장되지 않습니다.',
    },
    {
      title: '온라인 플랫폼 책임',
      summary: '〔개발용 샘플〕 공개된 글의 표시와 운영 기준을 나눠 보는 예시입니다. 저장되지 않습니다.',
    },
  ];

  function dailyIssues() {
    if (!isActive() || mode === 'empty') return [];
    ensureStore();
    var out = [];
    var topic;
    for (topic = 0; topic < DAILY_TOPICS.length; topic++) {
      var interest = 0;
      var participation = 0;
      var ti;
      for (ti = 0; ti < TERRITORIES.length; ti++) {
        var list = store[TERRITORIES[ti].id] || [];
        var i;
        for (i = 0; i < list.length; i++) {
          if (i % DAILY_TOPICS.length !== topic) continue;
          interest += list[i].reactions && list[i].reactions.empathy ? list[i].reactions.empathy.length : 0;
          participation += commentTotal(list[i]);
        }
      }
      out.push({
        title: DAILY_TOPICS[topic].title,
        summary: DAILY_TOPICS[topic].summary,
        interest: interest,
        participation: participation,
      });
    }
    return out;
  }

  function collectSearchRows() {
    if (!isActive()) return [];
    var out = [];
    var ti;
    for (ti = 0; ti < TERRITORIES.length; ti++) {
      var tid = TERRITORIES[ti].id;
      var rows = postsFor(tid, 1);
      var i;
      for (i = 0; i < rows.length; i++) {
        var post = rows[i];
        out.push({
          postId: post.id,
          title: post.title,
          body: post.body,
          bodyFormat: 'plain',
          authorId: post.authorId,
          createdAt: post.createdAt,
          territoryId: tid,
          stage: 1,
        });
      }
    }
    return out;
  }

  function stats() {
    ensureStore();
    var posts = 0;
    var comments = 0;
    var replies = 0;
    var by = {};
    var ti;
    for (ti = 0; ti < TERRITORIES.length; ti++) {
      var tid = TERRITORIES[ti].id;
      var list = store[tid] || [];
      var row = { posts: list.length, comments: 0, replies: 0 };
      var i;
      for (i = 0; i < list.length; i++) {
        var n = list[i].comments.length;
        row.comments += n;
        var c;
        for (c = 0; c < list[i].comments.length; c++) {
          if (list[i].comments[c].parentId) row.replies += 1;
        }
      }
      posts += row.posts;
      comments += row.comments;
      replies += row.replies;
      by[tid] = row;
    }
    return { posts: posts, comments: comments, replies: replies, by: by, builtAt: builtAt, mode: mode };
  }

  function setStatus(text) {
    var el = document.getElementById('sc-board-sample-status');
    if (el) el.textContent = text || '';
  }

  function syncChrome() {
    var on = isActive();
    var banner = document.getElementById('sc-board-sample-banner');
    var detail = document.getElementById('sc-board-sample-detail-banner');
    if (banner) banner.hidden = !on;
    if (detail) detail.hidden = !on;
    if (!on) setStatus('');
    if (document.body) document.body.classList.toggle('sc-board-sample-on', on && mode !== 'empty');
  }

  function refreshBoard() {
    syncChrome();
    var detail = document.getElementById('screen-post-detail');
    if (detail && !detail.hidden && typeof window.__scClosePostDetail === 'function') {
      window.__scClosePostDetail();
    }
    var tid = currentTerritoryId();
    if (typeof window.__scBoardGoTerritory === 'function') {
      window.__scBoardGoTerritory(tid);
    }
  }

  function isBlockedControl(target) {
    if (!target || !target.closest) return false;
    if (target.closest('.sc-react-btn')) return true;
    if (target.closest('#sc-report-modal-submit')) return true;
    if (target.closest('.board__follow-btn')) return true;
    var button = target.closest('button, input[type="submit"]');
    if (!button) return false;
    var text = String(button.textContent || '').replace(/\s+/g, '');
    if (text === '댓글등록' || text === '답글등록') return true;
    if (button.classList.contains('board-btn-primary') && button.closest('#board-modal')) return true;
    return false;
  }

  function blockWriteEvent(ev) {
    if (!isActive()) return;
    if (!isBlockedControl(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    setStatus('샘플 화면에서는 글, 댓글, 반응, 신고를 저장하지 않습니다.');
  }

  function mount() {
    if (!devHost || document.getElementById('sc-board-sample-bar')) return;
    var style = document.createElement('style');
    style.textContent =
      '#sc-board-sample-bar,#sc-board-sample-detail-banner{box-sizing:border-box;max-width:100%;padding:4px 10px;font-size:12px;line-height:1.35;background:#fff7e8;color:#6b4b16;border-bottom:1px solid #e6d3a8}' +
      '#sc-board-sample-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}' +
      '#sc-board-sample-bar label{display:flex;flex-wrap:wrap;align-items:center;gap:6px}' +
      '#sc-board-sample-bar select{max-width:100%;font-size:12px}' +
      '#sc-board-sample-banner{font-weight:700}' +
      '#sc-board-sample-status{flex-basis:100%}' +
      '#sc-board-sample-detail-banner{font-weight:700}';
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'sc-board-sample-bar';
    var banner = document.createElement('span');
    banner.id = 'sc-board-sample-banner';
    banner.textContent = '개발용 샘플 데이터';
    banner.hidden = true;
    var label = document.createElement('label');
    label.appendChild(document.createTextNode('게시판 샘플 데이터 보기'));
    var select = document.createElement('select');
    select.id = 'sc-board-sample-mode';
    select.setAttribute('aria-label', '게시판 샘플 데이터 보기');
    Object.keys(MODE_LABELS).forEach(function (key) {
      var option = document.createElement('option');
      option.value = key;
      option.textContent = MODE_LABELS[key];
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      mode = select.value in MODE_LABELS ? select.value : 'off';
      refreshBoard();
    });
    label.appendChild(select);
    var status = document.createElement('span');
    status.id = 'sc-board-sample-status';
    bar.appendChild(banner);
    bar.appendChild(label);
    bar.appendChild(status);

    var board = document.getElementById('screen-board');
    if (board) board.insertBefore(bar, board.firstChild);

    var detailBanner = document.createElement('div');
    detailBanner.id = 'sc-board-sample-detail-banner';
    detailBanner.textContent = '개발용 샘플 데이터';
    detailBanner.hidden = true;
    var detail = document.getElementById('screen-post-detail');
    if (detail) detail.insertBefore(detailBanner, detail.firstChild);

    document.addEventListener('click', blockWriteEvent, true);
    document.addEventListener('submit', blockWriteEvent, true);
  }

  buildStore();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.ScBoardSamplePreview = {
    isActive: isActive,
    postsFor: postsFor,
    hotPosts: hotPosts,
    rankedPosts: rankedPosts,
    dailyIssues: dailyIssues,
    collectSearchRows: collectSearchRows,
    stats: stats,
    getMode: function () {
      return mode;
    },
    setMode: function (next) {
      if (!devHost) return mode;
      mode = next in MODE_LABELS ? next : 'off';
      var select = document.getElementById('sc-board-sample-mode');
      if (select) select.value = mode;
      refreshBoard();
      return mode;
    },
  };
})();
