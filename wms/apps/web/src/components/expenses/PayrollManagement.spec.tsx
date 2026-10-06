import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollManagement, payrollCargoText, payrollTimeCells, payrollIntervalCells, payrollPaymentSummary, payrollFilterRows, payrollDate, payrollSortRows, payrollCurrentRates, attendancePhotoStatus, payrollFilterEmployees, payrollOperationTariff, payrollLocalTime, payrollEditedTime, payrollInitialConditions } from './PayrollManagement';
import type { AuthSession } from '../../lib/api';
// TEST: no new payroll form is visible before the server explicitly enables it.
describe('payroll feature isolation', () => {
  // TEST: physical cargo counts must remain distinct, including old pallet-only records.
  it('shows all four cargo quantities without replacing them with pallet equivalents', () => {
    expect(payrollCargoText({ palletCount: 1, boxCount: 16, bagCount: 5, rollCount: 30 })).toBe('1 пал. · 16 кор. · 5 меш. · 30 рул.');
    expect(payrollCargoText({ palletCount: 2 })).toBe('2 пал. · 0 кор. · 0 меш. · 0 рул.');
    expect(payrollCargoText({ rollCount: 1 })).toBe('0 пал. · 0 кор. · 0 меш. · 1 рул.');
  });
  // TEST: the new card handles zero, hourly/piecework and optional loader tariffs independently.
  it('builds initial tariffs without inheriting another employee or a hidden loader rate', () => {
    const f = new FormData(); f.set('initialKind', 'PIECE'); f.set('initialRate', '12.50'); f.set('initialPalletRate', '500'); f.set('initialStart', '2026-09-28T00:00');
    expect(payrollInitialConditions(f, true)).toEqual([{ kind: 'PIECE', rateKopecks: 1250, startsAt: '2026-09-28T00:00:00+03:00' }, { kind: 'PALLET', rateKopecks: 50000, startsAt: '2026-09-28T00:00:00+03:00' }]);
    expect(payrollInitialConditions(f, false)).toHaveLength(1);
    f.set('initialRate', '0'); expect(payrollInitialConditions(f, false)[0].rateKopecks).toBe(0);
    expect(payrollInitialConditions(new FormData(), true)).toEqual([]);
  });
  // TEST: editing only lunch must not silently round the tablet's attendance timestamps.
  it('preserves unchanged timestamps and converts edited MSK times across midnight', () => {
    const original = '2026-09-27T19:04:01.302Z';
    expect(payrollLocalTime(original)).toBe('2026-09-27T22:04:01');
    expect(payrollEditedTime(payrollLocalTime(original), original)).toBe(original);
    expect(new Date(payrollEditedTime('2026-09-28T00:10', original)).toISOString()).toBe('2026-09-27T21:10:00.000Z');
    expect(payrollLocalTime('')).toBe('');
  });
  // TEST: explicit rouble values must never be mistaken for kopecks or silently rounded.
  it('parses a one-off pallet tariff and keeps an empty field as personal-rate fallback', () => {
    expect(payrollOperationTariff('500')).toBe(50000);
    expect(payrollOperationTariff(' 500,25 ')).toBe(50025);
    expect(payrollOperationTariff('')).toBeUndefined();
    for (const value of ['-1', '1.001', 'abc', '1e5', '99999999999']) expect(() => payrollOperationTariff(value)).toThrow();
  });
  // TEST: archived staff must not enter active-only totals, but remain available in historical reports.
  it('filters active and inactive employees without losing historical payroll', () => {
    const people = [{ id: 'active', name: 'Активный', isActive: true, paymentMethod: 'CASH' },
      { id: 'old', name: 'Архивный', isActive: false, paymentMethod: 'CASH' }];
    const rows = [{ employeeId: 'active', amountKopecks: 10000, status: 'UNPAID' },
      { employeeId: 'old', amountKopecks: 90000, status: 'PAID' }];
    expect(payrollFilterEmployees(people, 'active').map(e => e.id)).toEqual(['active']);
    expect(payrollFilterEmployees(people, 'inactive').map(e => e.id)).toEqual(['old']);
    expect(payrollPaymentSummary(payrollFilterEmployees(people, 'active'), rows, '__all').reduce((n, p) => n + p.amountKopecks, 0)).toBe(10000);
    expect(payrollPaymentSummary(payrollFilterEmployees(people, 'all'), rows, '__all').reduce((n, p) => n + p.amountKopecks, 0)).toBe(100000);
    expect(payrollFilterEmployees([], 'active')).toEqual([]);
    expect(people).toHaveLength(2);
  });
  // TEST: a pending/expired request must never be presented as a stored photo.
  it('distinguishes local photos from requested, stored and expired photographs', () => {
    expect(attendancePhotoStatus('NOT_REQUESTED')).toBe('На планшете');
    expect(attendancePhotoStatus('PENDING')).toBe('Ожидаем планшет');
    expect(attendancePhotoStatus('STORED')).toBe('Фото доступно');
    expect(attendancePhotoStatus('EXPIRED')).toBe('Срок хранения истёк');
  });
  // TEST: settings show the current condition, not one from the report period or an expired override.
  it('selects current rates with temporary precedence and an exclusive end boundary', () => {
    const rates = [
      { id: 'base', kind: 'HOURLY', rateKopecks: 35000, startsAt: '2026-01-01T00:00:00Z', temporary: false },
      { id: 'temp', kind: 'HOURLY', rateKopecks: 40000, startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z', temporary: true },
      { id: 'future', kind: 'PALLET', rateKopecks: 60000, startsAt: '2026-11-01T00:00:00Z', temporary: false },
    ];
    expect(payrollCurrentRates(rates, Date.parse('2026-09-26T12:00:00Z')).map(r => r.id)).toEqual(['temp']);
    expect(payrollCurrentRates(rates, Date.parse('2026-10-01T00:00:00Z')).map(r => r.id)).toEqual(['base']);
  });
  // TEST: display dates are Russian, but chronological sorting uses ISO dates across month boundaries.
  it('formats dates and sorts all employees by date, name or bank without mutating the report', () => {
    expect(payrollDate('2026-09-05')).toBe('05.09.2026');
    const people = [{ id: 'a', name: 'Яна', paymentMethod: 'TRANSFER', paymentBank: 'Альфа' }, { id: 'b', name: 'Анна', paymentMethod: 'TRANSFER', paymentBank: 'Сбер' }];
    const rows = [{ key: 'a', employeeId: 'a', date: '2026-09-30' }, { key: 'b', employeeId: 'b', date: '2026-10-01' }];
    expect(payrollSortRows(rows, people, 'name', 'asc').map(r => r.key)).toEqual(['b', 'a']);
    expect(payrollSortRows(rows, people, 'bank', 'asc').map(r => r.key)).toEqual(['a', 'b']);
    expect(payrollSortRows(rows, people, 'date', 'desc').map(r => r.key)).toEqual(['b', 'a']);
    expect(rows[0].key).toBe('a');
  });
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
  it('marks missing transfer details explicitly for an employee with accruals', () => {
    expect(payrollPaymentSummary([{ id: 'e', name: 'Имя', paymentMethod: 'TRANSFER' }], [{ employeeId: 'e', amountKopecks: 100, status: 'UNPAID' }], 'e')[0])
      .toMatchObject({ amountKopecks: 100, phone: 'Не указан', bank: 'Не указан' });
  });
  // TEST: the weekly payment summary must not list idle, zero-value or paid-only staff under UNPAID.
  it('omits employees without amounts in the filtered period and payment status', () => {
    const people = ['working', 'idle', 'zero', 'paid'].map(id => ({ id, name: id, paymentMethod: 'CASH' }));
    const rows = [{ employeeId: 'working', amountKopecks: 10000, status: 'UNPAID' },
      { employeeId: 'zero', amountKopecks: 0, status: 'UNPAID' },
      { employeeId: 'paid', amountKopecks: 5000, status: 'PAID' }];
    expect(payrollPaymentSummary(people, payrollFilterRows(rows, 'UNPAID'), '__all').map(p => p.id)).toEqual(['working']);
    expect(payrollPaymentSummary(people, payrollFilterRows(rows, 'PAID'), '__all').map(p => p.id)).toEqual(['paid']);
    expect(payrollPaymentSummary(people, [], '__all')).toEqual([]);
    expect(payrollPaymentSummary(people, rows, 'idle')).toEqual([]);
    expect(payrollPaymentSummary(people, rows, 'zero')).toEqual([]);
    expect(rows).toHaveLength(3); // Zero entries remain available in the timesheet.
  });
  // TEST: group aliases before hiding empty summaries; retain nonzero status balances even if the total nets to zero.
  it('keeps alias accruals and separate status balances', () => {
    const people = [{ id: 'root', name: 'Основной', paymentMethod: 'CASH' },
      { id: 'alias', name: 'Другое имя', paymentMethod: 'CASH', payrollPrimaryId: 'root' }];
    const rows = [{ employeeId: 'alias', amountKopecks: 10000, status: 'UNPAID' },
      { employeeId: 'root', amountKopecks: -10000, status: 'PAID' }];
    expect(payrollPaymentSummary(people, rows, '__all')[0]).toMatchObject({ id: 'root', amountKopecks: 0, unpaidKopecks: 10000, paidKopecks: -10000 });
    expect(payrollPaymentSummary(people, payrollFilterRows(rows, 'UNPAID'), 'alias')[0]).toMatchObject({ id: 'root', amountKopecks: 10000 });
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
