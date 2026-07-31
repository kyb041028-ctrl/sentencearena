/**
 * 이벤트 처리 후 캐시 무효화 interface (실행 보류)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./user-domain-event-core'));
  } else {
    root.UserCacheInvalidationCore = factory(root.UserDomainEventCore);
  }
})(typeof self !== 'undefined' ? self : this, function factory(eventCore) {
  'use strict';

  var ET = eventCore.EVENT_TYPE;

  function planCacheInvalidation(event) {
    var targets = [];
    var t = event && event.eventType;
    if ([ET.LEVEL_UP, ET.REPUTATION_GRADE_CHANGED, ET.CITIZEN_RANK_CHANGED].indexOf(t) !== -1) {
      targets.push('profile:self', 'profile:public');
    }
    if (t === ET.FOLLOWER_GAINED) targets.push('profile:follow');
    if (t === ET.ACHIEVEMENT_ACQUIRED) targets.push('profile:achievements');
    if ([ET.TERRITORY_CHANGED, ET.TERRITORY_ASSIGNED].indexOf(t) !== -1) {
      targets.push('profile:territory', 'territory:population', 'territory:evolution');
    }
    if ([ET.ALIEN_TRANSFERRED, ET.ALIEN_RETURNED, ET.ALIEN_RETURN_ELIGIBLE].indexOf(t) !== -1) {
      targets.push('alien:context', 'profile:territory', 'territory:population', 'board:access');
    }
    if (
      [ET.POST_CREATED, ET.POST_DELETED, ET.COMMENT_CREATED, ET.COMMENT_DELETED].indexOf(t) !== -1
    ) {
      targets.push('user-content:list');
    }
    return { userId: event.userId, targets: targets, execute: false, note: 'INVALIDATE_NOT_EXECUTED' };
  }

  return { planCacheInvalidation: planCacheInvalidation };
});
