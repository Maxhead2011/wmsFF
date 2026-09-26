import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { previewPayrollWorkbook } from '../src/modules/expenses/payroll-import';
function file(amount = 2100, status = 'оплачен') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Дата', 'ФИО', 'Начало', 'Конец', 'Обед', 'Время Итого', 'Цена в час', 'Сумма', 'Телефон', 'Банк', 'Статус'],
    [46023, 'Employee', 17 / 24, (23 * 60 + 59) / 1440, 0, 6 / 24, 350, amount, '', 'нал', status],
  ]), 'January');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
// TEST: historical payroll must keep the imported result and stable identity.
describe('historical payroll', () => {
  it('preserves historical totals without recalculating midnight or lunch', () => {
    const p = previewPayrollWorkbook(file());
    expect(p.issues).toEqual([]); expect(p.rows[0].amountKopecks).toBe(210000);
    expect(p.rows[0].paidTime).toBe(0.25); expect(p.rows[0].status).toBe('PAID');
  });
  it('keeps identity stable when the workbook is loaded again', () => {
    expect(previewPayrollWorkbook(file()).rows[0].key).toBe(previewPayrollWorkbook(file()).rows[0].key);
  });
  it('does not silently mark unknown statuses as paid', () => {
    expect(previewPayrollWorkbook(file(2100, '')).rows[0].status).toBe('REVIEW');
  });
});
