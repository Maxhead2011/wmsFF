import * as XLSX from 'xlsx';

export const receiptKizExportEnabled = () => process.env.WMS_RECEIPT_KIZ_EXPORT_ENABLED === 'true';
export const receiptKizHeaders = ['Дата приёмки (МСК)', 'Документ', 'Короб при приёмке', 'Товар', 'Артикул / SKU клиента', 'Размер', 'ШК товара', 'КИЗ', 'Основание связи', 'Примечание', 'ID движения'];
// FIX: use only movements already authorized by the calling report, never today's box contents.
export async function receiptKizRows(db: any, rows: any[], boxes = new Map<string, string>()): Promise<string[][]> {
  const incoming = rows.filter(r => r.type === 'RECEIPT' && r.quantity > 0);
  const keys = [...new Set(incoming.map(r => r.idempotencyKey).filter(Boolean))];
  const operations = new Map<string, any>();
  for (let offset = 0; offset < keys.length; offset += 500) {
    const batch = await db.tsdOperation.findMany({where:{operationKey:{in:keys.slice(offset,offset+500)},operationType:'receipt_scan',status:'ACCEPTED'},select:{operationKey:true,payload:true}});
    for (const op of batch) operations.set(op.operationKey, op.payload);
  }
  const result: string[][] = [];
  const corrected = new Set(rows.filter(r=>r.type==='INVENTORY_ADJUSTMENT').map(r=>JSON.stringify([r.clientId,r.boxId,r.skuId])));
  for (const row of incoming) {
    const box = boxes.get(row.boxId) ?? row.box?.code ?? '';
    const scan = operations.get(row.idempotencyKey);
    const matches = scan && scan.clientId === row.clientId && (scan.boxCode ?? '') === box
      && (scan.sourceDocument ?? null) === (row.sourceDocument ?? null)
      && (!scan.warehouseId || scan.warehouseId === row.warehouseId)
      && (!scan.skuId || scan.skuId === row.skuId);
    const marks = new Map<string,string>();
    for (const mark of row.productMarks ?? []) {
      if (mark.clientId && mark.clientId !== row.clientId || mark.skuId && mark.skuId !== row.skuId || mark.stockMovementId && mark.stockMovementId !== row.id) continue;
      if (typeof mark.value === 'string' && mark.value) marks.set(mark.value,'Привязка к движению приёмки');
    }
    if (matches && typeof scan.kiz === 'string' && scan.kiz && !marks.has(scan.kiz)) marks.set(scan.kiz,'Принятый скан при приёмке (история)');
    const aliases = row.sku?.barcodes ?? [], primary = aliases.filter((b:any)=>b.isPrimary);
    const barcode = matches && typeof scan.barcode === 'string' ? scan.barcode : primary.length===1 ? primary[0].value : aliases.length===1 ? aliases[0].value : '';
    const note = corrected.has(JSON.stringify([row.clientId,row.boxId,row.skuId])) ? 'Количество корректировалось. Исторические КИЗ не подтверждают состав после корректировки.' : 'Связь на приёмке; текущее местонахождение и статус КИЗ могут отличаться.';
    const base = [new Date(row.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}),row.sourceDocument??'',box,row.sku?.name??'',row.sku?.article??row.sku?.clientSku??'',row.sku?.size??'',barcode];
    if (!marks.size) result.push([...base,'','КИЗ не зафиксирован','Для немаркируемого товара КИЗ не требуется.',row.id]);
    else for (const [value,source] of marks) result.push([...base,value,source,note,row.id]);
  }
  return result;
}
// FIX: add a separate per-unit mapping sheet without changing existing quantities or totals.
export function appendReceiptKizSheet(content: Buffer, rows: string[][]): Buffer {
  const book=XLSX.read(content,{type:'buffer',cellStyles:true});
  const sheet=XLSX.utils.aoa_to_sheet([receiptKizHeaders,...rows]);
  sheet['!cols']=[23,30,26,45,28,14,22,65,42,70,38].map(wch=>({wch}));
  sheet['!autofilter']={ref:`A1:K${Math.max(1,rows.length+1)}`};
  XLSX.utils.book_append_sheet(book,sheet,'КИЗ по товарам');
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
