import { Prisma, StockStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

// FIX: our WMS opts in; installations without the flag retain their current policy.
export const wbOrderStockLifecycleEnabled = () => process.env.WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED === 'true';
type Demand = { id: string; requestId: string; skuId: string; itemCount: number; status: string; pickedQuantity: number; shipped: boolean };
type RequestDemand = { id: string; quantity: number };
const pending = new Set(['RESERVED', 'WAITING_STOCK', 'IN_PROGRESS', 'COMPLETED', 'RETURN_REQUIRED']);

// FIX: request demand and its WB orders are the same units, not two reservations.
export function calculateWbFreeStock(stock: number, tasks: Demand[], requests: RequestDemand[]) {
  const taskQuantityByRequest = new Map<string, number>();
  let reserved = 0;
  for (const task of tasks) {
    taskQuantityByRequest.set(task.requestId, (taskQuantityByRequest.get(task.requestId) ?? 0) + task.itemCount);
    if (!task.shipped && pending.has(task.status)) reserved += Math.max(0, task.itemCount - task.pickedQuantity);
  }
  for (const request of requests) reserved += Math.max(0, request.quantity - (taskQuantityByRequest.get(request.id) ?? 0));
  return Math.max(0, stock - reserved);
}

export async function wbReservationQuantities(db: Prisma.TransactionClient, clientId: string, skuIds: string[], warehouseId?: string, excludeRequestId?: string) {
  if (!skuIds.length) return new Map<string, number>();
  const skus = await db.sku.findMany({ where: { clientId, id: { in: skuIds } }, select: { id: true, barcodes: { select: { value: true } } } });
  const skuByBarcode = new Map(skus.flatMap(sku => sku.barcodes.map(barcode => [barcode.value, sku.id] as const)));
  const tasks = await db.fbsTsdAssembly.findMany({ where: { clientId, marketplace: 'WILDBERRIES',
    OR: [{ skuId: { in: skuIds } }, { sourceSkuId: { in: skuIds } }],
    ...(warehouseId ? { stockWarehouseId: warehouseId } : {}),
  } });
  const requests = await db.clientRequest.findMany({ where: { clientId, type: 'OUTBOUND',
    status: { in: ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'IN_WORK', 'PACKED'] },
    ...(warehouseId ? { warehouseId } : {}),
    ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    items: { some: { OR: [{ skuId: { in: skuIds } }, { skuId: null, barcode: { in: [...skuByBarcode.keys()] } }] } },
  }, select: { id: true, items: { select: { skuId: true, barcode: true, quantity: true } } } });
  const links = tasks.length ? await db.fbsOrderRequestLink.findMany({ where: { clientId, marketplace: 'WILDBERRIES',
    orderId: { in: [...new Set(tasks.map(task => task.orderId))] },
    request: { status: { notIn: ['CANCELLED', 'REJECTED'] } },
  }, select: { connectionId: true, orderId: true, requestId: true } }) : [];
  const requestByOrder = new Map(links.map(link => [`${link.connectionId}:${link.orderId}`, link.requestId]));
  const picked: Array<{ idempotencyKey: string | null; quantity: number }> = [];
  // FIX: a supply transfer can change requestId; physical evidence belongs to the exact task.
  for (let offset = 0; offset < tasks.length; offset += 100) {
    picked.push(...await db.stockMovement.findMany({ where: { clientId, status: StockStatus.PACKING,
      ...(warehouseId ? { warehouseId } : {}),
      OR: tasks.slice(offset, offset + 100).map(task => ({ idempotencyKey: { startsWith: `fbs-sticker-pick:${task.id}:` } })),
    }, select: { idempotencyKey: true, quantity: true } }));
  }
  // FIX: ordinary WMS picks also leave AVAILABLE and must stop reserving it.
  const requestPicks = requests.length ? await db.stockMovement.groupBy({ by: ['sourceDocument', 'skuId'], where: {
    clientId, ...(warehouseId ? { warehouseId } : {}), sourceDocument: { in: requests.map(r => r.id) },
    status: 'AVAILABLE', type: { in: ['PICK', 'PACK', 'SHIP', 'RETURN'] },
    OR: [{ idempotencyKey: null }, { NOT: { idempotencyKey: { startsWith: 'fbs-sticker-pick:' } } }],
  }, _sum: { quantity: true } }) : [];
  const shipments = tasks.length ? await db.wbOrderShipment.findMany({ where: { clientId,
    assemblyId: { in: tasks.map(t => t.id) } }, select: { assemblyId: true } }) : [];
  const shipped = new Set(shipments.map(s => s.assemblyId));
  const pickedByTask = new Map<string, number>();
  for (const row of picked) {
    const id = row.idempotencyKey?.split(':')[1];
    if (id) pickedByTask.set(id, (pickedByTask.get(id) ?? 0) + row.quantity);
  }
  const taskGroups = new Map<string, Demand[]>();
  const relabelDeductions = new Map<string, number>();
  for (const task of tasks) {
    // FIX: the request link can commit before the automatic task is rebound.
    const requestId = requestByOrder.get(`${task.connectionId}:${task.orderId}`) ?? task.requestId;
    if (requestId === excludeRequestId) continue;
    const skuId = task.sourceSkuId && !task.relabelConfirmedAt ? task.sourceSkuId : task.skuId;
    const group = taskGroups.get(skuId) ?? [];
    group.push({ ...task, requestId, pickedQuantity: Math.max(0, pickedByTask.get(task.id) ?? 0), shipped: shipped.has(task.id) });
    taskGroups.set(skuId, group);
    if (skuId !== task.skuId) {
      const key = `${requestId}:${task.skuId}`;
      relabelDeductions.set(key, (relabelDeductions.get(key) ?? 0) + task.itemCount);
    }
  }
  const physicalByRequestSku = new Map(requestPicks.map(row => [`${row.sourceDocument}:${row.skuId}`, Math.max(0, -(row._sum.quantity ?? 0))]));
  const requestGroups = new Map<string, RequestDemand[]>();
  for (const request of requests) {
    const quantities = new Map<string, number>();
    for (const item of request.items) {
      const skuId = item.skuId ?? skuByBarcode.get(item.barcode ?? '');
      if (skuId) quantities.set(skuId, (quantities.get(skuId) ?? 0) + item.quantity);
    }
    for (const [skuId, quantity] of quantities) {
      const key = `${request.id}:${skuId}`;
      const group = requestGroups.get(skuId) ?? [];
      group.push({ id: request.id, quantity: Math.max(0, quantity - (physicalByRequestSku.get(key) ?? 0) - (relabelDeductions.get(key) ?? 0)) });
      requestGroups.set(skuId, group);
    }
  }
  return new Map(skuIds.map(skuId => {
    const ceiling = Number.MAX_SAFE_INTEGER;
    return [skuId, ceiling - calculateWbFreeStock(ceiling, taskGroups.get(skuId) ?? [], requestGroups.get(skuId) ?? [])] as const;
  }));
}

// FIX: serialize shipment against retries; the movement, mark and immutable fact commit together.
export async function finalizeWbOrderShipment(db: Prisma.TransactionClient, assemblyId: string, source: string, snapshot: Prisma.InputJsonValue, occurredAt = new Date()) {
  const header = await db.fbsTsdAssembly.findUniqueOrThrow({ where: { id: assemblyId }, select: { requestId: true } });
  // FIX: same lock order as whole-request close: request before task/balances.
  await db.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${header.requestId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id=${assemblyId} FOR UPDATE`;
  const task = await db.fbsTsdAssembly.findUniqueOrThrow({ where: { id: assemblyId } });
  if (task.marketplace !== 'WILDBERRIES') return null;
  // FIX: retries share an assembly; an explicit repeat gets a different assembly and cannot erase this fact.
  const existing = await db.wbOrderShipment.findUnique({ where: { assemblyId: task.id } });
  if (existing) return existing;
  const request = await db.clientRequest.findUnique({ where: { id: task.requestId }, include: { client: true, items: true } });
  const warehouseId = task.stockWarehouseId ?? request?.warehouseId;
  if (!warehouseId || !request) throw new ConflictException('Не определена заявка или филиал отгрузки WB. Требуется сверка.');
  const legacy = await db.shippedKizHistory.findFirst({ where: { assemblyId: task.id } });
  const count = Math.max(1, task.itemCount);
  // FIX: an unmarked item may have been shipped by a whole-request operation too.
  const manualShip = request.status === 'DONE' ? await db.stockMovement.aggregate({ where: {
    clientId: task.clientId, warehouseId, sourceDocument: request.id, type: 'SHIP', quantity: { lt: 0 },
  }, _sum: { quantity: true }, _min: { createdAt: true } }) : null;
  const wholeRequestShipped = Boolean(manualShip && request.items.length &&
    -(manualShip._sum.quantity ?? 0) >= request.items.reduce((sum, item) => sum + item.quantity, 0));
  const alreadyShipped = Boolean(legacy) || wholeRequestShipped;
  const shippedAt = legacy?.shippedAt ?? (wholeRequestShipped ? manualShip!._min.createdAt! : occurredAt);
  if (!alreadyShipped) {
    const movements = await db.stockMovement.findMany({ where: { clientId: task.clientId, warehouseId,
      idempotencyKey: { startsWith: `fbs-sticker-pick:${task.id}:` }, status: 'PACKING',
    } });
    if (movements.reduce((sum, row) => sum + row.quantity, 0) < count) {
      throw new ConflictException('Отгрузка WB подтверждена, но физическое списание товара не найдено. Требуется сверка источника.');
    }
    let remaining = count;
    const balances = await db.stockBalance.findMany({ where: { clientId: task.clientId, warehouseId,
      skuId: task.skuId, status: { in: ['PACKING', 'SHIPPING'] }, quantity: { gt: 0 },
      OR: [{ boxId: null }, ...(task.boxId ? [{ boxId: task.boxId }] : [])],
    }, orderBy: { updatedAt: 'asc' } });
    for (const balance of balances) {
      const quantity = Math.min(remaining, balance.quantity);
      if (!quantity) break;
      const changed = await db.stockBalance.updateMany({ where: { id: balance.id, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
      if (changed.count !== 1) throw new ConflictException('Остаток упаковки изменился. Повторите подтверждение отгрузки.');
      await db.stockMovement.create({ data: { clientId: task.clientId, warehouseId, skuId: task.skuId,
        boxId: balance.boxId, palletId: balance.palletId, status: balance.status, type: 'SHIP', quantity: -quantity,
        sourceDocument: task.requestId, idempotencyKey: `wb-order-shipment:${task.id}:${balance.id}`,
        comment: `Отгрузка WB ${task.orderId}: ${source}`,
      } });
      remaining -= quantity;
    }
    if (remaining) throw new ConflictException('Недостаточно товара в упаковке для подтверждения отгрузки WB.');
  }
  const { client: _client, items: _items, ...requestSnapshot } = request;
  const orderSnapshot = JSON.parse(JSON.stringify({ ...(snapshot as object), request: requestSnapshot }));
  const repeat = await db.fbsAssemblyAttemptHistory.findUnique({ where: { successorId: task.id }, select: { id: true } }) ||
    await db.wbOrderShipment.findFirst({ where: { clientId: task.clientId, connectionId: task.connectionId, orderId: task.orderId }, select: { id: true } });
  const fact = await db.wbOrderShipment.create({ data: { clientId: task.clientId, connectionId: task.connectionId,
    orderId: task.orderId, assemblyId: task.id, requestId: task.requestId, warehouseId, skuId: task.skuId,
    quantity: count, kiz: task.kiz, source, shippedAt, orderSnapshot,
    assemblySnapshot: JSON.parse(JSON.stringify({ ...task, billingAttemptId: repeat ? task.id : null })),
  } });
  if (task.kiz) {
    if (!alreadyShipped) await db.productMark.updateMany({ where: { clientId: task.clientId, skuId: task.skuId, value: task.kiz, status: { in: ['PACKING', 'SHIPPING'] } },
      data: { status: 'SHIPPING', boxId: null } });
    const sku = await db.sku.findUniqueOrThrow({ where: { id: task.skuId } });
    await db.shippedKizHistory.createMany({ skipDuplicates: true, data: [{ assemblyId: task.id, clientId: task.clientId,
      warehouseId, clientName: request.client.name, requestId: request.id, requestNumber: request.number,
      requestTitle: request.title, orderId: task.orderId, supplyId: task.supplyId, skuId: sku.id,
      internalSku: sku.internalSku, barcode: task.barcode, article: sku.article, productName: sku.name,
      color: sku.color, size: sku.size, kiz: task.kiz, sourceBoxCode: task.boxCode, shippedAt,
    }] });
  }
  return fact;
}
