'use strict';

function requestRegion(req) {
  const ref = req && typeof req.get === 'function' ? req.get('referer') : '';
  if (ref) {
    try {
      const url = new URL(ref);
      if (url.host === req.get('host')) {
        const region = require('../shared/activity-region-core').pathRegion(url.pathname);
        if (region) return region;
      }
    } catch (_) {}
  }
  return require('./activity-region-service').resolveFromRequest(req).region;
}
module.exports = { requestRegion };
