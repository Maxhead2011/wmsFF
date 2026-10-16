type ReceiptBarcodeRow = {
  id: string; clientId: string; boxId: string | null; sourceDocument: string | null;
  idempotencyKey: string | null;
  sku: { barcodes: { value: string; isPrimary: boolean }[] };
};

// FIX: preserve the historical label scan; never substitute the GTIN from a KIZ.
export async function receiptExportBarcodes(db: any, rows: ReceiptBarcodeRow[], boxes: Map<string, string>) {
  const keys = [...new Set(rows.map(r => r.idempotencyKey).filter((v): v is string => Boolean(v)))];
  const operations = new Map<string, any>();
  for (let offset = 0; offset < keys.length; offset += 500) {
    const batch = await db.tsdOperation.findMany({
      where: { operationKey: { in: keys.slice(offset, offset + 500) }, operationType: 'receipt_scan', status: 'ACCEPTED' },
      select: { operationKey: true, payload: true },
    });
    for (const operation of batch) operations.set(operation.operationKey, operation.payload);
  }
  return new Map(rows.map(row => {
    const scan = row.idempotencyKey ? operations.get(row.idempotencyKey) : null;
    const matches = scan && scan.clientId === row.clientId && scan.boxCode === boxes.get(row.boxId ?? '')
      && scan.sourceDocument === row.sourceDocument;
    if (matches && typeof scan.barcode === 'string' && scan.barcode.trim()) return [row.id, scan.barcode.trim()];
    const primary = row.sku.barcodes.filter(b => b.isPrimary);
    const fallback = primary.length === 1 ? primary[0].value : row.sku.barcodes.length === 1 ? row.sku.barcodes[0].value : '';
    return [row.id, fallback];
  }));
}
