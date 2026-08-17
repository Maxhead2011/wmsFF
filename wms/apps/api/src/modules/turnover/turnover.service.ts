import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType, MovementType, Prisma, StockStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import { BoxCodePolicyService } from '../../common/boxes/box-code-policy.service';
import { receiptBoxCodePrefixForDate, receiptDateFromBoxCode } from '../../common/receipt-batches';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService, type ClientFilter } from '../auth/client-scope.service';
import { ListTurnoverDto, TurnoverBoxDetailsDto, TurnoverStatisticsDto, TurnoverStockExportDto, TurnoverSuggestionsDto } from './dto/list-turnover.dto';
import { TurnoverActionDto, TurnoverActionKind } from './dto/turnover-action.dto';
import {
  buildTurnoverReceiptPeriodWorkbook,
  buildTurnoverReceiptWorkbook,
  buildTurnoverStockWorkbook,
  turnoverReceiptXlsxMimeType,
} from './turnover-receipt-xlsx';

type TurnoverMovement = Prisma.StockMovementGetPayload<{
  include: {
    box: { select: { id: true; code: true; status: true } };
    productMarks: { select: { id: true; value: true; status: true } };
  };
}>;

type TurnoverSku = Prisma.SkuGetPayload<{
  include: {
    client: { select: { id: true; code: true; name: true } };
    barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] };
    balances: {
      include: {
        box: {
          select: {
            id: true;
            code: true;
            status: true;
            zone: { select: { id: true; code: true; name: true } };
            storagePlacement: {
              select: {
                source: true;
                pallet: {
                  select: {
                    id: true;
                    code: true;
                    zone: { select: { id: true; code: true; name: true } };
                  };
                };
              };
            };
          };
        };
        pallet: {
          select: {
            id: true;
            code: true;
            status: true;
            zone: { select: { id: true; code: true; name: true } };
          };
        };
      };
    };
    productMarks: { select: { id: true; value: true; status: true; boxId: true; createdAt: true }; take: 30 };
    movements: {
      include: {
        box: { select: { id: true; code: true; status: true } };
        productMarks: { select: { id: true; value: true; status: true } };
      };
      orderBy: { createdAt: 'asc' };
      take: 250;
    };
  };
}>;

type SourceAllocation = {
  balance: {
    id: string;
    clientId: string;
    skuId: string;
    boxId: string | null;
    palletId: string | null;
    status: StockStatus;
    quantity: number;
    box: { id: string; code: string; status: string; palletId: string | null } | null;
  };
  quantity: number;
};

type StockExportWorkingRow = Omit<TurnoverStockExportDocument['rows'][number], 'position'> & {
  position: number;
  barcodeSet: Set<string>;
};

type TurnoverMovementAggregate = {
  skuId: string;
  period: string;
  receivedQuantity: bigint | number;
  shippedQuantity: bigint | number;
  writtenOffQuantity: bigint | number;
};

type TurnoverStoragePlacement = {
  source: string;
  pallet: {
    id: string;
    code: string;
    zone: { id: string; code: string; name: string } | null;
  };
};

type TurnoverWarehouseScope = {
  warehouseId: string;
  boxlessClientIds: string[];
  legacyBoxlessClientIds: string[];
};

export type TurnoverReceiptDocument = {
  movementId: string;
  sourceDocument: string | null;
  type: MovementType;
  typeLabel: string;
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  totalQuantity: number;
  skuCount: number;
  boxesCount: number;
  fileName: string;
  client: { id: string; code: string; name: string };
  rows: Array<{
    position: number;
    movementId: string;
    date: string;
    boxCode: string | null;
    barcode: string | null;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    color: string | null;
    size: string | null;
    quantity: number;
    status: StockStatus;
    statusLabel: string;
    kiz: string | null;
    sourceRows: number[];
    comment: string | null;
  }>;
};

export type TurnoverReceiptPeriodDocument = {
  generatedAt: string;
  periodFrom: string | null;
  periodTo: string | null;
  totalQuantity: number;
  skuCount: number;
  boxesCount: number;
  fileName: string;
  client: { id: string; code: string; name: string };
  rows: Array<{
    position: number;
    movementId: string;
    date: string;
    boxCode: string | null;
    barcode: string | null;
    kiz: string | null;
    clientSku: string | null;
    name: string;
    color: string | null;
    size: string | null;
    quantity: number;
    sourceDocument: string | null;
  }>;
};

export type TurnoverStockExportDocument = {
  generatedAt: string;
  ignoreActiveRequests: boolean;
  fileName: string;
  client: { id: string; code: string; name: string };
  totals: {
    rows: number;
    skuCount: number;
    boxesCount: number;
    physicalQuantity: number;
    reservedQuantity: number;
    exportQuantity: number;
  };
  rows: Array<{
    position: number;
    balanceId: string;
    skuId: string;
    boxCode: string | null;
    palletCode: string | null;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    color: string | null;
    size: string | null;
    barcode: string | null;
    allBarcodes: string;
    status: StockStatus;
    statusLabel: string;
    physicalQuantity: number;
    reservedQuantity: number;
    exportQuantity: number;
    volumeLiters: number | null;
    kizCount: number;
    updatedAt: string;
  }>;
};

export type TurnoverBoxDetails = {
  generatedAt: string;
  box: {
    id: string;
    code: string;
    status: string;
    client: { id: string; code: string; name: string };
    storagePlacement: {
      source: string;
      scannedAt: Date;
      pallet: {
        id: string;
        code: string;
        zone: { id: string; code: string; name: string } | null;
      };
    } | null;
  };
  totals: {
    rows: number;
    skuCount: number;
    quantity: number;
    kizCount: number;
  };
  contents: Array<{
    balanceId: string;
    skuId: string;
    internalSku: string;
    clientSku: string | null;
    article: string | null;
    name: string;
    color: string | null;
    size: string | null;
    barcode: string | null;
    status: StockStatus;
    statusLabel: string;
    quantity: number;
    kiz: string[];
    kizCount: number;
  }>;
  movements: Array<{
    id: string;
    date: string;
    type: MovementType;
    typeLabel: string;
    status: StockStatus;
    statusLabel: string;
    quantity: number;
    skuId: string;
    name: string;
    barcode: string | null;
    sourceDocument: string | null;
    comment: string | null;
  }>;
};

@Injectable()
export class TurnoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly inventoryLock?: InventoryLockService,
    private readonly boxCodes?: BoxCodePolicyService,
  ) {}

  async list(query: ListTurnoverDto, user: AuthUser) {
    // Exact barcode lookup is intentionally cross-client, but still respects the user's accessible client scope.
    const clientFilter = this.clientScopes.resolveClientFilter(user, query.barcode?.trim() ? undefined : query.clientId);
    const skuWhere = this.buildSkuWhere(query, clientFilter);
    const movementDateRange = dateRange(query.dateFrom, query.dateTo);
    const kiz = query.kiz?.trim();
    const warehouseScope = await this.resolveWarehouseScope(user, clientFilter);
    const movementScopeWhere = this.movementWarehouseWhere(warehouseScope);
    const balanceScopeWhere = this.balanceWarehouseWhere(warehouseScope);
    const markScopeWhere = this.markWarehouseWhere(warehouseScope);

    const skus = await this.prisma.sku.findMany({
      where: {
        ...skuWhere,
        ...(movementDateRange
          ? {
              movements: {
                some: {
                  AND: [
                    { createdAt: movementDateRange },
                    ...(movementScopeWhere ? [movementScopeWhere] : []),
                  ],
                },
              },
            }
          : {}),
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
        balances: {
          ...(balanceScopeWhere ? { where: balanceScopeWhere } : {}),
          include: {
            box: {
              select: {
                id: true,
                code: true,
                status: true,
                zone: { select: { id: true, code: true, name: true } },
                storagePlacement: {
                  select: {
                    source: true,
                    pallet: {
                      select: {
                        id: true,
                        code: true,
                        zone: { select: { id: true, code: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
            pallet: {
              select: {
                id: true,
                code: true,
                status: true,
                zone: { select: { id: true, code: true, name: true } },
              },
            },
          },
          orderBy: [{ updatedAt: 'desc' }],
        },
        productMarks: {
          ...(kiz || markScopeWhere
            ? {
                where: {
                  AND: [
                    ...(kiz ? [{ value: { contains: kiz, mode: Prisma.QueryMode.insensitive } }] : []),
                    ...(markScopeWhere ? [markScopeWhere] : []),
                  ],
                },
              }
            : {}),
          select: { id: true, value: true, status: true, boxId: true, createdAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 30,
        },
        movements: {
          ...(movementDateRange || movementScopeWhere
            ? {
                where: {
                  AND: [
                    ...(movementDateRange ? [{ createdAt: movementDateRange }] : []),
                    ...(movementScopeWhere ? [movementScopeWhere] : []),
                  ],
                },
              }
            : {}),
          include: {
            box: { select: { id: true, code: true, status: true } },
            productMarks: { select: { id: true, value: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 250,
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...(query.limit ? { take: query.limit } : {}),
    });

    const [requestMap, storagePlacementMap] = await Promise.all([
      this.loadRequestMap(skus.flatMap((sku) => sku.movements)),
      this.loadStoragePlacementMap(skus),
    ]);

    const items = skus.map((sku) => this.mapSkuReport(sku, requestMap, storagePlacementMap));
    const totals = items.reduce(
      (acc, item) => ({
        skuCount: acc.skuCount + 1,
        currentQuantity: acc.currentQuantity + item.currentQuantity,
        receivedQuantity: acc.receivedQuantity + item.receivedQuantity,
        shippedQuantity: acc.shippedQuantity + item.shippedQuantity,
        writtenOffQuantity: acc.writtenOffQuantity + item.writtenOffQuantity,
      }),
      { skuCount: 0, currentQuantity: 0, receivedQuantity: 0, shippedQuantity: 0, writtenOffQuantity: 0 },
    );

    return {
      generatedAt: new Date().toISOString(),
      filters: normalizedFilters(query),
      totals,
      items,
    };
  }

  async statistics(query: TurnoverStatisticsDto, user: AuthUser) {
    this.requireInternalStatisticsAccess(user);

    const clientFilter = this.clientScopes.resolveClientFilter(user, query.barcode?.trim() ? undefined : query.clientId);
    const skuWhere = this.buildSkuWhere(query, clientFilter);
    const movementDateRange = dateRange(query.dateFrom, query.dateTo);
    const groupBy = query.groupBy ?? 'month';

    const skus = await this.prisma.sku.findMany({
      where: skuWhere,
      include: {
        client: { select: { id: true, code: true, name: true } },
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
      },
      orderBy: { updatedAt: 'desc' },
      ...(query.limit ? { take: query.limit } : {}),
    });
    const skuIds = skus.map((sku) => sku.id);

    if (skuIds.length === 0) {
      return emptyStatistics(query, groupBy);
    }

    const movementConditions: Prisma.Sql[] = [
      Prisma.sql`movement."skuId" IN (${Prisma.join(skuIds)})`,
    ];
    if (typeof clientFilter === 'string') {
      movementConditions.push(Prisma.sql`movement."clientId" = ${clientFilter}`);
    } else if (clientFilter && 'in' in clientFilter && clientFilter.in.length) {
      movementConditions.push(Prisma.sql`movement."clientId" IN (${Prisma.join(clientFilter.in)})`);
    } else if (clientFilter && 'notIn' in clientFilter && clientFilter.notIn.length) {
      movementConditions.push(Prisma.sql`movement."clientId" NOT IN (${Prisma.join(clientFilter.notIn)})`);
    }
    if (movementDateRange?.gte) {
      movementConditions.push(Prisma.sql`movement."createdAt" >= ${movementDateRange.gte}`);
    }
    if (movementDateRange?.lte) {
      movementConditions.push(Prisma.sql`movement."createdAt" <= ${movementDateRange.lte}`);
    }
    const periodExpression = turnoverStatisticsPeriodSql(groupBy);

    const [movementAggregates, balances] = await Promise.all([
      this.prisma.$queryRaw<TurnoverMovementAggregate[]>(Prisma.sql`
        SELECT
          movement."skuId" AS "skuId",
          ${periodExpression} AS "period",
          SUM(
            CASE
              WHEN movement."quantity" > 0
                AND movement."type" IN ('INITIAL_IMPORT', 'RECEIPT', 'RETURN', 'INVENTORY_ADJUSTMENT')
              THEN movement."quantity"
              ELSE 0
            END
          )::bigint AS "receivedQuantity",
          SUM(
            CASE
              WHEN movement."type" = 'SHIP' AND movement."quantity" < 0
              THEN -movement."quantity"
              ELSE 0
            END
          )::bigint AS "shippedQuantity",
          SUM(
            CASE
              WHEN movement."type" = 'INVENTORY_ADJUSTMENT' AND movement."quantity" < 0
              THEN -movement."quantity"
              ELSE 0
            END
          )::bigint AS "writtenOffQuantity"
        FROM "StockMovement" movement
        WHERE ${Prisma.join(movementConditions, ' AND ')}
        GROUP BY movement."skuId", 2
      `),
      this.prisma.stockBalance.groupBy({
        by: ['skuId'],
        where: {
          clientId: clientFilter,
          skuId: { in: skuIds },
        },
        _sum: { quantity: true },
      }),
    ]);

    const currentBySkuId = new Map<string, number>();
    balances.forEach((balance) => currentBySkuId.set(balance.skuId, balance._sum.quantity ?? 0));

    const rows = new Map<string, ReturnType<typeof emptyStatisticsRow>>();
    skus.forEach((sku) => {
      rows.set(sku.id, emptyStatisticsRow(sku, currentBySkuId.get(sku.id) ?? 0));
    });

    const trend = new Map<string, { period: string; receivedQuantity: number; shippedQuantity: number; writtenOffQuantity: number }>();

    for (const aggregate of movementAggregates) {
      const row = rows.get(aggregate.skuId);
      if (!row) continue;
      const receivedQuantity = Number(aggregate.receivedQuantity);
      const shippedQuantity = Number(aggregate.shippedQuantity);
      const writtenOffQuantity = Number(aggregate.writtenOffQuantity);
      const trendRow = trend.get(aggregate.period) ?? {
        period: aggregate.period,
        receivedQuantity: 0,
        shippedQuantity: 0,
        writtenOffQuantity: 0,
      };

      row.receivedQuantity += receivedQuantity;
      row.shippedQuantity += shippedQuantity;
      row.writtenOffQuantity += writtenOffQuantity;
      trendRow.receivedQuantity += receivedQuantity;
      trendRow.shippedQuantity += shippedQuantity;
      trendRow.writtenOffQuantity += writtenOffQuantity;

      trend.set(aggregate.period, trendRow);
      rows.set(row.skuId, row);
    }

    const rowList = Array.from(rows.values()).sort((a, b) => b.currentQuantity - a.currentQuantity || a.name.localeCompare(b.name));
    const totals = rowList.reduce(
      (acc, row) => ({
        receivedQuantity: acc.receivedQuantity + row.receivedQuantity,
        shippedQuantity: acc.shippedQuantity + row.shippedQuantity,
        writtenOffQuantity: acc.writtenOffQuantity + row.writtenOffQuantity,
        currentQuantity: acc.currentQuantity + row.currentQuantity,
      }),
      { receivedQuantity: 0, shippedQuantity: 0, writtenOffQuantity: 0, currentQuantity: 0 },
    );

    return {
      generatedAt: new Date().toISOString(),
      filters: normalizedFilters(query),
      groupBy,
      totals,
      rows: rowList,
      trend: Array.from(trend.values()).sort((a, b) => a.period.localeCompare(b.period)),
      clientWidgetCandidate: true,
    };
  }

  async suggestions(query: TurnoverSuggestionsDto, user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user, query.scope === 'barcode' ? undefined : query.clientId);
    const search = query.search?.trim();
    const searchText = search ? { contains: search, mode: Prisma.QueryMode.insensitive } : undefined;
    const warehouseScope = await this.resolveWarehouseScope(user, clientFilter);
    const balanceScopeWhere = this.balanceWarehouseWhere(warehouseScope);
    const markScopeWhere = this.markWarehouseWhere(warehouseScope);
    const boxScopeWhere = this.boxWarehouseWhere(warehouseScope);

    const [skus, barcodeRows, marks, boxes] = await Promise.all([
      this.prisma.sku.findMany({
        where: {
          clientId: clientFilter,
          ...(search
            ? {
                OR: [
                  { name: searchText },
                  { internalSku: searchText },
                  { clientSku: searchText },
                  { article: searchText },
                  { size: searchText },
                  { barcodes: { some: { value: { contains: search } } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          client: { select: { id: true, code: true, name: true } },
          internalSku: true,
          clientSku: true,
          article: true,
          name: true,
          color: true,
          size: true,
          barcodes: { select: { value: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }], take: 5 },
          balances: {
            ...(balanceScopeWhere ? { where: balanceScopeWhere } : {}),
            select: {
              quantity: true,
              status: true,
              updatedAt: true,
              box: { select: { code: true } },
            },
            orderBy: [{ updatedAt: 'desc' }],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 40,
      }),
      this.prisma.barcode.findMany({
        where: {
          ...(search ? { value: { contains: search } } : {}),
          sku: { clientId: clientFilter },
        },
        select: {
          value: true,
          isPrimary: true,
          sku: {
            select: {
              id: true,
              client: { select: { id: true, code: true, name: true } },
              internalSku: true,
              clientSku: true,
              article: true,
              name: true,
              color: true,
              size: true,
            },
          },
        },
        orderBy: { value: 'asc' },
        take: 60,
      }),
      this.prisma.productMark.findMany({
        where: {
          clientId: clientFilter,
          ...(search ? { value: searchText } : {}),
          ...(markScopeWhere ? { AND: [markScopeWhere] } : {}),
        },
        select: {
          id: true,
          value: true,
          status: true,
          sku: { select: { id: true, internalSku: true, article: true, name: true, barcodes: { select: { value: true }, take: 3 } } },
          box: { select: { id: true, code: true, status: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      this.prisma.box.findMany({
        where: {
          clientId: clientFilter,
          ...(search ? { code: searchText } : {}),
          ...(boxScopeWhere ?? {}),
        },
        select: { id: true, code: true, status: true },
        orderBy: { code: 'asc' },
        take: 60,
      }),
    ]);

    const products = skus.map((sku) => {
      const primaryBarcode = sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? null;
      const firstBalance = sku.balances.find((balance) => balance.box?.code && balance.quantity > 0) ?? sku.balances[0] ?? null;

      return {
        skuId: sku.id,
        client: sku.client,
        label: [sku.name, primaryBarcode ? `ШК ${primaryBarcode}` : null].filter(Boolean).join(' · '),
        name: sku.name,
        internalSku: sku.internalSku,
        clientSku: sku.clientSku,
        article: sku.article,
        color: sku.color,
        size: sku.size,
        barcode: primaryBarcode,
        quantity: sku.balances.reduce((sum, balance) => sum + balance.quantity, 0),
        boxCode: firstBalance?.box?.code ?? null,
        status: firstBalance?.status ?? null,
      };
    });

    const barcodes = uniqueByValue(
      [
        ...products
          .filter((product) => product.barcode)
          .map((product) => ({
            value: product.barcode!,
            label: product.barcode!,
            skuId: product.skuId,
            client: product.client,
            name: product.name,
            internalSku: product.internalSku,
            clientSku: product.clientSku,
            article: product.article,
            color: product.color,
            size: product.size,
          })),
        ...barcodeRows.map((row) => ({
          value: row.value,
          label: row.value,
          skuId: row.sku.id,
          client: row.sku.client,
          name: row.sku.name,
          internalSku: row.sku.internalSku,
          clientSku: row.sku.clientSku,
          article: row.sku.article,
          color: row.sku.color,
          size: row.sku.size,
        })),
      ],
      (row) => `${row.client.id}:${row.skuId}:${row.value}`,
    ).slice(0, 60);

    return {
      products,
      barcodes,
      kiz: marks.map((mark) => ({
        id: mark.id,
        value: mark.value,
        status: mark.status,
        skuId: mark.sku.id,
        name: mark.sku.name,
        internalSku: mark.sku.internalSku,
        article: mark.sku.article,
        barcode: mark.sku.barcodes[0]?.value ?? null,
        boxCode: mark.box?.code ?? null,
      })),
      boxes: boxes.map((box) => ({
        id: box.id,
        value: box.code,
        code: box.code,
        status: box.status,
      })),
    };
  }

  async boxDetails(boxCode: string, query: TurnoverBoxDetailsDto, user: AuthUser): Promise<TurnoverBoxDetails> {
    const cleanCode = boxCode.trim();
    if (!cleanCode) {
      throw new BadRequestException('Укажите номер короба.');
    }

    const clientFilter = this.clientScopes.resolveClientFilter(user, query.clientId);
    const warehouseScope = await this.resolveWarehouseScope(user, clientFilter);
    const box = await this.prisma.box.findFirst({
      where: {
        clientId: clientFilter,
        code: { equals: cleanCode, mode: Prisma.QueryMode.insensitive },
        ...(this.boxWarehouseWhere(warehouseScope) ?? {}),
      },
      select: {
        id: true,
        code: true,
        status: true,
        client: { select: { id: true, code: true, name: true } },
        storagePlacement: {
          select: {
            source: true,
            scannedAt: true,
            pallet: {
              select: {
                id: true,
                code: true,
                zone: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!box) {
      throw new NotFoundException('Короб не найден или недоступен текущему пользователю.');
    }

    const [balances, marks, movements] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: {
          clientId: box.client.id,
          boxId: box.id,
          quantity: { gt: 0 },
        },
        include: {
          sku: {
            include: {
              barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
            },
          },
        },
        orderBy: [{ sku: { name: 'asc' } }, { status: 'asc' }],
      }),
      this.prisma.productMark.findMany({
        where: {
          clientId: box.client.id,
          boxId: box.id,
        },
        select: {
          id: true,
          value: true,
          status: true,
          skuId: true,
        },
        orderBy: [{ skuId: 'asc' }, { value: 'asc' }],
        take: 500,
      }),
      this.prisma.stockMovement.findMany({
        where: {
          clientId: box.client.id,
          boxId: box.id,
        },
        include: {
          sku: {
            include: {
              barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 150,
      }),
    ]);

    const marksBySkuAndStatus = new Map<string, string[]>();
    marks.forEach((mark) => {
      const key = `${mark.skuId}:${mark.status}`;
      const current = marksBySkuAndStatus.get(key) ?? [];
      current.push(mark.value);
      marksBySkuAndStatus.set(key, current);
    });

    const contents = balances.map((balance) => {
      const primaryBarcode = balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? balance.sku.barcodes[0]?.value ?? null;
      const kiz = marksBySkuAndStatus.get(`${balance.skuId}:${balance.status}`) ?? [];

      return {
        balanceId: balance.id,
        skuId: balance.skuId,
        internalSku: balance.sku.internalSku,
        clientSku: balance.sku.clientSku,
        article: balance.sku.article,
        name: balance.sku.name,
        color: balance.sku.color,
        size: balance.sku.size,
        barcode: primaryBarcode,
        status: balance.status,
        statusLabel: stockStatusLabel(balance.status),
        quantity: balance.quantity,
        kiz: kiz.slice(0, 50),
        kizCount: kiz.length,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      box,
      totals: {
        rows: contents.length,
        skuCount: uniqueValues(contents.map((item) => item.skuId)).length,
        quantity: contents.reduce((sum, item) => sum + item.quantity, 0),
        kizCount: marks.length,
      },
      contents,
      movements: movements.map((movement) => {
        const primaryBarcode = movement.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? movement.sku.barcodes[0]?.value ?? null;

        return {
          id: movement.id,
          date: movement.createdAt.toISOString(),
          type: movement.type,
          typeLabel: movementTypeLabel(movement.type),
          status: movement.status,
          statusLabel: stockStatusLabel(movement.status),
          quantity: movement.quantity,
          skuId: movement.skuId,
          name: movement.sku.name,
          barcode: primaryBarcode,
          sourceDocument: movement.sourceDocument,
          comment: movement.comment,
        };
      }),
    };
  }

  async runAction(dto: TurnoverActionDto, user: AuthUser) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    this.clientScopes.requireClientAccess(user, dto.clientId, 'write');
    const idempotencyKey = dto.idempotencyKey?.trim() || `turnover:${dto.action}:${randomUUID()}`;
    const warehouseScope = await this.resolveWarehouseScope(user, dto.clientId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.stockMovement.findFirst({
        where: {
          idempotencyKey: { startsWith: `${idempotencyKey}:` },
          ...(this.movementWarehouseWhere(warehouseScope) ?? {}),
        },
      });

      if (existing) {
        return { status: 'ALREADY_APPLIED', idempotencyKey };
      }

      const sku = await this.resolveSku(tx, dto.clientId, dto.skuId, dto.barcode);
      const comment = this.actionComment(dto, user);
      const kizValues = parseKizValues(dto.kiz);
      await this.assertKizValuesInWarehouse(tx, dto.clientId, kizValues, warehouseScope);

      if (dto.action === TurnoverActionKind.REPLACE_BARCODE) {
        const sourceBalanceId = dto.sourceBalanceId?.trim();
        const sourceBoxCode = dto.sourceBoxCode?.trim();
        const targetBarcode = dto.targetBarcode?.trim();
        if (!sourceBalanceId || !sourceBoxCode || !targetBarcode) {
          throw new BadRequestException('Укажите строку остатка, исходный короб и новый ШК.');
        }
        if (!dto.reason?.trim()) {
          throw new BadRequestException('Укажите причину замены ШК.');
        }
        if (kizValues.length > 0) {
          throw new BadRequestException('При замене ШК КИЗы передавать нельзя.');
        }

        const balanceScopeWhere = this.balanceWarehouseWhere(warehouseScope);
        const sourceBalance = await tx.stockBalance.findFirst({
          where: {
            AND: [
              {
                id: sourceBalanceId,
                clientId: dto.clientId,
                skuId: sku.id,
                quantity: { gt: 0 },
                boxId: { not: null },
                status: {
                  in: [
                    StockStatus.AVAILABLE,
                    StockStatus.RECEIVING,
                    StockStatus.UNMARKED,
                    StockStatus.NEEDS_LABEL,
                    StockStatus.NEEDS_RELABEL,
                  ],
                },
              },
              ...(balanceScopeWhere ? [balanceScopeWhere] : []),
            ],
          },
          include: { box: true },
        });
        if (
          !sourceBalance?.box ||
          sourceBalance.box.code.localeCompare(sourceBoxCode, 'ru-RU', { sensitivity: 'accent' }) !== 0
        ) {
          throw new NotFoundException('Строка товара не найдена в указанном коробе. Обновите карточку короба.');
        }
        if (sourceBalance.quantity < dto.quantity) {
          throw new BadRequestException(`В выбранной строке доступно только ${sourceBalance.quantity} шт.`);
        }

        const marksCount = await tx.productMark.count({
          where: {
            clientId: dto.clientId,
            skuId: sku.id,
            boxId: sourceBalance.boxId,
            status: sourceBalance.status,
          },
        });
        if (marksCount > 0) {
          throw new BadRequestException(
            'У этой позиции есть КИЗы. Сначала исправьте привязку КИЗов отдельной операцией; автоматическая замена ШК запрещена.',
          );
        }

        const targetSku = await this.resolveSku(tx, dto.clientId, undefined, targetBarcode);
        if (targetSku.id === sku.id) {
          throw new BadRequestException('Новый ШК относится к тому же товару. Остаток менять не нужно.');
        }

        const targetWarehouseId =
          sourceBalance.warehouseId ?? sourceBalance.box.warehouseId ?? warehouseScope?.warehouseId ?? user.activeWarehouseId ?? null;
        if (!targetWarehouseId) {
          throw new BadRequestException('Не удалось определить филиал исправляемого остатка.');
        }

        // FIX: change the SKU in-place as one transaction; total box quantity is preserved.
        const reduced = await tx.stockBalance.updateMany({
          where: { id: sourceBalance.id, quantity: { gte: dto.quantity } },
          data: { quantity: { decrement: dto.quantity } },
        });
        if (reduced.count !== 1) {
          throw new BadRequestException('Остаток уже изменился. Обновите карточку короба и повторите операцию.');
        }
        await tx.stockBalance.deleteMany({ where: { id: sourceBalance.id, quantity: 0 } });
        await this.incrementBalance(tx, {
          warehouseId: targetWarehouseId,
          clientId: dto.clientId,
          skuId: targetSku.id,
          boxId: sourceBalance.boxId,
          palletId: sourceBalance.palletId,
          status: sourceBalance.status,
          quantity: dto.quantity,
        });

        const sourceBarcode =
          sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? 'не указан';
        const correctionComment = `${comment}. Исправление ШК: ${sourceBarcode} → ${targetBarcode}`;
        await tx.stockMovement.createMany({
          data: [
            {
              warehouseId: targetWarehouseId,
              clientId: dto.clientId,
              skuId: sku.id,
              boxId: sourceBalance.boxId,
              palletId: sourceBalance.palletId,
              type: MovementType.INVENTORY_ADJUSTMENT,
              status: sourceBalance.status,
              quantity: -dto.quantity,
              sourceDocument: 'barcode-correction',
              idempotencyKey: `${idempotencyKey}:barcode-correction:out`,
              comment: correctionComment,
            },
            {
              warehouseId: targetWarehouseId,
              clientId: dto.clientId,
              skuId: targetSku.id,
              boxId: sourceBalance.boxId,
              palletId: sourceBalance.palletId,
              type: MovementType.INVENTORY_ADJUSTMENT,
              status: sourceBalance.status,
              quantity: dto.quantity,
              sourceDocument: 'barcode-correction',
              idempotencyKey: `${idempotencyKey}:barcode-correction:in`,
              comment: correctionComment,
            },
          ],
        });

        return this.actionResult('APPLIED', idempotencyKey, targetSku, dto.quantity, sourceBalance.box.code);
      }

      if (dto.action === TurnoverActionKind.ADD) {
        const targetBox = dto.targetBoxCode
          ? await this.ensureBox(tx, dto.clientId, dto.targetBoxCode, warehouseScope)
          : null;
        if (!targetBox) {
          this.assertUnambiguousBoxlessClient(dto.clientId, warehouseScope);
        }
        const targetWarehouseId =
          targetBox?.warehouseId ?? warehouseScope?.warehouseId ?? user.activeWarehouseId ?? null;
        if (!targetWarehouseId) {
          throw new BadRequestException(
            'Выберите филиал перед добавлением остатка без короба.',
          );
        }
        await this.incrementBalance(tx, {
          warehouseId: targetWarehouseId,
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: targetBox?.id ?? null,
          palletId: targetBox?.palletId ?? null,
          status: StockStatus.AVAILABLE,
          quantity: dto.quantity,
        });
        const movement = await tx.stockMovement.create({
          data: {
            warehouseId: targetWarehouseId,
            clientId: dto.clientId,
            skuId: sku.id,
            boxId: targetBox?.id ?? null,
            palletId: targetBox?.palletId ?? null,
            type: MovementType.RECEIPT,
            status: StockStatus.AVAILABLE,
            quantity: dto.quantity,
            sourceDocument: 'turnover-action',
            idempotencyKey: `${idempotencyKey}:receipt`,
            comment,
          },
        });
        await this.attachKizValues(tx, dto.clientId, sku.id, targetBox?.id ?? null, movement.id, StockStatus.AVAILABLE, kizValues);
        return this.actionResult('APPLIED', idempotencyKey, sku, dto.quantity, targetBox?.code ?? null);
      }

      if (dto.action === TurnoverActionKind.TRANSFER || dto.action === TurnoverActionKind.HOLD) {
        if (!dto.targetBoxCode?.trim()) {
          throw new BadRequestException('Укажите ячейку или короб, куда переносим товар.');
        }

        const targetBox = await this.ensureBox(tx, dto.clientId, dto.targetBoxCode, warehouseScope);
        const targetStatus = dto.action === TurnoverActionKind.HOLD ? StockStatus.BLOCKED : StockStatus.AVAILABLE;
        const allocations = await this.decrementAvailable(
          tx,
          dto.clientId,
          sku.id,
          dto.quantity,
          dto.sourceBoxCode,
          warehouseScope,
        );

        for (const allocation of allocations) {
          await tx.stockMovement.create({
            data: {
              clientId: dto.clientId,
              skuId: sku.id,
              boxId: allocation.balance.boxId,
              palletId: allocation.balance.palletId,
              type: MovementType.MOVE,
              status: allocation.balance.status,
              quantity: -allocation.quantity,
              sourceDocument: 'turnover-action',
              idempotencyKey: `${idempotencyKey}:out:${allocation.balance.id}`,
              comment,
            },
          });
        }

        const targetWarehouseId =
          targetBox.warehouseId ?? warehouseScope?.warehouseId ?? user.activeWarehouseId ?? null;
        if (!targetWarehouseId) {
          throw new BadRequestException('Не удалось определить филиал целевого короба.');
        }
        await this.incrementBalance(tx, {
          warehouseId: targetWarehouseId,
          clientId: dto.clientId,
          skuId: sku.id,
          boxId: targetBox.id,
          palletId: targetBox.palletId,
          status: targetStatus,
          quantity: dto.quantity,
        });
        const movement = await tx.stockMovement.create({
          data: {
            warehouseId: targetWarehouseId,
            clientId: dto.clientId,
            skuId: sku.id,
            boxId: targetBox.id,
            palletId: targetBox.palletId,
            type: MovementType.MOVE,
            status: targetStatus,
            quantity: dto.quantity,
            sourceDocument: 'turnover-action',
            idempotencyKey: `${idempotencyKey}:in`,
            comment,
          },
        });
        await this.moveKizValues(tx, dto.clientId, sku.id, targetBox.id, movement.id, targetStatus, kizValues);
        return this.actionResult('APPLIED', idempotencyKey, sku, dto.quantity, targetBox.code);
      }

      const allocations = await this.decrementAvailable(
        tx,
        dto.clientId,
        sku.id,
        dto.quantity,
        dto.sourceBoxCode,
        warehouseScope,
      );
      for (const allocation of allocations) {
        const movement = await tx.stockMovement.create({
          data: {
            clientId: dto.clientId,
            skuId: sku.id,
            boxId: allocation.balance.boxId,
            palletId: allocation.balance.palletId,
            type: MovementType.INVENTORY_ADJUSTMENT,
            status: allocation.balance.status,
            quantity: -allocation.quantity,
            sourceDocument: 'turnover-action',
            idempotencyKey: `${idempotencyKey}:write-off:${allocation.balance.id}`,
            comment,
          },
        });
        const markStatus = dto.action === TurnoverActionKind.UTILIZE ? StockStatus.DEFECT : StockStatus.BLOCKED;
        await this.moveKizValues(tx, dto.clientId, sku.id, null, movement.id, markStatus, kizValues);
      }

      return this.actionResult('APPLIED', idempotencyKey, sku, dto.quantity, null);
    });
  }

  async getReceiptDocument(movementId: string, user: AuthUser): Promise<TurnoverReceiptDocument> {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const warehouseScope = await this.resolveWarehouseScope(user, clientFilter);
    const movementScopeWhere = this.movementWarehouseWhere(warehouseScope);
    const seed = await this.prisma.stockMovement.findFirst({
      where: {
        id: movementId,
        clientId: clientFilter,
        ...(movementScopeWhere ? { AND: [movementScopeWhere] } : {}),
      },
      include: receiptDocumentInclude,
    });

    if (!seed) {
      throw new NotFoundException('Движение прихода не найдено.');
    }

    this.clientScopes.requireClientAccess(user, seed.clientId, 'read');

    if (!isDocumentMovement(seed)) {
      throw new BadRequestException('По этому движению нет отдельного документа для просмотра.');
    }

    const sourceDocument = seed.sourceDocument?.trim() || null;
    const documentWhere =
      sourceDocument && sourceDocument !== 'turnover-action'
        ? documentGroupWhere(seed, sourceDocument)
        : { id: seed.id };
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        AND: [
          documentWhere,
          ...(movementScopeWhere ? [movementScopeWhere] : []),
        ],
      },
      include: receiptDocumentInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return buildReceiptDocument(seed.id, movements.length ? movements : [seed], sourceDocument);
  }

  async getReceiptDocumentXlsx(movementId: string, user: AuthUser) {
    const document = await this.getReceiptDocument(movementId, user);
    const content = buildTurnoverReceiptWorkbook(document);

    return {
      fileName: document.fileName,
      mimeType: turnoverReceiptXlsxMimeType(),
      content,
    };
  }

  async getReceiptPeriodXlsx(query: ListTurnoverDto, user: AuthUser) {
    if (!query.clientId) {
      throw new BadRequestException('Выберите клиента для выгрузки приемки.');
    }

    this.clientScopes.requireClientAccess(user, query.clientId, 'read');
    const warehouseScope = await this.resolveWarehouseScope(user, query.clientId);
    const movementScopeWhere = this.movementWarehouseWhere(warehouseScope);

    const client = await this.prisma.client.findUnique({
      where: { id: query.clientId },
      select: { id: true, code: true, name: true },
    });

    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const receiptBatchDate = query.receiptBatchDate?.trim() || null;
    const configuredReceiptPrefix = this.boxCodes
      ? (await this.boxCodes.getPolicy()).receiptPrefix
      : 'FFL_LKB';
    const receiptBoxPrefix = receiptBatchDate
      ? receiptBoxCodePrefixForDate(receiptBatchDate, configuredReceiptPrefix)
      : null;
    if (receiptBatchDate && !receiptBoxPrefix) {
      throw new BadRequestException('Дата партии приемки должна быть корректной датой в формате ГГГГ-ММ-ДД.');
    }

    const movementDateRange = receiptBatchDate ? undefined : dateRange(query.dateFrom, query.dateTo);
    const candidateMovements = await this.prisma.stockMovement.findMany({
      where: {
        AND: [
          {
            clientId: client.id,
            quantity: { gt: 0 },
            type: receiptBatchDate ? MovementType.RECEIPT : { in: INCOMING_DOCUMENT_MOVEMENT_TYPES },
            ...(movementDateRange ? { createdAt: movementDateRange } : {}),
            ...(receiptBoxPrefix
              ? { box: { code: { startsWith: receiptBoxPrefix, mode: Prisma.QueryMode.insensitive } } }
              : {}),
          },
          ...(movementScopeWhere ? [movementScopeWhere] : []),
        ],
      },
      include: receiptPeriodInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const movements = receiptBatchDate
      ? candidateMovements.filter(
          (movement) =>
            Boolean(movement.box?.code) &&
            receiptDateFromBoxCode(
              movement.box!.code,
              movement.createdAt,
              configuredReceiptPrefix,
            ) === receiptBatchDate,
        )
      : candidateMovements;

    const document = buildReceiptPeriodDocument(client, movements, query);
    const content = buildTurnoverReceiptPeriodWorkbook(document);

    return {
      fileName: document.fileName,
      mimeType: turnoverReceiptXlsxMimeType(),
      content,
    };
  }

  async getStockXlsx(query: TurnoverStockExportDto, user: AuthUser) {
    this.requireInternalStatisticsAccess(user);

    const clientId = query.clientId?.trim();
    if (!clientId) {
      throw new BadRequestException('Выберите клиента для выгрузки остатков.');
    }

    this.clientScopes.requireClientAccess(user, clientId, 'read');

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, code: true, name: true },
    });

    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    const ignoreActiveRequests = parseBooleanFlag(query.ignoreActiveRequests);
    const warehouseScope = await this.resolveWarehouseScope(user, clientId);
    const balanceScopeWhere = this.balanceWarehouseWhere(warehouseScope);
    const markScopeWhere = this.markWarehouseWhere(warehouseScope);
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        clientId,
        quantity: { gt: 0 },
        ...(balanceScopeWhere ? { AND: [balanceScopeWhere] } : {}),
      },
      include: stockExportBalanceInclude,
      orderBy: [{ updatedAt: 'desc' }],
    });

    const marks = await this.prisma.productMark.groupBy({
      by: ['skuId', 'boxId', 'status'],
      where: {
        clientId,
        ...(markScopeWhere ? { AND: [markScopeWhere] } : {}),
      },
      _count: { _all: true },
    });
    const markCountByBalance = new Map(
      marks.map((mark) => [stockExportMarkKey(mark.skuId, mark.boxId, mark.status), mark._count._all]),
    );

    const rows = balances
      .map((balance) => {
        const barcodes = balance.sku.barcodes.map((barcode) => barcode.value).filter(Boolean);
        const primaryBarcode = balance.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? barcodes[0] ?? null;

        return {
          position: 0,
          balanceId: balance.id,
          skuId: balance.skuId,
          barcodeSet: new Set(barcodes),
          boxCode: balance.box?.code ?? null,
          palletCode: balance.pallet?.code ?? null,
          internalSku: balance.sku.internalSku,
          clientSku: balance.sku.clientSku,
          article: balance.sku.article,
          name: balance.sku.name,
          color: balance.sku.color,
          size: balance.sku.size,
          barcode: primaryBarcode,
          allBarcodes: barcodes.join(', '),
          status: balance.status,
          statusLabel: stockStatusLabel(balance.status),
          physicalQuantity: balance.quantity,
          reservedQuantity: 0,
          exportQuantity: balance.quantity,
          volumeLiters: nullableNumber(balance.sku.volumeLiters),
          kizCount: markCountByBalance.get(stockExportMarkKey(balance.skuId, balance.boxId, balance.status)) ?? 0,
          updatedAt: balance.updatedAt.toISOString(),
        };
      })
      .sort(stockExportRowSort);

    if (!ignoreActiveRequests && rows.length > 0) {
      await this.applyActiveRequestReservations(clientId, rows, warehouseScope?.warehouseId);
    }

    const exportRows = rows
      .filter((row) => row.exportQuantity > 0)
      .map(({ barcodeSet: _barcodeSet, ...row }, index) => ({ ...row, position: index + 1 }));
    const generatedAt = new Date();
    const document: TurnoverStockExportDocument = {
      generatedAt: generatedAt.toISOString(),
      ignoreActiveRequests,
      fileName: `stock-${safeFileName(client.code)}-${formatIsoDate(generatedAt)}-${ignoreActiveRequests ? 'full' : 'available'}.xlsx`,
      client,
      totals: {
        rows: exportRows.length,
        skuCount: uniqueValues(exportRows.map((row) => row.skuId)).length,
        boxesCount: uniqueValues(exportRows.map((row) => row.boxCode).filter((boxCode): boxCode is string => Boolean(boxCode))).length,
        physicalQuantity: rows.reduce((sum, row) => sum + row.physicalQuantity, 0),
        reservedQuantity: rows.reduce((sum, row) => sum + row.reservedQuantity, 0),
        exportQuantity: exportRows.reduce((sum, row) => sum + row.exportQuantity, 0),
      },
      rows: exportRows,
    };

    return {
      fileName: document.fileName,
      mimeType: turnoverReceiptXlsxMimeType(),
      content: buildTurnoverStockWorkbook(document),
    };
  }

  private async applyActiveRequestReservations(
    clientId: string,
    rows: StockExportWorkingRow[],
    warehouseId?: string,
  ) {
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId,
        ...(warehouseId ? { warehouseId } : {}),
        type: ClientRequestType.OUTBOUND,
        status: { in: ACTIVE_STOCK_EXPORT_REQUEST_STATUSES },
      },
      select: {
        items: {
          select: {
            skuId: true,
            barcode: true,
            quantity: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (requests.length === 0) {
      return;
    }

    const rowsBySkuId = new Map<string, StockExportWorkingRow[]>();
    const rowsByBarcode = new Map<string, StockExportWorkingRow[]>();
    rows.forEach((row) => {
      const skuRows = rowsBySkuId.get(row.skuId) ?? [];
      skuRows.push(row);
      rowsBySkuId.set(row.skuId, skuRows);

      row.barcodeSet.forEach((barcode) => {
        const barcodeRows = rowsByBarcode.get(barcode) ?? [];
        barcodeRows.push(row);
        rowsByBarcode.set(barcode, barcodeRows);
      });
    });

    requests.forEach((request) => {
      request.items.forEach((item) => {
        let remainingQuantity = Math.max(0, item.quantity);
        if (remainingQuantity === 0) {
          return;
        }

        const skuRows = item.skuId ? rowsBySkuId.get(item.skuId) ?? [] : [];
        const barcodeRows = item.barcode ? rowsByBarcode.get(item.barcode) ?? [] : [];
        const candidates = (skuRows.length > 0 ? skuRows : barcodeRows).slice().sort(stockExportReservationSort);

        for (const row of candidates) {
          if (remainingQuantity <= 0) {
            break;
          }

          const takeQuantity = Math.min(row.exportQuantity, remainingQuantity);
          if (takeQuantity <= 0) {
            continue;
          }

          row.reservedQuantity += takeQuantity;
          row.exportQuantity -= takeQuantity;
          remainingQuantity -= takeQuantity;
        }
      });
    });
  }

  private buildSkuWhere(query: ListTurnoverDto, clientFilter: ClientFilter): Prisma.SkuWhereInput {
    const search = query.search?.trim();
    const barcode = query.barcode?.trim();
    const kiz = query.kiz?.trim();

    return {
      clientId: clientFilter,
      ...(query.skuId ? { id: query.skuId } : {}),
      ...(barcode ? { barcodes: { some: { value: barcode } } } : {}),
      ...(kiz ? { productMarks: { some: { value: { contains: kiz, mode: Prisma.QueryMode.insensitive } } } } : {}),
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
    };
  }

  private async loadRequestMap(movements: TurnoverMovement[]) {
    const ids = uniqueValues(movements.map((movement) => extractUuid(movement.sourceDocument)).filter((id): id is string => Boolean(id)));
    if (ids.length === 0) {
      return new Map<string, { id: string; title: string; status: string; destinationCity: string | null; createdAt: Date }>();
    }

    const requests = await this.prisma.clientRequest.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, status: true, destinationCity: true, createdAt: true },
    });

    return new Map(requests.map((request) => [request.id, request]));
  }

  private async loadStoragePlacementMap(skus: TurnoverSku[]) {
    const boxIds = uniqueValues(
      skus.flatMap((sku) => sku.balances.map((balance) => balance.boxId).filter((id): id is string => Boolean(id))),
    );
    const boxCodes = uniqueValues(
      skus.flatMap((sku) => sku.balances.map((balance) => balance.box?.code).filter((code): code is string => Boolean(code))),
    );

    if (boxIds.length === 0 && boxCodes.length === 0) {
      return new Map<string, TurnoverStoragePlacement>();
    }

    const placements = await this.prisma.storagePalletBox.findMany({
      where: {
        OR: [
          ...(boxIds.length ? [{ boxId: { in: boxIds } }] : []),
          ...(boxCodes.length ? [{ boxCode: { in: boxCodes } }] : []),
        ],
      },
      select: {
        boxId: true,
        boxCode: true,
        source: true,
        pallet: {
          select: {
            id: true,
            code: true,
            zone: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    const result = new Map<string, TurnoverStoragePlacement>();
    placements.forEach((placement) => {
      const value = { source: placement.source, pallet: placement.pallet };
      if (placement.boxId) result.set(`id:${placement.boxId}`, value);
      result.set(`code:${placement.boxCode.trim().toLocaleUpperCase('ru-RU')}`, value);
    });
    return result;
  }

  private mapSkuReport(
    sku: TurnoverSku,
    requestMap: Map<string, { id: string; title: string; status: string; destinationCity: string | null; createdAt: Date }>,
    storagePlacementMap: Map<string, TurnoverStoragePlacement>,
  ) {
    const firstReceipt = sku.movements.find(isReceiptMovement) ?? null;
    const latestShip = [...sku.movements].reverse().find((movement) => movement.type === MovementType.SHIP && movement.quantity < 0) ?? null;
    const latestNegative =
      [...sku.movements].reverse().find((movement) => movement.quantity < 0 && movement.type !== MovementType.PICK) ?? null;
    const currentQuantity = sku.balances.reduce((sum, balance) => sum + balance.quantity, 0);
    const receivedQuantity = sku.movements.filter(isReceiptMovement).reduce((sum, movement) => sum + movement.quantity, 0);
    const shippedQuantity = sku.movements
      .filter((movement) => movement.type === MovementType.SHIP && movement.quantity < 0)
      .reduce((sum, movement) => sum + Math.abs(movement.quantity), 0);
    const writtenOffQuantity = sku.movements
      .filter((movement) => movement.type === MovementType.INVENTORY_ADJUSTMENT && movement.quantity < 0)
      .reduce((sum, movement) => sum + Math.abs(movement.quantity), 0);
    const request = latestShip ? requestMap.get(extractUuid(latestShip.sourceDocument) ?? '') ?? null : null;
    const lastExit = currentQuantity === 0 ? latestNegative : null;

    return {
      skuId: sku.id,
      client: sku.client,
      internalSku: sku.internalSku,
      clientSku: sku.clientSku,
      article: sku.article,
      name: sku.name,
      color: sku.color,
      size: sku.size,
      primaryBarcode: sku.barcodes[0]?.value ?? null,
      barcodes: sku.barcodes.map((barcode) => barcode.value),
      volumeLiters: nullableNumber(sku.volumeLiters),
      firstReceiptAt: firstReceipt?.createdAt.toISOString() ?? null,
      firstCell: firstReceipt?.box?.code ?? null,
      shippedByRequest: request,
      latestShipAt: latestShip?.createdAt.toISOString() ?? null,
      writtenOffAt: lastExit?.createdAt.toISOString() ?? null,
      storageDays: firstReceipt ? daysBetween(firstReceipt.createdAt, lastExit?.createdAt ?? latestShip?.createdAt ?? new Date()) : 0,
      receivedQuantity,
      shippedQuantity,
      writtenOffQuantity,
      currentQuantity,
      currentCells: sku.balances.map((balance) => {
        const storagePlacement = balance.box?.storagePlacement
          ?? (balance.boxId ? storagePlacementMap.get(`id:${balance.boxId}`) : null)
          ?? (balance.box?.code
            ? storagePlacementMap.get(`code:${balance.box.code.trim().toLocaleUpperCase('ru-RU')}`)
            : null)
          ?? null;
        const storageZone = storagePlacement?.pallet.zone ?? balance.box?.zone ?? balance.pallet?.zone ?? null;

        return {
          boxId: balance.boxId,
          boxCode: balance.box?.code ?? 'Без короба',
          palletCode: balance.pallet?.code ?? null,
          palletSortCode: storagePlacement?.pallet.code ?? null,
          storageZone,
          placementSource: storagePlacement?.source ?? null,
          status: balance.status,
          quantity: balance.quantity,
        };
      }),
      kiz: sku.productMarks.map((mark) => ({
        id: mark.id,
        value: mark.value,
        status: mark.status,
        createdAt: mark.createdAt.toISOString(),
      })),
      movements: sku.movements.map((movement) => {
        const movementRequest = requestMap.get(extractUuid(movement.sourceDocument) ?? '') ?? null;

        return {
          id: movement.id,
          date: movement.createdAt.toISOString(),
          type: movement.type,
          typeLabel: movementTypeLabel(movement.type),
          status: movement.status,
          statusLabel: stockStatusLabel(movement.status),
          quantity: movement.quantity,
          boxCode: movement.box?.code ?? null,
          palletCode: null,
          sourceDocument: movement.sourceDocument,
          request: movementRequest,
          comment: movement.comment,
          kiz: movement.productMarks.map((mark) => mark.value),
        };
      }),
    };
  }

  private requireInternalStatisticsAccess(user: AuthUser) {
    if (user.permissionCodes.includes('system:admin')) {
      return;
    }

    if (user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER', 'BRANCH_MANAGER'].includes(role))) {
      return;
    }

    throw new ForbiddenException('Статистика товарооборота доступна администратору, владельцу и менеджеру.');
  }

  private async resolveWarehouseScope(
    user: AuthUser,
    clientFilter: ClientFilter,
  ): Promise<TurnoverWarehouseScope | null> {
    const warehouseId = warehouseScopedInternalWarehouseId(user);
    if (!warehouseId) return null;

    const clients = await this.prisma.client.findMany({
      where: { id: clientFilter, storesWithoutBoxes: true },
      select: {
        id: true,
        warehouseLinks: {
          where: { status: 'ACTIVE' },
          select: { warehouseId: true },
        },
      },
    });
    return {
      warehouseId,
      boxlessClientIds: clients
        .filter(
          (client) =>
            client.warehouseLinks.some((link) => link.warehouseId === warehouseId),
        )
        .map((client) => client.id),
      legacyBoxlessClientIds: clients
        .filter(
          (client) =>
            client.warehouseLinks.length === 1 &&
            client.warehouseLinks[0].warehouseId === warehouseId,
        )
        .map((client) => client.id),
    };
  }

  private balanceWarehouseWhere(
    scope: TurnoverWarehouseScope | null,
  ): Prisma.StockBalanceWhereInput | undefined {
    if (!scope) return undefined;
    return {
      OR: [
        { warehouseId: scope.warehouseId },
        {
          warehouseId: null,
          boxId: { not: null },
          box: { warehouseId: scope.warehouseId },
        },
        {
          warehouseId: null,
          boxId: null,
          palletId: { not: null },
          pallet: { zone: { warehouseId: scope.warehouseId } },
        },
      ],
    };
  }

  private movementWarehouseWhere(
    scope: TurnoverWarehouseScope | null,
  ): Prisma.StockMovementWhereInput | undefined {
    if (!scope) return undefined;
    return {
      OR: [
        { warehouseId: scope.warehouseId },
        {
          warehouseId: null,
          boxId: { not: null },
          box: { warehouseId: scope.warehouseId },
        },
        ...(scope.legacyBoxlessClientIds.length
          ? [{ warehouseId: null, boxId: null, palletId: null, clientId: { in: scope.legacyBoxlessClientIds } }]
          : []),
      ],
    };
  }

  private markWarehouseWhere(
    scope: TurnoverWarehouseScope | null,
  ): Prisma.ProductMarkWhereInput | undefined {
    if (!scope) return undefined;
    return {
      OR: [
        { boxId: { not: null }, box: { warehouseId: scope.warehouseId } },
        ...(scope.legacyBoxlessClientIds.length
          ? [{ boxId: null, clientId: { in: scope.legacyBoxlessClientIds } }]
          : []),
      ],
    };
  }

  private boxWarehouseWhere(
    scope: TurnoverWarehouseScope | null,
  ): Prisma.BoxWhereInput | undefined {
    return scope ? { warehouseId: scope.warehouseId } : undefined;
  }

  private assertUnambiguousBoxlessClient(
    clientId: string,
    scope: TurnoverWarehouseScope | null,
  ) {
    if (scope && !scope.boxlessClientIds.includes(clientId)) {
      throw new BadRequestException(
        'Операция без короба недоступна: клиент работает более чем в одном филиале.',
      );
    }
  }

  private async resolveSku(tx: Prisma.TransactionClient, clientId: string, skuId?: string, barcode?: string) {
    const sku = skuId
      ? await tx.sku.findFirst({ where: { id: skuId, clientId }, include: { barcodes: true } })
      : await tx.sku.findFirst({
          where: {
            clientId,
            barcodes: { some: { value: barcode?.trim() } },
          },
          include: { barcodes: true },
        });

    if (!sku) {
      throw new NotFoundException('Товар не найден в каталоге клиента.');
    }

    return sku;
  }

  private async ensureBox(
    tx: Prisma.TransactionClient,
    clientId: string,
    code: string,
    warehouseScope: TurnoverWarehouseScope | null,
  ) {
    const cleanCode = code.trim();
    if (!cleanCode) {
      throw new BadRequestException('Укажите номер ячейки или короба.');
    }

    const existing = await tx.box.findUnique({
      where: { clientId_code: { clientId, code: cleanCode } },
    });
    if (existing) {
      if (warehouseScope && existing.warehouseId !== warehouseScope.warehouseId) {
        throw new NotFoundException('Короб не найден в текущем филиале.');
      }
      return existing;
    }
    return tx.box.create({
      data: {
        clientId,
        code: cleanCode,
        ...(warehouseScope ? { warehouseId: warehouseScope.warehouseId } : {}),
      },
    });
  }

  private async decrementAvailable(
    tx: Prisma.TransactionClient,
    clientId: string,
    skuId: string,
    quantity: number,
    sourceBoxCode?: string,
    warehouseScope: TurnoverWarehouseScope | null = null,
  ): Promise<SourceAllocation[]> {
    const sourceBox = sourceBoxCode?.trim()
      ? await tx.box.findUnique({ where: { clientId_code: { clientId, code: sourceBoxCode.trim() } } })
      : null;

    if (sourceBoxCode?.trim() && !sourceBox) {
      throw new NotFoundException('Исходная ячейка или короб не найдены.');
    }

    if (sourceBox && warehouseScope && sourceBox.warehouseId !== warehouseScope.warehouseId) {
      throw new NotFoundException('Исходный короб не найден в текущем филиале.');
    }

    const balances = await tx.stockBalance.findMany({
      where: {
        clientId,
        skuId,
        quantity: { gt: 0 },
        boxId: sourceBoxCode?.trim() ? sourceBox?.id : undefined,
        status: { in: [StockStatus.AVAILABLE, StockStatus.RECEIVING, StockStatus.UNMARKED, StockStatus.NEEDS_LABEL, StockStatus.NEEDS_RELABEL] },
        ...(this.balanceWarehouseWhere(warehouseScope) ?? {}),
      },
      include: {
        box: { select: { id: true, code: true, status: true, palletId: true } },
      },
      orderBy: [{ updatedAt: 'asc' }],
    });

    let remaining = quantity;
    const allocations: SourceAllocation[] = [];

    for (const balance of balances) {
      if (remaining <= 0) {
        break;
      }

      const take = Math.min(balance.quantity, remaining);
      const updated = await tx.stockBalance.update({
        where: { id: balance.id },
        data: { quantity: { decrement: take } },
      });
      if (updated.quantity < 0) {
        throw new BadRequestException('Складская операция увела остаток в минус.');
      }
      if (updated.quantity === 0) {
        await tx.stockBalance.delete({ where: { id: balance.id } });
      }

      allocations.push({ balance, quantity: take });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new BadRequestException('Недостаточно доступного остатка для операции.');
    }

    return allocations;
  }

  private incrementBalance(
    tx: Prisma.TransactionClient,
    input: {
      warehouseId: string;
      clientId: string;
      skuId: string;
      boxId: string | null;
      palletId: string | null;
      status: StockStatus;
      quantity: number;
    },
  ) {
    const keyParts = [
      input.clientId,
      input.skuId,
      input.boxId ?? 'no-box',
      input.palletId ?? 'no-pallet',
      input.status,
    ];
    if (!input.boxId && !input.palletId) {
      keyParts.push('warehouse', input.warehouseId);
    }
    const balanceKey = keyParts.join(':');

    return tx.stockBalance.upsert({
      where: { balanceKey },
      update: {
        quantity: { increment: input.quantity },
        warehouseId: input.warehouseId,
      },
      create: {
        balanceKey,
        warehouseId: input.warehouseId,
        clientId: input.clientId,
        skuId: input.skuId,
        boxId: input.boxId,
        palletId: input.palletId,
        status: input.status,
        quantity: input.quantity,
      },
    });
  }

  private actionComment(dto: TurnoverActionDto, user: AuthUser) {
    const parts = [
      actionLabel(dto.action),
      dto.reason?.trim() ? `Причина: ${dto.reason.trim()}` : null,
      dto.photoFileName?.trim() ? `Фото: ${dto.photoFileName.trim()}` : null,
      dto.comment?.trim() ? dto.comment.trim() : null,
      `Пользователь: ${user.name}`,
    ];

    return parts.filter(Boolean).join('. ');
  }

  private async attachKizValues(
    tx: Prisma.TransactionClient,
    clientId: string,
    skuId: string,
    boxId: string | null,
    movementId: string,
    status: StockStatus,
    values: string[],
  ) {
    for (const value of values) {
      await tx.productMark.upsert({
        where: { clientId_value: { clientId, value } },
        update: { skuId, boxId, stockMovementId: movementId, status },
        create: { clientId, skuId, boxId, stockMovementId: movementId, value, status, sourceDocument: 'turnover-action' },
      });
    }
  }

  private async moveKizValues(
    tx: Prisma.TransactionClient,
    clientId: string,
    skuId: string,
    boxId: string | null,
    movementId: string,
    status: StockStatus,
    values: string[],
  ) {
    if (values.length === 0) {
      return;
    }

    await tx.productMark.updateMany({
      where: { clientId, skuId, value: { in: values } },
      data: { boxId, stockMovementId: movementId, status },
    });
  }

  private async assertKizValuesInWarehouse(
    tx: Prisma.TransactionClient,
    clientId: string,
    values: string[],
    scope: TurnoverWarehouseScope | null,
  ) {
    if (!scope || values.length === 0) return;

    const existingMarks = await tx.productMark.findMany({
      where: { clientId, value: { in: values } },
      select: {
        value: true,
        boxId: true,
        box: { select: { warehouseId: true } },
      },
    });
    const hasForeignMark = existingMarks.some((mark) =>
      mark.boxId
        ? mark.box?.warehouseId !== scope.warehouseId
        : !scope.boxlessClientIds.includes(clientId),
    );
    if (hasForeignMark) {
      throw new NotFoundException('КИЗ не найден в текущем филиале.');
    }
  }

  private actionResult(status: 'APPLIED' | 'ALREADY_APPLIED', idempotencyKey: string, sku: { id: string; name: string }, quantity?: number, targetBoxCode?: string | null) {
    return {
      status,
      idempotencyKey,
      skuId: sku.id,
      skuName: sku.name,
      quantity,
      targetBoxCode,
    };
  }
}

const INCOMING_DOCUMENT_MOVEMENT_TYPES: MovementType[] = [
  MovementType.INITIAL_IMPORT,
  MovementType.RECEIPT,
  MovementType.RETURN,
];

function warehouseScopedInternalWarehouseId(user: AuthUser) {
  if (
    !user.activeWarehouseId ||
    user.roleCodes.includes('CLIENT')
  ) {
    return null;
  }
  return user.activeWarehouseId;
}

const DOCUMENT_MOVEMENT_TYPES: MovementType[] = [...INCOMING_DOCUMENT_MOVEMENT_TYPES, MovementType.SHIP];

const ACTIVE_STOCK_EXPORT_REQUEST_STATUSES: ClientRequestStatus[] = [
  ClientRequestStatus.IN_WORK,
];

const stockExportBalanceInclude = {
  sku: {
    include: {
      barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
    },
  },
  box: { select: { id: true, code: true, status: true } },
  pallet: { select: { id: true, code: true, status: true } },
} satisfies Prisma.StockBalanceInclude;

const receiptDocumentInclude = {
  client: { select: { id: true, code: true, name: true } },
  sku: {
    select: {
      id: true,
      internalSku: true,
      clientSku: true,
      article: true,
      name: true,
      color: true,
      size: true,
      barcodes: { select: { value: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
    },
  },
  box: { select: { id: true, code: true, status: true } },
  productMarks: { select: { value: true, sourceRow: true }, orderBy: [{ sourceRow: 'asc' }, { value: 'asc' }] },
} satisfies Prisma.StockMovementInclude;

type ReceiptDocumentMovement = Prisma.StockMovementGetPayload<{ include: typeof receiptDocumentInclude }>;

const receiptPeriodInclude = {
  sku: {
    select: {
      id: true,
      internalSku: true,
      clientSku: true,
      name: true,
      color: true,
      size: true,
      barcodes: { select: { value: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
    },
  },
  box: { select: { id: true, code: true } },
  productMarks: { select: { value: true }, orderBy: [{ value: 'asc' }] },
} satisfies Prisma.StockMovementInclude;

type ReceiptPeriodMovement = Prisma.StockMovementGetPayload<{ include: typeof receiptPeriodInclude }>;

function buildReceiptDocument(movementId: string, movements: ReceiptDocumentMovement[], sourceDocument: string | null): TurnoverReceiptDocument {
  const first = movements[0];
  const last = movements[movements.length - 1] ?? first;
  const rows = movements.map((movement, index) => {
    const primaryBarcode = movement.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? movement.sku.barcodes[0]?.value ?? null;
    const sourceRows = uniqueValues(movement.productMarks.map((mark) => mark.sourceRow).filter((row): row is number => row != null));

    return {
      position: index + 1,
      movementId: movement.id,
      date: movement.createdAt.toISOString(),
      boxCode: movement.box?.code ?? null,
      barcode: primaryBarcode,
      internalSku: movement.sku.internalSku,
      clientSku: movement.sku.clientSku,
      article: movement.sku.article,
      name: movement.sku.name,
      color: movement.sku.color,
      size: movement.sku.size,
      quantity: Math.abs(movement.quantity),
      status: movement.status,
      statusLabel: stockStatusLabel(movement.status),
      kiz: movement.productMarks.map((mark) => mark.value).join(', ') || null,
      sourceRows,
      comment: movement.comment,
    };
  });

  const sourceName = sourceDocument || `movement-${movementId.slice(0, 8)}`;

  return {
    movementId,
    sourceDocument,
    type: first.type,
    typeLabel: movementTypeLabel(first.type),
    generatedAt: new Date().toISOString(),
    periodFrom: first.createdAt.toISOString(),
    periodTo: last.createdAt.toISOString(),
    totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    skuCount: uniqueValues(rows.map((row) => row.internalSku)).length,
    boxesCount: uniqueValues(rows.map((row) => row.boxCode).filter((boxCode): boxCode is string => Boolean(boxCode))).length,
    fileName: `movement-${safeFileName(first.client.code)}-${safeFileName(sourceName)}.xlsx`,
    client: first.client,
    rows,
  };
}

function buildReceiptPeriodDocument(
  client: { id: string; code: string; name: string },
  movements: ReceiptPeriodMovement[],
  query: ListTurnoverDto,
): TurnoverReceiptPeriodDocument {
  const rows = movements.flatMap((movement) => receiptPeriodRowsFromMovement(movement));
  const periodFrom = query.receiptBatchDate ?? query.dateFrom ?? movements[0]?.createdAt.toISOString() ?? null;
  const periodTo = query.receiptBatchDate ?? query.dateTo ?? movements[movements.length - 1]?.createdAt.toISOString() ?? null;
  const periodName = query.receiptBatchDate
    ? `batch-${query.receiptBatchDate}`
    : [query.dateFrom || 'all', query.dateTo || query.dateFrom || 'all'].join('_');

  return {
    generatedAt: new Date().toISOString(),
    periodFrom,
    periodTo,
    totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    skuCount: uniqueValues(movements.map((movement) => movement.skuId)).length,
    boxesCount: uniqueValues(rows.map((row) => row.boxCode).filter((boxCode): boxCode is string => Boolean(boxCode))).length,
    fileName: `receipt-${safeFileName(client.code)}-${safeFileName(periodName)}.xlsx`,
    client,
    rows: rows.map((row, index) => ({ ...row, position: index + 1 })),
  };
}

function receiptPeriodRowsFromMovement(movement: ReceiptPeriodMovement): Omit<TurnoverReceiptPeriodDocument['rows'][number], 'position'>[] {
  const primaryBarcode = movement.sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? movement.sku.barcodes[0]?.value ?? null;
  const marks = movement.productMarks.map((mark) => mark.value).filter(Boolean);
  const baseRow = {
    movementId: movement.id,
    date: movement.createdAt.toISOString(),
    boxCode: movement.box?.code ?? null,
    barcode: primaryBarcode,
    name: movement.sku.name,
    clientSku: movement.sku.clientSku,
    color: movement.sku.color,
    size: movement.sku.size,
    sourceDocument: movement.sourceDocument,
  };

  if (marks.length === 0) {
    return [
      {
        ...baseRow,
        kiz: null,
        quantity: Math.abs(movement.quantity),
      },
    ];
  }

  const rows: Omit<TurnoverReceiptPeriodDocument['rows'][number], 'position'>[] = marks.map((kiz) => ({
    ...baseRow,
    kiz,
    quantity: 1,
  }));
  const quantityWithoutKiz = Math.max(0, Math.abs(movement.quantity) - marks.length);

  if (quantityWithoutKiz > 0) {
    rows.push({
      ...baseRow,
      kiz: null,
      quantity: quantityWithoutKiz,
    });
  }

  return rows;
}

function isDocumentMovement(movement: { type: MovementType; quantity: number }) {
  if (!DOCUMENT_MOVEMENT_TYPES.includes(movement.type)) {
    return false;
  }

  return movement.type === MovementType.SHIP ? movement.quantity < 0 : movement.quantity > 0;
}

function documentGroupWhere(seed: ReceiptDocumentMovement, sourceDocument: string): Prisma.StockMovementWhereInput {
  if (seed.type === MovementType.SHIP) {
    return {
      clientId: seed.clientId,
      sourceDocument,
      type: MovementType.SHIP,
      quantity: { lt: 0 },
    };
  }

  return {
    clientId: seed.clientId,
    sourceDocument,
    quantity: { gt: 0 },
    type: { in: INCOMING_DOCUMENT_MOVEMENT_TYPES },
  };
}

function isReceiptMovement(movement: { type: MovementType; quantity: number }) {
  const receiptMovementTypes: MovementType[] = [
    MovementType.INITIAL_IMPORT,
    MovementType.RECEIPT,
    MovementType.RETURN,
    MovementType.INVENTORY_ADJUSTMENT,
  ];

  return (
    movement.quantity > 0 &&
    receiptMovementTypes.includes(movement.type)
  );
}

function dateRange(dateFrom?: string, dateTo?: string) {
  if (!dateFrom && !dateTo) {
    return undefined;
  }

  return {
    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
    ...(dateTo ? { lte: endOfDay(new Date(dateTo)) } : {}),
  };
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function normalizedFilters(query: ListTurnoverDto) {
  return {
    clientId: query.clientId ?? null,
    skuId: query.skuId ?? null,
    barcode: query.barcode ?? null,
    kiz: query.kiz ?? null,
    search: query.search ?? null,
    dateFrom: query.dateFrom ?? null,
    dateTo: query.dateTo ?? null,
  };
}

function daysBetween(from: Date, to: Date) {
  const start = new Date(from);
  const end = new Date(to);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

function nullableNumber(value: Prisma.Decimal | number | null) {
  return value == null ? null : Number(value);
}

function movementTypeLabel(type: MovementType) {
  const labels: Record<MovementType, string> = {
    INITIAL_IMPORT: 'Первичная загрузка',
    RECEIPT: 'Приемка',
    MOVE: 'Перемещение',
    RESERVE: 'Резерв',
    PICK: 'Сборка',
    PACK: 'Упаковка',
    SHIP: 'Отгрузка',
    RETURN: 'Возврат',
    INVENTORY_ADJUSTMENT: 'Корректировка',
  };

  return labels[type];
}

function stockStatusLabel(status: StockStatus) {
  const labels: Record<StockStatus, string> = {
    AVAILABLE: 'Доступно',
    IN_TRANSIT: 'В пути между филиалами',
    RESERVED: 'Резерв',
    RECEIVING: 'Приемка',
    PACKING: 'Сборка',
    SHIPPING: 'Отгрузка',
    BLOCKED: 'Отложено',
    DEFECT: 'Дефект',
    QUARANTINE: 'Карантин',
    UNMARKED: 'Без маркировки',
    NEEDS_LABEL: 'Нужна этикетка',
    NEEDS_RELABEL: 'Нужна перемаркировка',
  };

  return labels[status];
}

function actionLabel(action: TurnoverActionKind) {
  const labels: Record<TurnoverActionKind, string> = {
    ADD: 'Добавление товара',
    WRITE_OFF: 'Списание товара',
    TRANSFER: 'Перенос товара',
    UTILIZE: 'Утилизация товара',
    HOLD: 'Отложено на отдельное хранение',
    REPLACE_BARCODE: 'Исправление ошибочного ШК', // ADDED
  };

  return labels[action];
}

function extractUuid(value?: string | null) {
  return value?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0] ?? null;
}

function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values));
}

function uniqueByValue<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(value);
  }

  return result;
}

function parseKizValues(value?: string) {
  return uniqueValues(
    (value ?? '')
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function stockExportRowSort(a: StockExportWorkingRow, b: StockExportWorkingRow) {
  return (
    (a.boxCode ?? '').localeCompare(b.boxCode ?? '', 'ru') ||
    a.name.localeCompare(b.name, 'ru') ||
    (a.barcode ?? '').localeCompare(b.barcode ?? '', 'ru') ||
    a.status.localeCompare(b.status)
  );
}

function stockExportReservationSort(a: StockExportWorkingRow, b: StockExportWorkingRow) {
  return (
    stockExportReservationStatusWeight(a.status) - stockExportReservationStatusWeight(b.status) ||
    stockExportRowSort(a, b)
  );
}

function stockExportReservationStatusWeight(status: StockStatus) {
  const weights: Partial<Record<StockStatus, number>> = {
    PACKING: 0,
    SHIPPING: 1,
    RESERVED: 2,
    AVAILABLE: 3,
  };

  return weights[status] ?? 9;
}

function stockExportMarkKey(skuId: string, boxId: string | null, status: StockStatus) {
  return [skuId, boxId ?? 'no-box', status].join(':');
}

function parseBooleanFlag(value?: string) {
  return ['true', '1', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function formatIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'receipt';
}

function emptyStatistics(query: TurnoverStatisticsDto, groupBy: string) {
  return {
    generatedAt: new Date().toISOString(),
    filters: normalizedFilters(query),
    groupBy,
    totals: {
      receivedQuantity: 0,
      shippedQuantity: 0,
      writtenOffQuantity: 0,
      currentQuantity: 0,
    },
    rows: [],
    trend: [],
    clientWidgetCandidate: true,
  };
}

function emptyStatisticsRow(sku: {
  id: string;
  clientId: string;
  internalSku: string;
  clientSku: string | null;
  article: string | null;
  name: string;
  barcodes: Array<{ value: string; isPrimary: boolean }>;
  client?: { id: string; code: string; name: string };
}, currentQuantity: number) {
  return {
    skuId: sku.id,
    clientId: sku.clientId,
    client: sku.client ?? null,
    internalSku: sku.internalSku,
    clientSku: sku.clientSku,
    article: sku.article,
    name: sku.name,
    primaryBarcode: sku.barcodes[0]?.value ?? null,
    receivedQuantity: 0,
    shippedQuantity: 0,
    writtenOffQuantity: 0,
    currentQuantity,
  };
}

function turnoverStatisticsPeriodSql(groupBy: 'day' | 'month' | 'quarter' | 'year') {
  if (groupBy === 'day') {
    return Prisma.sql`to_char(movement."createdAt", 'YYYY-MM-DD')`;
  }
  if (groupBy === 'month') {
    return Prisma.sql`to_char(movement."createdAt", 'YYYY-MM')`;
  }
  if (groupBy === 'quarter') {
    return Prisma.sql`to_char(movement."createdAt", 'YYYY') || '-Q' || EXTRACT(QUARTER FROM movement."createdAt")::int::text`;
  }
  return Prisma.sql`to_char(movement."createdAt", 'YYYY')`;
}
