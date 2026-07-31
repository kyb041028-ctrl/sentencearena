'use strict';
/**
 * 사용자 콘텐츠 route contract
 * GET /api/users/:userId/posts|comments — 운영 비활성(503)
 */

const express = require('express');
const service = require('./user-content-service');

const router = express.Router();

function notActivated(res) {
  return res.status(503).json({ ok: false, error: 'USER_CONTENT_API_NOT_ACTIVATED' });
}

router.get('/users/:userId/posts', async function (req, res) {
  if (!service.isActivated()) return notActivated(res);
  try {
    const data = await service.listUserContent({
      profileUserId: req.params.userId,
      contentType: 'POSTS',
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    return res.json({ ok: true, data: data });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.code || 'USER_CONTENT_ERROR' });
  }
});

router.get('/users/:userId/comments', async function (req, res) {
  if (!service.isActivated()) return notActivated(res);
  try {
    const data = await service.listUserContent({
      profileUserId: req.params.userId,
      contentType: 'COMMENTS',
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    return res.json({ ok: true, data: data });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.code || 'USER_CONTENT_ERROR' });
  }
});

module.exports = router;
