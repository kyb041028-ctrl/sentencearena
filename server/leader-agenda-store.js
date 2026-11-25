'use strict';

const agenda = require('../shared/representative-agenda-core');

async function publish(client, input) {
  const src = input || {};
  const decision = agenda.decide(src);
  if (!decision.side || (src.country !== 'KR' && src.country !== 'US')) return decision;
  const persist = decision.published === true || decision.reason === 'VACANT_UNPUBLISHED' || decision.reason === 'NO_TEXT' || decision.reason === 'TERM_ENDED';
  if (!persist) return decision;
  const weekNumber = Number(src.weekNumber);
  const existing = await client.query(
    'SELECT id, published, reason FROM leader_agenda_issues WHERE country = $1 AND week_number = $2',
    [src.country, weekNumber]
  );
  if (existing.rows[0]) {
    return {
      ok: false,
      published: false,
      reason: 'DUPLICATE_ROUND',
      kept: existing.rows[0],
      name: '지도자의제',
    };
  }
  await client.query(
    `INSERT INTO leader_agenda_issues
      (id, country, week_number, territory, published, title, body, author_id, reason, created_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      src.country + ':week:' + weekNumber,
      src.country,
      weekNumber,
      decision.side,
      decision.published === true,
      decision.title || null,
      decision.body || null,
      decision.authorId || null,
      decision.reason,
      Number(src.atMs),
    ]
  );
  return decision;
}

module.exports = { publish: publish };
