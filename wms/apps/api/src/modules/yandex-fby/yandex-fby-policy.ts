import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type FbyLine = { barcode: string; quantity: number };
// FIX: cabinet numbers and API IDs are distinct namespaces. Never guess one from the other.
export function supplyReference(input: string): string {
  const value = String(input ?? '').trim();
  if (/^[\w-]{1,100}$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new BadRequestException('Введите номер поставки или ссылку из кабинета Яндекса.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'partner.market.yandex.ru' || url.username || url.password)
    throw new BadRequestException('Нужна ссылка из кабинета Яндекс Маркета.');
  const candidate = url.searchParams.get('requestId') ?? url.searchParams.get('supplyId') ??
    url.pathname.match(/\/(?:supply|supplies|supply-requests|requests)\/([\w-]+)\/?$/)?.[1];
  if (!candidate || !/^[\w-]{1,100}$/.test(candidate)) throw new BadRequestException('Не удалось определить номер поставки. Введите его отдельно.');
  return candidate;
}

// FIX: reject incomplete or fractional demand before reserving any stock.
export function normalizeFbyLines(input: unknown): FbyLine[] {
  if (!Array.isArray(input) || !input.length || input.length > 1000) throw new BadRequestException('Нужно от 1 до 1000 строк товара.');
  const grouped = new Map<string, number>();
  for (const row of input) {
    if (!row || typeof row !== 'object') throw new BadRequestException('Некорректная строка товара.');
    const barcode = typeof row.barcode === 'string' ? row.barcode.trim() : '';
    if (!barcode || barcode.length > 150 || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 1_000_000)
      throw new BadRequestException('Укажите ШК и целое положительное количество.');
    const quantity = (grouped.get(barcode) ?? 0) + row.quantity;
    if (quantity > 1_000_000) throw new BadRequestException('Слишком большое количество одного товара.');
    grouped.set(barcode, quantity);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([barcode, quantity]) => ({ barcode, quantity }));
}

export function fbyCompositionHash(lines: Array<{ skuId: string; quantity: number }>) {
  const totals = new Map<string, number>();
  for (const row of lines) totals.set(row.skuId, (totals.get(row.skuId) ?? 0) + row.quantity);
  return createHash('sha256').update(JSON.stringify([...totals].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}

export function assertFbySupply(row: { type?: string; subtype?: string; status?: string }) {
  if (row.type !== 'SUPPLY' || !['DEFAULT', 'XDOC', 'VIRTUAL_DISTRIBUTION_CENTER_CHILD'].includes(row.subtype ?? ''))
    throw new BadRequestException('Нужна отдельная поставка на склад, а не вывоз, утилизация или общая мультипоставка.');
  if (!['CREATED', 'VALIDATED', 'PUBLISHED', 'ACCEPTED_BY_WAREHOUSE_SYSTEM', 'NEED_PREPARATION', 'CANCELLATION_REJECTED'].includes(row.status ?? ''))
    throw new BadRequestException('Поставка не доступна для начала сборки. Проверьте её статус в Яндексе.');
}
