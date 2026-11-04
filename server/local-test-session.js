'use strict';

/**
 * 로컬 시험 세션. 운영에서는 켜지지 않는다.
 * 클라이언트가 보낸 사용자 번호는 받지 않고, 서버가 저장한 토큰 해시만 확인한다.
 * Supabase Auth 세션이 아니다.
 */

const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createLocalSessionVerifier(query) {
  if (typeof query !== 'function') return null;
  return async function verify(req) {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return null;
    if (String(process.env.SA_LOCAL_AUTH_VERIFY || '').trim() !== '1') return null;
    const header = req && req.headers ? req.headers.authorization || '' : '';
    const match = String(header).match(/^Bearer\s+(\S+)$/i);
    if (!match) return null;
    let found;
    try {
      found = await query(
        'SELECT user_id FROM auth.local_test_sessions WHERE token_hash = $1 AND expires_at > now()',
        [hashToken(match[1])]
      );
    } catch (_) {
      return null;
    }
    const id = found && found.rows && found.rows[0] && found.rows[0].user_id;
    if (!id) return null;
    return { userId: String(id) };
  };
}

module.exports = {
  createLocalSessionVerifier: createLocalSessionVerifier,
  hashToken: hashToken,
};
