import { ConflictException } from '@nestjs/common';
import { assignFabricOrder } from '../warehouse/fabric-fbs-assignment';
import { FABRIC_TASK_MARKER } from '../warehouse/fabric-fbs-task-state';
import { identifyFabricSku } from '../warehouse/fabric-fbs-availability';
import { ozonLinkedSkus } from './marketplace-product-links';
import { ozonPostingProducts, resolveOzonLineSku, readOzonPickState, writeOzonPickState, OzonPickState, ozonPickLinesEnabled } from './ozon-fbs-pick-lines';

// FIX: resolve the entire posting before starting a DB transaction. Raw metres
// are never represented as AVAILABLE finished goods, even for queue previews.
export async function tryAssignFabricTask(service: any, clientId: string, order: any, existing: any, user: any, deviceCode: string) {
  if (process.env.WMS_FBS_FABRIC_CUT_ENABLED !== 'true') return { handled: false };
  const enabled = await service.prisma.systemSetting.findUnique({ where: { key: `fabric.fbs.enabled.v1:${clientId}` } });
  if (enabled?.value?.enabled !== true) return { handled: false };
  const catalog = await service.prisma.sku.findMany({ where: { clientId }, include: { barcodes: true } });
  let rows: Array<{ sku: any; quantity: number; productId: number; offerId: string }>;
  if (order.marketplace === 'OZON') {
    const posting = await service.readOzonFbsPickPosting({ clientId, connectionId: order.connectionId, orderId: order.id });
    const linked = await ozonLinkedSkus(service.prisma, clientId, order.connectionId, catalog);
    const products = ozonPostingProducts(posting);
    // FIX: opting into fabric must not apply fabric restrictions to ordinary orders.
    const containsFabric = products.some(p => linked.some((sku:any) => identifyFabricSku(sku) && (
      String(sku.marketplaceProductId ?? '').split(':').some(id => id === p.offerId || id === String(p.productId)) ||
      sku.marketplaceOfferId === p.offerId || (sku.barcodes ?? []).some((b:any) => p.barcodes.includes(b.value))
    )));
    if (!containsFabric) return { handled: false };
    if (!ozonPickLinesEnabled()) throw new ConflictException('Для нарезки Ozon требуется поштучный учёт состава заказа.');
    rows = products.map(p => ({ ...p, sku: resolveOzonLineSku(p, linked) }));
    if (!rows.some(r => identifyFabricSku(r.sku))) return { handled: false };
    if (posting.status !== 'awaiting_packaging' || posting.requirements?.products_requiring_mandatory_mark?.length)
      throw new ConflictException('Заказ Ozon изменился или требует маркировки. Проверьте состав перед нарезкой.');
  } else {
    const sku = catalog.find((s: any) => s.id === order.product?.id);
    if (!sku || !identifyFabricSku(sku)) return { handled: false };
    rows = [{ sku, quantity: order.itemCount, productId: 0, offerId: '' }];
  }
  if (user.tsdFabricCutConfirmation !== true) throw new ConflictException('Для сборки из рулонов обновите приложение ТСД.');
  if (rows.some(r => !Number.isSafeInteger(r.quantity) || r.quantity < 1 || !r.sku.barcodes?.length ||
      (r.sku.needsChestnyZnak && !r.sku.isUnmarked) || r.sku.needsRelabel) ||
      (order.requiredMeta ?? []).some((m: string) => m.toLowerCase() === 'sgtin'))
    throw new ConflictException('Для нарезки проверьте количество, ШК и требования маркировки всех позиций.');
  if (new Set(rows.map(r => r.sku.id)).size !== rows.length || rows[0].sku.id !== order.product.id ||
      rows.reduce((n,r) => n+r.quantity,0) !== order.itemCount)
    throw new ConflictException('Состав заказа отличается от заявки. Обновите заявку перед нарезкой.');
  // FIX: auto-reservation waits for finished stock; raw-roll assignment can satisfy it.
  if (existing && !['RESERVED', 'RELEASED', 'WAITING_STOCK'].includes(existing.status)) return { handled: true };
  // Existing physical evidence must not be erased by reassignment.
  if (existing && (existing.marketplaceSubmittedAt || (existing.sourceArticle !== FABRIC_TASK_MARKER &&
      (existing.barcode || existing.kiz || existing.sourceBarcode || existing.relabelConfirmedAt))))
    throw new ConflictException('В заказе уже есть физические действия. Требуется продолжение прежнего задания.');
  const task = await service.prisma.$transaction(async (tx: any) => {
    const requestId = order.request.id;
    await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${requestId} FOR UPDATE`;
    const request = await tx.clientRequest.findUnique({ where: { id: requestId } });
    if (!request || request.clientId !== clientId || !request.warehouseId || request.warehouseId !== user.activeWarehouseId ||
        ['DONE','CANCELLED','REJECTED'].includes(request.status)) throw new ConflictException('Выберите филиал открытой заявки.');
    const saved = existing && order.marketplace === 'OZON' ? await readOzonPickState(tx, existing.id) : null;
    if (saved && (saved.submission !== 'PICKING' || (existing.sourceArticle !== FABRIC_TASK_MARKER && saved.lines.some(l => l.picks.length)) || saved.lines.length !== rows.length ||
        saved.lines.some(l => !rows.some(r => r.sku.id === l.skuId && r.quantity === l.quantity && r.productId === l.productId && r.offerId === l.offerId))))
      throw new ConflictException('Состав или сканы ранее начатого заказа изменились. Нужна сверка.');
    const items: any[] = [];
    for (const [index,row] of rows.entries()) {
      const found = await tx.clientRequestItem.findFirst({ where: { requestId, skuId: row.sku.id } });
      // Match the existing Ozon initialization: replace this order's historical
      // contribution to the first SKU once, retaining other orders in the request.
      if (!saved && order.marketplace === 'OZON' && rows.length > 1) {
        if (index === 0) {
          if (!found || found.quantity < order.itemCount) throw new ConflictException('Количество первой позиции изменилось. Нужна сверка.');
          items.push(await tx.clientRequestItem.update({ where:{id:found.id}, data:{quantity:{decrement:order.itemCount-row.quantity}} }));
        } else if (found) items.push(await tx.clientRequestItem.update({where:{id:found.id},data:{quantity:{increment:row.quantity}}}));
        else items.push(await tx.clientRequestItem.create({data:{requestId,skuId:row.sku.id,name:row.sku.name,barcode:row.sku.barcodes[0].value,quantity:row.quantity}}));
      } else {
        if (!found || found.quantity < row.quantity) throw new ConflictException('Позиция не соответствует заявке.');
        items.push(found);
      }
    }
    const owner = { marketplace: order.marketplace, connectionId: order.connectionId, orderId: order.id, requestId };
    const lines = rows.flatMap((row,index) => {
      const identity = identifyFabricSku(row.sku);
      return identity ? [{...identity,lineId:items[index].id,warehouseId:request.warehouseId,units:row.quantity}] : [];
    });
    return assignFabricOrder(tx, { clientId, owner, lines, capability: true }, async () => {
      const first = rows[0].sku;
      const data = { clientId, ...owner, supplyId:order.supplyId, requestItemId:items[0].id,skuId:first.id,
        productName:first.name,article:first.article || first.clientSku || first.internalSku,
        barcodes:first.barcodes.map((b:any)=>b.value),sourceBarcodes:[],storageBoxes:[],itemCount:order.itemCount,
        requiresKiz:false,relabelRequired:false,status:'IN_PROGRESS',deviceCode,workerUserId:user.id,workerName:user.name,
        startedAt:new Date(),boxId:null,boxCode:order.marketplace === 'OZON' ? null : 'БЕЗ КОРОБА',
        // This marks a reserved production task as non-empty for legacy lease recovery.
        sourceBoxPending:order.marketplace === 'OZON',sourceArticle:FABRIC_TASK_MARKER,sourceSkuId:null,sourceBarcode:null,barcode:null,kiz:null,
        reservedBoxId:null,reservedBoxCode:null,reservedAt:null,wbMetaStatus:'NOT_REQUIRED',errorMessage:null };
      let claimed;
      if (existing) {
        const assignmentData = existing.sourceArticle === FABRIC_TASK_MARKER
          ? {status:'IN_PROGRESS',deviceCode,workerUserId:user.id,workerName:user.name,errorMessage:null}
          : data;
        const changed = await tx.fbsTsdAssembly.updateMany({where:{id:existing.id,status:existing.status,updatedAt:existing.updatedAt},data:assignmentData});
        if (changed.count !== 1) throw new ConflictException('Заказ уже взят другим сотрудником. Обновите очередь.');
        claimed = await tx.fbsTsdAssembly.findUnique({where:{id:existing.id}});
      } else claimed = await tx.fbsTsdAssembly.create({data});
      if (order.marketplace === 'OZON' && !saved) {
        const state: OzonPickState = {version:1,source:null,submission:'PICKING',legacyScansDiscarded:false,
          lines:rows.map((row,index)=>({productId:row.productId,offerId:row.offerId,quantity:row.quantity,skuId:row.sku.id,
            requestItemId:items[index].id,name:row.sku.name,article:row.sku.article || row.sku.internalSku,
            barcodes:row.sku.barcodes.map((b:any)=>b.value),picks:[]}))};
        await writeOzonPickState(tx,claimed.id,state);
      }
      await tx.clientRequestEvent.create({data:{requestId,clientId,eventType:'COMMENT',createdByUserId:user.id,
        title:'Зарезервирована ткань для ФБС',body:JSON.stringify({taskId:claimed.id,...owner,lines})}});
      return claimed;
    });
  });
  return { handled:true,task };
}
export async function assignFabricTaskForQueue(...args: Parameters<typeof tryAssignFabricTask>): Promise<{handled:boolean;task?:any;blockedReason?:string}> {
  // FIX: business conflicts must reach the picker instead of the marketplace fallback.
  try { return await tryAssignFabricTask(...args); }
  catch (error) {
    if (error instanceof ConflictException) return {handled:true,blockedReason:error.message};
    throw error;
  }
}
