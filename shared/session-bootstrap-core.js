/**
 * SentenceArena — post-auth session state (provider-agnostic)
 * Google / Kakao / Naver 공통. email·provider로 화면을 결정하지 않는다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.SessionBootstrapCore = api;
})(typeof self !== 'undefined' ? self : typeof global !== 'undefined' ? global : this, function sessionBootstrapCoreFactory() {
  'use strict';

  var STATES = {
    BOOTING: 'BOOTING',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
    READY: 'READY',
    GUEST: 'GUEST',
    ERROR: 'ERROR',
  };

  function trimName(profile) {
    if (!profile || profile.display_name == null) return '';
    return String(profile.display_name);
  }

  function isProfileComplete(profile, activityNameCore) {
    var name = trimName(profile);
    if (activityNameCore && typeof activityNameCore.isCompleteActivityName === 'function') {
      return activityNameCore.isCompleteActivityName(name) === true;
    }
    return !!(name && String(name).trim().length >= 2);
  }

  /**
   * @param {{
   *   guest?: boolean,
   *   authenticated?: boolean,
   *   user?: { id?: string }|null,
   *   profile?: object|null,
   *   profileQueryFailed?: boolean,
   *   transportError?: boolean,
   * }} input
   * @param {object} [activityNameCore]
   */
  function resolveSessionState(input, activityNameCore) {
    var opt = input || {};
    if (opt.transportError || opt.profileQueryFailed) {
      return {
        state: STATES.ERROR,
        user: opt.user && opt.user.id ? { id: opt.user.id } : null,
        profile: opt.profile || null,
        error: opt.error || 'SESSION_BOOTSTRAP_FAILED',
      };
    }
    if (opt.guest && !opt.authenticated) {
      return { state: STATES.GUEST, user: null, profile: null };
    }
    if (!opt.authenticated || !opt.user || !opt.user.id) {
      return { state: STATES.UNAUTHENTICATED, user: null, profile: null };
    }
    var user = { id: String(opt.user.id) };
    var profile = opt.profile && typeof opt.profile === 'object' ? opt.profile : { id: user.id, display_name: '' };
    if (!isProfileComplete(profile, activityNameCore)) {
      return { state: STATES.PROFILE_INCOMPLETE, user: user, profile: profile };
    }
    return { state: STATES.READY, user: user, profile: profile };
  }

  function publicUserFromAuth(authUser) {
    if (!authUser || !authUser.id) return null;
    return {
      id: String(authUser.id),
      email: authUser.email == null ? null : authUser.email,
    };
  }

  return {
    STATES: STATES,
    isProfileComplete: isProfileComplete,
    resolveSessionState: resolveSessionState,
    publicUserFromAuth: publicUserFromAuth,
  };
});
