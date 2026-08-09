/**
 * =============================================================================
 * 센텐스아레나 — “정치색(점수) + 자동 편입” 규칙 뼈대
 * =============================================================================
 * 지금은 숫자·이름만 적어 둔 ‘설계 메모’에 가깝습니다.
 * 나중에 글/댓글/좋아요를 분석하는 코드를 붙일 때 이 값을 읽게 하면 됩니다.
 * =============================================================================
 */

'use strict';

const alignmentRankLimits = require('./alignment-rank-limits');

/**
 * 점수에 반영할 “행동 종류” (서버가 나중에 집계할 때 쓸 이름표)
 */
const SIGNAL_TYPES = Object.freeze({
  POST: 'POST',
  COMMENT: 'COMMENT',
  LIKE: 'LIKE',
  DISLIKE: 'DISLIKE',
  /** 정치색이 다른 유저에게 받은 반응 — 가중치를 다르게 줄 수 있음 */
  CROSS_REACTION: 'CROSS_REACTION',
});

/**
 * 자동 입당(편입) 추천이 뜨는지 여부 — 임계값 (기획 바뀌면 여기만 수정)
 * 실제 구현 전까지는 “대략 이런 느낌”의 숫자입니다.
 */
const AUTO_PARTY_THRESHOLDS = Object.freeze({
  /** 한쪽으로 강하게 기울었다고 보는 점수 (예시) */
  strongBiasScore: 60,
  /** 이 점수를 넘으면 “입당 추천서” 이벤트(자동 편입 로직과 연결) */
  partyInviteScore: 80,
});

/**
 * 중도에서 활동하며 점수를 쌓는 방식 요약 (문서용)
 */
const NEUTRAL_ZONE_BEHAVIOR = Object.freeze({
  summaryKo:
    '중도에서는 글·댓글·좋아요·싫어요(특히 다른 성향 유저와의 상호 반응)으로 정치색 점수가 쌓입니다. ' +
    '일정 수준에 도달하면 입당 추천서가 발송되고, 동의 없이도 해당 영토 소속으로 편입되며 그 영토의 1단계 게시판이 열립니다.',
});

/**
 * AI 토론 주제(일간/주간/데일리) — 나중에 스케줄러·프롬프트와 연결
 */
const AI_TOPIC_CHANNELS = Object.freeze({
  dailyGeneral: { id: 'AI_DAILY_GENERAL', labelKo: '일간 일반 토론 주제' },
  weekly: { id: 'AI_WEEKLY', labelKo: '주간 토론 주제' },
});

function getPublicAlignmentConfig() {
  return Object.freeze({
    signalTypes: SIGNAL_TYPES,
    autoPartyThresholds: AUTO_PARTY_THRESHOLDS,
    neutralZone: NEUTRAL_ZONE_BEHAVIOR,
    aiTopicChannels: AI_TOPIC_CHANNELS,
    /** 랭크별 축 상한 + 게시물당 캡 (config/alignment-rank-limits.js) */
    rankAlignment: alignmentRankLimits.getPublicRankAlignmentLimits(),
  });
}

module.exports = Object.freeze({
  SIGNAL_TYPES,
  AUTO_PARTY_THRESHOLDS,
  NEUTRAL_ZONE_BEHAVIOR,
  AI_TOPIC_CHANNELS,
  getPublicAlignmentConfig,
  alignmentRankLimits,
});
