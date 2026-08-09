/**
 * =============================================================================
 * 센텐스아레나 — 베타 초기 업적 정의 (SSOT)
 * =============================================================================
 * 원칙:
 * - 업적은 활동 기록·개인 연대기. 단순 보상 배지가 아님.
 * - 정의(ACHIEVEMENT_DEFINITIONS)와 사용자 획득 기록은 분리한다.
 * - acquiredAt / acquisitionSequence 는 향후 사용자 기록에만 저장.
 * - persistenceType으로 시즌 유지 정책을 구분한다 (지급·초기화 로직은 미구현).
 * - SEASON_REPEATABLE: 시즌 종료 시 진행도·현재 획득 상태 초기화 · 이전 시즌은 히스토리만
 *   · 대표 업적에서 자동 해제 예정 · 빈 슬롯 자동 대체 없음 · 다음 시즌 재획득 가능.
 * - 대표 업적은 최대 3개 (canFeature).
 * - 정치 성향의 우열을 만들지 않음. 상대 영토 공격·분쟁·신고를 조건으로 쓰지 않음.
 * - 외계행성 입성을 보상성 업적으로 만들지 않음.
 * - 반복 목표는 향후 미션 시스템으로 분리.
 * - 실제 지급은 향후 서버/신뢰 가능한 백엔드가 담당. 이 파일은 정의만.
 *
 * 이번 범위: 정의 데이터 · 조회 · 검증. 지급·저장·시즌 초기화·API·알림 미구현.
 * =============================================================================
 */
(function (global) {
  'use strict';

  var ACHIEVEMENT_CATEGORIES = Object.freeze({
    GROWTH: '성장',
    ACTIVITY: '활동',
    INTERACTION: '교류',
    TERRITORY: '영토',
    SEASON: '시즌',
    SPECIAL: '특별',
  });

  var ACHIEVEMENT_CATEGORY_KEYS = Object.freeze(Object.keys(ACHIEVEMENT_CATEGORIES));

  var ACHIEVEMENT_RETROACTIVE_POLICIES = Object.freeze([
    'NONE',
    'ELIGIBLE',
    'REVIEW_REQUIRED',
  ]);

  var ACHIEVEMENT_IMPLEMENTATION_STATUSES = Object.freeze([
    'CONFIRMED',
    'CANDIDATE',
    'BLOCKED',
  ]);

  /**
   * PERMANENT_ONCE — 계정 전체 1회 · 시즌 종료 후에도 현재 보유·대표 업적 유지 · 기록 영구
   * SEASON_REPEATABLE — 시즌별 진행도·획득 상태 · 시즌 종료 시 현재 보유/대표 선택에서 초기화
   *                   · 이전 시즌 내역은 히스토리에만 보존 · 다음 시즌 재획득 가능
   * EVENT_PERMANENT — 발전/사건 단위 · 일반 시즌 초기화와 분리 · 현재 보유·대표 유지 · 기록 영구
   */
  var ACHIEVEMENT_PERSISTENCE_TYPES = Object.freeze({
    PERMANENT_ONCE: 'PERMANENT_ONCE',
    SEASON_REPEATABLE: 'SEASON_REPEATABLE',
    EVENT_PERMANENT: 'EVENT_PERMANENT',
  });

  var ACHIEVEMENT_PERSISTENCE_TYPE_KEYS = Object.freeze([
    'PERMANENT_ONCE',
    'SEASON_REPEATABLE',
    'EVENT_PERMANENT',
  ]);

  var KEBAB_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

  /**
   * 베타 초기 업적 정의 11개.
   * CONFIRMED 9 · CANDIDATE 1 · BLOCKED 1
   * PERMANENT_ONCE 5 · SEASON_REPEATABLE 5 · EVENT_PERMANENT 1
   */
  var ACHIEVEMENT_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: 'first-post',
      name: '글쓰기 버튼이 눌렸다',
      description:
        '자신의 생각을 담은 첫 번째 글을 광장에 남겼습니다. 드디어 글쓰기 버튼이 제 역할을 했습니다.',
      category: 'ACTIVITY',
      rarity: 'COMMON',
      conditionType: 'VALID_POST_COUNT',
      conditionValue: 1,
      canFeature: true,
      isSeasonal: false,
      persistenceType: 'PERMANENT_ONCE',
      isHidden: false,
      retroactivePolicy: 'ELIGIBLE',
      implementationStatus: 'CONFIRMED',
      notes:
        '첫 번째 유효 게시글 · 계정 전체에서 최초 1회만 획득 · 시즌 변경 후 재획득하지 않음 · 획득 기록은 영구 보존',
    }),
    Object.freeze({
      id: 'first-comment',
      name: '한마디 거들겠습니다',
      description:
        '다른 시민의 이야기에 첫 댓글을 남겼습니다. 그냥 지나치기에는 할 말이 조금 있었습니다.',
      category: 'ACTIVITY',
      rarity: 'COMMON',
      conditionType: 'VALID_COMMENT_ON_OTHERS_POST_COUNT',
      conditionValue: 1,
      canFeature: true,
      isSeasonal: false,
      persistenceType: 'PERMANENT_ONCE',
      isHidden: false,
      retroactivePolicy: 'ELIGIBLE',
      implementationStatus: 'CONFIRMED',
      notes:
        '다른 사용자 게시글에 대한 첫 유효 댓글만 인정 · 계정 전체에서 최초 1회만 획득 · 시즌 변경 후 재획득하지 않음 · 획득 기록은 영구 보존',
    }),
    Object.freeze({
      id: 'first-empathy-received',
      name: '내 말 맞지?',
      description:
        '남긴 생각이 다른 시민의 첫 공감을 얻었습니다. 혼자만 그렇게 생각한 것은 아니었습니다.',
      category: 'INTERACTION',
      rarity: 'COMMON',
      conditionType: 'VALID_EMPATHY_RECEIVED_COUNT',
      conditionValue: 1,
      canFeature: true,
      isSeasonal: false,
      persistenceType: 'PERMANENT_ONCE',
      isHidden: false,
      retroactivePolicy: 'ELIGIBLE',
      implementationStatus: 'CONFIRMED',
      notes:
        '자기 공감과 취소된 공감은 제외 · 유효 공감 판정은 추후 백엔드 · 계정 전체에서 최초 1회만 획득 · 시즌 변경 후 재획득하지 않음 · 획득 기록은 영구 보존',
    }),
    Object.freeze({
      id: 'territory-citizen',
      name: '시민증 발급 완료',
      description:
        '레벨 5에 도달해 정식 영토시민으로 인정받았습니다. 이제 초보 시민 표찰은 떼도 되겠습니다.',
      category: 'GROWTH',
      rarity: 'BRONZE',
      conditionType: 'LEVEL_REACHED',
      conditionValue: 5,
      canFeature: true,
      isSeasonal: false,
      persistenceType: 'PERMANENT_ONCE',
      isHidden: false,
      retroactivePolicy: 'REVIEW_REQUIRED',
      implementationStatus: 'CONFIRMED',
      notes:
        '레벨 5를 건너뛰어 상승해도 지급 대상 · 레벨 5 최초 달성 시 계정 전체에서 1회 · 시즌 변경 후 재획득하지 않음 · 획득 기록은 영구 보존 · 소급 지급 여부는 추후 결정',
    }),
    Object.freeze({
      id: 'steady-footsteps',
      name: '또 왔네, 또 왔어',
      description:
        '최근 30일 동안 서로 다른 7일에 활동했습니다. 이쯤 되면 광장이 먼저 얼굴을 기억하겠습니다.',
      category: 'ACTIVITY',
      rarity: 'BRONZE',
      conditionType: 'DISTINCT_ACTIVE_DAYS_IN_WINDOW',
      conditionValue: Object.freeze({ days: 7, windowDays: 30 }),
      canFeature: true,
      isSeasonal: true,
      persistenceType: 'SEASON_REPEATABLE',
      isHidden: false,
      retroactivePolicy: 'REVIEW_REQUIRED',
      implementationStatus: 'CONFIRMED',
      notes:
        '해당 시즌의 유효 활동만 집계 · 시즌 종료 시 미완성 진행도 초기화 · 시즌 종료 시 현재 획득 상태 초기화 · 이전 시즌 획득 내역은 히스토리에만 보존 · 이전 시즌 기록은 현재 프로필 대표 업적으로 표시 불가 · 다음 시즌에 다시 획득 가능 · 연속 7일 출석 아님 · 단순 로그인만으로 인정하지 않음 · 유효 게시글·댓글·공감 활동 기준 · 현재 30일 창은 시즌 경계를 넘지 않음 · 시즌 시작 후 30일이 지나지 않은 경우 실제 경과 기간만 사용',
    }),
    Object.freeze({
      id: 'record-builder',
      name: '할 말이 좀 많습니다',
      description:
        '유효한 게시글을 10개 남겼습니다. 생각보다 하고 싶은 말이 꽤 많았습니다.',
      category: 'ACTIVITY',
      rarity: 'BRONZE',
      conditionType: 'VALID_POST_COUNT',
      conditionValue: 10,
      canFeature: true,
      isSeasonal: true,
      persistenceType: 'SEASON_REPEATABLE',
      isHidden: false,
      retroactivePolicy: 'REVIEW_REQUIRED',
      implementationStatus: 'CONFIRMED',
      notes:
        '해당 시즌의 유효 게시글만 집계 · 시즌 종료 시 진행도와 현재 획득 상태 초기화 · 이전 시즌 게시글 수 이월 금지 · 이전 시즌 획득 내역은 히스토리에만 보존 · 현재 프로필에서는 시즌 종료 후 표시하지 않음 · 다음 시즌에 다시 획득 가능 · 삭제·도배·제재 게시글 제외 · 단순 수량 도배 방지 기준 필요',
    }),
    Object.freeze({
      id: 'conversation-bridge',
      name: '댓글에서 뵙겠습니다',
      description:
        '서로 다른 게시글 20곳에서 대화에 참여했습니다. 어디선가 또 댓글로 만나게 될 가능성이 높습니다.',
      category: 'ACTIVITY',
      rarity: 'BRONZE',
      conditionType: 'DISTINCT_POSTS_WITH_VALID_COMMENTS',
      conditionValue: 20,
      canFeature: true,
      isSeasonal: true,
      persistenceType: 'SEASON_REPEATABLE',
      isHidden: false,
      retroactivePolicy: 'REVIEW_REQUIRED',
      implementationStatus: 'CONFIRMED',
      notes:
        '해당 시즌의 유효 댓글과 서로 다른 게시글 수만 집계 · 시즌 종료 시 진행도와 현재 획득 상태 초기화 · 이전 시즌 획득 내역은 히스토리에만 보존 · 현재 프로필에서는 시즌 종료 후 표시하지 않음 · 다음 시즌에 다시 획득 가능 · 같은 게시글에 댓글을 여러 개 작성해도 1개 게시글로 계산 · 자기 게시글은 제외하는 방향 · 삭제·도배·제재 댓글 제외',
    }),
    Object.freeze({
      id: 'empathy-from-many',
      name: '나만 그렇게 생각한 거 아니었어',
      description:
        '서로 다른 10명의 시민에게 공감을 받았습니다. 혼잣말인 줄 알았는데 듣고 있던 사람이 제법 많았습니다.',
      category: 'INTERACTION',
      rarity: 'GOLD',
      conditionType: 'DISTINCT_USERS_EMPATHY_RECEIVED',
      conditionValue: 10,
      canFeature: true,
      isSeasonal: true,
      persistenceType: 'SEASON_REPEATABLE',
      isHidden: false,
      retroactivePolicy: 'REVIEW_REQUIRED',
      implementationStatus: 'CONFIRMED',
      notes:
        '해당 시즌의 유효 공감과 고유 사용자 수만 집계 · 시즌 종료 시 진행도와 현재 획득 상태 초기화 · 이전 시즌 획득 내역은 히스토리에만 보존 · 현재 프로필에서는 시즌 종료 후 표시하지 않음 · 다음 시즌에 다시 획득 가능 · 동일 사용자의 반복 공감은 1명으로 계산 · 자기 계정·비정상 계정 제외 · 글과 댓글에서 받은 유효 공감 합산 · 봇·품앗이 감쇠 기준은 추후 구현',
    }),
    Object.freeze({
      id: 'dialogue-across-territories',
      name: '양쪽에서 살아남은 발언',
      description:
        '개척과 수호 양쪽 시민에게 긍정적인 반응을 받았습니다. 어느 한쪽에서만 통하는 이야기는 아니었던 모양입니다.',
      category: 'INTERACTION',
      rarity: 'GOLD',
      conditionType: 'POSITIVE_RESPONSE_FROM_BOTH_TERRITORIES',
      conditionValue: Object.freeze({ pioneer: 1, guardian: 1 }),
      canFeature: true,
      isSeasonal: true,
      persistenceType: 'SEASON_REPEATABLE',
      isHidden: false,
      retroactivePolicy: 'REVIEW_REQUIRED',
      implementationStatus: 'CANDIDATE',
      notes:
        '향후 확정 조건은 시즌 단위로 계산 · 시즌 종료 시 진행도와 현재 획득 상태 초기화 · 이전 시즌 획득 내역은 히스토리에만 보존 · 현재 프로필에서는 시즌 종료 후 표시하지 않음 · 다음 시즌에 다시 획득 가능 · 반응 당시 영토 기준과 긍정 반응 범위는 미확정 · 관련 데이터 구조 확정 전 지급 구현 금지',
    }),
    Object.freeze({
      id: 'witness-of-an-era',
      name: '그때 내가 거기 있었지',
      description:
        '소속 영토가 새로운 발전 단계에 도달하는 순간을 함께했습니다. 나중에 누가 물으면 직접 봤다고 말할 수 있습니다.',
      category: 'TERRITORY',
      rarity: 'CRYSTAL',
      conditionType: 'TERRITORY_STAGE_ADVANCED_WHILE_MEMBER',
      conditionValue: 1,
      canFeature: true,
      isSeasonal: false,
      persistenceType: 'EVENT_PERMANENT',
      isHidden: false,
      retroactivePolicy: 'NONE',
      implementationStatus: 'BLOCKED',
      notes:
        '일반 시즌 진행도와 무관 · 특정 영토 발전 이벤트를 기준으로 판정 · 획득 기록은 영구 보존 · 같은 발전 사건에 대한 중복 지급 금지 · 서로 다른 발전 사건에서 반복 획득 가능 여부는 추후 결정 · 실제 영토 발전 이벤트 연결 전 지급 금지 · 현재 Mock 발전 단계에서는 지급 금지 · 외계행성 입성 자체와 연결 금지',
    }),
    Object.freeze({
      id: 'beta-citizen',
      name: '공사 중인데 들어오셨네요',
      description:
        '아직 여기저기 공사 중이던 베타 시절부터 함께했습니다. 정식 개장 전부터 자리를 잡은 시민입니다.',
      category: 'SPECIAL',
      rarity: 'CRYSTAL',
      conditionType: 'BETA_MEMBER_AND_LEVEL_REACHED',
      conditionValue: Object.freeze({ betaParticipant: true, level: 5 }),
      canFeature: true,
      isSeasonal: false,
      persistenceType: 'PERMANENT_ONCE',
      isHidden: false,
      retroactivePolicy: 'ELIGIBLE',
      implementationStatus: 'CONFIRMED',
      notes:
        '지정된 베타 기간에만 획득 가능 · 계정 전체에서 1회만 획득 · 베타 종료 및 시즌 변경 후에도 기록 유지 · 단순 가입만으로 지급하지 않음 · 베타 시작일과 종료일은 추후 설정 · 베타 기간 참여와 레벨 5 달성 모두 필요',
    }),
  ]);

  function cloneDefinition(def) {
    if (!def) return null;
    var out = {
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      rarity: def.rarity,
      conditionType: def.conditionType,
      conditionValue: def.conditionValue,
      canFeature: def.canFeature,
      isSeasonal: def.isSeasonal,
      persistenceType: def.persistenceType,
      isHidden: def.isHidden,
      retroactivePolicy: def.retroactivePolicy,
      implementationStatus: def.implementationStatus,
    };
    if (def.notes) out.notes = def.notes;
    if (def.conditionValue && typeof def.conditionValue === 'object') {
      out.conditionValue = Object.assign({}, def.conditionValue);
    }
    return out;
  }

  function resolveAchievementDefinition(achievementOrId) {
    if (achievementOrId && typeof achievementOrId === 'object') {
      if (achievementOrId.id) {
        return getAchievementDefinition(achievementOrId.id) || cloneDefinition(achievementOrId);
      }
      return cloneDefinition(achievementOrId);
    }
    return getAchievementDefinition(achievementOrId);
  }

  function getAchievementDefinition(achievementId) {
    var id = String(achievementId || '').trim();
    if (!id) return null;
    var i;
    for (i = 0; i < ACHIEVEMENT_DEFINITIONS.length; i++) {
      if (ACHIEVEMENT_DEFINITIONS[i].id === id) {
        return cloneDefinition(ACHIEVEMENT_DEFINITIONS[i]);
      }
    }
    return null;
  }

  function getAchievementDefinitionsByCategory(category) {
    var key = String(category || '').trim().toUpperCase();
    if (ACHIEVEMENT_CATEGORY_KEYS.indexOf(key) === -1) return [];
    return ACHIEVEMENT_DEFINITIONS.filter(function (d) {
      return d.category === key;
    }).map(cloneDefinition);
  }

  function getAchievementDefinitionsByRarity(rarity) {
    var normalized =
      typeof global.normalizeAchievementRarity === 'function'
        ? global.normalizeAchievementRarity(rarity)
        : String(rarity || 'COMMON').toUpperCase();
    return ACHIEVEMENT_DEFINITIONS.filter(function (d) {
      return d.rarity === normalized;
    }).map(cloneDefinition);
  }

  function getFeatureableAchievementDefinitions() {
    return ACHIEVEMENT_DEFINITIONS.filter(function (d) {
      return d.canFeature === true;
    }).map(cloneDefinition);
  }

  function getAchievementPersistenceType(achievementOrId) {
    var def = resolveAchievementDefinition(achievementOrId);
    if (!def || def.persistenceType == null || def.persistenceType === '') return null;
    var key = String(def.persistenceType).trim();
    if (ACHIEVEMENT_PERSISTENCE_TYPE_KEYS.indexOf(key) === -1) return null;
    return key;
  }

  function isPermanentOnceAchievement(achievementOrId) {
    return getAchievementPersistenceType(achievementOrId) === 'PERMANENT_ONCE';
  }

  function isSeasonRepeatableAchievement(achievementOrId) {
    return getAchievementPersistenceType(achievementOrId) === 'SEASON_REPEATABLE';
  }

  function isEventPermanentAchievement(achievementOrId) {
    return getAchievementPersistenceType(achievementOrId) === 'EVENT_PERMANENT';
  }

  function validateAchievementDefinitions() {
    var errors = [];
    var warnings = [];
    var seen = Object.create(null);
    var legendaryCount = 0;
    var confirmedCount = 0;
    var candidateCount = 0;
    var blockedCount = 0;
    var persistenceCounts = {
      PERMANENT_ONCE: 0,
      SEASON_REPEATABLE: 0,
      EVENT_PERMANENT: 0,
    };
    var i;

    if (!ACHIEVEMENT_DEFINITIONS.length) {
      errors.push({ code: 'empty', message: '업적 정의가 비어 있습니다.' });
    }

    for (i = 0; i < ACHIEVEMENT_DEFINITIONS.length; i++) {
      var d = ACHIEVEMENT_DEFINITIONS[i];
      var label = (d && d.id) || '#' + i;

      if (!d || typeof d !== 'object') {
        errors.push({ code: 'invalid-entry', id: label, message: '정의가 객체가 아닙니다.' });
        continue;
      }

      if (!d.id || typeof d.id !== 'string') {
        errors.push({ code: 'missing-id', id: label, message: 'id 누락' });
      } else {
        if (seen[d.id]) {
          errors.push({ code: 'duplicate-id', id: d.id, message: 'id 중복' });
        }
        seen[d.id] = true;
        if (!KEBAB_ID_RE.test(d.id)) {
          errors.push({
            code: 'id-not-kebab',
            id: d.id,
            message: 'id는 kebab-case여야 합니다.',
          });
        }
      }

      if (!d.name || !String(d.name).trim()) {
        errors.push({ code: 'missing-name', id: label, message: 'name 누락' });
      }
      if (!d.description || !String(d.description).trim()) {
        errors.push({ code: 'missing-description', id: label, message: 'description 누락' });
      }
      if (ACHIEVEMENT_CATEGORY_KEYS.indexOf(d.category) === -1) {
        errors.push({
          code: 'invalid-category',
          id: label,
          message: 'category 무효: ' + d.category,
        });
      }

      var rarityOk =
        typeof global.normalizeAchievementRarity === 'function'
          ? global.normalizeAchievementRarity(d.rarity) === String(d.rarity || '').toUpperCase() &&
            ['COMMON', 'BRONZE', 'GOLD', 'CRYSTAL', 'LEGENDARY'].indexOf(
              String(d.rarity || '').toUpperCase()
            ) !== -1
          : ['COMMON', 'BRONZE', 'GOLD', 'CRYSTAL', 'LEGENDARY'].indexOf(d.rarity) !== -1;
      if (!rarityOk) {
        errors.push({
          code: 'invalid-rarity',
          id: label,
          message: 'rarity 무효: ' + d.rarity,
        });
      }
      if (d.rarity === 'LEGENDARY') {
        legendaryCount += 1;
        warnings.push({
          code: 'legendary-in-initial',
          id: d.id,
          message: '초기 목록에 LEGENDARY가 있습니다. 의도된 경우에만 유지하세요.',
        });
      }

      if (!d.conditionType || !String(d.conditionType).trim()) {
        errors.push({
          code: 'missing-condition-type',
          id: label,
          message: 'conditionType 누락',
        });
      }

      if (typeof d.canFeature !== 'boolean') {
        errors.push({ code: 'canFeature-type', id: label, message: 'canFeature는 boolean' });
      }
      if (typeof d.isSeasonal !== 'boolean') {
        errors.push({ code: 'isSeasonal-type', id: label, message: 'isSeasonal는 boolean' });
      }
      if (typeof d.isHidden !== 'boolean') {
        errors.push({ code: 'isHidden-type', id: label, message: 'isHidden는 boolean' });
      }

      if (d.persistenceType == null || d.persistenceType === '') {
        errors.push({
          code: 'missing-persistenceType',
          id: label,
          message: 'persistenceType 누락',
        });
      } else if (ACHIEVEMENT_PERSISTENCE_TYPE_KEYS.indexOf(d.persistenceType) === -1) {
        errors.push({
          code: 'invalid-persistenceType',
          id: label,
          message: 'persistenceType 무효: ' + d.persistenceType,
        });
      } else {
        persistenceCounts[d.persistenceType] += 1;
        if (d.persistenceType === 'SEASON_REPEATABLE' && d.isSeasonal !== true) {
          errors.push({
            code: 'season-repeatable-requires-seasonal',
            id: label,
            message: 'SEASON_REPEATABLE requires isSeasonal true',
          });
        }
        if (d.persistenceType === 'PERMANENT_ONCE' && d.isSeasonal !== false) {
          errors.push({
            code: 'permanent-once-requires-non-seasonal',
            id: label,
            message: 'PERMANENT_ONCE requires isSeasonal false',
          });
        }
        if (d.persistenceType === 'EVENT_PERMANENT' && d.isSeasonal !== false) {
          errors.push({
            code: 'event-permanent-requires-non-seasonal',
            id: label,
            message: 'EVENT_PERMANENT requires isSeasonal false',
          });
        }
      }

      if (ACHIEVEMENT_RETROACTIVE_POLICIES.indexOf(d.retroactivePolicy) === -1) {
        errors.push({
          code: 'invalid-retroactive',
          id: label,
          message: 'retroactivePolicy 무효: ' + d.retroactivePolicy,
        });
      }
      if (ACHIEVEMENT_IMPLEMENTATION_STATUSES.indexOf(d.implementationStatus) === -1) {
        errors.push({
          code: 'invalid-status',
          id: label,
          message: 'implementationStatus 무효: ' + d.implementationStatus,
        });
      }

      if (d.implementationStatus === 'CONFIRMED') {
        confirmedCount += 1;
        if (
          !d.id ||
          !d.name ||
          !d.description ||
          !d.category ||
          !d.rarity ||
          !d.conditionType ||
          d.conditionValue == null ||
          !d.persistenceType
        ) {
          errors.push({
            code: 'confirmed-incomplete',
            id: label,
            message: 'CONFIRMED 업적에 필수 필드가 부족합니다.',
          });
        }
      }

      if (d.implementationStatus === 'CANDIDATE') {
        candidateCount += 1;
        warnings.push({
          code: 'candidate-unsettled',
          id: d.id,
          message: '후보 업적 — 조건·지급 기준이 아직 확정되지 않았습니다.',
        });
      }
      if (d.implementationStatus === 'BLOCKED') {
        blockedCount += 1;
        warnings.push({
          code: 'blocked-pending-infra',
          id: d.id,
          message: 'BLOCKED — 선행 시스템 연동 전 지급 구현 금지.',
        });
      }
      if (d.conditionValue === null || d.conditionValue === undefined) {
        if (d.implementationStatus !== 'CONFIRMED') {
          warnings.push({
            code: 'condition-value-null',
            id: d.id,
            message: 'conditionValue가 비어 있습니다 (후보/차단 허용).',
          });
        }
      }
    }

    if (confirmedCount < 1) {
      warnings.push({
        code: 'no-confirmed',
        message: 'CONFIRMED 업적이 없습니다.',
      });
    }

    return {
      valid: errors.length === 0,
      total: ACHIEVEMENT_DEFINITIONS.length,
      confirmedCount: confirmedCount,
      candidateCount: candidateCount,
      blockedCount: blockedCount,
      legendaryCount: legendaryCount,
      persistenceCounts: persistenceCounts,
      errors: errors,
      warnings: warnings,
    };
  }

  global.ACHIEVEMENT_CATEGORIES = ACHIEVEMENT_CATEGORIES;
  global.ACHIEVEMENT_CATEGORY_KEYS = ACHIEVEMENT_CATEGORY_KEYS;
  global.ACHIEVEMENT_RETROACTIVE_POLICIES = ACHIEVEMENT_RETROACTIVE_POLICIES;
  global.ACHIEVEMENT_IMPLEMENTATION_STATUSES = ACHIEVEMENT_IMPLEMENTATION_STATUSES;
  global.ACHIEVEMENT_PERSISTENCE_TYPES = ACHIEVEMENT_PERSISTENCE_TYPES;
  global.ACHIEVEMENT_PERSISTENCE_TYPE_KEYS = ACHIEVEMENT_PERSISTENCE_TYPE_KEYS;
  global.ACHIEVEMENT_DEFINITIONS = ACHIEVEMENT_DEFINITIONS;
  global.getAchievementDefinition = getAchievementDefinition;
  global.getAchievementDefinitionsByCategory = getAchievementDefinitionsByCategory;
  global.getAchievementDefinitionsByRarity = getAchievementDefinitionsByRarity;
  global.getFeatureableAchievementDefinitions = getFeatureableAchievementDefinitions;
  global.getAchievementPersistenceType = getAchievementPersistenceType;
  global.isPermanentOnceAchievement = isPermanentOnceAchievement;
  global.isSeasonRepeatableAchievement = isSeasonRepeatableAchievement;
  global.isEventPermanentAchievement = isEventPermanentAchievement;
  global.validateAchievementDefinitions = validateAchievementDefinitions;
})(typeof window !== 'undefined' ? window : globalThis);
