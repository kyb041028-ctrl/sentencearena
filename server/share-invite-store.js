'use strict';

const crypto = require('crypto');

const BOT = /bot|spider|crawler|preview|facebookexternalhit|whatsapp|slackbot|twitterbot|discordbot|kakaotalk|kakao|telegrambot|googlebot|bingbot|applebot|linkedinbot|pinterest|embedly|quora|iframely|redditbot/i;

function newCode() {
  return crypto.randomBytes(9).toString('base64url');
}

function isBot(userAgent) {
  return BOT.test(String(userAgent || ''));
}

function safeCode(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(text)) return null;
  return text;
}

async function displayName(query, userId) {
  try {
    const res = await query('SELECT display_name FROM public.profiles WHERE id = $1', [userId]);
    const name = res.rows[0] && res.rows[0].display_name;
    const text = String(name || '').trim();
    if (text) return text.slice(0, 40);
  } catch (err) {
    if (!err || err.code !== '42703') throw err;
  }
  return '회원';
}

async function usParticipationBlock(query, userId) {
  if (typeof query !== 'function' || !userId) return 'US_AGE_UNVERIFIED';
  const legal = require('../shared/legal-gate-core');
  let krRow = null;
  try {
    const res = await query(
      `SELECT age_requirement_confirmed_at, age_policy_version, us_participation
         FROM public.user_legal_consents WHERE user_id = $1`,
      [userId]
    );
    krRow = res.rows[0] || null;
  } catch (err) {
    if (!err || err.code !== '42703') throw err;
    try {
      const res = await query(
        `SELECT age_requirement_confirmed_at, age_policy_version
           FROM public.user_legal_consents WHERE user_id = $1`,
        [userId]
      );
      krRow = res.rows[0] || null;
    } catch (inner) {
      if (!inner || inner.code !== '42P01') throw inner;
    }
  }
  if (krRow && krRow.us_participation === 'read-only') return 'US_PARTICIPATION_READ_ONLY';
  let usRow = null;
  try {
    const res = await query(
      `SELECT activity_region, age_policy_region, age_requirement_confirmed_at, age_policy_version
         FROM public.user_activity_region_legal_consents
        WHERE user_id = $1 AND activity_region = 'US'`,
      [userId]
    );
    usRow = res.rows[0] || null;
  } catch (err) {
    if (!err || (err.code !== '42P01' && err.code !== '42703')) throw err;
    return 'US_AGE_UNVERIFIED';
  }
  if (legal.isUsAgeConfirmed(usRow)) return null;
  return 'US_AGE_UNVERIFIED';
}

async function createShareLink(query, userId, postId) {
  const post = await query(
    `SELECT id, activity_region, status FROM public.board_posts WHERE id = $1`,
    [postId]
  );
  const row = post.rows[0];
  if (!row || row.status !== 'ACTIVE') {
    const err = new Error('POST_UNAVAILABLE');
    err.code = 'POST_UNAVAILABLE';
    throw err;
  }
  const region = row.activity_region === 'US' ? 'US' : row.activity_region === 'KR' ? 'KR' : null;
  if (!region) {
    const err = new Error('COUNTRY_REQUIRED');
    err.code = 'COUNTRY_REQUIRED';
    throw err;
  }
  const code = newCode();
  await query(
    `INSERT INTO public.share_links (code, post_id, activity_region, sharer_user_id)
     VALUES ($1, $2, $3, $4)`,
    [code, row.id, region, userId]
  );
  return { code: code, region: region, postId: String(row.id), path: '/' + region.toLowerCase() + '/posts/' + row.id + '?s=' + code };
}

async function createInviteLink(query, userId, region) {
  const country = region === 'US' ? 'US' : region === 'KR' ? 'KR' : null;
  if (!country) {
    const err = new Error('COUNTRY_REQUIRED');
    err.code = 'COUNTRY_REQUIRED';
    throw err;
  }
  const code = newCode();
  await query(
    `INSERT INTO public.invite_links (code, inviter_user_id, activity_region)
     VALUES ($1, $2, $3)`,
    [code, userId, country]
  );
  return {
    code: code,
    region: country,
    path: '/' + country.toLowerCase() + '/invite/' + code,
    nickname: await displayName(query, userId),
  };
}

async function readShare(query, region, postId, code, userAgent) {
  const post = await loadPublicPost(query, postId);
  if (!post || post.region !== region) {
    return { ok: false, error: post ? 'COUNTRY_MISMATCH' : 'POST_UNAVAILABLE', region: post ? post.region : region };
  }
  if (post.status !== 'ACTIVE') {
    return { ok: false, error: 'POST_UNAVAILABLE', region: region };
  }
  let attribution = null;
  if (code) {
    const link = await query(
      'SELECT code, post_id, activity_region FROM public.share_links WHERE code = $1',
      [code]
    );
    const row = link.rows[0];
    if (!row || String(row.post_id) !== String(postId)) {
      return { ok: false, error: 'CODE_NOT_FOUND', region: region };
    }
    if (row.activity_region !== region) {
      return { ok: false, error: 'COUNTRY_MISMATCH', region: row.activity_region };
    }
    attribution = { code: row.code, region: row.activity_region };
    if (!isBot(userAgent)) {
      await query(
        `INSERT INTO public.share_invite_events (kind, activity_region, path_kind, code, post_id)
         VALUES ('share_visit', $1, 'share', $2, $3)`,
        [region, row.code, postId]
      );
    }
  }
  const comments = await query(
    `SELECT id, content, is_anonymous, author_user_id, territory, created_at,
            earth_positive_count, earth_negative_count
     FROM public.board_comments
     WHERE post_id = $1 AND status = 'ACTIVE'
     ORDER BY created_at ASC
     LIMIT 50`,
    [postId]
  );
  const authorName = post.isAnonymous ? '익명' : await displayName(query, post.authorUserId);
  return {
    ok: true,
    post: {
      id: String(post.id),
      region: post.region,
      title: post.title,
      content: post.content,
      territory: post.territory,
      boardStage: post.boardStage,
      authorName: authorName,
      authorId: post.isAnonymous ? null : String(post.authorUserId || ''),
      reactions: post.reactions,
      comments: await Promise.all(comments.rows.map(async function (row) {
        return {
          id: String(row.id),
          content: row.content,
          authorName: row.is_anonymous ? '익명' : await displayName(query, row.author_user_id),
          authorId: row.is_anonymous ? null : String(row.author_user_id || ''),
          territory: row.territory,
          reactions: {
            positive: Number(row.earth_positive_count) || 0,
            negative: Number(row.earth_negative_count) || 0,
          },
        };
      })),
    },
    attribution: attribution,
  };
}

async function loadPublicPost(query, postId) {
  const res = await query(
    `SELECT id, title, content, territory, board_stage, status, is_anonymous, author_user_id, activity_region,
            earth_positive_count, earth_negative_count
     FROM public.board_posts WHERE id = $1`,
    [postId]
  );
  const row = res.rows[0];
  if (!row) return null;
  const region = row.activity_region === 'US' ? 'US' : row.activity_region === 'KR' ? 'KR' : null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    territory: row.territory,
    boardStage: row.board_stage,
    status: row.status,
    isAnonymous: row.is_anonymous === true,
    authorUserId: row.author_user_id,
    region: region,
    reactions: {
      positive: Number(row.earth_positive_count) || 0,
      negative: Number(row.earth_negative_count) || 0,
    },
  };
}

async function publicPreview(query, region, postId) {
  const post = await loadPublicPost(query, postId);
  if (!post || post.region !== region || post.status !== 'ACTIVE') {
    return { available: false, region: region };
  }
  return {
    available: true,
    region: region,
    title: String(post.title || '').slice(0, 80),
    description: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 140),
  };
}

async function readInvite(query, pathRegion, code, userAgent) {
  const safe = safeCode(code);
  if (!safe) return { ok: false, error: 'CODE_NOT_FOUND', region: pathRegion };
  const res = await query(
    'SELECT code, inviter_user_id, activity_region FROM public.invite_links WHERE code = $1',
    [safe]
  );
  const row = res.rows[0];
  if (!row) return { ok: false, error: 'CODE_NOT_FOUND', region: pathRegion };
  if (row.activity_region !== pathRegion) {
    return { ok: false, error: 'COUNTRY_MISMATCH', region: row.activity_region };
  }
  if (!isBot(userAgent)) {
    await query(
      `INSERT INTO public.share_invite_events (kind, activity_region, path_kind, code)
       VALUES ('invite_visit', $1, 'invite', $2)`,
      [pathRegion, row.code]
    );
  }
  return {
    ok: true,
    region: pathRegion,
    code: row.code,
    nickname: await displayName(query, row.inviter_user_id),
  };
}

async function inviteFollowTarget(query, code, pathRegion) {
  const safe = safeCode(code);
  if (!safe) return null;
  const res = await query(
    'SELECT inviter_user_id, activity_region FROM public.invite_links WHERE code = $1',
    [safe]
  );
  const row = res.rows[0];
  if (!row || row.activity_region !== pathRegion) return null;
  return { userId: String(row.inviter_user_id), region: row.activity_region, nickname: await displayName(query, row.inviter_user_id) };
}

async function lookupReferral(query, region, code, email) {
  const safe = safeCode(code);
  const country = region === 'US' ? 'US' : region === 'KR' ? 'KR' : null;
  if (!safe || !country) return { ok: false, error: 'REFERRAL_CODE_INVALID' };
  const res = await query(
    `SELECT l.inviter_user_id, l.activity_region, u.email
       FROM public.invite_links l
       LEFT JOIN auth.users u ON u.id = l.inviter_user_id
      WHERE l.code = $1`,
    [safe]
  );
  const row = res.rows[0];
  if (!row || row.activity_region !== country) return { ok: false, error: 'REFERRAL_CODE_INVALID' };
  const ownerEmail = String(row.email || '').trim().toLowerCase();
  if (ownerEmail && ownerEmail === String(email || '').trim().toLowerCase()) {
    return { ok: false, error: 'SELF_REFERRAL' };
  }
  return { ok: true, inviterId: String(row.inviter_user_id), region: country, code: safe };
}

async function recordSignup(query, userId, region, pathKind, code) {
  const safe = safeCode(code);
  const kind = pathKind === 'invite' ? 'invite' : 'share';
  if (!safe || (region !== 'KR' && region !== 'US')) return { recorded: false };
  const table = kind === 'invite' ? 'invite_links' : 'share_links';
  const found = await query(
    'SELECT activity_region' + (kind === 'share' ? ', post_id, sharer_user_id' : ', inviter_user_id') + ' FROM public.' + table + ' WHERE code = $1',
    [safe]
  );
  const row = found.rows[0];
  if (!row || row.activity_region !== region) return { recorded: false };
  const ownerId = kind === 'invite' ? row.inviter_user_id : row.sharer_user_id;
  if (ownerId && String(ownerId) === String(userId)) return { recorded: false };
  const inserted = await query(
    `INSERT INTO public.share_invite_events (kind, activity_region, path_kind, code, post_id, user_id)
     VALUES ('share_signup', $1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [region, kind, safe, row.post_id || null, userId]
  );
  return { recorded: inserted.rows.length > 0 };
}

async function noteFirstAction(query, userId, kind, region) {
  if (typeof query !== 'function') return;
  if (kind !== 'first_post' && kind !== 'first_comment' && kind !== 'first_reaction') return;
  if (region !== 'KR' && region !== 'US') return;
  const prior = await query(
    `SELECT path_kind, code, activity_region FROM public.share_invite_events
     WHERE user_id = $1 AND kind = 'share_signup'
     ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  const src = prior.rows[0];
  if (!src) return;
  await query(
    `INSERT INTO public.share_invite_events (kind, activity_region, path_kind, code, user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [kind, region, src.path_kind, src.code, userId]
  );
}

module.exports = {
  isBot: isBot,
  safeCode: safeCode,
  usParticipationBlock: usParticipationBlock,
  createShareLink: createShareLink,
  createInviteLink: createInviteLink,
  lookupReferral: lookupReferral,
  readShare: readShare,
  publicPreview: publicPreview,
  readInvite: readInvite,
  inviteFollowTarget: inviteFollowTarget,
  recordSignup: recordSignup,
  noteFirstAction: noteFirstAction,
  displayName: displayName,
};
