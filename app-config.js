/**
 * =============================================================================
 * 센텐스크래프트(Sentence Craft) Ver 1.0 베타 — 앱 핵심 설정 모듈 (app-config.js)
 * =============================================================================
 *
 * 【이 파일이 하는 일】
 * - 게임/커뮤니티의 “규칙과 가격, 한도, 시간”처럼 자주 바뀌는 비즈니스 값을 한곳에 모읍니다.
 * - 개발자가 코드 여기저기를 뒤지지 않고, 이 파일만 열어서 숫자·문구·정책을 조정할 수 있게 합니다.
 * - 서버(server.js)와 나중에 붙일 클라이언트(앱/웹)가 같은 규칙을 참조하도록 설계했습니다.
 *
 * 【주의】
 * - 비밀번호, API 비밀키(Supabase service role key 등)는 절대 이 파일에 직접 적지 마세요.
 *   → 환경변수(.env)와 서버 전용 설정으로 분리하는 것이 안전합니다.
 * =============================================================================
 */

'use strict';

const worldTerritories = require('./config/world-territories');
const alignmentSystem = require('./config/alignment-system');
const playerProgression = require('./config/player-progression');
const { buildKantapbiya } = require('./config/kantapbiya');
const signupCountries = require('./config/signup-countries');

// -----------------------------------------------------------------------------
// 1) 가입 시 “활동 무대” 나라 — ISO 3166-1 alpha-2 (거의 전 세계)
// -----------------------------------------------------------------------------
/** @typedef {string} IsoCountryCode ISO 3166-1 alpha-2 (예: KR, US, DE) */

/** 전체 목록(정렬됨). 화면 드롭다운·서버 검증에 동일 사용 */
const SIGNUP_COUNTRIES = signupCountries.SIGNUP_COUNTRIES;

/** 코드만 담은 배열 — 빠른 조회용 */
const SIGNUP_COUNTRY_CODES = signupCountries.SIGNUP_COUNTRY_CODES;

function isSignupCountryCode(code) {
  return signupCountries.isSignupCountryCode(code);
}

/** 예전 이름 호환 — 새 코드에서는 isSignupCountryCode 권장 */
const isStartCountryCode = isSignupCountryCode;

/** 예전 export 이름 호환 */
const START_COUNTRY_CODES = SIGNUP_COUNTRY_CODES;

// -----------------------------------------------------------------------------
// 2) 게시판 권한 / 글자 수 제한
// -----------------------------------------------------------------------------
/**
 * 게시판 접근·작성 규칙 요약
 * - 읽기: 모든 국가 게시판을 누구나 무료로 “구경(읽기)” 가능.
 * - 쓰기: 자국 게시판은 일반 작성. 타국 게시판에 글/댓글을 쓰면 외지인 첩자 플래그를 부여.
 */
const BOARD_PERMISSIONS = Object.freeze({
  /** 타국 게시판 읽기: 항상 허용(무료 개방) */
  foreignBoardRead: { enabled: true },
  /**
   * 타국 게시판 쓰기(글/댓글): 허용하되, 아래 플래그를 프로필/게시 메타에 남깁니다.
   * - UI에서는 “외지인 첩자” 배지로 표현할 수 있습니다.
   */
  foreignBoardWrite: {
    enabled: true,
    /** 서버/DB에 저장할 표준 플래그 키(영문 상수) */
    spyFlagKey: 'OUTLANDER_SPY',
    /** 사용자에게 보여줄 한글 라벨 */
    spyFlagLabelKo: '외지인 첩자',
  },
});

/**
 * 글자 수 제한
 * - 본문(Post): 제한 없음 → maxChars를 null로 두고, 검증 함수에서 “무제한”으로 처리합니다.
 * - demoShortInputMaxChars: `/api/demo/validate-comment` 등 짧은 입력 데모 전용 (140자).
 *   게시판 댓글(1500자)은 shared/board-config-core.js LIMITS.commentMaxLength 를 사용합니다.
 */
const CONTENT_LIMITS = Object.freeze({
  postBodyMaxChars: null,
  /** @deprecated 게시판 댓글 아님 — demoShortInputMaxChars 사용 */
  commentMaxChars: 140,
  demoShortInputMaxChars: 140,
});

// -----------------------------------------------------------------------------
// 3) 새벽 5시 리셋 / 무료 한도 / 구독 보너스 / 500원 단품 이월
// -----------------------------------------------------------------------------
/**
 * 일일 초기화(리셋) 시각
 * - “매일 새벽 05:00”에 무료 권한(하루 3개)과 구독 보너스를 소멸·초기화합니다.
 * - 운영 정책상 한국 서비스이므로 기본 타임존은 Asia/Seoul(한국 표준시)로 둡니다.
 *   (글로벌 확장 시 국가별 타임존 테이블을 추가하면 됩니다.)
 */
const DAILY_RESET = Object.freeze({
  /** 24시간제 시 (0~23). 5 = 새벽 5시 */
  hour: 5,
  /** 분(필요 시 조정). 현재 정책은 정각 기준 설명이므로 0분으로 둡니다. */
  minute: 0,
  /** IANA 타임존 이름 (node-cron, dayjs-tz 등에서 그대로 사용 가능) */
  timezone: 'Asia/Seoul',
});

/**
 * 무료 이용권(하루 3개)
 * - 의미: “매일 공짜로 N번” 같은 일일 쿼터입니다. (정확한 대상: 글/댓글/행동 등은 기획 확정 시 이름만 바꾸면 됩니다.)
 */
const FREE_DAILY_ENTITLEMENT = Object.freeze({
  /** 하루에 리셋되는 무료 횟수 */
  perDayCount: 3,
  /** 내부 식별자(결제/로그 DB에 저장할 때 편하게 쓰세요) */
  key: 'FREE_DAILY_QUOTA',
});

/**
 * 구독 보너스
 * - “매일 새벽 5시 리셋” 대상에 포함된다는 뜻입니다(미소진분 소멸/초기화).
 * - 실제 보너스 수치(예: +3회)는 기획 변경이 잦으므로 아래 값만 조정하면 됩니다.
 */
const SUBSCRIPTION_BONUS = Object.freeze({
  /** 리셋 시 소멸·초기화되는 보너스인지 여부(정책상 true) */
  resetsDailyAtSameSchedule: true,
  /** 월 구독 시 매일(혹은 리셋 주기마다) 부여되는 보너스 예시치 — 기획에 맞게 수정 */
  dailyBonusUses: 0,
  key: 'SUBSCRIPTION_BONUS',
});

/**
 * 결제 상품(가격) 및 “이월” 규칙
 * - 월 구독권: 4,900원
 * - 특종 직언권(단품 500원): 영구 이월(리셋으로 사라지지 않음)
 * - 지구 귀환 티켓: 3,000원 (외계행성 귀환 등에 사용)
 */
const PAYMENT_PRODUCTS = Object.freeze({
  /** 월 구독권 */
  MONTHLY_SUBSCRIPTION: {
    key: 'MONTHLY_SUBSCRIPTION',
    nameKo: '월 구독권',
    priceKrw: 4900,
    /** 구독 보너스와 연동(위 SUBSCRIPTION_BONUS와 합의해 운영) */
    tiesToSubscriptionBonus: true,
  },
  /** 특종 직언권 — 500원 단품, 매일 5시 리셋에도 “소멸되지 않고” 이월 */
  STRAIGHT_SCOOP_PASS_500: {
    key: 'STRAIGHT_SCOOP_PASS_500',
    nameKo: '특종 직언권',
    priceKrw: 500,
    /** 정책: 500원 단품 결제분은 영구 이월 */
    carriesOverForever: true,
  },
  /** 지구 귀환 티켓 */
  EARTH_RETURN_TICKET: {
    key: 'EARTH_RETURN_TICKET',
    nameKo: '지구 귀환 티켓',
    priceKrw: 3000,
    /** 외계행성 탈출 수단 중 하나(정책과 연동) */
    usedForKantapbiyaReturn: true,
  },
});

/**
 * 결제 수단
 * - 무통장 입금은 제외
 * - 카카오페이 / 토스페이 / 휴대폰 소액결제만 지원
 */
const PAYMENT_METHODS = Object.freeze({
  allowed: Object.freeze([
    { id: 'KAKAOPAY', labelKo: '카카오페이' },
    { id: 'TOSS_PAY', labelKo: '토스페이' },
    { id: 'PHONE_MICRO', labelKo: '휴대폰 소액결제' },
  ]),
  /** 명시적으로 금지하는 결제 수단(운영/개발 시 실수 방지용) */
  excluded: Object.freeze([{ id: 'BANK_TRANSFER', labelKo: '무통장 입금' }]),
});

// -----------------------------------------------------------------------------
// 4) 정치/축출, 외계행성(유배지), 신분 이력, 문패 칭호 매핑
// -----------------------------------------------------------------------------
/**
 * 일반 축출(반대 진영 등에서 싫어요/신고 누적)
 * - 30회 누적 시 축출
 * - 실제 구현에서는 “싫어요”와 “신고”를 어떻게 가중치할지 정책에 따라 조정 가능합니다.
 */
const EXILE_RULES = Object.freeze({
  /** 축출까지 필요한 누적 횟수 */
  dislikeOrReportThreshold: 30,
  /** 내부 이벤트 키(로그/알림) */
  eventKeys: Object.freeze({
    thresholdHit: 'EXILE_THRESHOLD_HIT',
    exiled: 'USER_EXILED',
  }),
});

/**
 * 외계행성 — 행동 관측 기지 + 유배 규칙 (config/kantapbiya.js 에서 한 덩어리로 생성)
 */
const KANTAPBIYA = buildKantapbiya(PAYMENT_PRODUCTS.EARTH_RETURN_TICKET.priceKrw);

/**
 * 프로필의 identity_history 필드(누적 신분 변동 내역)
 * - DB에 JSON 배열로 저장하는 형태를 가정합니다.
 * - 아래는 “권장 스키마(껍데기)”입니다. 서버에서 검증할 때 그대로 써도 됩니다.
 */
const IDENTITY_HISTORY = Object.freeze({
  /** 필드명(프로필 JSON 컬럼명 등으로 사용) */
  fieldName: 'identity_history',
  /**
   * 한 줄 기록(entry) 예시 구조
   * - occurredAt: ISO 문자열 권장(예: 2026-05-20T05:00:00+09:00)
   * - from / to: 내부 상태 코드(영문 상수)
   * - reason: 사람이 읽을 수 있는 이유 코드
   */
  entryShape: Object.freeze({
    occurredAt: 'string (ISO8601)',
    from: 'string (status code)',
    to: 'string (status code)',
    reason: 'string (machine reason code)',
    noteKo: 'string (optional human note)',
    meta: 'object (optional extra data)',
  }),
  /** 상태 코드 예시(개발 초기 뼈대) */
  statusCodes: Object.freeze({
    CITIZEN: 'CITIZEN',
    EXILED: 'EXILED',
    KANTAPBIYA_RESIDENT: 'KANTAPBIYA_RESIDENT',
    OUTLANDER_SPY: 'OUTLANDER_SPY',
  }),
  /** 변동 사유 코드 예시 */
  reasonCodes: Object.freeze({
    /** Supabase 트리거: 회원가입 직후 profiles 생성 시 자동 기록 */
    SIGNUP: 'SIGNUP',
    /** Supabase 트리거: profiles.citizenship_status 변경 시 자동 기록 */
    PROFILE_CITIZENSHIP_CHANGED: 'PROFILE_CITIZENSHIP_CHANGED',
    EXILE_THRESHOLD: 'EXILE_THRESHOLD',
    PAY_EARTH_RETURN: 'PAY_EARTH_RETURN',
    KANTAPBIYA_RE_EXILE: 'KANTAPBIYA_RE_EXILE',
    FOREIGN_WRITE: 'FOREIGN_WRITE',
  }),
});

/**
 * 아바타 옆 “문패 칭호” 매핑 테이블
 * - 클라이언트는 유저의 badgeKey(예: SPY)를 내려받아, 아래 labelKo를 표시합니다.
 * - 필요하면 등급/색상/우선순위 컬럼을 추가하면 됩니다.
 */
const TITLE_BADGE_MAP = Object.freeze({
  SPY: {
    key: 'SPY',
    titleKo: '종횡무진 스파이',
    /** UI 힌트(선택) */
    flavorKo: '타국 무대에서도 눈에 띄는 첩자의 향기…',
  },
  EXILED: {
    key: 'EXILED',
    titleKo: '정치의 벼랑 끝',
    flavorKo: '축출된 자의 낙인',
  },
  KANTAPBIYA: {
    key: 'KANTAPBIYA',
    titleKo: '외계행성 유배자',
    flavorKo: '자동 사면은 없다',
  },
  RETURNED: {
    key: 'RETURNED',
    titleKo: '지구 귀환자',
    flavorKo: '희생(결제) 또는 재축출의 길을 걸었다',
  },
});

// -----------------------------------------------------------------------------
// 5) 영토 확장 공식(시각화 연동용) — 인구 구간별 스케일링 뼈대
// -----------------------------------------------------------------------------
/**
 * 【목적】
 * - 국가별 “소속 인구수”가 커질수록 지도/영토 표현에 쓸 크기 변수를 돌려줍니다.
 * - 최종 목표 인구(예: 10만 명) 대비 진행률도 같이 줍니다.
 *
 * 【스케일링 규칙(요구사항 그대로)】
 * - 100명 이하: 10명 단위로 반영(47명이면 40으로 “끊어서” 반영)
 * - 1000명 이하: 100명 단위로 반영
 * - 1000명 초과: 1000명 단위로 반영
 *
 * @param {number} population 소속 인구수(0 이상 정수를 권장)
 * @param {number} [targetCap=100000] 최종 목표 인구(기본 10만)
 * @returns {{
 *   rawPopulation: number,
 *   bucket: '10'|'100'|'1000',
 *   steppedPopulation: number,
 *   progress01: number,
 *   territoryVisualScale01: number,
 * }}
 */
function getTerritoryVisualVariables(population, targetCap = 100_000) {
  const raw = Number(population);
  const safeRaw = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  const cap = Number.isFinite(targetCap) && targetCap > 0 ? targetCap : 100_000;

  let bucket;
  /** @type {number} */
  let stepped;

  if (safeRaw <= 100) {
    bucket = '10';
    stepped = Math.floor(safeRaw / 10) * 10;
  } else if (safeRaw <= 1000) {
    bucket = '100';
    stepped = Math.floor(safeRaw / 100) * 100;
  } else {
    bucket = '1000';
    stepped = Math.floor(safeRaw / 1000) * 1000;
  }

  /** 0~1 사이 진행률(시각화에서 progress bar 등에 사용) */
  const progress01 = Math.min(1, safeRaw / cap);

  /**
   * 영토 “크기”에 쓸 0~1 스케일(예시)
   * - stepped 값을 cap으로 나눈 값을 기본으로 하되, 아주 작은 인구에서도 0이 되지 않게 미세 바닥을 둡니다.
   * - 실제 지도 엔진이 픽셀 단위를 원하면: pixel = basePixel * territoryVisualScale01 같은 식으로 변환하면 됩니다.
   */
  const stepped01 = Math.min(1, stepped / cap);
  const territoryVisualScale01 = Math.max(0.02, Math.sqrt(stepped01));

  return {
    rawPopulation: safeRaw,
    bucket,
    steppedPopulation: stepped,
    progress01,
    territoryVisualScale01,
    targetPopulationCap: cap,
  };
}

// -----------------------------------------------------------------------------
// 6) 작은 헬퍼(서버/클라이언트 공통으로 쓰기 좋은 “검증 뼈대”)
// -----------------------------------------------------------------------------
/**
 * 댓글 길이 검증
 * @param {string} text
 * @returns {{ ok: boolean, max: number, length: number }}
 */
function validateCommentLength(text) {
  const length = Array.from(String(text ?? '')).length;
  const max = CONTENT_LIMITS.demoShortInputMaxChars;
  return { ok: length <= max, max, length };
}

/**
 * 본문 길이 검증(무제한 정책)
 * @param {string} text
 */
function validatePostBodyLength(text) {
  const max = CONTENT_LIMITS.postBodyMaxChars;
  if (max === null) return { ok: true, max: null, length: Array.from(String(text ?? '')).length };
  const length = Array.from(String(text ?? '')).length;
  return { ok: length <= max, max, length };
}

/**
 * 결제 수단이 허용되는지
 * @param {string} methodId
 */
function isPaymentMethodAllowed(methodId) {
  return PAYMENT_METHODS.allowed.some((m) => m.id === methodId);
}

/**
 * “타국에 글/댓글 작성”인지 판별(서버에서 최종 검증 필요)
 * @param {string} userHomeCountry 유저의 시작 국가 (ISO alpha-2)
 * @param {string} boardCountry 글/댓글이 올라가는 게시판 국가
 */
function shouldMarkOutlanderSpy(userHomeCountry, boardCountry) {
  return userHomeCountry !== boardCountry;
}

/**
 * 클라이언트에 내려줘도 되는 “공개 설정”만 골라 반환합니다.
 * - 가격/정책/한도는 괜찮지만, 내부 관리용 비밀값은 넣지 마세요.
 */
function getPublicClientConfig() {
  return Object.freeze({
    /** 가입 시 고를 나라 전체 (ISO alpha-2 + 한글·영문 이름) */
    signupCountries: signupCountries.getPublicSignupCountries(),
    boardPermissions: BOARD_PERMISSIONS,
    contentLimits: CONTENT_LIMITS,
    dailyReset: DAILY_RESET,
    freeDailyEntitlement: FREE_DAILY_ENTITLEMENT,
    subscriptionBonus: SUBSCRIPTION_BONUS,
    paymentProducts: PAYMENT_PRODUCTS,
    paymentMethods: PAYMENT_METHODS,
    exileRules: EXILE_RULES,
    /** 외계행성 — 영토(좌/우) + 유배 규칙 (한 덩어리) */
    kantapbiya: KANTAPBIYA,
    titleBadgeMap: TITLE_BADGE_MAP,
    identityHistory: {
      fieldName: IDENTITY_HISTORY.fieldName,
      statusCodes: IDENTITY_HISTORY.statusCodes,
      reasonCodes: IDENTITY_HISTORY.reasonCodes,
    },
    /** 글로 싸우는 전쟁 — 영토·게시판 단계 (config/world-territories.js) */
    worldTerritories: worldTerritories.getPublicWorldConfig(),
    /** 정치색 점수·자동 편입·AI 주제 채널 뼈대 (config/alignment-system.js) */
    alignmentSystem: alignmentSystem.getPublicAlignmentConfig(),
    /** 레벨(1~5) · 경험치 · 명성·등급 (config/player-progression.js) */
    playerProgression: playerProgression.getPublicPlayerProgressionConfig(),
  });
}

module.exports = Object.freeze({
  // 상수 묶음
  SIGNUP_COUNTRIES,
  SIGNUP_COUNTRY_CODES,
  /** @deprecated 이름 호환 — SIGNUP_COUNTRY_CODES 사용 권장 */
  START_COUNTRY_CODES,
  BOARD_PERMISSIONS,
  CONTENT_LIMITS,
  DAILY_RESET,
  FREE_DAILY_ENTITLEMENT,
  SUBSCRIPTION_BONUS,
  PAYMENT_PRODUCTS,
  PAYMENT_METHODS,
  EXILE_RULES,
  KANTAPBIYA,
  IDENTITY_HISTORY,
  TITLE_BADGE_MAP,

  // 글로 싸우는 전쟁 — 영토 / 정치색 (폴더로 분리)
  worldTerritories,
  alignmentSystem,
  playerProgression,

  // 함수
  getTerritoryVisualVariables,
  validateCommentLength,
  validatePostBodyLength,
  isPaymentMethodAllowed,
  isSignupCountryCode,
  isStartCountryCode,
  shouldMarkOutlanderSpy,
  getPublicClientConfig,
});
