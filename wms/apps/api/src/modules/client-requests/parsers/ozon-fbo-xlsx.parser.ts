import type { SheetMatrix } from './outbound-request-xlsx.parser';

export type OzonImportLine = { direction: string; barcode: string; article: string; quantity: number; row: number };
// FIX: a customer allocation is authoritative; blank direction cells inherit only within a group.
export function parseOzonFboRows(rows: SheetMatrix) {
  const text = (v: unknown) => String(v ?? '').trim();
  const header = rows.findIndex(r => r.some(c => text(c).toLowerCase() === 'склад хранения') && r.some(c => text(c).toLowerCase() === 'шк'));
  if (header < 0) throw new Error('Нужны колонки «Склад хранения», «Артикул», «ШК», «Поставка, шт».');
  const cols = rows[header].map(c => text(c).toLowerCase());
  const dc = cols.indexOf('склад хранения'), bc = cols.indexOf('шк'), ac = cols.indexOf('артикул');
  const qc = cols.findIndex(c => /^поставка.*шт/.test(c));
  if (qc < 0 || ac < 0) throw new Error('Не найдены артикул или количество поставки.');
  const lines: OzonImportLine[] = [];
  let direction = '';
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some(c => text(c))) continue;
    const label = text(r[dc]), barcode = text(r[bc]), article = text(r[ac]);
    if (!barcode && !article && /итог|всего/i.test(label)) { direction = ''; continue; }
    if (label) direction = label;
    const quantity = Number(text(r[qc]).replace(/\s/g, '').replace(',', '.'));
    if (!direction || !/^\d{8,14}$/.test(barcode) || !Number.isSafeInteger(quantity) || quantity <= 0)
      throw new Error(`Строка ${i + 1}: проверьте направление, ШК и целое положительное количество.`);
    lines.push({ direction, barcode, article, quantity, row: i + 1 });
  }
  if (!lines.length || lines.length > 5000) throw new Error('В файле должно быть от 1 до 5000 товарных строк.');
  return lines;
}
