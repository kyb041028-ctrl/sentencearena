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
    "id": "plaza",
    "title": "중앙광장 입장",
    "body": [
      "이곳은 서로 다른 의견이 만나는 중앙광장입니다. 밝게 표시된 중앙광장을 눌러보세요."
    ],
    "nextLabel": "중앙광장 입장"
  },
  {
    "id": "discussion",
    "title": "첫 토론 열기",
    "body": [
      "다른 시민의 글을 읽어볼까요? 밝게 표시된 안내글을 눌러보세요."
    ],
    "nextLabel": "안내글 열기"
  },
  {
    "id": "reactions",
    "title": "반응 연습",
    "body": [
      "좋아요·싫어요는 의견에 대한 반응이고, 공감은 별도의 표현입니다. 공감은 성향에 영향을 주지 않아요."
    ],
    "nextLabel": "다음: 내 시민 카드"
  },
  {
    "id": "profile",
    "title": "내 시민 카드 열기",
    "body": [
      "활동이 쌓이면 레벨이 오르고, 다른 시민에게 받은 공감은 명성으로 이어집니다. 내 기록을 확인해 보세요."
    ],
    "nextLabel": "중앙광장 시작하기"
  }
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
