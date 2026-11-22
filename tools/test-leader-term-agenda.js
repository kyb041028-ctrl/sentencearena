'use strict';

const term = require('../shared/leader-term-core');
const agenda = require('../shared/representative-agenda-core');
const rank = require('../shared/rank-formula-core');

let failed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failed += 1;
}

const inaug = Date.UTC(2024, 0, 31, 15, 0, 0);
const three = term.addCalendarMonths(inaug, 3);
check('1. 1월 31일 더하기 3개월은 4월 30일', three === Date.UTC(2024, 3, 30, 15, 0, 0));
check('2. 윤년 2월 29일', term.addCalendarMonths(Date.UTC(2024, 1, 29, 0, 0, 0), 12) === Date.UTC(2025, 1, 28, 0, 0, 0));

const open = term.planTerm({ inauguratedAtMs: inaug, seasonId: 's1' });
check('3. 시즌 종료가 없으면 날짜를 만들지 않음', open.ok && open.seasonEndAtMs == null && open.seasonLength === 'UNCONFIRMED' && open.earlierReason === 'THREE_MONTH');
check('4. 3개월 전에는 권한 유지', term.authorityAt(open, three - 1).holdsOffice === true);
check('5. 3개월 시각에 권한 회수', term.authorityAt(open, three).revoked === true && term.authorityAt(open, three).reason === 'THREE_MONTH');

const earlySeason = Date.UTC(2024, 2, 1, 0, 0, 0);
const early = term.planTerm({ inauguratedAtMs: inaug, seasonId: 's1', seasonEndAtMs: earlySeason });
check('6. 시즌이 3개월보다 빠르면 시즌 종료', early.earlierAtMs === earlySeason && early.earlierReason === 'SEASON_END');

const immediate = term.planTerm({ inauguratedAtMs: inaug, seasonId: 's1', seasonEndAtMs: inaug + 1000 });
check('7. 취임 직후 시즌 종료', immediate.earlierReason === 'SEASON_END' && immediate.earlierAtMs === inaug + 1000);

const office = { country: 'KR', territory: 'pioneer', leaderId: 'p1', inauguratedAtMs: inaug, seasonId: 's1' };
const first = term.applyEnd(office, three, null);
const second = term.applyEnd(first.office, three + 1000, null);
check('8. 중복 종료는 한 번만', first.applied === true && second.applied === false && second.reason === 'ALREADY_PROCESSED' && second.leaderCount === 0);

const both = term.applyEnd(office, three, 'IMPEACHMENT');
check('9. 만료 시각의 탄핵도 지도자 1명 회수', both.leaderCount === 0 && both.office.leaderId == null && both.office.cause === 'IMPEACHMENT');

const seasonCut = term.applyEnd(Object.assign({}, office, { seasonEndAtMs: earlySeason, term: early }), earlySeason, 'SEASON_END');
check('10. 시즌 종료와 보궐 전 공석은 한 명', seasonCut.leaderCount === 0 && seasonCut.office.vacancyStartMs === earlySeason);
check('11. 종료 후 권한 유지 없음', term.authorityAt(early, earlySeason).holdsOffice === false);

const usAgenda = agenda.decide({ country: 'US', weekNumber: 1, weekday: 'Mon' });
check('12. 비로그인은 작성하지 못함', usAgenda.published === false && usAgenda.reason === 'AUTH_NOT_CONNECTED');
const krAgenda = agenda.decide({
  country: 'KR',
  weekNumber: 1,
  weekday: 'Mon',
  sessionUserId: 'p1',
  title: '주거',
  body: '토론',
  offices: [{ country: 'KR', territory: 'pioneer', leaderId: 'p1' }],
});
check('13. 1주 진보 지도자 글은 중앙영토 1건', krAgenda.published === true && krAgenda.board === 'central' && krAgenda.side === 'pioneer');
const vacant = agenda.decide({
  country: 'KR',
  weekNumber: 2,
  weekday: 'Mon',
  sessionUserId: 'p1',
  title: '주거',
  body: '토론',
  offices: [{ country: 'KR', territory: 'pioneer', leaderId: 'p1' }],
});
check('14. 2주 보수 공석은 대체하지 않음', vacant.published === false && vacant.reason === 'VACANT_UNPUBLISHED' && vacant.side === 'guardian' && vacant.substitute === false);
const many = agenda.decide({
  country: 'US',
  weekNumber: 1,
  weekday: 'Mon',
  sessionUserId: 'u1',
  drafts: [{ title: 'a' }, { title: 'b' }],
  offices: [{ country: 'US', territory: 'pioneer', leaderId: 'u1' }],
});
check('15. 여러 초안은 고르지 않음', many.reason === 'DRAFT_SELECTION_REMOVED' && many.published === false);
var wed = Date.UTC(2026, 10, 10, 15, 0, 0);
var step;
for (step = 0; step < 14 && !rank.isLocalMidnight(wed, 'Asia/Seoul'); step += 1) wed += 24 * 60 * 60 * 1000;
check('16. 서울 자정은 다음 날도 갱신 시각', rank.isLocalMidnight(wed, 'Asia/Seoul') === true && rank.isLocalMidnight(wed + 24 * 60 * 60 * 1000, 'Asia/Seoul') === true);

console.log('failed=' + failed);
process.exit(failed ? 1 : 0);
