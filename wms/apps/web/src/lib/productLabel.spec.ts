import { describe, expect, it } from 'vitest';
import { PRODUCT_LABEL_TSPL, productLabelBatch, productLabelCopies, productLabelVariables, productLabelTemplate, productMarketplaceVariables } from './productLabel';

// TEST: synced marketplace card barcode is used on the agreed 60 × 40 landscape label.
describe('product label', () => {
  const sku = { name: 'Костюм спорт синий', article: 'Костюм_спорт_синий', internalSku: 'SKU-1', color: 'синий', size: '44', barcodes: [{ value: '2041234567890', isPrimary: true }] };
  it('uses the marketplace barcode and card fields', () => {
    expect(productLabelVariables(sku as never, 'ИП Лукин')).toMatchObject({ barcode: '2041234567890', article: 'Костюм_спорт_синий', variant: 'синий / 44' });
    expect(PRODUCT_LABEL_TSPL).toContain('SIZE 60 mm,40 mm');
  });
  it('rejects missing or oversized barcodes', () => {
    expect(() => productLabelVariables({ ...sku, barcodes: [] } as never, 'ИП Лукин')).toThrow('нет штрихкода');
    expect(() => productLabelVariables({ ...sku, barcodes: [{ value: 'X'.repeat(25), isPrimary: true }] } as never, 'ИП Лукин')).toThrow('не помещается');
  });
  it('uses an explicitly selected marketplace barcode only if it belongs to the card', () => {
    const withSecond = { ...sku, barcodes: [...sku.barcodes, { value: '2049876543210', isPrimary: false }] };
    expect(productLabelVariables(withSecond as never, 'ИП Лукин', '2049876543210').barcode).toBe('2049876543210');
    expect(() => productLabelVariables(withSecond as never, 'ИП Лукин', 'WRONG')).toThrow('не принадлежит');
  });
  it('validates copy count before queueing', () => {
    expect(productLabelCopies('2')).toBe(2);
    for (const invalid of ['0', '101', '1.5', '']) expect(() => productLabelCopies(invalid)).toThrow();
  });
  it('keeps a separate quantity for each selected item', () => {
    const second = { ...sku, id: 'sku-2', name: 'Костюм серый' };
    const batch = productLabelBatch([{ ...sku, id: 'sku-1' }, second] as never, 'ИП Лукин', { 'sku-1': '2', 'sku-2': '5' }, {});
    expect(batch.map(item => item.copies)).toEqual([2, 5]);
    expect(() => productLabelBatch([second] as never, 'ИП Лукин', { 'sku-2': '0' }, {})).toThrow();
  });
});

describe('selectable marketplace label templates', () => {
  const sku = { name: 'Костюм летний брючный оверсайз', article: 'Костюм_сантален_черный', internalSku: 'SKU-1', color: 'черный', size: 'XXS', brand: 'LOOK.IN', marketplaceProductId: '379327330:552071802', barcodes: [{ value: '2043472945040', isPrimary: true }] };
  it('uses synced WB card fields on the Lukin NiceLabel layout', () => {
    // TEST: the WB nmID and brand must be printed, not a truncated internal article.
    const variables = productMarketplaceVariables(sku as never, 'ИП Лукин Илья Ильич');
    expect(variables).toMatchObject({ barcode: '2043472945040', wbArticle: '379327330', brand: 'LOOK (IN)', clientShort: 'Лукин И.И.' });
    expect(productLabelTemplate('lukin').tspl).toContain('SIZE 60 mm,40 mm');
    expect(productLabelTemplate('lukin').tspl).toContain('EAC');
  });
  it('offers compact WB stock for Trofimova without EAC', () => {
    const template = productLabelTemplate('wb-compact');
    expect(template.widthMm).toBe(40);
    expect(template.heightMm).toBe(30);
    expect(template.tspl).not.toContain('EAC');
  });
  it('leaves absent marketplace fields entirely blank', () => {
    // TEST: an unavailable brand, color or size must not leave a dangling caption.
    const vars = productMarketplaceVariables({ ...sku, brand: '', color: '', size: '' } as never, 'ИП Лукин Илья Ильич');
    expect(vars).toMatchObject({ brandLine: '', colorLine: '', sizeLine: '' });
    expect(productLabelTemplate('lukin').tspl).toContain('{{brandLine}}');
  });
});
