import type { SkuSummary } from './api';

// FIX: product labels use 60 mm width × 40 mm height and the barcode from the client card.
export const PRODUCT_LABEL_TSPL = [
  'SIZE 60 mm,40 mm',
  'GAP 2 mm,0',
  'CLS',
  'TEXT 16,18,"2",0,1,1,"{{clientName}}"',
  'TEXT 16,58,"2",0,1,1,"{{name}}"',
  'TEXT 16,90,"2",0,1,1,"{{article}}"',
  'TEXT 16,122,"2",0,1,1,"{{variant}}"',
  'BARCODE 16,155,"128",88,1,0,1,1,"{{barcode}}"',
  'TEXT 16,265,"2",0,1,1,"{{barcode}}"',
  'PRINT 1',
].join('\n');

export type ProductLabelTemplate = 'standard' | 'lukin' | 'wb-compact';

const LUKIN_TSPL = [
  'SIZE 60 mm,40 mm', 'GAP 2 mm,0', 'CLS',
  'BARCODE 16,12,"128",105,0,0,2,2,"{{barcode}}"',
  'TEXT 348,24,"5",0,3,3,"EAC"',
  'TEXT 90,122,"2",0,1,1,"{{barcode}}"',
  'BLOCK 16,151,448,36,"0",0,25,25,0,0,1,"{{name}}"',
  'BLOCK 16,188,448,30,"0",0,22,22,0,0,1,"{{secondLine}}"',
  'TEXT 16,220,"2",0,1,1,"{{wbArticleLine}}"',
  'TEXT 16,243,"2",0,1,1,"{{colorLine}}"',
  'TEXT 16,266,"2",0,1,1,"{{sizeLine}}"',
  'TEXT 16,283,"2",0,1,1,"{{brandLine}}"',
  'TEXT 252,283,"2",0,1,1,"{{clientShort}}"',
  'TEXT 378,303,"1",0,1,1,"{{date}}"',
  'PRINT 1',
].join('\n');

const COMPACT_TSPL = [
  'SIZE 40 mm,30 mm', 'GAP 2 mm,0', 'CLS',
  'BARCODE 12,10,"128",69,0,0,1,1,"{{barcode}}"',
  'TEXT 63,80,"2",0,1,1,"{{barcode}}"',
  'TEXT 12,107,"2",0,1,1,"{{clientShort}}"',
  'BLOCK 12,130,296,32,"0",0,20,20,0,0,1,"{{name}}"',
  'TEXT 12,165,"1",0,1,1,"{{brand}}"',
  'TEXT 12,184,"1",0,1,1,"{{color}}"',
  'TEXT 12,203,"1",0,1,1,"{{size}}"',
  'TEXT 12,221,"1",0,1,1,"{{article}}"',
  'PRINT 1',
].join('\n');

// FIX: the operator chooses the physical stock and layout for each print run.
export function productLabelTemplate(kind: ProductLabelTemplate) {
  if (kind === 'lukin') return { widthMm: 60 as const, heightMm: 40 as const, name: 'По образцу Лукина · 60 × 40', tspl: LUKIN_TSPL };
  if (kind === 'wb-compact') return { widthMm: 40 as const, heightMm: 30 as const, name: 'WB компактная · 40 × 30', tspl: COMPACT_TSPL };
  return { widthMm: 60 as const, heightMm: 40 as const, name: 'Обычная · 60 × 40', tspl: PRODUCT_LABEL_TSPL };
}

export function productMarketplaceVariables(sku: SkuSummary, clientName: string, chosenBarcode?: string) {
  const standard = productLabelVariables(sku, clientName, chosenBarcode);
  const fullName = sku.name.trim();
  const shortName = clientName.includes('Лукин') ? 'Лукин И.И.' : clientName.includes('Трофимова') ? 'ИП Трофимова Т. А.' : clientName.trim();
  const wbArticle = /^\d+/.exec(sku.marketplaceProductId ?? '')?.[0] || sku.article || sku.clientSku || sku.internalSku;
  const brand = sku.brand === 'LOOK.IN' ? 'LOOK (IN)' : sku.brand || '';
  return {
    ...standard,
    clientShort: shortName,
    name: fullName,
    secondLine: sku.article || '',
    wbArticle,
    article: sku.article || sku.clientSku || sku.internalSku,
    color: sku.color || '',
    size: sku.size || '',
    brand,
    brandLine: brand ? `Бренд: ${brand}` : '',
    colorLine: sku.color ? `Цвет: ${sku.color}` : '',
    sizeLine: sku.size ? `Размер: ${sku.size}` : '',
    wbArticleLine: wbArticle ? `Артикул: ${wbArticle}` : '',
    date: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()),
  };
}

export function productLabelVariables(sku: SkuSummary, clientName: string, chosenBarcode?: string) {
  if (chosenBarcode && !sku.barcodes.some(item => item.value === chosenBarcode)) throw new Error('Выбранный штрихкод не принадлежит карточке товара.');
  const barcode = chosenBarcode || sku.barcodes.find(item => item.isPrimary)?.value?.trim() || sku.barcodes[0]?.value?.trim();
  if (!barcode) throw new Error(`У товара «${sku.name}» нет штрихкода в карточке.`);
  if (barcode.length > 24) throw new Error(`Штрихкод товара «${sku.name}» не помещается на этикетке 60 × 40 мм.`);
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
