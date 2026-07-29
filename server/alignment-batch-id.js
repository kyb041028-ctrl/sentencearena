'use strict';

const SEOUL_TZ = 'Asia/Seoul';

function getSeoulDateParts(batchTime) {
  const date = new Date(batchTime);
  if (!Number.isFinite(date.getTime())) {
    const err = new Error('ALIGNMENT_BATCH_TIME_INVALID');
    err.code = 'ALIGNMENT_BATCH_TIME_INVALID';
    throw err;
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: SEOUL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].type !== 'literal') map[parts[i].type] = parts[i].value;
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
  };
}

function createAlignmentBatchId(batchTime) {
  const p = getSeoulDateParts(batchTime);
  return 'alignment-' + p.year + p.month + p.day + '-' + p.hour + p.minute;
}

module.exports = {
  SEOUL_TZ,
  createAlignmentBatchId,
  getSeoulDateParts,
};
