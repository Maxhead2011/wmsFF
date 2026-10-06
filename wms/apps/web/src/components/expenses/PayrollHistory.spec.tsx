import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollHistory, payrollHistoryValues } from './PayrollHistory';
import { PayrollCorrectionEmployee } from './PayrollManagement';
// TEST: correction choices and history use employee/time/cargo fields, without exposing internal snapshots.
describe('payroll correction UI', () => {
  it('limits replacement employees to the same warehouse while retaining the original inactive employee', () => {
    const people = [{ id: 'old', name: 'Исходный', warehouseId: 'w', isActive: false }, { id: 'new', name: 'Новый', warehouseId: 'w', isActive: true }, { id: 'other', name: 'Другой филиал', warehouseId: 'else', isActive: true }, { id: 'inactive', name: 'Архив', warehouseId: 'w', isActive: false }];
    const html = renderToStaticMarkup(<PayrollCorrectionEmployee people={people} employee={people[0]} />);
    expect(html).toContain('Сотрудник этой смены'); expect(html).toContain('Исходный'); expect(html).toContain('Новый');
    expect(html).not.toContain('Другой филиал'); expect(html).not.toContain('Архив');
  });
  it('shows four cargo quantities, operation direction and participants in the change details', () => {
    const values = payrollHistoryValues({ kind: 'HANDLING', handling: { startsAt: '2026-10-01T06:00Z', operation: 'LOAD', palletCount: '1.5', boxCount: 16, bagCount: 5, rollCount: 30, status: 'REVIEW', shares: [{ employeeId: 'e' }] } }, { e: 'Сотрудник' });
    expect(values).toContainEqual(['Участники', 'Сотрудник']); expect(values).toContainEqual(['Работа', 'Погрузка']);
    for (const [label, value] of [['Палеты', '1.5'], ['Короба', '16'], ['Мешки', '5'], ['Рулоны', '30']]) expect(values).toContainEqual([label, value]);
  });
  it('distinguishes automatic lunch from explicit zero and offers the requested history flow', () => {
    const state = { kind: 'SHIFT' as const, shift: { employeeId: 'e', startsAt: '2026-10-01T06:00Z', endsAt: '2026-10-01T15:00Z', workDate: '2026-10-01' }, days: [{ employeeId: 'e', workDate: '2026-10-01', lunchMinutes: 0 }] };
    expect(payrollHistoryValues(state, { e: 'Сотрудник' })).toContainEqual(['Обед за день', '0 мин']);
    const html = renderToStaticMarkup(<PayrollHistory api={async <T,>() => ({ entries: [], nextCursor: null } as T)} />);
    expect(html).toContain('История изменений'); expect(html).toContain('Отменить изменение'); expect(html).toContain('Кто изменил');
  });
});
