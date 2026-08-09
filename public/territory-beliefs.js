/**
 * =============================================================================
 * 센텐스아레나 — 영토별 신념 데이터
 * =============================================================================
 * 이 파일이 영토 신념 문장의 단일 출처(Single Source of Truth)입니다.
 * 문장을 바꿀 때는 이 파일만 수정하면 프로필·소개·툴팁 등 모든 곳에 반영됩니다.
 *
 * 필드 설명
 *   displayName : 사용자에게 보이는 영토 명칭
 *   subtitle    : 영토 부제 (소속 유형 한 줄 요약)
 *   belief      : 프로필 신념 HUD에 크게 표시되는 문장 (\n = 줄바꿈)
 *   philosophy  : 프로필 비노출 — 영토 소개·툴팁·상세 설명용으로 보관
 *
 * 내부 key (reform / centrist / order / alien) 는 변경하지 않습니다.
 * =============================================================================
 */

(function (global) {
  'use strict';

  var TERRITORY_BELIEFS = Object.freeze({
    reform: Object.freeze({
      displayName: '개척영토',
      subtitle: '변화를 만드는 사람',
      belief: '미래는 기다리는 것이 아니라,\n개척하는 것이다.',
      philosophy: '변화를 두려워하지 않고\n새로운 가능성을 향해 나아간다.',
    }),
    centrist: Object.freeze({
      displayName: '중앙광장',
      subtitle: '대화하는 사람',
      belief: '답은 하나가 아니라,\n함께 찾는 것이다.',
      philosophy: '서로 다른 생각이 모일 때\n더 나은 해답이 만들어진다.',
    }),
    order: Object.freeze({
      displayName: '수호영토',
      subtitle: '질서를 지키는 사람',
      belief: '질서는 자유를 지키는\n가장 강한 약속이다.',
      philosophy: '책임과 원칙은\n공동체를 지탱하는 가장 든든한 기반이다.',
    }),
    alien: Object.freeze({
      displayName: '외계행성',
      subtitle: '경계를 관측하는 사람',
      belief: '경계 밖의 시선은\n새로운 문명을 만든다.',
      philosophy: '기존의 틀을 넘어선 사고는\n또 다른 가능성을 발견한다.',
    }),
  });

  global.TERRITORY_BELIEFS = TERRITORY_BELIEFS;
})(window);
