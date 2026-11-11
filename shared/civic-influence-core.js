'use strict';

/**
 * 시민 영향력 = 받은 게시글 공감 + 받은 댓글 공감 × 2 + 팔로워 × 5.
 * 입력이 없으면 0으로 바꾸지 않고 그 항목을 빠진 것으로 남긴다.
 */
function readInput(input, key) {
  const raw = input && input[key];
  if (raw == null) return { ok: false };
  if (typeof raw === 'number' && isFinite(raw)) {
    return { ok: true, value: Math.max(0, Math.floor(raw)) };
  }
  if (typeof raw === 'object' && raw.available === true && typeof raw.value === 'number' && isFinite(raw.value)) {
    return { ok: true, value: Math.max(0, Math.floor(raw.value)) };
  }
  return { ok: false };
}

function civicInfluence(input) {
  const keys = ['postLikes', 'commentLikes', 'followers'];
  const missing = [];
  const values = {};
  let i;
  for (i = 0; i < keys.length; i++) {
    const read = readInput(input, keys[i]);
    if (!read.ok) missing.push(keys[i]);
    else values[keys[i]] = read.value;
  }
  if (missing.length) {
    return { available: false, value: null, missing: missing };
  }
  return {
    available: true,
    value: values.postLikes + values.commentLikes * 2 + values.followers * 5,
    missing: [],
  };
}

module.exports = {
  civicInfluence: civicInfluence,
};
