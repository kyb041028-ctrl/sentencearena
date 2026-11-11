'use strict';

/**
 * 표나 열이 없거나, 읽기 권한이 없거나, DB 연결 자체가 없는 경우.
 * 이런 경우 관리자 화면은 0이 아니라 "미확인"으로 표시해야 한다.
 */
function isUnavailableDbError(err) {
  const code = err && err.code;
  return code === '42P01' || code === '42703' || code === '42501' || code === 'DB_UNAVAILABLE';
}

module.exports = {
  isUnavailableDbError: isUnavailableDbError,
};
