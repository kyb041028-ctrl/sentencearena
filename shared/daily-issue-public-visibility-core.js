'use strict';

const usOps = require('./daily-issue-us-ops-core');

function isPubliclyAccessible(item, viewerRegion) {
  if (!item || String(item.status) !== 'PUBLISHED') return false;
  const viewer = usOps.normalizeRegion(viewerRegion) || viewerRegion;
  const region = usOps.issueRegion(item);
  if (!region || region !== viewer) return false;
  const vis = item.lifecycleMeta && item.lifecycleMeta.usVisibility;
  if (region === 'US' && vis === 'TEMP_HIDDEN') return false;
  return true;
}

module.exports = {
  isPubliclyAccessible: isPubliclyAccessible,
};
