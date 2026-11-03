'use strict';

const express = require('express');
const core = require('../shared/activity-region-core');
const service = require('./activity-region-service');
const { createActivityRegionStore } = require('./activity-region-store');

var US_DEV_SAMPLES = [
  {
    id: 'us-sample-1',
    title: '[Sample · Progressive] A shorter ballot, a clearer cost',
    region: 'US',
    sample: true,
    userId: 'sample',
  },
  {
    id: 'us-sample-2',
    title: '[Sample · Central] The plaza is for the unfinished argument',
    region: 'US',
    sample: true,
    userId: 'sample',
  },
];

function createActivityRegionRouter(options) {
  var opts = options || {};
  var lookup = opts.lookup || null;
  var store = opts.store || createActivityRegionStore();
  var devSamples = opts.devSamples !== false && String(process.env.NODE_ENV || '') !== 'production';
  var router = express.Router();

  function current(req) {
    return service.resolveFromRequest(req, lookup);
  }

  function identity(req) {
    if (typeof opts.resolveUser !== 'function') return '';
    var id = opts.resolveUser(req);
    return id ? String(id).trim() : '';
  }

  router.get('/activity-region', function (req, res) {
    var resolved = current(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      region: resolved.region,
      source: resolved.source,
      explicit: resolved.explicit,
    });
  });

  router.post('/activity-region', function (req, res) {
    var region = core.normalizeRegion(req.body && req.body.region);
    if (!region) {
      return res.status(400).json({ ok: false, error: 'INVALID_ACTIVITY_REGION' });
    }
    var headers = service.cookieHeader(region, true);
    headers.forEach(function (line) {
      res.append('Set-Cookie', line);
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, region: region, source: 'explicit', explicit: true });
  });

  router.get('/activity-region/profile', function (req, res) {
    var resolved = current(req);
    var userId = identity(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
    if (req.query && req.query.region && core.normalizeRegion(req.query.region) !== resolved.region) {
      return res.status(403).json({ ok: false, error: 'REGION_MISMATCH' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, profile: store.readProfile(userId, resolved.region) });
  });

  router.get('/activity-region/posts', function (req, res) {
    var resolved = current(req);
    if (req.query && req.query.region && core.normalizeRegion(req.query.region) !== resolved.region) {
      return res.status(403).json({ ok: false, error: 'REGION_MISMATCH' });
    }
    var posts = store.listPosts(resolved.region);
    if (devSamples && resolved.region === 'US') posts = US_DEV_SAMPLES.concat(posts);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, region: resolved.region, posts: posts });
  });

  router.post('/activity-region/posts', function (req, res) {
    var resolved = current(req);
    var userId = identity(req);
    var guest = !userId;
    try {
      var profile = store.writeActivity({
        guest: guest,
        userId: userId,
        activeRegion: resolved.region,
        requestedRegion: req.body && req.body.region,
        post: { title: req.body && req.body.title, body: req.body && req.body.body },
        xp: req.body && req.body.xp,
        fame: req.body && req.body.fame,
        aura: req.body && req.body.aura,
        tendency: req.body && req.body.tendency,
        achievement: req.body && req.body.achievement,
        territory: req.body && req.body.territory,
        evolution: req.body && req.body.evolution,
        level: req.body && req.body.level,
      });
      res.status(201).json({ ok: true, profile: profile });
    } catch (err) {
      var code = err && err.code ? err.code : 'WRITE_FAILED';
      var status = code === 'GUEST_READ_ONLY' || code === 'REGION_MISMATCH' ? 403 : 400;
      res.status(status).json({ ok: false, error: code });
    }
  });

  return router;
}

module.exports = {
  createActivityRegionRouter: createActivityRegionRouter,
  US_DEV_SAMPLES: US_DEV_SAMPLES,
};
