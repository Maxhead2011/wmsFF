import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { LamodaApiError, type LamodaResource } from './lamoda-client';

export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f]/.test(value)) {
    throw new BadRequestException(`Заполните поле «${label}» (до ${max} символов).`);
  }
  return value.trim();
}
function optional(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 2000 ? value : null;
}
export function productSnapshot(row: Record<string, unknown>) {
  if (typeof row.sku !== 'string' || !row.sku.trim()) throw new LamodaApiError('CATALOG_SKU_MISSING');
  return {
    remoteSku: row.sku, externalSku: optional(row.externalSku), barcode: optional(row.barcode),
    size: optional(row.externalSize), name: optional(row.name) ?? row.sku,
  };
}

// FIX: explicit allowlist keeps recipient data and arbitrary API payloads out of storage.
export function documentSnapshot(kind: Exclude<LamodaResource, 'CATALOG'>, row: Record<string, unknown>) {
  const id = kind === 'FBS_SHIPMENTS' ? row.shipmentId : row.id;
  if (typeof id !== 'string' || !id) throw new LamodaApiError('DOCUMENT_ID_MISSING');
  const payload: Record<string, string | number | null> = {};
  for (const key of ['createdAt', 'updatedAt', 'plannedDate', 'returnDate', 'sku', 'externalSku', 'itemId', 'boxId', 'baseWarehouse']) {
    payload[key] = optional(row[key]);
  }
  const delivery = row.deliveryMethod;
  if (delivery && typeof delivery === 'object' && !Array.isArray(delivery)) payload.cutOff = optional((delivery as Record<string, unknown>).cutOff);
  for (const key of ['palletsQuantity', 'packQuantity', 'itemsQuantity']) {
    if (Number.isSafeInteger(row[key]) && Number(row[key]) >= 0) payload[key] = Number(row[key]);
  }
  const stats = row.statistics;
  if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
    for (const key of ['plannedItems', 'acceptedItems', 'receivedItems', 'missingItems', 'surplusItems', 'damagedItems']) {
      const value = (stats as Record<string, unknown>)[key];
      if (Number.isSafeInteger(value) && Number(value) >= 0) payload[key] = Number(value);
    }
  }
  return { remoteId: id, number: optional(row.orderId) ?? optional(row.externalShipmentId) ?? id, status: optional(row.status) ?? 'UNKNOWN', payload };
}

export type LamodaPlanLine = { barcode: string; quantity: number; article: string; destination: string };
export function parseLamodaPlan(buffer: Buffer): LamodaPlanLine[] {
  let book: XLSX.WorkBook;
  try { book = XLSX.read(buffer, { type: 'buffer', cellFormula: true, sheetRows: 1002 }); }
  catch { throw new BadRequestException('Не удалось прочитать Excel. Используйте шаблон Lamoda.'); }
  const sheet = book.Sheets['Поставка'] ?? book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new BadRequestException('В файле нет листа поставки.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  const headers = (rows[0] ?? []).map(value => String(value).trim());
  const bi = headers.indexOf('ШК'), qi = headers.indexOf('Количество'), ai = headers.indexOf('Артикул'), di = headers.indexOf('Направление');
  if (bi < 0 || qi < 0 || headers.filter(h => h === 'ШК').length !== 1 || headers.filter(h => h === 'Количество').length !== 1) {
    throw new BadRequestException('Нужны колонки «ШК» и «Количество».');
  }
  const lines: LamodaPlanLine[] = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    if (row.every(v => v === '' || v == null)) continue;
    for (const col of [bi, qi, ai, di].filter(v => v >= 0)) {
      if (sheet[XLSX.utils.encode_cell({ r: index, c: col })]?.f) throw new BadRequestException(`Строка ${index + 1}: замените формулы значениями.`);
    }
    const rawBarcode = row[bi];
    // Numeric Excel cells cannot preserve leading zeroes: reject instead of guessing.
    if (typeof rawBarcode !== 'string' || !/^\d{8,14}$/.test(rawBarcode.trim())) throw new BadRequestException(`Строка ${index + 1}: ШК должен быть текстом из 8–14 цифр.`);
    const quantity = Number(row[qi]);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100_000) throw new BadRequestException(`Строка ${index + 1}: количество должно быть целым числом от 1 до 100000.`);
    lines.push({ barcode: rawBarcode.trim(), quantity, article: ai < 0 ? '' : String(row[ai]).trim().slice(0, 200), destination: di < 0 ? '' : String(row[di]).trim().slice(0, 200) });
  }
  if (!lines.length || lines.length > 1000 || rows.length >= 1002) throw new BadRequestException('В файле должно быть от 1 до 1000 строк.');
  return lines;
}
export function planHash(lines: LamodaPlanLine[], title: string, remoteShipmentId: string | null) {
  return createHash('sha256').update(JSON.stringify([title, remoteShipmentId, lines])).digest('hex');
}
export function templateWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([['ШК', 'Количество', 'Артикул', 'Направление']]);
  for (let r = 1; r <= 1000; r++) sheet[XLSX.utils.encode_cell({ r, c: 0 })] = { t: 's', v: '', z: '@' };
  sheet['!ref'] = 'A1:D1001';
  sheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 25 }, { wch: 35 }];
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Поставка');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Как заполнить'], ['ШК — текст из 8–14 цифр. Сохраните начальные нули.'],
    ['Количество — целое положительное число.'], ['Артикул необязателен. Направление — склад назначения Lamoda.'],
    ['Одна строка — один товар для одного направления.'], ['Импорт создаёт черновик и не резервирует товар.'],
  ]), 'Инструкция');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
