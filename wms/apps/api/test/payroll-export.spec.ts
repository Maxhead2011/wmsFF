import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { payrollPdf, payrollXlsx } from '../src/modules/expenses/payroll-export';
const report: any = { employee: { name: 'Тестовый сотрудник', paymentMethod: 'CASH' }, from: '2026-09-26', to: '2026-09-26',
  rows: [{ date: '2026-09-26', kind: 'HOURLY', workedMs: 8 * 3600000, lunchMs: 3600000, amountKopecks: 245000, status: 'UNPAID', detail: { segments: [
    { start: '2026-09-26T06:00:00Z', end: '2026-09-26T14:00:00Z', workedMs: 8 * 3600000, paidMs: 7 * 3600000, rateKopecks: 35000 },
  ] } }], totals: { amountKopecks: 245000, paidKopecks: 0 }, issues: [] };
// TEST: employee exports preserve amounts and produce actual readable file formats.
describe('payroll export', () => {
  it('exports original timesheet columns and exact amount', () => {
    const book = XLSX.read(payrollXlsx(report), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<any[]>(book.Sheets['Табель'], { header: 1 });
    expect(rows[0]).toEqual(['Дата', 'ФИО', 'Начало', 'Конец', 'Обед', 'Время Итого', 'Цена в час', 'Сумма', 'Телефон', 'Банк', 'Статус']);
    expect(rows[1][7]).toBe(2450); expect(rows[1][5]).toBe(7 / 24);
    // TEST: all report sheets display dd.mm.yyyy, including the selected period.
    for (const name of ['Табель', 'Начисления', 'Расчёт по ставкам']) {
      expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets[name], { header: 1 })[1][0]).toBe('26.09.2026');
    }
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets['Итоги'], { header: 1 })[0][1]).toBe('26.09.2026 — 26.09.2026');
  });
  it('renders a Cyrillic PDF', async () => {
    expect((await payrollPdf(report)).subarray(0, 4).toString()).toBe('%PDF');
  });
});
