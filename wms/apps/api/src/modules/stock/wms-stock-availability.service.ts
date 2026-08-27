import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType, ClientStockBalanceMode, Prisma, StockStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';

export type WmsStockAvailabilityRow = {
  barcode: string;
  total: number;
  reserved: number;
  available: number;
};

export type WmsStockAvailabilitySnapshot = {
  rows: WmsStockAvailabilityRow[];
  totals: { total: number; reserved: number; available: number; barcodes: number };
  missingBarcodeCount: number;
  generatedAt: string;
};

type BarcodeAggregate = { total: number; reserved: number };

const ACTIVE_OUTBOUND_STATUSES = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
  ClientRequestStatus.PACKED,
];

const NON_CURRENT_BOX_STATUSES = ['deleted', 'archived', 'shipped'];

@Injectable()
export class WmsStockAvailabilityService {
  private readonly batchSize: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClientScopeService) private readonly clientScopes: ClientScopeService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.batchSize = boundedInteger(config.get('WMS_STOCK_EXPORT_BATCH_SIZE'), 1_000, 1, 5_000);
  }

  // FIX: every consumer now uses the same physical-stock scope and subtracts
  // only the part of an active reserve that has not left AVAILABLE already.
  async snapshot(
    clientIdValue: string,
    user: AuthUser,
    options: { warehouseId?: string } = {},
  ): Promise<WmsStockAvailabilitySnapshot> {
    const clientId = clientIdValue.trim();
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const warehouseId = scopedWarehouseId(user, options.warehouseId);
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, storesWithoutBoxes: true, stockBalanceMode: true },
    });
    if (!client) throw new NotFoundException('Клиент для расчёта остатков не найден.');

    const aggregates = new Map<string, BarcodeAggregate>();
    let missingBarcodeCount = 0;
    let cursorId: string | undefined;

    for (;;) {
      const skus = await this.prisma.sku.findMany({
        where: { clientId, ...(cursorId ? { id: { gt: cursorId } } : {}) },
        select: {
          id: true,
          barcodes: {
            select: { value: true, isPrimary: true },
            orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }],
          },
        },
        orderBy: { id: 'asc' },
        take: this.batchSize,
      });
      if (skus.length === 0) break;

      const skuIds = skus.map((sku) => sku.id);
      const [balances, requestItems] = await Promise.all([
        this.prisma.stockBalance.groupBy({
          by: ['skuId'],
          where: sellableBalanceWhere(client, clientId, skuIds, warehouseId),
          _sum: { quantity: true },
        }),
        this.prisma.clientRequestItem.groupBy({
          by: ['requestId', 'skuId'],
          where: {
            skuId: { in: skuIds },
            request: {
              clientId,
              type: ClientRequestType.OUTBOUND,
              status: { in: ACTIVE_OUTBOUND_STATUSES },
              ...(warehouseId ? { warehouseId } : {}),
            },
          },
          _sum: { quantity: true },
        }),
      ]);
      const requestIds = [...new Set(requestItems.map((row) => row.requestId))];
      const pickedRows = requestIds.length
        ? await this.prisma.stockMovement.groupBy({
            by: ['sourceDocument', 'skuId'],
            where: {
              clientId,
              skuId: { in: skuIds },
              sourceDocument: { in: requestIds },
              status: StockStatus.PACKING,
            },
            _sum: { quantity: true },
          })
        : [];

      const totalBySku = new Map(balances.map((row) => [row.skuId, row._sum.quantity ?? 0]));
      const pickedByRequestSku = new Map(pickedRows.map((row) => [
        requestSkuKey(row.sourceDocument, row.skuId),
        Math.max(0, row._sum.quantity ?? 0),
      ]));
      const reservedBySku = new Map<string, number>();
      requestItems.forEach((row) => {
        if (!row.skuId) return;
        const requested = Math.max(0, row._sum.quantity ?? 0);
        const picked = pickedByRequestSku.get(requestSkuKey(row.requestId, row.skuId)) ?? 0;
        reservedBySku.set(row.skuId, (reservedBySku.get(row.skuId) ?? 0) + Math.max(0, requested - picked));
      });

      skus.forEach((sku) => {
        const barcode = sku.barcodes[0]?.value.trim();
        if (!barcode) {
          missingBarcodeCount += 1;
          return;
        }
        const aggregate = aggregates.get(barcode) ?? { total: 0, reserved: 0 };
        aggregate.total += totalBySku.get(sku.id) ?? 0;
        aggregate.reserved += Math.max(0, reservedBySku.get(sku.id) ?? 0);
        aggregates.set(barcode, aggregate);
      });

      cursorId = skus[skus.length - 1].id;
      if (skus.length < this.batchSize) break;
    }

    const rows = [...aggregates.entries()]
      .map(([barcode, aggregate]) => ({
        barcode,
        total: aggregate.total,
        reserved: aggregate.reserved,
        available: wmsAvailableQuantity(aggregate.total, aggregate.reserved),
      }))
      .sort((left, right) => left.barcode.localeCompare(right.barcode, 'ru-RU', { numeric: true }));
    return {
      rows,
      totals: rows.reduce(
        (sum, row) => ({
          total: sum.total + row.total,
          reserved: sum.reserved + row.reserved,
          available: sum.available + row.available,
          barcodes: sum.barcodes + 1,
        }),
        { total: 0, reserved: 0, available: 0, barcodes: 0 },
      ),
      missingBarcodeCount,
      generatedAt: new Date().toISOString(),
    };
  }
}

// FIX: clamping happens only after every SKU carrying the same barcode has
// been aggregated, so a negative cell cannot hide stock in another cell.
export function wmsAvailableQuantity(total: number, reserved: number) {
  return Math.max(0, Math.trunc(total) - Math.max(0, Math.trunc(reserved)));
}

function sellableBalanceWhere(
  client: { storesWithoutBoxes: boolean; stockBalanceMode: ClientStockBalanceMode },
  clientId: string,
  skuIds: string[],
  warehouseId?: string,
): Prisma.StockBalanceWhereInput {
  const common: Prisma.StockBalanceWhereInput = {
    clientId,
    skuId: { in: skuIds },
    status: StockStatus.AVAILABLE,
  };
  if (client.storesWithoutBoxes) {
    return { ...common, boxId: null, palletId: null, ...(warehouseId ? { warehouseId } : {}) };
  }
  const box: Prisma.BoxNullableScalarRelationFilter | Prisma.BoxWhereInput = {
    status: { notIn: NON_CURRENT_BOX_STATUSES },
    ...(client.stockBalanceMode === ClientStockBalanceMode.PALLET_SORT
      ? { storagePlacement: warehouseId ? { is: { pallet: { warehouseId } } } : { isNot: null } }
      : warehouseId ? { warehouseId } : {}),
  };
  return { ...common, boxId: { not: null }, box };
}

function requestSkuKey(requestId: string | null, skuId: string) {
  return `${requestId || '-'}:${skuId}`;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function scopedWarehouseId(user: AuthUser, requestedWarehouseId?: string) {
  if (!user.activeWarehouseId || user.roleCodes.includes('CLIENT') || user.permissionCodes.includes('system:admin')) {
    return requestedWarehouseId;
  }
  return user.activeWarehouseId;
}

