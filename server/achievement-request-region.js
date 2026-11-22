'use strict';

function sameHostPathRegion(req) {
  const ref = req && typeof req.get === 'function' ? req.get('referer') : '';
  if (!ref) return null;
  try {
    const url = new URL(ref);
    if (url.host !== req.get('host')) return null;
    const region = require('../shared/activity-region-core').pathRegion(url.pathname);
    return region === 'KR' || region === 'US' ? region : null;
  } catch (_) {
    return null;
  }
}

function requestRegion(req) {
  const fromPath = sameHostPathRegion(req);
  if (fromPath) return fromPath;
  return require('./activity-region-service').resolveFromRequest(req).region;
}

/** 문의 저장용. 경로 또는 서버가 심은 국가 쿠키만 인정하고, 없으면 null이다. */
function explicitActivityRegion(req) {
  const fromPath = sameHostPathRegion(req);
  if (fromPath) return fromPath;
  const cookies = require('./activity-region-service').parseCookies(
    req && req.headers ? req.headers.cookie : ''
  );
  if (cookies.sa_ar_x === '1' && (cookies.sa_ar === 'KR' || cookies.sa_ar === 'US')) return cookies.sa_ar;
  return null;
}

module.exports = { requestRegion, explicitActivityRegion, sameHostPathRegion };
