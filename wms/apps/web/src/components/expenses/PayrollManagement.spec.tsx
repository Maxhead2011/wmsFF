import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollManagement, payrollTimeCells, payrollIntervalCells } from './PayrollManagement';
import type { AuthSession } from '../../lib/api';
// TEST: no new payroll form is visible before the server explicitly enables it.
describe('payroll feature isolation', () => {
  // TEST: historical display preserves synthetic clock values; real overnight visits retain dates.
  it('shows imported start/end without guessing the original night shift', () => {
    expect(payrollIntervalCells({ kind: 'HISTORY', detail: { start: 17 / 24, end: 1439 / 1440 } })).toEqual(['17:00', '23:59']);
  });
  it('merges rate boundaries but retains separate visits and overnight dates', () => {
    const cells = payrollIntervalCells({ kind: 'HOURLY', detail: { segments: [
      { start: '2026-09-25T17:00:00+03:00', end: '2026-09-25T18:00:00+03:00', rateKopecks: 30000 },
      { start: '2026-09-25T18:00:00+03:00', end: '2026-09-25T19:00:00+03:00', rateKopecks: 35000 },
      { start: '2026-09-25T20:00:00+03:00', end: '2026-09-26T01:00:00+03:00', rateKopecks: 35000 },
    ] } });
    expect(cells[0].split('\n')).toHaveLength(2); expect(cells[1]).toContain('26.09'); expect(cells[1]).toContain('01:00');
  });
  // TEST: imported historical rows retain visible duration, including minute rounding.
  it('shows historical work time and lunch without recalculation', () => {
    expect(payrollTimeCells({ kind: 'HISTORY', workedMs: 8 * 3600000, lunchMs: 3600000, detail: {} })).toEqual(['8:00', '1:00']);
    expect(payrollTimeCells({ kind: 'HOURLY', workedMs: 7199999, lunchMs: 0, detail: {} })).toEqual(['2:00', '0:00']);
  });
  it('retains the current workspace while capability is unavailable', () => {
    const session = { accessToken: 'test', user: { id: 'admin', roleCodes: ['ADMIN'] } } as AuthSession;
    const html = renderToStaticMarkup(<PayrollManagement session={session} legacy={<p>Existing payroll</p>} />);
    expect(html).toContain('Existing payroll'); expect(html).not.toContain('Телефон для перевода');
  });
});
