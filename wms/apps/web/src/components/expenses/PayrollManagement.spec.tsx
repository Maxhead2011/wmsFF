import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollManagement, payrollTimeCells } from './PayrollManagement';
import type { AuthSession } from '../../lib/api';
// TEST: no new payroll form is visible before the server explicitly enables it.
describe('payroll feature isolation', () => {
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
