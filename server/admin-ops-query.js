'use strict';

/**
 * 관리자 조회 전용 SQL 실행기. 기존 Daily Issue DB 연결(DAILY_ISSUE_DATABASE_URL)을 재사용한다.
 * DB 저장소를 쓰지 않거나 연결이 없으면 null을 돌려주고, 화면은 "미확인"으로 표시한다.
 */
function createAdminOpsQuery(env, deps) {
  const e = env || {};
  if (String(e.DAILY_ISSUE_REPOSITORY || '').trim().toLowerCase() !== 'db') return null;
  const factory = (deps && deps.createExecutor) || require('./daily-issue-pg-client').createDailyIssuePgExecutor;
  let executor = null;
  return async function adminOpsQuery(sql, params) {
    if (!executor) executor = factory({ schemaName: e.DAILY_ISSUE_DB_SCHEMA });
    if (!executor || executor.ok === false) {
      throw Object.assign(new Error('DB_UNAVAILABLE'), { code: 'DB_UNAVAILABLE' });
    }
    return executor.query(sql, params || []);
  };
}

module.exports = { createAdminOpsQuery: createAdminOpsQuery };
