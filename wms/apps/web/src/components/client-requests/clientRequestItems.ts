export type ClientRequestDraftItem = {
  skuId: string;
  internalSku: string;
  clientSku: string;
  article: string;
  color: string;
  size: string;
  name: string;
  barcode: string;
  quantity: string;
  comment: string;
};

export const MAX_CLIENT_REQUEST_ITEMS = 100;

export function emptyClientRequestItem(): ClientRequestDraftItem {
  return {
    skuId: '',
    internalSku: '',
    clientSku: '',
    article: '',
    color: '',
    size: '',
    name: '',
    barcode: '',
    quantity: '1',
    comment: '',
  };
}

export function normalizeClientRequestItems(items: ClientRequestDraftItem[]) {
  return items
    .map((item) => ({
      skuId: item.skuId.trim(),
      name: item.name.trim(),
      barcode: item.barcode.trim(),
      quantity: Number(item.quantity),
      comment: item.comment.trim(),
    }))
    .filter((item) => item.name || item.barcode || item.comment)
    .map((item) => ({
      skuId: item.skuId || undefined,
      name: item.name || undefined,
      barcode: item.barcode || undefined,
      quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 1,
      comment: item.comment || undefined,
    }));
}

export function parseClientRequestItemsText(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > MAX_CLIENT_REQUEST_ITEMS) {
    throw new Error(`Можно вставить не больше ${MAX_CLIENT_REQUEST_ITEMS} позиций.`);
  }

  // Русский комментарий: поддерживаем копирование из Excel/таблиц: штрихкод; товар; количество; комментарий.
  return lines.map((line) => {
    const parts = splitLine(line);
    const [barcode = '', name = '', quantity = '1', comment = ''] = parts;

    return {
      skuId: '',
      internalSku: '',
      clientSku: '',
      article: '',
      color: '',
      size: '',
      barcode: barcode.trim(),
      name: name.trim(),
      quantity: normalizeQuantity(quantity),
      comment: comment.trim(),
    };
  });
}

function splitLine(line: string) {
  if (line.includes('\t')) {
    return line.split('\t');
  }

  if (line.includes(';')) {
    return line.split(';');
  }

  return line.split(',');
}

function normalizeQuantity(value: string) {
  const normalized = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return '1';
  }

  return String(Math.floor(normalized));
}
