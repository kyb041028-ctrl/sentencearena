/**
 * SentenceArena 베타 시작용 공식 기본 게시글.
 * 가짜 회원/댓글/반응을 만들지 않는다. Production 자동 등록 없음.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BetaOfficialPostsCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function betaOfficialPostsCoreFactory() {
  'use strict';

  var TITLE_PREFIX = '[공식] ';
  var TERRITORY = 'CENTRAL';
  var BOARD_STAGE = 1;
  var STATUS = 'ACTIVE';

  var KIND = Object.freeze({
    GUIDE: 'GUIDE',
    DEBATE: 'DEBATE',
  });

  var CATEGORY = Object.freeze({
    INFO: 'info',
    DEBATE: 'debate',
  });

  function para() {
    return Array.prototype.slice.call(arguments).join('\n\n');
  }

  var POSTS = [
    {
      seedKey: 'guide-welcome',
      kind: KIND.GUIDE,
      categoryKey: CATEGORY.INFO,
      sort: 10,
      title: TITLE_PREFIX + 'SentenceArena에 오신 것을 환영합니다',
      content: para(
        'SentenceArena 공식 안내입니다.',
        'SentenceArena는 정치·사회 의견을 나누고 토론하는 커뮤니티입니다.',
        '모든 신규 회원은 중앙광장에서 시작합니다. 소속 영토는 가입할 때 고르는 것이 아닙니다. 활동이 쌓이면 성향의 흐름에 따라 달라질 수 있습니다.',
        '현재 소속 영토는 다른 회원에게 공개됩니다. 정치성향의 세부 점수와 계산 내역은 공개되지 않습니다.',
        '글을 읽고, 댓글을 남기고, 좋아요·싫어요·공감으로 의견을 표현해 보세요.',
      ),
    },
    {
      seedKey: 'guide-central',
      kind: KIND.GUIDE,
      categoryKey: CATEGORY.INFO,
      sort: 20,
      title: TITLE_PREFIX + '중앙광장은 어떤 공간인가요?',
      content: para(
        'SentenceArena 공식 안내입니다.',
        '중앙광장은 조정·중재·협력의 중심 공간입니다.',
        '신규 회원은 모두 여기서 시작합니다. 다른 영토의 글을 보기 전에, 먼저 중앙광장에서 읽고 토론에 참여할 수 있습니다.',
      ),
    },
    {
      seedKey: 'guide-territories',
      kind: KIND.GUIDE,
      categoryKey: CATEGORY.INFO,
      sort: 30,
      title: TITLE_PREFIX + '개척영토와 수호영토는 무엇인가요?',
      content: para(
        'SentenceArena 공식 안내입니다.',
        '개척영토는 개척 성향과 연결된 영토입니다.',
        '수호영토는 수호 성향과 연결된 영토입니다.',
        '영토는 이용자가 골라 이동하는 구조가 아닙니다. 서비스 활동에 따른 성향 흐름이 충분히 쌓이면 소속이 달라질 수 있습니다.',
        '현재 소속 영토는 다른 회원에게 공개됩니다. 정치성향 원점수와 세부 계산내역은 공개하지 않습니다.',
      ),
    },
    {
      seedKey: 'guide-reactions',
      kind: KIND.GUIDE,
      categoryKey: CATEGORY.INFO,
      sort: 40,
      title: TITLE_PREFIX + '좋아요·싫어요·공감은 어떻게 다른가요?',
      content: para(
        'SentenceArena 공식 안내입니다.',
        '좋아요는 의견이나 내용에 대한 긍정적 반응입니다. 성향 흐름에 영향을 줄 수 있습니다.',
        '싫어요는 의견이나 내용에 대한 부정적 반응입니다. 성향 흐름에 영향을 줄 수 있습니다.',
        '공감은 “이 의견이나 감정을 이해한다”는 표현입니다. 정치성향 계산에는 영향을 주지 않습니다. 명성처럼 다른 활동 기록에는 연결될 수 있습니다.',
        '정확한 점수나 계산 방법은 공개하지 않습니다.',
      ),
    },
    {
      seedKey: 'guide-alien',
      kind: KIND.GUIDE,
      categoryKey: CATEGORY.INFO,
      sort: 50,
      title: TITLE_PREFIX + '외계행성은 어떤 곳인가요?',
      content: para(
        'SentenceArena 공식 안내입니다.',
        '외계행성은 정치 진영이 아닙니다. 특정 정치적 견해 때문에 보내는 곳이 아닙니다.',
        '반복적인 운영정책 위반 등 행동 문제와 관련된 관측·제한 영역입니다.',
        '정치적 찬성이나 반대 그 자체로는 외계행성으로 가지 않습니다.',
      ),
    },
    {
      seedKey: 'guide-policy',
      kind: KIND.GUIDE,
      categoryKey: CATEGORY.INFO,
      sort: 60,
      title: TITLE_PREFIX + '신고와 운영원칙 안내',
      content: para(
        'SentenceArena 공식 안내입니다.',
        '정치적 견해 자체는 제재 사유가 아닙니다. 강한 찬성이나 반대 의견도 그 자체로는 제재하지 않습니다.',
        '운영 기준은 행동입니다. 도배, 스팸, 반복 괴롭힘, 개인정보 공개, 협박, 권리침해, 사실과 다른 신고를 반복하거나 보복 목적으로 신고하는 행동은 운영정책에 따라 조치될 수 있습니다.',
        '일반 신고는 운영정책 위반 행동을 알리는 절차입니다. 권리침해 요청은 본인의 명예·개인정보·사진·저작권 등 구체적 권리 문제로 신청하는 별도 절차입니다.',
        '신고가 많이 들어왔다는 사실만으로 자동 제재하거나 글을 지우지 않습니다. 운영자가 검토합니다.',
      ),
    },
    {
      seedKey: 'debate-speed-vs-deliberation',
      kind: KIND.DEBATE,
      categoryKey: CATEGORY.DEBATE,
      sort: 110,
      title: TITLE_PREFIX + '빠른 실행과 충분한 논의, 어디에 더 무게를 둘까요?',
      content: para(
        'SentenceArena 운영 토론 주제입니다.',
        '정책을 정할 때 어떤 사람은 빠른 실행이 더 중요하다고 보고, 어떤 사람은 충분한 사회적 논의가 먼저라고 봅니다.',
        '둘 다 타당한 이유가 있을 수 있습니다. 운영자가 정답을 정해 두지 않았습니다.',
        '여러분은 어떻게 생각하시나요?',
      ),
    },
    {
      seedKey: 'debate-government-vs-choice',
      kind: KIND.DEBATE,
      categoryKey: CATEGORY.DEBATE,
      sort: 120,
      title: TITLE_PREFIX + '사회 문제를 풀 때 정부와 개인의 역할은 어디까지일까요?',
      content: para(
        'SentenceArena 운영 토론 주제입니다.',
        '사회 문제를 해결할 때 정부의 역할이 커야 한다는 의견과, 개인의 선택과 책임이 더 중요하다는 의견이 있습니다.',
        '어디까지를 공공이 맡고, 어디까지를 개인에게 맡기는 것이 좋을지는 사람마다 다를 수 있습니다.',
        '여러분은 어떻게 생각하시나요?',
      ),
    },
    {
      seedKey: 'debate-speech-vs-order',
      kind: KIND.DEBATE,
      categoryKey: CATEGORY.DEBATE,
      sort: 130,
      title: TITLE_PREFIX + '표현의 자유와 커뮤니티 질서, 기준을 어디에 둘까요?',
      content: para(
        'SentenceArena 운영 토론 주제입니다.',
        '표현의 자유를 넓게 보장해야 한다는 의견과, 커뮤니티 질서를 위해 일정한 선이 필요하다는 의견이 있습니다.',
        '이 둘이 부딪힐 때 어디에 기준을 두는지는 정해진 정답이 없습니다.',
        '여러분은 어떻게 생각하시나요?',
      ),
    },
  ];

  var TITLE_MAX = 120;
  var CONTENT_MAX = 10000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isOfficialTitle(title) {
    return String(title || '').indexOf('[공식]') === 0;
  }

  function displayTitle(title) {
    return String(title || '').replace(/^\[공식\]\s*/, '');
  }

  function allCopyText() {
    return POSTS.map(function (p) {
      return p.title + '\n' + p.content;
    }).join('\n');
  }

  function forbiddenHits(text) {
    var src = String(text || '');
    var hits = [];
    if (/\b360\b/.test(src)) hits.push('360');
    if (/\b160\b/.test(src)) hits.push('160');
    if (/가중치/.test(src)) hits.push('가중치');
    if (/연속\s*2회/.test(src)) hits.push('연속 2회');
    if (/일일\s*제한/.test(src)) hits.push('일일 제한');
    if (/좋아요는\s*\d/.test(src) || /싫어요는\s*\d/.test(src)) hits.push('반응 점수');
    if (/\+0\.8|\-1\.2|\+1\.2|\-0\.8/.test(src)) hits.push('증감 수치');
    return hits;
  }

  function validatePack() {
    var errors = [];
    var keys = {};
    var titles = {};
    POSTS.forEach(function (p) {
      if (!p.seedKey) errors.push('MISSING_SEED_KEY');
      if (keys[p.seedKey]) errors.push('DUP_SEED_KEY:' + p.seedKey);
      keys[p.seedKey] = true;
      if (!isOfficialTitle(p.title)) errors.push('TITLE_NOT_OFFICIAL:' + p.seedKey);
      if (titles[p.title]) errors.push('DUP_TITLE:' + p.title);
      titles[p.title] = true;
      if (!String(p.title || '').trim()) errors.push('EMPTY_TITLE:' + p.seedKey);
      if (String(p.title).length > TITLE_MAX) errors.push('TITLE_TOO_LONG:' + p.seedKey);
      if (!String(p.content || '').trim()) errors.push('EMPTY_CONTENT:' + p.seedKey);
      if (String(p.content).length > CONTENT_MAX) errors.push('CONTENT_TOO_LONG:' + p.seedKey);
      if (p.kind === KIND.DEBATE && String(p.content).indexOf('여러분은 어떻게 생각하시나요?') === -1) {
        errors.push('DEBATE_MISSING_PROMPT:' + p.seedKey);
      }
    });
    var copyHits = forbiddenHits(allCopyText());
    if (copyHits.length) errors.push('FORBIDDEN_COPY:' + copyHits.join(','));
    return { ok: errors.length === 0, errors: errors };
  }

  function isUuid(v) {
    return UUID_RE.test(String(v || '').trim());
  }

  /**
   * @param {string[]} existingTitles ACTIVE CENTRAL titles already in DB
   */
  function planInserts(existingTitles) {
    var have = {};
    (existingTitles || []).forEach(function (t) {
      have[String(t || '')] = true;
    });
    var create = [];
    var skip = [];
    POSTS.forEach(function (p) {
      if (have[p.title]) skip.push(p);
      else create.push(p);
    });
    return { create: create, skip: skip };
  }

  function insertRow(post, authorUserId) {
    return {
      author_user_id: authorUserId,
      territory: TERRITORY,
      category_key: post.categoryKey,
      board_stage: BOARD_STAGE,
      title: post.title,
      content: post.content,
      is_anonymous: false,
      status: STATUS,
      faction_battle_enabled: false,
      is_official: true,
    };
  }

  return {
    TITLE_PREFIX: TITLE_PREFIX,
    TERRITORY: TERRITORY,
    BOARD_STAGE: BOARD_STAGE,
    KIND: KIND,
    CATEGORY: CATEGORY,
    POSTS: POSTS,
    isOfficialTitle: isOfficialTitle,
    displayTitle: displayTitle,
    allCopyText: allCopyText,
    forbiddenHits: forbiddenHits,
    validatePack: validatePack,
    isUuid: isUuid,
    planInserts: planInserts,
    insertRow: insertRow,
  };
});
