/**
 * =============================================================================
 * 외계행성 — 행동 관측 기지 (정치 성향과 분리)
 * =============================================================================
 * - 단일 허브 KANTAPBIYA: 자유게시판·관측기록·밈·생존일지 등
 * - 입장·체류: moderation exile(운영/행동 기반)만 사용
 * - planetPct·LEFT/RIGHT 신호구역 없음
 * =============================================================================
 */

'use strict';

const alignmentRankLimits = require('./alignment-rank-limits');

/**
 * @param {number} earthReturnTicketKrw 지구 귀환 티켓 가격(원)
 */
function buildKantapbiya(earthReturnTicketKrw) {
  const price = Number(earthReturnTicketKrw);
  return Object.freeze({
    id: 'KANTAPBIYA',
    labelKo: '외계영토',
    hub: Object.freeze({
      id: 'KANTAPBIYA',
      labelKo: '외계영토 · 행동 관측 기지',
      boardCategories: Object.freeze([
        { id: 'free', labelKo: '자유게시판' },
        { id: 'observe', labelKo: '관측기록' },
        { id: 'meme', labelKo: '밈·드립' },
        { id: 'diary', labelKo: '생존일지' },
      ]),
    }),
    exile: Object.freeze({
      noAutoTimer: false,
      stageDays: Object.freeze([0, 3, 7, 14, 30, 90]),
      noteKo: '반복 신고·도배·과열 등 행동 패턴에 따른 관측 체류. 정치 성향과 무관.',
      returnToCitizenLand: Object.freeze({
        payEarthReturnTicketKrw: price,
      }),
    }),
    rankAlignment: alignmentRankLimits.getKantapbiyaRankAlignmentLimits(),
  });
}

module.exports = Object.freeze({
  buildKantapbiya,
});
