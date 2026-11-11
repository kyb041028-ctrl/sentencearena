'use strict';

/**
 * 프로필 활동 목록. 카운트와 같은 범위만 페이지로 자른다.
 * 다른 회원 id는 거부한다. localStorage 활동은 쓰지 않는다.
 */

const PAGE_SIZE = 20;

function regionOf(row) {
  const raw = row && (row.activity_region != null ? row.activity_region : row.activityRegion);
  return String(raw == null ? '' : raw).trim().toUpperCase();
}

function inRegion(row, region) {
  const raw = regionOf(row);
  if (region === 'US') return raw === 'US';
  return raw === '' || raw === 'KR';
}

function pageSlice(items, page) {
  const size = PAGE_SIZE;
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / size);
  let p = Math.floor(Number(page) || 1);
  if (!isFinite(p) || p < 1) p = 1;
  if (totalPages > 0 && p > totalPages) p = totalPages;
  const start = (p - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: total === 0 ? 1 : p,
    pageSize: size,
    totalItems: total,
    totalPages: totalPages,
  };
}

function sortNewest(items) {
  return items.slice().sort(function (a, b) {
    const at = Date.parse(a.createdAt || '') || 0;
    const bt = Date.parse(b.createdAt || '') || 0;
    return bt - at;
  });
}

function assertOwner(query) {
  const userId = String((query && query.userId) || '').trim();
  const requested = String((query && query.requestedUserId) || '').trim();
  if (!userId) {
    const err = new Error('ACTIVITY_AUTH_REQUIRED');
    err.status = 401;
    err.code = 'ACTIVITY_AUTH_REQUIRED';
    throw err;
  }
  if (requested && requested !== userId) {
    const err = new Error('ACTIVITY_FORBIDDEN');
    err.status = 403;
    err.code = 'ACTIVITY_FORBIDDEN';
    throw err;
  }
  return userId;
}

function listPostsFromRows(rows, query) {
  const userId = assertOwner(query);
  const region = query.region === 'US' ? 'US' : 'KR';
  const items = [];
  (rows || []).forEach(function (row) {
    if (!row || String(row.author_user_id || row.authorUserId || '') !== userId) return;
    if (String(row.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return;
    if (!inRegion(row, region)) return;
    items.push({
      postId: String(row.id || ''),
      title: String(row.title || ''),
      createdAt: row.created_at || row.createdAt || '',
      territory: row.territory || '',
      commentCount: Math.max(0, Math.floor(Number(row.comment_count != null ? row.comment_count : row.commentCount) || 0)),
    });
  });
  const paged = pageSlice(sortNewest(items), query.page);
  return Object.assign({ ok: true, kind: 'POSTS', region: region, totalLikes: null }, paged);
}

function listCommentsFromRows(comments, posts, query) {
  const userId = assertOwner(query);
  const region = query.region === 'US' ? 'US' : 'KR';
  const postById = {};
  (posts || []).forEach(function (post) {
    if (post && post.id != null) postById[String(post.id)] = post;
  });
  const items = [];
  (comments || []).forEach(function (row) {
    if (!row || String(row.author_user_id || row.authorUserId || '') !== userId) return;
    if (String(row.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return;
    if (!inRegion(row, region)) return;
    const post = postById[String(row.post_id || row.postId || '')] || null;
    items.push({
      commentId: String(row.id || ''),
      postId: String(row.post_id || row.postId || ''),
      contentPreview: String(row.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      createdAt: row.created_at || row.createdAt || '',
      postTitle: post ? String(post.title || '') : '',
      territory: (post && post.territory) || row.territory || '',
    });
  });
  const paged = pageSlice(sortNewest(items), query.page);
  return Object.assign({ ok: true, kind: 'COMMENTS', region: region }, paged);
}

function empathyKind(sourceType) {
  const src = String(sourceType || '').toLowerCase();
  if (src === 'board_post' || src === 'post') return 'POST';
  if (src === 'board_comment' || src === 'comment') return 'COMMENT';
  return '';
}

function targetFromDedupe(dedupe) {
  const parts = String(dedupe || '').split(':');
  if (parts.length >= 3 && parts[0] === 'EMPATHY_RECEIVED') return parts[1];
  if (parts.length >= 4 && parts[1] === 'EMPATHY_RECEIVED') return parts[2];
  return '';
}

function reactorFromDedupe(dedupe) {
  const parts = String(dedupe || '').split(':');
  if (parts.length >= 3 && parts[0] === 'EMPATHY_RECEIVED') return parts[parts.length - 1];
  if (parts.length >= 4 && parts[1] === 'EMPATHY_RECEIVED') return parts[parts.length - 1];
  return '';
}

function listLikesFromRows(events, posts, comments, query) {
  const userId = assertOwner(query);
  const region = query.region === 'US' ? 'US' : 'KR';
  const postById = {};
  const commentById = {};
  (posts || []).forEach(function (post) {
    if (post && post.id != null) postById[String(post.id)] = post;
  });
  (comments || []).forEach(function (comment) {
    if (comment && comment.id != null) commentById[String(comment.id)] = comment;
  });
  const groups = {};
  let commentSupported = false;
  let unspecified = false;
  (events || []).forEach(function (row) {
    if (!row || String(row.user_id || row.userId || userId) !== userId) return;
    if (row.revoked === true || row.deleted === true) return;
    const eventRegion = regionOf(row);
    if (region === 'US') {
      if (eventRegion && eventRegion !== 'US') return;
      const dedupe = String(row.dedupe_key || row.dedupeKey || '');
      if (dedupe.indexOf('KR:') === 0) return;
    } else if (eventRegion === 'US') {
      return;
    }
    const dedupe = String(row.dedupe_key || row.dedupeKey || '');
    const reactor = String(row.reactor_user_id || row.reactorUserId || reactorFromDedupe(dedupe) || '');
    if (reactor && reactor === userId) return;
    const sourceType = row.source_type || row.sourceType || '';
    const kind = empathyKind(sourceType);
    if (kind === 'COMMENT') commentSupported = true;
    if (!kind) unspecified = true;
    const target = String(row.source_id || row.sourceId || targetFromDedupe(dedupe) || row.id || '');
    if (!target) return;
    const key = (kind || 'UNSPECIFIED') + ':' + target;
    if (!groups[key]) {
      groups[key] = {
        kind: kind,
        targetId: target,
        likeCount: 0,
        createdAt: row.occurred_at || row.createdAt || '',
      };
    }
    groups[key].likeCount += 1;
    const at = row.occurred_at || row.createdAt || '';
    if (Date.parse(at) > Date.parse(groups[key].createdAt || '')) groups[key].createdAt = at;
  });
  const items = [];
  let totalLikes = 0;
  Object.keys(groups).forEach(function (key) {
    const group = groups[key];
    totalLikes += group.likeCount;
    let postId = '';
    let commentId = '';
    let title = '';
    let territory = '';
    if (group.kind === 'COMMENT' || commentById[group.targetId]) {
      const comment = commentById[group.targetId];
      if (group.kind === 'COMMENT' || comment) {
        commentId = group.targetId;
        postId = comment ? String(comment.post_id || comment.postId || '') : '';
        const post = postById[postId];
        title = post ? String(post.title || '') : '';
        territory = (post && post.territory) || '';
      }
    }
    if (!postId && (group.kind === 'POST' || postById[group.targetId])) {
      const post = postById[group.targetId];
      if (group.kind === 'POST' || post) {
        postId = group.targetId;
        title = post ? String(post.title || '') : '';
        territory = (post && post.territory) || '';
      }
    }
    items.push({
      kind: group.kind || 'UNSPECIFIED',
      likeCount: group.likeCount,
      createdAt: group.createdAt,
      postId: postId,
      commentId: commentId,
      postTitle: title,
      territory: territory,
    });
  });
  const paged = pageSlice(sortNewest(items), query.page);
  return Object.assign(
    {
      ok: true,
      kind: 'LIKES',
      region: region,
      totalLikes: totalLikes,
      commentLikeHistory: commentSupported ? 'CONNECTED' : 'UNSUPPORTED',
      warning: unspecified && !commentSupported ? 'COMMENT_LIKE_HISTORY_UNSUPPORTED' : '',
    },
    paged
  );
}

function readResult(res) {
  if (!res || res.error) {
    const err = new Error((res && res.error && (res.error.message || res.error.code)) || 'ACTIVITY_QUERY_FAILED');
    err.status = 503;
    err.code = 'ACTIVITY_QUERY_FAILED';
    throw err;
  }
  return {
    rows: res.data || [],
    count: typeof res.count === 'number' ? res.count : null,
  };
}

function withExactTotal(listed, count, page) {
  if (typeof count !== 'number') return listed;
  listed.totalItems = count;
  listed.totalPages = count === 0 ? 0 : Math.ceil(count / PAGE_SIZE);
  listed.page = page;
  return listed;
}

function applyRegion(query, region) {
  if (region === 'US') return query.eq('activity_region', 'US');
  return query.or('activity_region.is.null,activity_region.eq.KR,activity_region.eq.');
}

async function listForUser(sb, query) {
  const userId = assertOwner(query);
  const region = query.region === 'US' ? 'US' : 'KR';
  const kind = String(query.kind || 'POSTS').toUpperCase();
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  if (!sb || typeof sb.from !== 'function') {
    const err = new Error('ACTIVITY_SOURCE_UNAVAILABLE');
    err.status = 503;
    err.code = 'ACTIVITY_SOURCE_UNAVAILABLE';
    throw err;
  }
  if (kind === 'COMMENTS') {
    const commentQuery = applyRegion(
      sb
        .from('board_comments')
        .select('id, post_id, author_user_id, content, territory, status, activity_region, created_at', { count: 'exact' })
        .eq('author_user_id', userId)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false })
        .range(from, to),
      region
    );
    const commentRead = readResult(await commentQuery);
    const ids = commentRead.rows.map(function (row) { return row.post_id; }).filter(Boolean);
    const posts = ids.length
      ? readResult(await sb.from('board_posts').select('id, title, territory, status').in('id', ids)).rows
      : [];
    return withExactTotal(
      listCommentsFromRows(commentRead.rows, posts, Object.assign({}, query, { page: 1 })),
      commentRead.count,
      page
    );
  }
  if (kind === 'LIKES') {
    const events = readResult(
      region === 'US'
        ? await sb
          .from('user_activity_events')
          .select('id, user_id, activity_type, activity_region, dedupe_key, source_type, source_id, occurred_at')
          .eq('user_id', userId)
          .eq('activity_type', 'EMPATHY_RECEIVED')
          .eq('activity_region', 'US')
        : await sb
          .from('user_progression_events')
          .select('id, user_id, event_type, source_type, source_id, dedupe_key, occurred_at')
          .eq('user_id', userId)
          .eq('event_type', 'EMPATHY_RECEIVED')
    ).rows;
    const postIds = [];
    const commentIds = [];
    events.forEach(function (row) {
      const kindName = empathyKind(row.source_type);
      const target = row.source_id || targetFromDedupe(row.dedupe_key);
      if (!target) return;
      if (kindName === 'COMMENT') commentIds.push(target);
      else postIds.push(target);
    });
    const posts = postIds.length
      ? readResult(await sb.from('board_posts').select('id, title, territory, status').in('id', postIds)).rows
      : [];
    const comments = commentIds.length
      ? readResult(await sb.from('board_comments').select('id, post_id, content, status').in('id', commentIds)).rows
      : [];
    const parentIds = comments.map(function (row) { return row.post_id; }).filter(Boolean);
    const parents = parentIds.length
      ? readResult(await sb.from('board_posts').select('id, title, territory, status').in('id', parentIds)).rows
      : [];
    return listLikesFromRows(events, posts.concat(parents), comments, query);
  }
  const postQuery = applyRegion(
    sb
      .from('board_posts')
      .select('id, author_user_id, title, territory, status, activity_region, created_at, comment_count', { count: 'exact' })
      .eq('author_user_id', userId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .range(from, to),
    region
  );
  const postRead = readResult(await postQuery);
  return withExactTotal(
    listPostsFromRows(postRead.rows, Object.assign({}, query, { page: 1 })),
    postRead.count,
    page
  );
}

module.exports = {
  PAGE_SIZE: PAGE_SIZE,
  listPostsFromRows: listPostsFromRows,
  listCommentsFromRows: listCommentsFromRows,
  listLikesFromRows: listLikesFromRows,
  listForUser: listForUser,
};
