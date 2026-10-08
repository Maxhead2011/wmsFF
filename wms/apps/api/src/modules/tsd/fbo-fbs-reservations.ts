import { receiptRules, receiptAllows, receiptOrderKey, receiptUnassignedOrders, type ReceiptRule } from '../warehouse/receipt-channel-policy';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Balance = { boxId: string | null; skuId: string; quantity: number };
type Reservation = { marketplace?: string; connectionId?: string; orderId?: string; skuId: string; sourceSkuId: string | null; relabelConfirmedAt: Date | null;
  boxId: string | null; reservedBoxId: string | null; itemCount: number };
const key = (box: string, sku: string) => `${box}:${sku}`;

// FIX: keep both a box limit and a warehouse limit for orders awaiting a box route.
export class FboFbsAvailability {
  private readonly boxes = new Map<string, number>();
  private readonly warehouse = new Map<string, number>();
  constructor(balances: Balance[], tasks: Reservation[], rules = new Map<string,ReceiptRule>()) {
    for (const b of balances) {
      if (!b.boxId || b.quantity <= 0) continue;
      const k = key(b.boxId, b.skuId);
      this.boxes.set(k, (this.boxes.get(k) ?? 0) + b.quantity);
      this.warehouse.set(b.skuId, (this.warehouse.get(b.skuId) ?? 0) + b.quantity);
    }
    // FIX: allocate each old/new FBS demand only to receipts that can supply it.
    if (rules.size) {
      for (const t of [...tasks].sort((a,b)=>Number(!!(b.boxId||b.reservedBoxId))-Number(!!(a.boxId||a.reservedBoxId)))) {
        const sku=t.sourceSkuId&&!t.relabelConfirmedAt?t.sourceSkuId:t.skuId;
        let remaining=Math.max(1,t.itemCount);const bound=t.boxId||t.reservedBoxId;
        const identity=t.connectionId&&t.orderId?{marketplace:t.marketplace,connectionId:t.connectionId,orderId:t.orderId}:undefined;
        const candidates=[...this.boxes.keys()].filter(k=>k.endsWith(`:${sku}`));
        candidates.sort((a,b)=>Number(b===key(bound||'',sku))-Number(a===key(bound||'',sku))||Number(rules.get(b.slice(0,-sku.length-1))?.fbs===false)-Number(rules.get(a.slice(0,-sku.length-1))?.fbs===false)||a.localeCompare(b));
        for(const k of candidates){const box=k.slice(0,-sku.length-1);
          if(!receiptAllows(rules.get(box),'fbs',identity))continue;
          const n=Math.min(Math.max(0,this.boxes.get(k)||0),remaining);this.boxes.set(k,(this.boxes.get(k)||0)-n);remaining-=n;if(!remaining)break;
        }
      }
      this.warehouse.clear();
      for(const [k,n]of this.boxes){const balance=balances.find(b=>b.boxId&&key(b.boxId,b.skuId)===k)!;
        if(!receiptAllows(rules.get(balance.boxId!),'fbo'))this.boxes.set(k,0);
        else this.warehouse.set(balance.skuId,(this.warehouse.get(balance.skuId)||0)+Math.max(0,n));}
      return;
    }
    for (const t of tasks) {
      const sku = t.sourceSkuId && !t.relabelConfirmedAt ? t.sourceSkuId : t.skuId;
      const qty = Math.max(1, t.itemCount), box = t.boxId ?? t.reservedBoxId;
      this.warehouse.set(sku, (this.warehouse.get(sku) ?? 0) - qty);
      if (box) this.boxes.set(key(box, sku), (this.boxes.get(key(box, sku)) ?? 0) - qty);
    }
  }
  free(box: string, sku: string) {
    return Math.max(0, Math.min(this.boxes.get(key(box, sku)) ?? 0, this.warehouse.get(sku) ?? 0));
  }
  take(box: string, sku: string, quantity: number) {
    if (quantity > this.free(box, sku))
      throw new ConflictException('Товар зарезервирован для FBS. Обновите маршрут ФБО и отберите только свободное количество.');
    this.boxes.set(key(box, sku), (this.boxes.get(key(box, sku)) ?? 0) - quantity);
    this.warehouse.set(sku, (this.warehouse.get(sku) ?? 0) - quantity);
  }
}

// FIX: run inside the existing serializable pick transaction, before any stock/KIZ writes.
export async function loadFboFbsAvailability(tx: Prisma.TransactionClient,
  request: { clientId: string; warehouseId: string | null }, skuIds: string[]) {
  const balances = await tx.stockBalance.findMany({ where: { clientId: request.clientId,
    warehouseId: request.warehouseId, skuId: { in: skuIds }, status: 'AVAILABLE', quantity: { gt: 0 },
    box: { status: 'active', clientId: request.clientId, warehouseId: request.warehouseId } },
    select: { boxId: true, skuId: true, quantity: true } });
  const requestIds = await tx.clientRequest.findMany({ where: { clientId: request.clientId,
    warehouseId: request.warehouseId, status: { notIn: ['DONE', 'CANCELLED', 'REJECTED'] } }, select: { id: true } });
  const tasks = await tx.fbsTsdAssembly.findMany({ where: { clientId: request.clientId,
    status: { in: ['WAITING_STOCK', 'RESERVED', 'IN_PROGRESS', 'RESCAN_REQUIRED', 'RETURN_REQUIRED', 'COMPLETED'] },
    AND: [{ OR: [{ skuId: { in: skuIds } }, { sourceSkuId: { in: skuIds } }] },
      { OR: [{ stockWarehouseId: request.warehouseId },
        { stockWarehouseId: null, requestId: { in: requestIds.map(r => r.id) } },
        { boxId: { in: balances.flatMap(b => b.boxId ? [b.boxId] : []) } },
        { reservedBoxId: { in: balances.flatMap(b => b.boxId ? [b.boxId] : []) } }] }] },
    select: { id: true, marketplace: true, requestId: true, connectionId: true, orderId: true, status: true,
      sourceBarcode: true, barcode: true, kiz: true,
      skuId: true, sourceSkuId: true, relabelConfirmedAt: true, itemCount: true, boxId: true, reservedBoxId: true } });
  // FIX: physical picking already reduced AVAILABLE; do not subtract that stock twice.
  const taskRequestIds = [...new Set(tasks.map(t => t.requestId))];
  const movements = tasks.length ? await tx.stockMovement.findMany({where:{clientId:request.clientId,
    sourceDocument:{in:taskRequestIds},skuId:{in:skuIds},status:'PACKING',
    idempotencyKey:{startsWith:'fbs-sticker-pick:'}},select:{idempotencyKey:true,quantity:true}}) : [];
  const picked = new Map<string, number>();
  for (const movement of movements) {
    const id = movement.idempotencyKey!.slice('fbs-sticker-pick:'.length).split(':',1)[0];
    picked.set(id,(picked.get(id) ?? 0)+movement.quantity);
  }
  const openRequests = tasks.length ? await tx.clientRequest.findMany({where:{id:{in:taskRequestIds},
    status:{notIn:['DONE','CANCELLED','REJECTED']}},select:{id:true}}) : [];
  const open = new Set(openRequests.map(r=>r.id));
  // FIX: only links capable of matching this reservation set are needed.
  const narrowedLinks = process.env.WMS_FBO_PLAN_COALESCE_ENABLED === 'true' ? {
    connectionId: { in: [...new Set(tasks.map(t => t.connectionId))] },
    orderId: { in: [...new Set(tasks.map(t => t.orderId))] },
  } : {};
  const shipped = tasks.length ? await tx.fbsOrderRequestLink.findMany({where:{requestId:{in:taskRequestIds},...narrowedLinks,
    lastCategory:{in:['shipped','archive']},lastSupplierStatus:'complete',request:{fbsEmergencyAssemblyAt:null}},
    select:{connectionId:true,orderId:true}}) : [];
  const shippedOrders = new Set(shipped.map(l=>`${l.connectionId}:${l.orderId}`));
  const pending = tasks.filter(t => t.status === 'RETURN_REQUIRED' ||
    (t.status === 'IN_PROGRESS' && !!(t.sourceBarcode || t.barcode || t.kiz || t.relabelConfirmedAt)) ||
    (open.has(t.requestId) && !shippedOrders.has(`${t.connectionId}:${t.orderId}`)))
    .map(t => ({...t,itemCount:Math.max(1,t.itemCount)-Math.max(0,picked.get(t.id) ?? 0)}))
    .filter(t => t.itemCount > 0);
  // FIX: only available candidate boxes can contribute stock to this FBO plan.
  // Keep approval reads in the same transaction without loading unrelated receipt history.
  const receiptBoxIds = [...new Set(balances.flatMap(b => b.boxId ? [b.boxId] : []))];
  const rules=await receiptRules(tx,request.clientId,request.warehouseId,receiptBoxIds);
  const missing=rules.size?await receiptUnassignedOrders(tx,request.clientId,request.warehouseId,new Set(tasks.map(receiptOrderKey))):[];
  return new FboFbsAvailability(balances, [...pending,...missing], rules);
}
