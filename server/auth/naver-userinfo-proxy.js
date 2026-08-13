'use strict';

/**
 * Naver /v1/nid/me → Supabase Custom OAuth2 userinfo shape.
 * Supabase Auth NewIdentity requires identityData["sub"]
 * (error: "error missing provider id" when absent).
 * Naver nests the stable app-scoped id at response.id.
 */

const NAVER_PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';

/**
 * @param {unknown} raw
 * @returns {{ ok: true, body: Record<string, string> } | { ok: false, error: string, status: number }}
 */
function normalizeNaverUserinfo(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'INVALID_NAVER_USERINFO', status: 502 };
  }
  const nested = raw.response;
  if (!nested || typeof nested !== 'object') {
    return { ok: false, error: 'MISSING_NAVER_RESPONSE', status: 502 };
  }
  const id = String(nested.id == null ? '' : nested.id).trim();
  if (!id) {
    return { ok: false, error: 'MISSING_NAVER_ID', status: 502 };
  }

  /** @type {Record<string, string>} */
  const body = { sub: id };
  const email = String(nested.email == null ? '' : nested.email).trim();
  if (email) body.email = email;
  const name = String(nested.name == null ? '' : nested.name).trim();
  if (name) body.name = name;
  const nickname = String(nested.nickname == null ? '' : nested.nickname).trim();
  if (nickname) body.preferred_username = nickname;
  return { ok: true, body };
}

/**
 * @param {string} authorizationHeader raw Authorization header (Bearer <naver access token>)
 * @param {typeof fetch} [fetchImpl]
 */
async function fetchNormalizedNaverUserinfo(authorizationHeader, fetchImpl) {
  const auth = String(authorizationHeader || '').trim();
  if (!/^Bearer\s+\S+/i.test(auth)) {
    return { ok: false, error: 'MISSING_BEARER', status: 401 };
  }
  const fetchFn = fetchImpl || fetch;
  let res;
  try {
    res = await fetchFn(NAVER_PROFILE_URL, {
      method: 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
    });
  } catch (_) {
    return { ok: false, error: 'NAVER_FETCH_FAILED', status: 502 };
  }

  let raw = null;
  try {
    raw = await res.json();
  } catch (_) {
    return { ok: false, error: 'NAVER_INVALID_JSON', status: 502 };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: 'NAVER_HTTP_' + String(res.status || 0),
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
      raw: raw,
    };
  }

  return normalizeNaverUserinfo(raw);
}

module.exports = {
  NAVER_PROFILE_URL,
  normalizeNaverUserinfo,
  fetchNormalizedNaverUserinfo,
};
