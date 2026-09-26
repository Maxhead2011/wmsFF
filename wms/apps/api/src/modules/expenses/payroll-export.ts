import * as XLSX from 'xlsx';
import pdfMake = require('pdfmake');
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { configurePdfMake } from '../../common/pdf/pdfmake';
import type { PayrollService } from './payroll.service';
type Report = Awaited<ReturnType<PayrollService['report']>>;
const status: Record<string, string> = { PAID: 'Оплачено', REVIEW: 'На проверке', UNPAID: 'Не оплачено' };
// FIX: one display format for dates in PDF and every workbook sheet.
const date = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');
function rows(report: Report) {
  return report.rows.map(r => [date(r.date), report.employee.name, r.kind === 'HOURLY' ? 'Повременная' : r.kind === 'PIECE' ? 'Сдельная' : r.kind === 'HISTORY' ? 'История табеля' : 'Погрузка / разгрузка',
    (r.workedMs ?? 0) / 3600000, (r.lunchMs ?? 0) / 3600000, r.units ?? '', r.amountKopecks / 100, status[r.status] ?? r.status, r.comment ?? '']);
}
const headers = ['Дата', 'Сотрудник', 'Начисление', 'Часы', 'Обед, ч', 'Единицы', 'Сумма, ₽', 'Статус', 'Комментарий'];
export function payrollXlsx(report: Report) {
  const book = XLSX.utils.book_new();
  const table: unknown[][] = [['Дата', 'ФИО', 'Начало', 'Конец', 'Обед', 'Время Итого', 'Цена в час', 'Сумма', 'Телефон', 'Банк', 'Статус']];
  const localTime = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  for (const r of report.rows.filter(row => ['HOURLY', 'HISTORY'].includes(row.kind))) {
    if (r.kind === 'HISTORY') {
      const d = r.detail as { start: number; end: number; lunch: number; paidTime: number; rate: number; phone: string; bank: string };
      table.push([date(r.date), report.employee.name, d.start, d.end, d.lunch, d.paidTime, d.rate, r.amountKopecks / 100, d.phone, d.bank, status[r.status]]);
    } else {
      const segments = (r.detail as { segments: Array<{ start: string; end: string; workedMs: number; paidMs: number; rateKopecks: number }> }).segments;
      let allocated = 0;
      segments.forEach((s, i) => {
        const amount = i === segments.length - 1 ? r.amountKopecks - allocated : Math.round(s.paidMs * s.rateKopecks / 3600000);
        allocated += amount;
        table.push([date(r.date), report.employee.name, localTime(s.start), localTime(s.end), (s.workedMs - s.paidMs) / 86400000, s.paidMs / 86400000, s.rateKopecks / 100, amount / 100,
          report.employee.paymentPhone ?? '', report.employee.paymentMethod === 'CASH' ? 'Наличные' : report.employee.paymentBank ?? '', status[r.status]]);
      });
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet['!cols'] = [14, 28, 23, 23, 12, 14, 16, 16, 20, 22, 18].map(wch => ({ wch }));
  for (let r = 1; r < table.length; r++) for (const c of [2, 3, 4, 5]) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })]; if (cell?.t === 'n') cell.z = c < 4 ? 'hh:mm' : '[h]:mm';
  }
  XLSX.utils.book_append_sheet(book, sheet, 'Табель');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows(report)]), 'Начисления');
  const details: unknown[][] = [['Дата', 'Начало', 'Конец', 'Оплачиваемые часы', 'Ставка, ₽/ч']];
  for (const r of report.rows) {
    const segments = (r.detail as { segments?: Array<{ start: string; end: string; paidMs: number; rateKopecks: number }> }).segments;
    for (const s of segments ?? []) details.push([date(r.date), localTime(s.start), localTime(s.end), s.paidMs / 3600000, s.rateKopecks / 100]);
  }
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(details), 'Расчёт по ставкам');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Период', `${date(report.from)} — ${date(report.to)}`], ['Начислено, ₽', report.totals.amountKopecks / 100], ['Оплачено, ₽', report.totals.paidKopecks / 100], ...report.issues.map(v => ['Требует проверки', v])]), 'Итоги');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
export async function payrollPdf(report: Report) {
  configurePdfMake();
  const doc: TDocumentDefinitions = { pageOrientation: 'landscape', defaultStyle: { font: 'DejaVuSans', fontSize: 8 }, content: [
    { text: `Табель: ${report.employee.name}`, fontSize: 15, bold: true }, { text: `${date(report.from)} — ${date(report.to)}`, margin: [0, 8, 0, 12] },
    { table: { headerRows: 1, body: [headers, ...rows(report).map(row => row.map(v => typeof v === 'number' ? v.toFixed(2) : v))] }, layout: 'lightHorizontalLines' },
    { text: `Начислено: ${(report.totals.amountKopecks / 100).toFixed(2)} ₽. Оплачено: ${(report.totals.paidKopecks / 100).toFixed(2)} ₽.`, margin: [0, 12, 0, 0] }, ...report.issues.map(text => ({ text })) ] };
  return Buffer.from(await pdfMake.createPdf(doc).getBuffer());
}
