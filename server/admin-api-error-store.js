'use strict';

const { isUnavailableDbError } = require('./admin-db-errors');

const ROW_CAP = 2000;
const MAX_IN_FLIGHT = 5;
const HANDLING = Object.freeze(['NEW', 'CHECKED', 'IGNORED']);

const DAY_SQL = "(now() AT TIME ZONE 'Asia/Seoul')::date";

/**
 * 5xx 오류를 하루·요청 경로·상태 단위로 묶어 셀 수만 저장한다.
 * 요청 본문, 쿼리 문자열, 토큰, IP, 사용자 식별자는 받지도 저장하지도 않는다.
 * 저장 실패는 조용히 버리며 요청 처리에는 어떤 영향도 주지 않는다.
 */
function createApiErrorStore(options) {
  const opts = options || {};
  const enabled = opts.enabled === true;
  const query = typeof opts.query === 'function' ? opts.query : null;
  let inFlight = 0;
  let dropped = 0;
  let failed = 0;

  function record(entry) {
    try {
      if (!enabled || !query || !entry) return;
      if (inFlight >= MAX_IN_FLIGHT) {
        dropped += 1;
        return;
      }
      inFlight += 1;
      const params = [String(entry.method || '').slice(0, 10), String(entry.path || '').slice(0, 160), Number(entry.status) || 500];
      Promise.resolve()
        .then(function () {
          return query(
            'INSERT INTO public.admin_api_error_records AS t (day, method, path, status) ' +
              'SELECT ' + DAY_SQL + ', $1::text, $2::text, $3::int ' +
              'WHERE (SELECT COUNT(*) FROM public.admin_api_error_records) < ' + ROW_CAP +
              ' OR EXISTS (SELECT 1 FROM public.admin_api_error_records e WHERE e.day = ' + DAY_SQL + ' AND e.method = $1::text AND e.path = $2::text AND e.status = $3::int) ' +
              'ON CONFLICT (day, method, path, status) DO UPDATE SET occurrence_count = t.occurrence_count + 1, last_at = now()',
            params,
          );
        })
        .catch(function () {
          failed += 1;
        })
        .then(function () {
          inFlight -= 1;
        });
    } catch (_) {
      // 오류 기록이 요청을 깨뜨리면 안 된다.
    }
  }

  async function list(limit) {
    if (!enabled) return { status: 'NOT_COLLECTED', enabled: false, items: [] };
    if (!query) return { status: 'NOT_CONFIRMED', enabled: true, items: [] };
    try {
      const rows = await query(
        'SELECT id, day, method, path, status, occurrence_count, first_at, last_at, handling_status FROM public.admin_api_error_records ' +
          'ORDER BY last_at DESC, id LIMIT ' + Math.max(1, Math.min(50, Number(limit) || 20)),
        [],
      );
      return {
        status: 'OK',
        enabled: true,
        cap: ROW_CAP,
        dropped: dropped,
        writeFailures: failed,
        items: rows.rows.map(function (r) {
          return {
            id: r.id,
            day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
            method: r.method,
            path: r.path,
            status: r.status,
            count: Number(r.occurrence_count),
            firstAt: new Date(r.first_at).toISOString(),
            lastAt: new Date(r.last_at).toISOString(),
            handling: r.handling_status,
          };
        }),
      };
    } catch (e) {
      if (isUnavailableDbError(e)) return { status: 'NOT_CONFIRMED', enabled: true, items: [] };
      return { status: 'FAIL', enabled: true, items: [] };
    }
  }

  async function setHandling(id, handling) {
    if (!enabled || !query) return { ok: false, code: 'ERROR_STORE_NOT_AVAILABLE' };
    if (HANDLING.indexOf(handling) < 0) return { ok: false, code: 'ERROR_HANDLING_INVALID' };
    try {
      const out = await query(
        'UPDATE public.admin_api_error_records SET handling_status = $2::text WHERE id = $1::uuid RETURNING id',
        [id, handling],
      );
      return out.rows.length ? { ok: true } : { ok: false, code: 'ERROR_RECORD_NOT_FOUND' };
    } catch (e) {
      return { ok: false, code: 'ERROR_STORE_NOT_AVAILABLE' };
    }
  }

  return { record: record, list: list, setHandling: setHandling, enabled: enabled };
}

module.exports = { createApiErrorStore: createApiErrorStore, HANDLING: HANDLING, ROW_CAP: ROW_CAP };
