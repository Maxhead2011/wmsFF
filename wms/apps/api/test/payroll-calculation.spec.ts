import { describe, expect, it } from 'vitest';
import { calculateHandling, calculateWorkDay, payrollRateAt } from '../src/modules/expenses/payroll-calculation';
const rate = [{ from: '2026-01-01T00:00:00+03:00', kopecks: 35000 }];
const span = (start: string, end: string) => ({ start: `2026-09-26T${start}:00+03:00`, end: `2026-09-26T${end}:00+03:00` });
// TEST: accepted payroll rules, including midnight and individual conditions.
describe('payroll work time', () => {
  it('does not deduct lunch at exactly six hours', () => {
    expect(calculateWorkDay([span('09:00', '15:00')], rate)).toMatchObject({ lunchMs: 0, amountKopecks: 210000 });
  });
  it('deducts once across several visits and excludes the gap', () => {
    expect(calculateWorkDay([span('09:00', '12:00'), span('14:00', '18:00')], rate))
      .toMatchObject({ workedMs: 7 * 3600000, lunchMs: 3600000, amountKopecks: 210000 });
  });
  it('keeps actual overnight duration and start date', () => {
    expect(calculateWorkDay([{ start: '2026-09-26T17:20:00+03:00', end: '2026-09-27T00:20:00+03:00' }], rate))
      .toMatchObject({ date: '2026-09-26', workedMs: 7 * 3600000, amountKopecks: 210000 });
  });
  it('allocates lunch proportionally across a temporary rate', () => {
    const rates = [...rate, { from: '2026-09-26T13:00:00+03:00', to: '2026-09-26T17:00:00+03:00', kopecks: 45000, temporary: true }];
    const result = calculateWorkDay([span('09:00', '17:00')], rates);
    expect(result.amountKopecks).toBe(280000);
    expect(result.segments.map(s => s.paidMs)).toEqual([3.5 * 3600000, 3.5 * 3600000]);
    expect(payrollRateAt(rates, '2026-09-26T17:00:00+03:00')).toBe(35000);
  });
  it('rejects overlapping visits rather than paying twice', () => {
    expect(() => calculateWorkDay([span('09:00', '15:00'), span('14:00', '18:00')], rate)).toThrow('Overlapping');
  });
  it('rejects missing rates and ambiguous temporary conditions', () => {
    expect(() => calculateWorkDay([span('09:00', '15:00')], [])).toThrow('Rate missing');
    expect(() => calculateWorkDay([span('09:00', '15:00')], [...rate, ...rate])).toThrow('Overlapping');
  });
  it('requires timezone and positive duration', () => {
    expect(() => payrollRateAt(rate, '2026-09-26T09:00:00')).toThrow('Timezone');
    expect(() => calculateWorkDay([span('15:00', '09:00')], rate)).toThrow('Invalid');
  });
});
describe('handling pay', () => {
  const rates = [{ ...rate[0], kopecks: 50000 }];
  it('splits operation payment without multiplying by participant count', () => {
    expect(calculateHandling(rate[0].from, 4, ['a', 'b'].map(employeeId => ({ employeeId, rates }))).participants
      .map(p => p.amountKopecks)).toEqual([100000, 100000]);
  });
  it('personal increase does not reduce helper pay', () => {
    expect(calculateHandling(rate[0].from, 1, [{ employeeId: 'a', rates: [{ ...rates[0], kopecks: 70000 }] }, { employeeId: 'b', rates }])
      .participants.map(p => p.amountKopecks)).toEqual([35000, 25000]);
  });
  it('distributes indivisible kopecks exactly once', () => {
    const result = calculateHandling(rate[0].from, 1, ['c', 'b', 'a'].map(employeeId => ({ employeeId, rates })));
    expect(result.totalKopecks).toBe(50000);
    expect(result.participants.reduce((sum, p) => sum + p.amountKopecks, 0)).toBe(50000);
  });
  it('rejects duplicate participants', () => {
    expect(() => calculateHandling(rate[0].from, 1, ['a', 'a'].map(employeeId => ({ employeeId, rates })))).toThrow('Duplicate');
  });
});
