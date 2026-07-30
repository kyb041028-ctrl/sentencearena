'use strict';
/**
 * 사용자 데이터 Express Router
 * server.js 에 mount: app.use('/api', userDataRouter)
 *
 * 운영 활성화 전까지 모든 엔드포인트는 USER_DATA_API_NOT_ACTIVATED 반환.
 */

const express = require('express');
const service = require('./user-data-service');

const router = express.Router();

// ─── 공통 유틸 ───────────────────────────────────────────────────────────────
function getUserId(req) {
  // Bearer 토큰에서 userId 추출 (server.js 의 chatResolveUserId 패턴 재사용)
  // 실제 운영 시: JWT 검증 후 auth.uid() 사용
  return req.headers['x-sc-user-id'] || (req.user && req.user.id) || null;
}

function sendError(res, err) {
  const code = err.code || 'USER_DATA_ERROR';
  const status = err.status || 400;
  return res.status(status).json({ ok: false, error: code });
}

function notActivated(res) {
  return res.status(503).json({ ok: false, error: 'USER_DATA_API_NOT_ACTIVATED' });
}

function wrapHandler(fn) {
  return async function (req, res) {
    if (!service.isActivated()) return notActivated(res);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'USER_DATA_AUTH_REQUIRED' });
    try {
      const result = await fn(req, res, userId);
      if (!res.headersSent) res.json({ ok: true, data: result });
    } catch (err) {
      sendError(res, err);
    }
  };
}

// =============================================================================
// Profile
// =============================================================================
router.get('/users/me', wrapHandler(async (req, res, userId) => {
  return service.getMyProfile(userId);
}));

router.get('/users/me/profile/full', wrapHandler(async (req, res, userId) => {
  return service.getSelfUserProfileFull(userId);
}));

router.get('/users/:userId/profile', wrapHandler(async (req, res, _me) => {
  return service.getPublicProfile(req.params.userId);
}));

router.get('/users/:userId/profile/public', wrapHandler(async (req, res, myId) => {
  return service.getPublicUserProfileFull(myId, req.params.userId);
}));

router.patch('/users/me/profile', wrapHandler(async (req, res, userId) => {
  return service.updateMyProfile(userId, req.body);
}));

// =============================================================================
// Progression
// =============================================================================
router.get('/users/me/progression', wrapHandler(async (req, res, userId) => {
  return service.getMyProgression(userId);
}));

router.get('/users/:userId/progression/public', wrapHandler(async (req, res, _me) => {
  return service.getPublicProgression(req.params.userId);
}));

// 일반 사용자가 progression 을 직접 patch 하는 것 차단
router.patch('/users/me/progression', async (req, res) => {
  return res.status(403).json({ ok: false, error: 'USER_DATA_PROGRESSION_WRITE_FORBIDDEN' });
});

// =============================================================================
// Follows
// =============================================================================
router.post('/users/:userId/follow/toggle', wrapHandler(async (req, res, myId) => {
  return service.toggleFollow(myId, req.params.userId);
}));

router.get('/users/:userId/followers', wrapHandler(async (req, res, _me) => {
  return service.getFollowers(req.params.userId, { limit: Number(req.query.limit) || 50 });
}));

router.get('/users/:userId/following', wrapHandler(async (req, res, _me) => {
  return service.getFollowing(req.params.userId, { limit: Number(req.query.limit) || 50 });
}));

router.get('/users/:userId/follow-state', wrapHandler(async (req, res, myId) => {
  return service.getFollowState(myId, req.params.userId);
}));

// =============================================================================
// Achievements
// =============================================================================
router.get('/users/:userId/achievements', wrapHandler(async (req, res, _me) => {
  return service.getAchievements(req.params.userId);
}));

router.put('/users/me/featured-achievements', wrapHandler(async (req, res, userId) => {
  const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys : [];
  return service.setFeaturedAchievements(userId, keys);
}));

// 일반 사용자 XP/업적 부여 API 없음 — 404 반환
router.post('/users/me/xp', (req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND' });
});
router.post('/users/me/achievements/grant', (req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND' });
});

// =============================================================================
// Notifications
// =============================================================================
router.get('/users/me/notifications', wrapHandler(async (req, res, userId) => {
  return service.listNotifications(userId, { limit: Number(req.query.limit) || 50 });
}));

router.patch('/users/me/notifications/:notificationId/read', wrapHandler(async (req, res, userId) => {
  return service.markNotificationRead(userId, req.params.notificationId);
}));

router.post('/users/me/notifications/read-all', wrapHandler(async (req, res, userId) => {
  return service.markAllNotificationsRead(userId);
}));

// 클라이언트 직접 알림 생성 금지
router.post('/users/me/notifications', (req, res) => {
  res.status(403).json({ ok: false, error: 'USER_DATA_NOTIFICATION_CREATE_FORBIDDEN' });
});

// =============================================================================
// Activity
// =============================================================================
router.get('/users/me/activity', wrapHandler(async (req, res, userId) => {
  return service.listActivity(userId, { limit: Number(req.query.limit) || 50 });
}));

// 클라이언트 직접 활동 이벤트 생성 금지
router.post('/users/me/activity', (req, res) => {
  res.status(403).json({ ok: false, error: 'USER_DATA_ACTIVITY_WRITE_FORBIDDEN' });
});

// =============================================================================
// Bookmarks
// =============================================================================
router.get('/users/me/bookmarks', wrapHandler(async (req, res, userId) => {
  return service.listBookmarks(userId);
}));

router.post('/users/me/bookmarks', wrapHandler(async (req, res, userId) => {
  const postId = req.body && req.body.postId;
  return service.addBookmark(userId, postId);
}));

router.delete('/users/me/bookmarks/:postId', wrapHandler(async (req, res, userId) => {
  return service.removeBookmark(userId, req.params.postId);
}));

module.exports = router;
