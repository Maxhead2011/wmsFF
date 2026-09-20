import { BadRequestException, Injectable } from '@nestjs/common';
import { wbOrderStockLifecycleEnabled, wbReservationQuantities } from '../../common/stock/wb-order-stock-lifecycle';
import { ClientStockBalanceMode, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto';

export type BalanceKeyInput = {
  warehouseId?: string | null;
  clientId: string;
  skuId: string;
  boxId?: string | null;
  palletId?: string | null;
  status: StockStatus;
};

@Injectable()
export class StockBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async list(filter: ListStockBalancesDto, user: AuthUser) {
    // FIX: our client cabinet/export accepts only located free stock. Internal
    // operations retain physical quantities and other installations opt out.
    const locatedFreeStock = process.env.WMS_CLIENT_PALLET_SORT_FREE_STOCK_ENABLED === 'true';
    const search = filter.search?.trim();
    const skuWhere: Prisma.SkuWhereInput | undefined =
      filter.barcode || search
        ? {
            ...(filter.barcode ? { barcodes: { some: { value: filter.barcode } } } : {}),
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { internalSku: { contains: search, mode: 'insensitive' } },
                    { clientSku: { contains: search, mode: 'insensitive' } },
                    { article: { contains: search, mode: 'insensitive' } },
                    { barcodes: { some: { value: { contains: search } } } },
                  ],
                }
              : {}),
          }
        : undefined;
    const clientFilter = this.clientScopes.resolveClientFilter(user, filter.clientId);
    const scopedWarehouseId = warehouseScopedInternalWarehouseId(user);
    // Lightweight service tests and maintenance scripts may provide a reduced
    // Prisma adapter without the Client delegate. The durable balance dimension
    // is authoritative; physical location is only a legacy fallback.
    if (typeof this.prisma.client?.findMany !== 'function') {
      return this.prisma.stockBalance.findMany({
        where: {
          ...(scopedWarehouseId
            ? {
                AND: [
                  { clientId: clientFilter },
                  {
                    OR: [
                      { warehouseId: scopedWarehouseId },
                      {
                        warehouseId: null,
                        boxId: { not: null },
                        box: { warehouseId: scopedWarehouseId },
                      },
                      {
                        warehouseId: null,
                        boxId: null,
                        palletId: { not: null },
                        pallet: { zone: { warehouseId: scopedWarehouseId } },
                      },
                    ],
                  },
                ],
              }
            : { clientId: clientFilter }),
          skuId: filter.skuId,
          box: filter.boxCode ? { code: filter.boxCode } : undefined,
          sku: skuWhere,
        },
        include: {
          sku: { include: { barcodes: true } },
          warehouse: true,
          box: { include: { warehouse: true } },
          pallet: true,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: search ? 100 : undefined,
      });
    }
    const clients = await this.prisma.client.findMany({
      where: { id: clientFilter },
      select: {
        id: true,
        storesWithoutBoxes: true,
        stockBalanceMode: true,
      },
    });
    const boxlessClientIds = clients
      .filter((client) => client.storesWithoutBoxes)
      .map((client) => client.id);
    const allBoxClientIds = clients
      .filter(
        (client) =>
          !client.storesWithoutBoxes &&
          client.stockBalanceMode === ClientStockBalanceMode.BOXES,
      )
      .map((client) => client.id);
    const palletSortClientIds = clients
      .filter(
        (client) =>
          !client.storesWithoutBoxes &&
          client.stockBalanceMode === ClientStockBalanceMode.PALLET_SORT,
      )
      .map((client) => client.id);
    const stockModeFilter: Prisma.StockBalanceWhereInput = {
      OR: [
        ...(boxlessClientIds.length
          ? [{
              clientId: { in: boxlessClientIds },
              boxId: null,
              palletId: null,
              ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}),
            }]
          : []),
        ...(allBoxClientIds.length
          ? [
              {
                clientId: { in: allBoxClientIds },
                boxId: { not: null },
                box: {
                  status: { notIn: ['deleted', 'archived'] },
                  ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}),
                },
              },
            ]
          : []),
        ...(palletSortClientIds.length
          ? [
              {
                clientId: { in: palletSortClientIds },
                boxId: { not: null },
                box: {
                  status: { notIn: ['deleted', 'archived'] },
                  ...(scopedWarehouseId ? { warehouseId: scopedWarehouseId } : {}),
                  storagePlacement: scopedWarehouseId
                    ? { is: { pallet: { warehouseId: scopedWarehouseId } } }
                    : { isNot: null },
                },
              },
            ]
          : []),
      ],
    };
    const warehouseFilter: Prisma.StockBalanceWhereInput | undefined = scopedWarehouseId
      ? {
          OR: [
            { warehouseId: scopedWarehouseId },
            {
              warehouseId: null,
              boxId: { not: null },
              box: { warehouseId: scopedWarehouseId },
            },
            {
              warehouseId: null,
              boxId: null,
              palletId: { not: null },
              pallet: { zone: { warehouseId: scopedWarehouseId } },
            },
          ],
        }
      : undefined;
    const where: Prisma.StockBalanceWhereInput = {
      AND: [
        { clientId: clientFilter },
        stockModeFilter,
        ...(warehouseFilter ? [warehouseFilter] : []),
      ],
      skuId: filter.skuId,
      box:
        filter.boxCode
          ? {
              ...(filter.boxCode ? { code: filter.boxCode } : {}),
            }
          : undefined,
      sku: skuWhere,
    };

    const rows = await this.prisma.stockBalance.findMany({
      where,
      include: {
        sku: { include: { barcodes: true } },
        warehouse: true,
        box: { include: { warehouse: true, ...(locatedFreeStock ? { storagePlacement: { select: { pallet: { select: { clientId: true, warehouseId: true } } } } } : {}) } },
        pallet: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: search ? 100 : undefined,
    });
    // FIX: preserve physical box quantities; expose free stock separately for the cabinet/export.
    if (!wbOrderStockLifecycleEnabled() && !locatedFreeStock) return rows;
    const freeById = new Map<string, number>();
    for (const clientId of [...new Set(rows.map(row => row.clientId))]) {
      for (const warehouseId of [...new Set(rows.filter(row => row.clientId === clientId).map(row => row.warehouseId ?? row.box?.warehouseId).filter((id): id is string => Boolean(id)))]) {
        const scoped = rows.filter(row => row.clientId === clientId && (row.warehouseId ?? row.box?.warehouseId) === warehouseId);
        const reserved = await wbReservationQuantities(this.prisma, clientId, [...new Set(scoped.map(row => row.skuId))], warehouseId);
        for (const row of scoped) {
          const placement = (row.box && 'storagePlacement' in row.box ? row.box.storagePlacement : null) as
            { pallet: { clientId: string; warehouseId: string } } | null;
          const located = !locatedFreeStock || Boolean(placement?.pallet && placement.pallet.clientId === clientId && placement.pallet.warehouseId === warehouseId);
          const physical = row.status === StockStatus.AVAILABLE && located ? Math.max(0, row.quantity) : 0;
          const deduction = Math.min(physical, reserved.get(row.skuId) ?? 0);
          freeById.set(row.id, physical - deduction);
          reserved.set(row.skuId, Math.max(0, (reserved.get(row.skuId) ?? 0) - deduction));
        }
      }
    }
    const result = rows.map(row => ({ ...row, freeQuantity: freeById.get(row.id) ?? 0 }));
    return locatedFreeStock && user.roleCodes?.includes('CLIENT')
      ? result.filter(row => row.freeQuantity > 0).map(row => ({ ...row, quantity: row.freeQuantity }))
      : result;
  }

  balanceKey(input: BalanceKeyInput) {
    // Русский комментарий: отдельный ключ убирает неоднозначность SQL NULL в составных unique-индексах.
    const parts = [
      input.clientId,
      input.skuId,
      input.boxId ?? 'no-box',
      input.palletId ?? 'no-pallet',
      input.status,
    ];
    if (!input.boxId && !input.palletId) {
      const warehouseId = input.warehouseId?.trim();
      if (!warehouseId) {
        throw new BadRequestException(
          'Для остатка без короба необходимо однозначно указать филиал.',
        );
      }
      parts.push('warehouse', warehouseId);
    }
    return parts.join(':');
  }
}

function warehouseScopedInternalWarehouseId(user: AuthUser) {
  if (
    !user.activeWarehouseId ||
    user.roleCodes.includes('CLIENT') ||
    user.permissionCodes.includes('system:admin')
  ) {
    return null;
  }
  return user.activeWarehouseId;
}
