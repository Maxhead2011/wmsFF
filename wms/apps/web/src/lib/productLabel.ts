import type { SkuSummary } from './api';

// FIX: product labels use the agreed 40 × 60 mm stock and the barcode from the client card.
export const PRODUCT_LABEL_TSPL = [
  'SIZE 40 mm,60 mm',
  'GAP 2 mm,0',
  'CLS',
  'TEXT 16,18,"2",0,1,1,"{{clientName}}"',
  'TEXT 16,58,"2",0,1,1,"{{name}}"',
  'TEXT 16,90,"2",0,1,1,"{{article}}"',
  'TEXT 16,122,"2",0,1,1,"{{variant}}"',
  'BARCODE 16,175,"128",88,1,0,1,1,"{{barcode}}"',
  'TEXT 16,280,"2",0,1,1,"{{barcode}}"',
  'PRINT 1',
].join('\n');

export function productLabelVariables(sku: SkuSummary, clientName: string, chosenBarcode?: string) {
  if (chosenBarcode && !sku.barcodes.some(item => item.value === chosenBarcode)) throw new Error('Выбранный штрихкод не принадлежит карточке товара.');
  const barcode = chosenBarcode || sku.barcodes.find(item => item.isPrimary)?.value?.trim() || sku.barcodes[0]?.value?.trim();
  if (!barcode) throw new Error(`У товара «${sku.name}» нет штрихкода в карточке.`);
  if (barcode.length > 24) throw new Error(`Штрихкод товара «${sku.name}» не помещается на этикетке 40 × 60 мм.`);
  return {
    clientName: clientName.slice(0, 24), name: sku.name.slice(0, 24),
    article: (sku.article || sku.clientSku || sku.internalSku).slice(0, 24),
    variant: [sku.color, sku.size].filter(Boolean).join(' / ').slice(0, 24), barcode,
  };
}

export function productLabelCopies(value: string) {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 100 || !Number.isSafeInteger(Number(value))) {
    throw new Error('Количество этикеток для каждого товара — от 1 до 100.');
  }
  return Number(value);
}

// FIX: each selected SKU carries its own validated print quantity.
export function productLabelBatch(skus: SkuSummary[], clientName: string, quantities: Record<string, string>, barcodes: Record<string, string>) {
  return skus.map(sku => ({ skuId: sku.id, variables: productLabelVariables(sku, clientName, barcodes[sku.id]), copies: productLabelCopies(quantities[sku.id] ?? '1') }));
}
