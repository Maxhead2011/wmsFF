const DEFAULT_RECEIPT_BOX_PREFIX = 'FFL_LKB';

export function receiptDateFromBoxCode(
  boxCode: string,
  fallback: Date,
  receiptPrefix = DEFAULT_RECEIPT_BOX_PREFIX,
  includeFboReceiptPrefix = false,
) {
  const escapedPrefix = receiptPrefix
    .trim()
    .toLocaleUpperCase('ru-RU')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // FIX: opt in only from reporting; operational close/finish keeps its existing parser.
  const fbo = includeFboReceiptPrefix && receiptPrefix.trim().toUpperCase() === DEFAULT_RECEIPT_BOX_PREFIX ? '(?:FBO)?' : '';
  const match = boxCode
    .toLocaleUpperCase('ru-RU')
    .match(new RegExp(`^${escapedPrefix}${fbo}(\\d{2})(\\d{2})(\\d{2})?(?:_|$)`));
  if (!match) return moscowDateKey(fallback);

  const fallbackYear = Number(moscowDateKey(fallback).slice(0, 4));
  const year = match[3] ? 2000 + Number(match[3]) : fallbackYear;
  const month = Number(match[2]);
  const day = Number(match[1]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
    ? candidate.toISOString().slice(0, 10)
    : moscowDateKey(fallback);
}

export function receiptBoxCodePrefixForDate(
  value: string,
  receiptPrefix = DEFAULT_RECEIPT_BOX_PREFIX,
) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${receiptPrefix.trim().toLocaleUpperCase('ru-RU')}${match[3]}${match[2]}`;
}

function moscowDateKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

// FIX: use the same aliases in the database prefilter and the in-memory date check.
export function receiptBoxCodePrefixesForDate(value: string, receiptPrefix = DEFAULT_RECEIPT_BOX_PREFIX, includeFboReceiptPrefix = false) {
  const primary = receiptBoxCodePrefixForDate(value, receiptPrefix);
  if (!primary) return null;
  return includeFboReceiptPrefix && receiptPrefix.trim().toUpperCase() === DEFAULT_RECEIPT_BOX_PREFIX
    ? [primary, primary.replace(DEFAULT_RECEIPT_BOX_PREFIX, `${DEFAULT_RECEIPT_BOX_PREFIX}FBO`)] : [primary];
}
