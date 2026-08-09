/**
 * =============================================================================
 * 센텐스아레나 — 시즌 설정 스키마 (SSOT)
 * =============================================================================
 * 정책:
 * - 시즌 길이: 6개월
 * - 첫 시즌 시작일: 미정 (운영자가 추후 설정)
 * - 시작일이 정해진 뒤부터 6개월 단위 운영
 * - 시즌 종료 처리: 다음 시즌 시작 배치에서 실행 예정
 * - 시작일 미정(UNSCHEDULED)이면 활성 시즌 없음 → 시즌 업적 집계·초기화 비활성
 *
 * 이번 범위: 설정·상태 상수·조회·검증만.
 * 시즌 생성·6개월 계산·전환·종료 초기화·업적 지급·저장·API 미구현.
 * =============================================================================
 */
(function (global) {
  'use strict';

  /**
   * UNSCHEDULED — 첫 시즌 시작일 미정 · 활성 시즌 없음 · 시즌 업적 집계 비활성
   * SCHEDULED   — 시작일은 정해졌지만 아직 시작 전
   * ACTIVE      — 현재 진행 중
   * ENDED       — 종료됨 · 실제 종료 처리는 다음 시즌 시작 배치에서 수행 예정
   */
  var SEASON_STATUSES = Object.freeze({
    UNSCHEDULED: 'UNSCHEDULED',
    SCHEDULED: 'SCHEDULED',
    ACTIVE: 'ACTIVE',
    ENDED: 'ENDED',
  });

  var SEASON_STATUS_KEYS = Object.freeze([
    'UNSCHEDULED',
    'SCHEDULED',
    'ACTIVE',
    'ENDED',
  ]);

  var SEASON_TRANSITION_MODES = Object.freeze({
    NEXT_SEASON_START_BATCH: 'NEXT_SEASON_START_BATCH',
  });

  /**
   * 향후 시즌 인스턴스 스키마 (현재는 인스턴스를 생성하지 않음).
   * {
   *   seasonId: null,
   *   sequence: null,
   *   startsAt: null,
   *   endsAt: null,
   *   durationMonths: 6,
   *   status: 'UNSCHEDULED'
   * }
   */
  var SC_SEASON_SCHEMA = Object.freeze({
    fields: Object.freeze([
      'seasonId',
      'sequence',
      'startsAt',
      'endsAt',
      'durationMonths',
      'status',
    ]),
    example: Object.freeze({
      seasonId: null,
      sequence: null,
      startsAt: null,
      endsAt: null,
      durationMonths: 6,
      status: 'UNSCHEDULED',
    }),
  });

  /** 기본 시즌 설정 — seasonId / startsAt / endsAt 을 임의로 채우지 않음 */
  var SC_SEASON_CONFIG = Object.freeze({
    durationMonths: 6,
    firstSeasonStartsAt: null,
    transitionMode: 'NEXT_SEASON_START_BATCH',
    status: 'UNSCHEDULED',
  });

  function isValidDateValue(value) {
    if (value == null) return false;
    if (value instanceof Date) {
      return !isNaN(value.getTime());
    }
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (!trimmed) return false;
      var parsed = Date.parse(trimmed);
      return !isNaN(parsed);
    }
    if (typeof value === 'number') {
      return !isNaN(value) && !isNaN(new Date(value).getTime());
    }
    return false;
  }

  function getSeasonConfig() {
    return Object.freeze({
      durationMonths: SC_SEASON_CONFIG.durationMonths,
      firstSeasonStartsAt: SC_SEASON_CONFIG.firstSeasonStartsAt,
      transitionMode: SC_SEASON_CONFIG.transitionMode,
      status: SC_SEASON_CONFIG.status,
    });
  }

  /**
   * 현재 활성 시즌 조회.
   * firstSeasonStartsAt이 null이면 null.
   * 시작일이 있어도 6개월 시즌 계산은 아직 미구현 → null (콘솔 오류 없음).
   */
  function getCurrentSeason(/* now */) {
    if (SC_SEASON_CONFIG.firstSeasonStartsAt == null) {
      return null;
    }
    // 6개월 단위 시즌 계산·인스턴스 생성은 미구현
    return null;
  }

  function hasActiveSeason(now) {
    return getCurrentSeason(now) != null;
  }

  function isSeasonSystemScheduled() {
    return isValidDateValue(SC_SEASON_CONFIG.firstSeasonStartsAt);
  }

  function getSeasonTransitionMode() {
    return SC_SEASON_CONFIG.transitionMode;
  }

  function validateSeasonConfig(config) {
    var cfg = config == null ? SC_SEASON_CONFIG : config;
    var errors = [];
    var warnings = [];

    if (cfg.durationMonths !== 6) {
      errors.push({
        code: 'invalid-durationMonths',
        message: 'durationMonths는 6이어야 합니다.',
      });
    }

    if (SEASON_STATUS_KEYS.indexOf(cfg.status) === -1) {
      errors.push({
        code: 'invalid-status',
        message: 'status 무효: ' + cfg.status,
      });
    }

    var startAt = cfg.firstSeasonStartsAt;
    if (startAt != null && !isValidDateValue(startAt)) {
      errors.push({
        code: 'invalid-firstSeasonStartsAt',
        message: 'firstSeasonStartsAt은 null 또는 유효한 날짜 문자열이어야 합니다.',
      });
    }

    if (startAt == null) {
      if (cfg.status !== 'UNSCHEDULED') {
        errors.push({
          code: 'unscheduled-status-mismatch',
          message:
            'firstSeasonStartsAt이 null이면 status는 UNSCHEDULED여야 합니다.',
        });
      }
      if (cfg.status === 'ACTIVE' || cfg.status === 'SCHEDULED') {
        errors.push({
          code: 'active-without-start',
          message:
            'firstSeasonStartsAt이 null인데 ACTIVE 또는 SCHEDULED일 수 없습니다.',
        });
      }
      warnings.push({
        code: 'first-season-unscheduled',
        message: '첫 시즌 시작일이 아직 설정되지 않음',
      });
    }

    if (cfg.transitionMode !== 'NEXT_SEASON_START_BATCH') {
      errors.push({
        code: 'invalid-transitionMode',
        message: 'transitionMode는 NEXT_SEASON_START_BATCH여야 합니다.',
      });
    }

    if (Object.prototype.hasOwnProperty.call(cfg, 'seasonId') && cfg.seasonId != null) {
      errors.push({
        code: 'unexpected-seasonId',
        message: '기본 시즌 설정에 seasonId를 넣지 않습니다.',
      });
    }
    if (Object.prototype.hasOwnProperty.call(cfg, 'startsAt') && cfg.startsAt != null) {
      errors.push({
        code: 'unexpected-startsAt',
        message: '기본 시즌 설정에 startsAt을 넣지 않습니다.',
      });
    }
    if (Object.prototype.hasOwnProperty.call(cfg, 'endsAt') && cfg.endsAt != null) {
      errors.push({
        code: 'unexpected-endsAt',
        message: '기본 시즌 설정에 endsAt을 넣지 않습니다.',
      });
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings,
    };
  }

  global.SEASON_STATUSES = SEASON_STATUSES;
  global.SEASON_STATUS_KEYS = SEASON_STATUS_KEYS;
  global.SEASON_TRANSITION_MODES = SEASON_TRANSITION_MODES;
  global.SC_SEASON_SCHEMA = SC_SEASON_SCHEMA;
  global.SC_SEASON_CONFIG = SC_SEASON_CONFIG;
  global.getSeasonConfig = getSeasonConfig;
  global.getCurrentSeason = getCurrentSeason;
  global.hasActiveSeason = hasActiveSeason;
  global.isSeasonSystemScheduled = isSeasonSystemScheduled;
  global.getSeasonTransitionMode = getSeasonTransitionMode;
  global.validateSeasonConfig = validateSeasonConfig;
})(typeof window !== 'undefined' ? window : globalThis);
