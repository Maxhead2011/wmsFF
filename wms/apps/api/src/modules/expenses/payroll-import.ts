import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const text = (v: unknown) => String(v ?? '').trim();
export type HistoricalPayrollRow = { key: string; sheet: string; row: number; name: string; date: string; start: number; end: number; lunch: number; paidTime: number; rate: number; amountKopecks: number; phone: string; bank: string; status: string };

// FIX: import historical results verbatim; never apply the new lunch rule retroactively.
export function previewPayrollWorkbook(buffer: Buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const rows: HistoricalPayrollRow[] = [], issues: string[] = [], counts = new Map<string, number>();
  for (const sheet of book.SheetNames) {
    const cells = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, raw: true, defval: null });
    const header = cells.findIndex(r => text(r[0]) === 'Дата' && text(r[1]) === 'ФИО');
    if (header < 0) continue;
    for (let i = header + 1; i < cells.length; i++) {
      const r = cells[i];
      if (!text(r[0]) && !text(r[1])) continue;
      const stamp = typeof r[0] === 'number' ? XLSX.SSF.parse_date_code(r[0]) : null;
      if (!stamp || !text(r[1])) { issues.push(`${sheet}, строка ${i + 1}: проверьте дату и имя`); continue; }
      const date = `${stamp.y}-${String(stamp.m).padStart(2, '0')}-${String(stamp.d).padStart(2, '0')}`;
      if (![r[2], r[3], r[4], r[5], r[6], r[7]].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        issues.push(`${sheet}, строка ${i + 1}: отсутствует числовое значение времени, ставки или суммы; пересохраните рассчитанный файл`); continue;
      }
      const statusText = text(r[10]).toLowerCase();
      const status = statusText === 'оплачен' || statusText === 'оплачено' ? 'PAID' : ['не оплачен', 'не оплачено', 'ожидает'].includes(statusText) ? 'UNPAID' : 'REVIEW';
      const data = { sheet, row: i + 1, name: text(r[1]), date, start: r[2] as number, end: r[3] as number, lunch: r[4] as number,
        paidTime: r[5] as number, rate: r[6] as number, amountKopecks: Math.round(Number(r[7]) * 100), phone: text(r[8]), bank: text(r[9]), status };
      const identity = hash(JSON.stringify([data.name.toLowerCase(), date, data.start, data.end]));
      const occurrence = (counts.get(identity) ?? 0) + 1; counts.set(identity, occurrence);
      rows.push({ key: `${identity}:${occurrence}`, ...data });
    }
  }
  return { sourceHash: hash(buffer), rows, issues, employees: [...new Set(rows.map(r => r.name))].sort(), totalKopecks: rows.reduce((s, r) => s + r.amountKopecks, 0) };
}
