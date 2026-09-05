import { ClientRequestStatus, MovementType, Prisma, StockStatus } from '@prisma/client';
import { appendFbsAttemptHistory } from './fbs-attempt-history';

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
  await appendFbsAttemptHistory(tx, assemblies, { requestId });
  if (assemblies.length === 0) return 0;

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
  if (rows.length === 0) return 0;
  const result = await tx.shippedKizHistory.createMany({
    data: rows,
    skipDuplicates: true,
  });
  await tx.productMark.updateMany({
    where: {
      clientId: request.clientId,
      value: { in: kizValues },
      status: { not: StockStatus.SHIPPING },
    },
    data: { status: StockStatus.SHIPPING },
  });
  return result.count;
}
