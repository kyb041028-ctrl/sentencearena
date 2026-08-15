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

const ALIGNMENT_SLOT_HOURS = Object.freeze(['05', '17']);
const ALIGNMENT_SLOT_MINUTE = '00';

function pad2(v) {
  return String(v == null ? '' : v).padStart(2, '0');
}

function createAlignmentSlotBatchId(dateParts, hour, minute) {
  const p = dateParts || {};
  return (
    'alignment-' +
    p.year +
    p.month +
    p.day +
    '-' +
    pad2(hour) +
    pad2(minute)
  );
}

function getAlignmentDueSlot(batchTime) {
  const p = getSeoulDateParts(batchTime);
  const hour = pad2(p.hour);
  const minute = pad2(p.minute);
  if (minute !== ALIGNMENT_SLOT_MINUTE) return null;
  if (ALIGNMENT_SLOT_HOURS.indexOf(hour) < 0) return null;
  return {
    hour: hour,
    minute: minute,
    slot: hour + minute,
    batchId: createAlignmentSlotBatchId(p, hour, minute),
    dateKey: p.year + p.month + p.day,
    timezone: SEOUL_TZ,
  };
}

module.exports = {
  SEOUL_TZ,
  ALIGNMENT_SLOT_HOURS,
  ALIGNMENT_SLOT_MINUTE,
  createAlignmentBatchId,
  createAlignmentSlotBatchId,
  getAlignmentDueSlot,
  getSeoulDateParts,
};
