import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { documentSnapshot, parseLamodaPlan, planHash, productSnapshot, templateWorkbook } from '../src/modules/lamoda/lamoda-policy';
function file(rows: unknown[][], formula = false) {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(rows);
  if (formula) sheet.B2.f = '1+1';
  XLSX.utils.book_append_sheet(book, sheet, 'Поставка');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
// TEST: Excel and remote data must not silently change product identity or physical stock.
describe('Lamoda plan and snapshot policy', () => {
  it('preserves leading zeroes and separates identical goods by destination', () => {
    const lines = parseLamodaPlan(file([['ШК', 'Количество', 'Направление'], ['0012345678901', 2, 'A'], ['0012345678901', 3, 'B']]));
    expect(lines.map(l => [l.barcode, l.quantity, l.destination])).toEqual([['0012345678901', 2, 'A'], ['0012345678901', 3, 'B']]);
    expect(planHash(lines, 'test', null)).toBe(planHash(lines, 'test', null));
    expect(planHash(lines, 'test', 'shipment')).not.toBe(planHash(lines, 'test', null));
  });
  it.each([0, -1, 1.5, 100001, 'x', ''])('rejects invalid quantity %s', quantity => {
    expect(() => parseLamodaPlan(file([['ШК', 'Количество'], ['0012345678901', quantity]]))).toThrow('количество');
  });
  it('rejects formulas, missing headers and numeric barcodes', () => {
    expect(() => parseLamodaPlan(file([['ШК', 'Количество'], ['0012345678901', 2]], true))).toThrow('формулы');
    expect(() => parseLamodaPlan(file([['SKU', 'Количество'], ['a', 2]]))).toThrow('колонки');
    expect(() => parseLamodaPlan(file([['ШК', 'Количество'], [1234567890123, 2]]))).toThrow('текстом');
  });
  it('provides a downloadable blank template with text-formatted barcodes', () => {
    const book = XLSX.read(templateWorkbook(), { type: 'buffer', cellNF: true });
    expect(book.Sheets['Поставка'].A2.z).toBe('@');
    expect(book.SheetNames).toContain('Инструкция');
    expect(() => parseLamodaPlan(templateWorkbook())).toThrow('от 1 до 1000');
  });
  it('rejects oversized plans instead of importing a truncated prefix', () => {
    expect(() => parseLamodaPlan(file([['ШК', 'Количество'], ...Array.from({ length: 1001 }, () => ['1234567890123', 1])]))).toThrow('1000');
  });
  it('discards remote quantity and customer data', () => {
    expect(productSnapshot({ sku: 'LM1', barcode: '0012345678901', quantity: 900, name: 'Товар' })).not.toHaveProperty('quantity');
    const snapshot = documentSnapshot('ORDERS', { id: 'internal-id', orderId: 'public-id', status: 'CONFIRMED', recipient: { phone: 'secret' }, comment: 'private', deliveryMethod: { cutOff: '2026-10-26T10:00:00Z', address: 'private' } });
    expect(snapshot.remoteId).toBe('internal-id'); expect(snapshot.number).toBe('public-id');
    expect(JSON.stringify(snapshot)).not.toContain('private'); expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(snapshot.payload.cutOff).toBe('2026-10-26T10:00:00Z');
  });
  it('keeps received and accepted FBO quantities separate and uses FBS shipmentId', () => {
    expect(documentSnapshot('FBO_SHIPMENTS', { id: 'LM', statistics: { receivedItems: 10, acceptedItems: 8 } }).payload).toMatchObject({ receivedItems: 10, acceptedItems: 8 });
    expect(documentSnapshot('FBS_SHIPMENTS', { shipmentId: 'F301', itemsQuantity: 2 }).remoteId).toBe('F301');
    expect(() => productSnapshot({ sku: null })).toThrow('CATALOG_SKU_MISSING');
  });
});
