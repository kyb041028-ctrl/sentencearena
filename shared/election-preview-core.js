/**
 * 개발용 선거·탄핵 미리보기.
 * 운영 선거가 아니다. API, DB, 투표 제출, 일정, 당선 확정을 하지 않는다.
 * 주소에 devElectionPreview 가 있을 때만 연다. 일반 로그인에서 자동으로 뜨지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ElectionPreviewCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function electionPreviewFactory() {
  'use strict';

  var STATES = [
    'election-open',
    'election-voted',
    'impeach-open',
    'impeach-voted',
    'ended',
    'hide-today',
    'none',
    'ineligible',
  ];

  var COPY = {
    KR: {
      sim: '개발용 시뮬레이션',
      notLive: '운영 선거가 아닙니다. 이 화면은 투표를 서버로 보내지 않습니다.',
      close: '닫기',
      turnout: '전체 투표율',
      choose: '선택',
      previewOnly: '이 버튼은 미리보기입니다. 선택이 저장되거나 전송되지 않습니다.',
      voted: '참여했습니다. 무엇을 골랐는지는 다른 사람에게 보이지 않습니다.',
      ended: '종료',
      tie: '동률이라 부결입니다.',
      none: '지금 열린 선거가 없습니다.',
      ineligible: '이번 투표권이 없습니다.',
      yes: '찬성',
      no: '반대',
      electionTitle: '지도자 선거 미리보기',
      impeachTitle: '탄핵 투표 미리보기',
      sole: '후보가 한 명이면 선택 화면이 없습니다. 자동 당선으로 표시만 합니다.',
      rulesElection:
        '유효 인구 1000명부터, 대표 중 희망자만 후보, 1인 1표, 48시간, 단독이면 자동 당선. 임기는 시즌이며 시즌 길이와 날짜는 정해지지 않았습니다.',
      rulesImpeach:
        '대표 의결 24시간, 최소 5명이 참여하고 참여자 과반이면 시민투표. 시민투표 48시간, 유권자 20% 이상 참여와 찬성 과반이면 가결. 동률은 부결. 가결되면 바로 해임합니다. 부결되면 28일 동안 같은 발의를 막습니다. 공석은 해임 시각부터 7일이고, 그 시각에 접수가 시작되어 3일입니다. 별도 검증 대기 2일은 없습니다. 자격은 일반 선거와 같습니다. 0명은 매주 재접수, 1명은 투표 없이 자동 당선 대상, 2명 이상은 48시간입니다. 복수 후보는 해임부터 투표 종료까지 12일입니다. 자동 접수, 단독 임명, 투표 개설은 아직 없습니다. 정책 설명이며 운영 중인 선거가 아닙니다.',
      hideTitle: '오늘 하루 보지 않기',
      hideBody:
        '닫으면 주입된 날짜의 자동 팝업만 숨깁니다. 수동 알림은 다시 열립니다. 선거와 탄핵은 따로입니다. 숨김은 기권이 아닙니다.',
      hideDate: '기준 날짜',
      tz: '시간대는 확정하지 않았습니다. 날짜는 밖에서 넣은 값입니다.',
      autoHidden: '이 날짜의 자동 팝업은 숨겨져 있습니다.',
      manual: '수동 알림 열기',
      dismiss: '오늘 하루 보지 않기',
      electionKind: '선거',
      impeachKind: '탄핵',
    },
    US: {
      sim: 'Development simulation',
      notLive: 'Development simulation. This is not a live election, and nothing is sent to a server.',
      close: 'Close',
      turnout: 'Overall turnout',
      choose: 'Choose',
      previewOnly: 'This button is only a preview. The choice is not saved or sent.',
      voted: 'You have taken part. Your choice is not shown to anyone else.',
      ended: 'Ended',
      tie: 'A tie fails.',
      none: 'There is no open election.',
      ineligible: 'You cannot vote in this one.',
      yes: 'Yes',
      no: 'No',
      electionTitle: 'Leader election preview',
      impeachTitle: 'Impeachment vote preview',
      sole: 'A sole candidate has no choice screen. The preview only says they would win automatically.',
      rulesElection:
        'Opens at 1,000 valid members. Only a representative who wants to run is a candidate. One vote each, for 48 hours. A sole candidate wins automatically. The term is a season, and the season length and dates are not set.',
      rulesImpeach:
        'Representatives vote for 24 hours. At least 5 must vote, and a majority of them must say yes, before the citizen vote. That vote lasts 48 hours. It passes only with at least 20% turnout and a yes majority. A tie fails. Passage removes the leader at once. Failure blocks the same proposal for 28 days. The seat stays empty for 7 days from removal. Filing starts then and lasts 3 days. There is no separate 2-day review wait. Eligibility matches an ordinary election. None means weekly filing again, one candidate is an automatic winner with no vote, and two or more vote for 48 hours. For two or more, the vote ends 12 days after removal. Automatic filing, appointing a sole winner, and opening the vote are not available yet. This is the policy, not a live election.',
      hideTitle: 'Hide for this date',
      hideBody:
        'Closing hides only the automatic popup for the injected date. A manual notice still opens. Election and impeachment are separate. Hiding is not an abstention.',
      hideDate: 'Injected date',
      tz: 'The timezone is not set. The date is supplied from outside.',
      autoHidden: 'The automatic popup for this date is hidden.',
      manual: 'Open the manual notice',
      dismiss: 'Hide for this date',
      electionKind: 'Election',
      impeachKind: 'Impeachment',
    },
  };

  function text(country, key) {
    var pack = COPY[country] || COPY.KR;
    return pack[key];
  }

  function base(country, extra) {
    var kr = country !== 'US';
    var row = {
      country: kr ? 'KR' : 'US',
      territory: kr ? 'pioneer' : 'guardian',
      electionId: kr ? 'kr-preview-leader' : 'us-preview-leader',
      type: 'leader-election',
      eligibility: 'eligible',
      votingStatus: 'open',
      eligibleCount: kr ? 1200 : 1400,
      votesCast: kr ? 180 : 210,
      start: kr ? 'kr-preview-start' : 'us-preview-start',
      end: kr ? 'kr-preview-end' : 'us-preview-end',
      candidates: kr
        ? [
            { id: 'kr-preview-a', name: '한결', territory: 'pioneer' },
            { id: 'kr-preview-b', name: '오름', territory: 'pioneer' },
          ]
        : [
            { id: 'us-preview-a', name: 'Avery', territory: 'guardian' },
            { id: 'us-preview-b', name: 'Jordan', territory: 'guardian' },
          ],
      finalResult: null,
    };
    var key;
    for (key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) row[key] = extra[key];
    }
    return row;
  }

  function fixture(country, state) {
    var code = country === 'US' ? 'US' : 'KR';
    if (state === 'none') return null;
    if (state === 'election-open' || state === 'hide-today') return base(code, {});
    if (state === 'election-voted') return base(code, { votingStatus: 'voted' });
    if (state === 'ineligible') return base(code, { eligibility: 'ineligible' });
    if (state === 'ended') {
      return base(code, { votingStatus: 'ended', finalResult: 'tie-rejected' });
    }
    if (state === 'impeach-open' || state === 'impeach-voted') {
      return base(code, {
        electionId: code === 'KR' ? 'kr-preview-impeach' : 'us-preview-impeach',
        type: 'impeachment',
        votingStatus: state === 'impeach-voted' ? 'voted' : 'open',
        candidates: [],
        finalResult: null,
      });
    }
    return null;
  }

  function turnoutLabel(record, country) {
    var eligible = Number(record && record.eligibleCount);
    var cast = Number(record && record.votesCast);
    if (!isFinite(eligible) || eligible <= 0 || !isFinite(cast) || cast < 0) return text(country, 'turnout') + ' —';
    var rate = Math.floor((cast * 100) / eligible);
    return text(country, 'turnout') + ' ' + rate + '%';
  }

  function showsChoices(record) {
    if (!record || record.eligibility !== 'eligible' || record.votingStatus !== 'open') return false;
    if (record.type === 'leader-election' && (!record.candidates || record.candidates.length < 2)) return false;
    return record.type === 'leader-election' || record.type === 'impeachment';
  }

  function hideKey(country, memberId, kind, clockDate) {
    return [country || '', memberId || '', kind || '', clockDate || ''].join('|');
  }

  function createHideMemory() {
    var hidden = Object.create(null);
    return {
      dismiss: function (country, memberId, kind, clockDate) {
        hidden[hideKey(country, memberId, kind, clockDate)] = true;
      },
      isHidden: function (country, memberId, kind, clockDate) {
        return hidden[hideKey(country, memberId, kind, clockDate)] === true;
      },
    };
  }

  return {
    STATES: STATES,
    COPY: COPY,
    fixture: fixture,
    turnoutLabel: turnoutLabel,
    showsChoices: showsChoices,
    hideKey: hideKey,
    createHideMemory: createHideMemory,
    text: text,
  };
});
