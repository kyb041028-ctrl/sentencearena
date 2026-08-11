'use strict';

/** Kakao OAuth scopes when account_email is unavailable (non-Biz app). */
const KAKAO_OAUTH_SCOPES = 'profile_nickname profile_image';

/**
 * Rewrite accounts.kakao.com/login continue URL to drop account_email from scope.
 * Supabase Auth may append default scopes; this keeps Kakao authorize in sync with
 * enabled consent items while preserving the existing Supabase PKCE/callback flow.
 * @param {string} loginUrl accounts.kakao.com/login?continue=...
 * @returns {string}
 */
function rewriteKakaoLoginScope(loginUrl) {
  const outer = new URL(loginUrl);
  const continueRaw = outer.searchParams.get('continue');
  if (!continueRaw) return loginUrl;

  const inner = new URL(continueRaw);
  inner.searchParams.set('scope', KAKAO_OAUTH_SCOPES);
  outer.searchParams.set('continue', inner.href);
  return outer.href;
}

/**
 * Follow Supabase authorize redirects and fix Kakao scope on the login page URL.
 * @param {string} supabaseAuthorizeUrl
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>}
 */
async function resolveKakaoOAuthRedirect(supabaseAuthorizeUrl, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  let url = supabaseAuthorizeUrl;

  for (let i = 0; i < 6; i += 1) {
    const res = await fetchFn(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'SentenceArena-KakaoOAuth/1.0' },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      url = new URL(loc, url).href;
      if (url.includes('accounts.kakao.com/login')) {
        return rewriteKakaoLoginScope(url);
      }
      continue;
    }

    if (url.includes('kauth.kakao.com/oauth/authorize')) {
      const fixed = new URL(url);
      fixed.searchParams.set('scope', KAKAO_OAUTH_SCOPES);
      return fixed.href;
    }

    break;
  }

  if (url.includes('accounts.kakao.com/login')) {
    return rewriteKakaoLoginScope(url);
  }

  return url;
}

module.exports = {
  KAKAO_OAUTH_SCOPES,
  rewriteKakaoLoginScope,
  resolveKakaoOAuthRedirect,
};
