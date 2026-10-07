import { BadRequestException, Injectable } from '@nestjs/common';
import { pendingReceiptBoxIds } from '../warehouse/receipt-channel-policy';
import { wbOrderStockLifecycleEnabled, wbReservationQuantities } from '../../common/stock/wb-order-stock-lifecycle';
import { ClientStockBalanceMode, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto';
import { CabinetStockExportDto } from './dto/cabinet-stock-export.dto';
import { createHash } from 'node:crypto';

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
    // FIX: cabinet reads do not need the repeated marketplace payload for every box.
    const skuInclude = filter.view === 'cabinet'
      ? { select: { id: true, internalSku: true, clientSku: true, article: true, name: true,
          color: true, size: true, barcodes: true } }
      : { include: { barcodes: true } };
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
          sku: skuInclude,
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
    // FIX: visibility uses approval only; storage billing still reads physical balances directly.
    const pendingBoxes = await pendingReceiptBoxIds(this.prisma, clients.map(c=>c.id), scopedWarehouseId);
    const where: Prisma.StockBalanceWhereInput = {
      AND: [
        { clientId: clientFilter },
        stockModeFilter,
        ...(pendingBoxes.length ? [{ OR: [{ boxId: null }, { boxId: { notIn: pendingBoxes } }] }] : []),
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
        sku: skuInclude,
        warehouse: true,
        box: { include: { warehouse: true } },
        pallet: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: search ? 100 : undefined,
    });
    // FIX: preserve physical box quantities; expose free stock separately for the cabinet/export.
    if (!wbOrderStockLifecycleEnabled()) return rows;
    const freeById = new Map<string, number>();
    for (const clientId of [...new Set(rows.map(row => row.clientId))]) {
      for (const warehouseId of [...new Set(rows.filter(row => row.clientId === clientId).map(row => row.warehouseId ?? row.box?.warehouseId).filter((id): id is string => Boolean(id)))]) {
        const scoped = rows.filter(row => row.clientId === clientId && (row.warehouseId ?? row.box?.warehouseId) === warehouseId);
        const reserved = await wbReservationQuantities(this.prisma, clientId, [...new Set(scoped.map(row => row.skuId))], warehouseId);
        for (const row of scoped) {
          const physical = row.status === StockStatus.AVAILABLE ? Math.max(0, row.quantity) : 0;
          const deduction = Math.min(physical, reserved.get(row.skuId) ?? 0);
          freeById.set(row.id, physical - deduction);
          reserved.set(row.skuId, Math.max(0, (reserved.get(row.skuId) ?? 0) - deduction));
        }
      }
    }
    return rows.map(row => ({ ...row, freeQuantity: freeById.get(row.id) ?? 0 }));
  }

  // FIX: persist the exact browser export, rather than recalculating changing stock after download.
  async recordCabinetExport(dto: CabinetStockExportDto, user: AuthUser, context: { ip?: string; userAgent?: string }) {
    this.clientScopes.requireClientAccess(user, dto.clientId, 'read');
    if (!wbOrderStockLifecycleEnabled()) return { recorded: false };
    const snapshot = {
      source: 'client-cabinet-browser', eventMeaning: 'file-prepared-not-confirmed-saved',
      actorName: user.name, ipAddress: context.ip ?? null, userAgent: context.userAgent?.slice(0, 1000) ?? null,
      fileName: dto.fileName, generatedAt: dto.generatedAt, filters: dto.filters,
      rowCount: dto.rows.length, totalQuantity: dto.rows.reduce((sum, row) => sum + row.quantity, 0), rows: dto.rows,
      rowsSha256: createHash('sha256').update(JSON.stringify(dto.rows)).digest('hex'),
    };
    const record = await this.prisma.auditLog.create({ data: {
      userId: user.id, action: 'CLIENT_STOCK_EXPORT_PREPARED', entity: 'Client', entityId: dto.clientId,
      payload: JSON.parse(JSON.stringify(snapshot)),
    }, select: { id: true, createdAt: true } });
    return { recorded: true, id: record.id, createdAt: record.createdAt };
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
