import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollManagement, payrollTimeCells, payrollIntervalCells, payrollPaymentSummary } from './PayrollManagement';
import type { AuthSession } from '../../lib/api';
// TEST: no new payroll form is visible before the server explicitly enables it.
describe('payroll feature isolation', () => {
  // TEST: payment details belong beside each employee's period total, never another employee's rows.
  it('groups selected-period rows and distinguishes paid, unpaid and review amounts', () => {
    const people = [{ id: 'e1', name: 'Первый', paymentMethod: 'TRANSFER', paymentPhone: '+7 900 000-00-00', paymentBank: 'Банк' },
      { id: 'e2', name: 'Второй', paymentMethod: 'CASH', paymentPhone: 'old', paymentBank: 'old' }];
    const rows = [{ employeeId: 'e1', amountKopecks: 10000, status: 'UNPAID' }, { employeeId: 'e1', amountKopecks: 5000, status: 'PAID' },
      { employeeId: 'e1', amountKopecks: 2000, status: 'REVIEW' }, { employeeId: 'e2', amountKopecks: 900, status: 'UNPAID' }];
    expect(payrollPaymentSummary(people, rows, 'e1')).toEqual([{ id: 'e1', name: 'Первый', amountKopecks: 17000, unpaidKopecks: 10000,
      paidKopecks: 5000, reviewKopecks: 2000, payment: 'Перевод', phone: '+7 900 000-00-00', bank: 'Банк' }]);
    expect(payrollPaymentSummary(people, rows, '__all')[1]).toMatchObject({ amountKopecks: 900, payment: 'Наличные', phone: '—', bank: '—' });
  });
  it('marks missing transfer details explicitly and includes zero total for a selected employee', () => {
    expect(payrollPaymentSummary([{ id: 'e', name: 'Имя', paymentMethod: 'TRANSFER' }], [], 'e')[0])
      .toMatchObject({ amountKopecks: 0, phone: 'Не указан', bank: 'Не указан' });
    expect(payrollPaymentSummary([{ id: 'e', name: 'Имя', paymentMethod: 'UNSPECIFIED' }], [], '__all')).toEqual([]);
  });
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
