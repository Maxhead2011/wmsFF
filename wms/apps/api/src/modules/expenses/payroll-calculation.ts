/** Payroll calculations use elapsed milliseconds and integer kopecks, never rounded decimal hours. */
export type PayrollRate = { from: string; to?: string | null; kopecks: number; temporary?: boolean };
export type WorkInterval = { start: string; end: string };
const HOUR = 3_600_000;

function instant(value: string): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Timezone is required');
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('Invalid timestamp');
  return time;
}

function checkedRates(rates: PayrollRate[]) {
  const rows = rates.map(r => {
    if (!Number.isSafeInteger(r.kopecks) || r.kopecks < 0) throw new Error('Invalid rate');
    const from = instant(r.from), to = r.to ? instant(r.to) : Infinity;
    if (to <= from) throw new Error('Invalid rate period');
    return { ...r, from, to };
  });
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (!!rows[i].temporary === !!rows[j].temporary && rows[i].from < rows[j].to && rows[j].from < rows[i].to) {
      throw new Error('Overlapping rate periods');
    }
  }
  return rows;
}

// FIX: temporary conditions override the base only within their explicit interval.
export function payrollRateAt(rates: PayrollRate[], at: string): number {
  const time = instant(at);
  const matches = checkedRates(rates).filter(r => r.from <= time && time < r.to);
  const rate = matches.find(r => r.temporary) ?? matches[0];
  if (!rate) throw new Error('Rate missing for period');
  return rate.kopecks;
}

export function workDate(start: string, timezone = 'Europe/Moscow'): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant(start)));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// FIX: aggregate a complete start-date group before applying lunch once.
export function calculateWorkDay(intervals: WorkInterval[], rates: PayrollRate[], timezone = 'Europe/Moscow') {
  if (!intervals.length) throw new Error('Work intervals required');
  const date = workDate(intervals[0].start, timezone);
  const rows = intervals.map(i => ({ start: instant(i.start), end: instant(i.end), date: workDate(i.start, timezone) }))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].date !== date || rows[i].end <= rows[i].start) throw new Error('Invalid work day');
    if (i && rows[i].start < rows[i - 1].end) throw new Error('Overlapping work intervals');
  }
  const schedule = checkedRates(rates);
  const segments: { start: string; end: string; workedMs: number; rateKopecks: number }[] = [];
  for (const row of rows) {
    const cuts = [...new Set([row.start, row.end, ...schedule.flatMap(r => [r.from, r.to])
      .filter(t => t > row.start && t < row.end)])].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const start = new Date(cuts[i - 1]).toISOString();
      segments.push({ start, end: new Date(cuts[i]).toISOString(), workedMs: cuts[i] - cuts[i - 1], rateKopecks: payrollRateAt(rates, start) });
    }
  }
  const workedMs = segments.reduce((sum, s) => sum + s.workedMs, 0);
  const lunchMs = workedMs > 6 * HOUR ? HOUR : 0;
  const paidMs = workedMs - lunchMs;
  // Proportional lunch; keep precision until the final monetary total.
  const detail = segments.map(s => ({ ...s, paidMs: s.workedMs * paidMs / workedMs }));
  const amountKopecks = Math.round(detail.reduce((sum, s) => sum + s.paidMs * s.rateKopecks / HOUR, 0));
  if (!Number.isSafeInteger(amountKopecks)) throw new Error('Amount exceeds safe range');
  return { date, workedMs, lunchMs, paidMs, amountKopecks, segments: detail };
}

// FIX: one operation has unique participants; each participant's rate is fixed at work start.
export function calculateHandling(start: string, pallets: number, participants: { employeeId: string; rates: PayrollRate[] }[]) {
  if (!Number.isFinite(pallets) || pallets <= 0 || !participants.length) throw new Error('Invalid handling operation');
  if (new Set(participants.map(p => p.employeeId)).size !== participants.length || participants.some(p => !p.employeeId)) {
    throw new Error('Duplicate or missing participant');
  }
  const rows = participants.map(p => {
    const rateKopecks = payrollRateAt(p.rates, start);
    const exact = pallets * rateKopecks / participants.length;
    if (!Number.isSafeInteger(Math.ceil(exact))) throw new Error('Amount exceeds safe range');
    return { employeeId: p.employeeId, rateKopecks, amountKopecks: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  // Allocate residual kopecks deterministically, without increasing the total on a three-person split.
  const total = Math.round(rows.reduce((sum, r) => sum + r.amountKopecks + r.fraction, 0));
  let remainder = total - rows.reduce((sum, r) => sum + r.amountKopecks, 0);
  const order = [...rows].sort((a, b) => b.fraction - a.fraction || a.employeeId.localeCompare(b.employeeId));
  for (const row of order) if (remainder-- > 0) row.amountKopecks++;
  return { totalKopecks: total, participants: rows.map(({ fraction, ...row }) => row) };
}
