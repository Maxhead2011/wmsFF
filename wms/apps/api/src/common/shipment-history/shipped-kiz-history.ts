import { ClientRequestStatus, MovementType, Prisma, StockStatus } from '@prisma/client';
import { appendFbsAttemptHistory } from './fbs-attempt-history';
import { permanentStorageBoxesEnabled } from '../boxes/box-code-policy.service';

export async function captureShippedKizHistory(
  tx: Prisma.TransactionClient,
  requestId: string,
  shippedAt?: Date,
) {
  const request = await tx.clientRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      clientId: true,
      warehouseId: true,
      client: { select: { name: true } },
      updatedAt: true,
    },
  });
  if (!request) return 0;
  if (!shippedAt && request.status !== ClientRequestStatus.DONE) return 0;

  // FIX: FBO has its own unit records; archive only after an explicit shipment or DONE.
  let fboCount = 0;
  if (process.env.WMS_FBO_TWO_STAGE_ENABLED === 'true') {
    const units = await tx.fboAssemblyUnit.findMany({
      where: { requestId, state: 'PACKED', kiz: { not: null } },
    });
    if (units.length) {
      const skus = await tx.sku.findMany({ where: { id: { in: [...new Set(units.map(unit => unit.skuId))] } } });
      const byId = new Map(skus.map(sku => [sku.id, sku]));
      const at = shippedAt ?? request.updatedAt;
      const rows = units.map(unit => {
        const sku = byId.get(unit.skuId);
        if (!sku || !unit.kiz) throw new Error('Не найдена карточка отгруженной единицы ФБО.');
        return { assemblyId: `fbo:${unit.id}`, clientId: request.clientId,
          warehouseId: request.warehouseId, clientName: request.client.name,
          requestId, requestNumber: request.number, requestTitle: request.title,
          skuId: sku.id, internalSku: sku.internalSku, barcode: unit.barcode,
          article: sku.article, productName: sku.name, color: sku.color, size: sku.size,
          kiz: unit.kiz, sourceBoxCode: unit.sourceBoxCode, shippedAt: at };
      });
      fboCount = (await tx.shippedKizHistory.createMany({ data: rows, skipDuplicates: true })).count;
      // FIX: historical rebuild is read-only for marks; a later receipt must survive.
      if (request.status !== ClientRequestStatus.DONE) {
        for (const unit of units) {
          if (!unit.markId || !unit.targetBoxId) continue;
          await tx.productMark.updateMany({ where: {
            id: unit.markId, clientId: request.clientId, skuId: unit.skuId,
            value: unit.kiz!, boxId: unit.targetBoxId, status: StockStatus.SHIPPING,
            updatedAt: { lte: at },
          }, data: { boxId: null } });
        }
      }
    }
  }

  const assemblies = await tx.fbsTsdAssembly.findMany({
    where: {
      requestId,
      status: 'COMPLETED',
      kiz: { not: null },
    },
    select: {
      id: true,
      orderId: true,
      supplyId: true,
      skuId: true,
      kiz: true,
      boxId: true,
      boxCode: true,
      completedAt: true,
    },
  });
  // FIX: archived attempts are history only; they cannot own a currently active KIZ.
  const currentAssemblies = [...assemblies];
  await appendFbsAttemptHistory(tx, assemblies, { requestId });
  if (assemblies.length === 0) return fboCount;

  const skuIds = [...new Set(assemblies.map((row) => row.skuId))];
  const kizValues = assemblies
    .map((row) => row.kiz)
    .filter((value): value is string => Boolean(value));
  const shippedWarehouseRows = await tx.stockMovement.findMany({
    where: {
      sourceDocument: request.id,
      type: MovementType.SHIP,
      quantity: { lt: 0 },
      warehouseId: { not: null },
    },
    select: { warehouseId: true },
    distinct: ['warehouseId'],
  });
  const shippedWarehouseIds = shippedWarehouseRows
    .map((row) => row.warehouseId)
    .filter((value): value is string => Boolean(value));
  const historyWarehouseId =
    request.warehouseId ??
    (shippedWarehouseIds.length === 1 ? shippedWarehouseIds[0] : null);
  const [skus, marks, receiptMovements] = await Promise.all([
    tx.sku.findMany({
      where: { id: { in: skuIds } },
      select: {
        id: true,
        internalSku: true,
        article: true,
        name: true,
        color: true,
        size: true,
        barcodes: {
          select: { value: true, isPrimary: true },
          orderBy: [{ isPrimary: 'desc' }],
        },
      },
    }),
    tx.productMark.findMany({
      where: { clientId: request.clientId, value: { in: kizValues } },
      select: { value: true, sourceDocument: true, createdAt: true },
    }),
    tx.stockMovement.findMany({
      where: {
        clientId: request.clientId,
        ...(historyWarehouseId ? { warehouseId: historyWarehouseId } : {}),
        skuId: { in: skuIds },
        type: { in: [MovementType.RECEIPT, MovementType.INITIAL_IMPORT] },
        quantity: { gt: 0 },
      },
      select: { skuId: true, boxId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const markArrivalByValue = new Map(
    marks
      .filter((mark) => !mark.sourceDocument?.startsWith('FBS TSD,'))
      .map((mark) => [mark.value, mark.createdAt]),
  );
  const firstReceiptBySkuBox = new Map<string, Date>();
  for (const movement of receiptMovements) {
    const key = `${movement.skuId}:${movement.boxId ?? 'no-box'}`;
    if (!firstReceiptBySkuBox.has(key)) firstReceiptBySkuBox.set(key, movement.createdAt);
  }

  const rows = assemblies.flatMap((assembly) => {
    if (!assembly.kiz) return [];
    const sku = skuById.get(assembly.skuId);
    if (!sku) return [];
    return [
      {
        assemblyId: assembly.id,
        clientId: request.clientId,
        warehouseId: historyWarehouseId,
        clientName: request.client.name,
        requestId: request.id,
        requestNumber: request.number,
        requestTitle: request.title,
        orderId: assembly.orderId,
        supplyId: assembly.supplyId,
        skuId: sku.id,
        internalSku: sku.internalSku,
        barcode: sku.barcodes[0]?.value ?? null,
        article: sku.article,
        productName: sku.name,
        color: sku.color,
        size: sku.size,
        kiz: assembly.kiz,
        sourceBoxCode: assembly.boxCode,
        arrivalAt:
          markArrivalByValue.get(assembly.kiz) ??
          firstReceiptBySkuBox.get(`${sku.id}:${assembly.boxId ?? 'no-box'}`) ??
          null,
        shippedAt: shippedAt ?? request.updatedAt ?? assembly.completedAt ?? new Date(),
      },
    ];
  });
  if (rows.length === 0) return fboCount;
  const result = await tx.shippedKizHistory.createMany({
    data: rows,
    skipDuplicates: true,
  });
  if (permanentStorageBoxesEnabled()) {
    // FIX: refreshing a completed request only fills history, never rewrites recovered stock.
    if (request.status !== ClientRequestStatus.DONE) {
      for (const assembly of currentAssemblies) {
        if (!assembly.kiz || !assembly.completedAt) continue;
        await tx.productMark.updateMany({
          where: {
            clientId: request.clientId, skuId: assembly.skuId, value: assembly.kiz,
            status: { in: [StockStatus.AVAILABLE, StockStatus.RESERVED, StockStatus.PACKING, StockStatus.SHIPPING] },
            // FIX: a later receipt/move/rebind or another box must survive a delayed shipment/retry.
            updatedAt: { lte: assembly.completedAt },
            OR: [{ boxId: assembly.boxId }, { boxId: null, status: StockStatus.PACKING }],
          },
          data: { status: StockStatus.SHIPPING, boxId: null },
        });
      }
    }
    return result.count + fboCount;
  }
  await tx.productMark.updateMany({
    where: {
      clientId: request.clientId,
      value: { in: kizValues },
      status: { not: StockStatus.SHIPPING },
    },
    data: { status: StockStatus.SHIPPING },
  });
  return result.count + fboCount;
}
