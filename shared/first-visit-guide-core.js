/**
 * SentenceArena first-visit guide — copy + member-based completion rules.
 * Does not change alignment formulas, territory keys, or auth.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FirstVisitGuideCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function firstVisitGuideCoreFactory() {
  'use strict';

  var SESSION_PENDING_PREFIX = 'sc_fvg_pending_';
  var CENTRAL_TERRITORY_ID = 'COMMON';

  var STEPS = [
    {
      id: 'intro',
      title: 'SentenceArena에 오신 것을 환영합니다',
      body: [
        '정치·사회 의견을 나누고 토론하는 커뮤니티입니다.',
        '활동과 반응이 쌓이면 나의 성향과 소속 영토가 달라질 수 있습니다.',
        '모든 신규 회원은 중앙광장에서 시작합니다.',
        '현재 소속 영토는 다른 이용자에게 보입니다.',
        '정치성향의 세부 점수와 계산 내역은 다른 이용자에게 공개되지 않습니다.',
      ],
      nextLabel: '다음',
    },
    {
      id: 'reactions',
      title: '좋아요 · 싫어요 · 공감',
      body: [
        '좋아요와 싫어요는 성향의 흐름에 영향을 줄 수 있습니다.',
        '공감은 정치성향에 영향을 주지 않습니다.',
        '글, 댓글, 반응은 레벨·명성·업적 같은 활동 기록에도 연결될 수 있습니다.',
      ],
      nextLabel: '다음',
    },
    {
      id: 'territory',
      title: '세 영토와 외계행성',
      body: [
        '개척영토는 개척 성향을 가진 이용자들이 소속될 수 있는 영토입니다.',
        '중앙광장은 조정·중재·협력의 중심 공간이며, 신규 회원은 여기서 시작합니다.',
        '수호영토는 수호 성향을 가진 이용자들이 소속될 수 있는 영토입니다.',
        '서비스 활동에 따라 소속 영토가 자동으로 달라질 수 있습니다. 이용자가 영토를 골라 이동하는 구조가 아닙니다.',
        '외계행성은 정치성향 영토가 아닙니다. 정치적 견해 때문에 가는 곳이 아니며, 반복적인 운영정책 위반 등 행동 문제와 관련된 관측·제한 영역입니다.',
      ],
      nextLabel: '중앙광장 시작하기',
    },
  ];

  var CENTRAL_HINT =
    '글을 읽고 좋아요·싫어요·공감으로 의견을 표현해보세요. 활동에 따라 나의 성향과 소속 영토가 변화할 수 있습니다.';

  function trimTs(value) {
    if (value == null) return null;
    var s = String(value).trim();
    return s ? s : null;
  }

  function fromProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return { eligibleAt: null, completedAt: null, centralHintSeenAt: null };
    }
    return {
      eligibleAt: trimTs(profile.first_visit_guide_eligible_at || profile.firstVisitGuideEligibleAt),
      completedAt: trimTs(profile.first_visit_guide_completed_at || profile.firstVisitGuideCompletedAt),
      centralHintSeenAt: trimTs(profile.central_plaza_hint_seen_at || profile.centralPlazaHintSeenAt),
    };
  }

  function fromPack(pack) {
    if (pack && pack.firstVisit && typeof pack.firstVisit === 'object') {
      return {
        eligibleAt: trimTs(pack.firstVisit.eligibleAt),
        completedAt: trimTs(pack.firstVisit.completedAt),
        centralHintSeenAt: trimTs(pack.firstVisit.centralHintSeenAt),
      };
    }
    return fromProfile(pack && pack.profile);
  }

  function shouldAutoShow(input) {
    var o = input || {};
    if (trimTs(o.completedAt)) return false;
    if (trimTs(o.eligibleAt)) return true;
    if (o.justFinishedSignupFlow === true) return true;
    if (o.sessionPending === true) return true;
    return false;
  }

  function shouldShowCentralHint(input) {
    var o = input || {};
    if (trimTs(o.centralHintSeenAt)) return false;
    if (o.justFinishedGuide === true) return true;
    if (trimTs(o.completedAt) && !trimTs(o.centralHintSeenAt)) return true;
    return false;
  }

  function toPublic(state) {
    var s = state || {};
    var eligibleAt = trimTs(s.eligibleAt);
    var completedAt = trimTs(s.completedAt);
    var centralHintSeenAt = trimTs(s.centralHintSeenAt);
    return {
      eligibleAt: eligibleAt,
      completedAt: completedAt,
      centralHintSeenAt: centralHintSeenAt,
      shouldShowGuide: shouldAutoShow({
        eligibleAt: eligibleAt,
        completedAt: completedAt,
      }),
      shouldShowCentralHint: shouldShowCentralHint({
        completedAt: completedAt,
        centralHintSeenAt: centralHintSeenAt,
      }),
    };
  }

  function toPublicFromProfile(profile) {
    return toPublic(fromProfile(profile));
  }

  function sessionPendingKey(userId) {
    return SESSION_PENDING_PREFIX + String(userId || '').trim();
  }

  function allCopyText() {
    var parts = [];
    for (var i = 0; i < STEPS.length; i++) {
      parts.push(STEPS[i].title);
      parts.push(STEPS[i].nextLabel);
      var body = STEPS[i].body || [];
      for (var j = 0; j < body.length; j++) parts.push(body[j]);
    }
    parts.push(CENTRAL_HINT);
    return parts.join('\n');
  }

  return {
    SESSION_PENDING_PREFIX: SESSION_PENDING_PREFIX,
    CENTRAL_TERRITORY_ID: CENTRAL_TERRITORY_ID,
    STEPS: STEPS,
    CENTRAL_HINT: CENTRAL_HINT,
    fromProfile: fromProfile,
    fromPack: fromPack,
    shouldAutoShow: shouldAutoShow,
    shouldShowCentralHint: shouldShowCentralHint,
    toPublic: toPublic,
    toPublicFromProfile: toPublicFromProfile,
    sessionPendingKey: sessionPendingKey,
    allCopyText: allCopyText,
  };
});
