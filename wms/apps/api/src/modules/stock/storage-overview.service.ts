import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ListStorageOverviewDto } from './dto/list-storage-overview.dto';
import { UpdateStorageTariffDto } from './dto/update-storage-tariff.dto';
import { buildStorageOverviewWorkbook, storageOverviewXlsxMimeType } from './storage-overview-xlsx';

const storageSkuSelect = {
  id: true,
  internalSku: true,
  clientSku: true,
  article: true,
  name: true,
  size: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  volumeLiters: true,
  marketplaceOfferId: true,
  marketplaceProductId: true,
  barcodes: {
    select: {
      value: true,
      isPrimary: true,
    },
  },
} satisfies Prisma.SkuSelect;

const storageBalanceSelect = {
  skuId: true,
  quantity: true,
  box: { select: { code: true } },
  pallet: { select: { code: true } },
} satisfies Prisma.StockBalanceSelect;

@Injectable()
export class StorageOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async getOverview(
    query: ListStorageOverviewDto,
    user: AuthUser,
    options: { includeDailyRows?: boolean } = {},
  ) {
    this.clientScopes.requireClientAccess(user, query.clientId, 'read');
    const period = normalizePeriod(query.periodFrom, query.periodTo);
    const client = await this.prisma.client.findUnique({
      where: { id: query.clientId },
      select: {
        id: true,
        code: true,
        name: true,
        storageAccountingEnabled: true,
        storagePriceRubPerLiterDay: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Клиент не найден.');
    }

    if (!client.storageAccountingEnabled) {
      const tariff = decimalToNumber(client.storagePriceRubPerLiterDay) ?? 0;
      return emptyStorageOverview(client, period.periodFrom, period.periodTo, tariff);
    }

    const periodStart = startOfUtcDay(period.periodFrom);
    const relevantMovementWhere = storageRelevantMovementWhere(query.clientId);
    const [balances, openingBalances, movements, firstReceipts] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: {
          clientId: query.clientId,
          quantity: { gt: 0 },
          status: { in: [StockStatus.AVAILABLE, StockStatus.PACKING, StockStatus.SHIPPING] },
        },
        select: storageBalanceSelect,
      }),
      this.prisma.stockMovement.groupBy({
        by: ['skuId'],
        where: {
          ...relevantMovementWhere,
          createdAt: { lt: periodStart },
        },
        _sum: { quantity: true },
      }),
      this.prisma.stockMovement.findMany({
        where: {
          ...relevantMovementWhere,
          createdAt: { gte: periodStart, lte: period.periodTo },
        },
        select: { skuId: true, quantity: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.stockMovement.groupBy({
        by: ['skuId'],
        where: {
          clientId: query.clientId,
          createdAt: { lte: period.periodTo },
          quantity: { gt: 0 },
          type: { notIn: [MovementType.PICK, MovementType.PACK, MovementType.MOVE, MovementType.SHIP] },
        },
        _min: { createdAt: true },
      }),
    ]);

    const skuIds = new Set<string>();
    balances.forEach((row) => skuIds.add(row.skuId));
    openingBalances.forEach((row) => skuIds.add(row.skuId));
    movements.forEach((row) => skuIds.add(row.skuId));
    const skus = skuIds.size
      ? await this.prisma.sku.findMany({
          where: { clientId: query.clientId, id: { in: [...skuIds] } },
          select: storageSkuSelect,
        })
      : [];
    const skusById = new Map(skus.map((sku) => [sku.id, sku]));

    const currentBySku = groupCurrentStorage(balances, skusById);
    const history = calculateStorageHistory(
      openingBalances,
      movements,
      firstReceipts,
      skusById,
      period.periodFrom,
      period.periodTo,
      options.includeDailyRows === true,
    );
    const tariff = decimalToNumber(client.storagePriceRubPerLiterDay) ?? 0;
    const rows = [...new Set([...currentBySku.keys(), ...history.skuTotals.keys()])]
      .map((skuId) => {
        const currentRow = currentBySku.get(skuId);
        const historyRow = history.skuTotals.get(skuId);
        const row = currentRow ?? historyRow;
        if (!row) {
          return null;
        }
        const literDays = roundQuantity(historyRow?.literDays ?? 0);
        const storageCostRub = roundMoney(literDays * tariff);

        return {
          ...row,
          quantity: currentRow?.quantity ?? 0,
          totalLiters: currentRow?.totalLiters ?? 0,
          boxesCount: currentRow?.boxesCount ?? 0,
          palletsCount: currentRow?.palletsCount ?? 0,
          boxCodes: currentRow?.boxCodes ?? [],
          palletCodes: currentRow?.palletCodes ?? [],
          firstReceiptDate: history.firstReceiptBySku.get(skuId)?.toISOString() ?? null,
          literDays,
          storageCostRub,
        };
      })
      .filter((row): row is StorageOverviewRow => Boolean(row))
      .sort((left, right) => right.storageCostRub - left.storageCostRub || left.name.localeCompare(right.name, 'ru'));

    const totalsBase = rows.reduce(
      (acc, row) => ({
        quantity: acc.quantity + row.quantity,
        totalLiters: roundQuantity(acc.totalLiters + row.totalLiters),
        literDays: roundQuantity(acc.literDays + row.literDays),
        storageCostRub: 0,
        skuCount: acc.skuCount + 1,
      }),
      { skuCount: 0, quantity: 0, totalLiters: 0, literDays: 0, storageCostRub: 0 },
    );
    const totals = {
      ...totalsBase,
      storageCostRub: roundMoney(totalsBase.literDays * tariff),
    };

    return {
      client,
      periodFrom: period.periodFrom.toISOString(),
      periodTo: period.periodTo.toISOString(),
      tariffRubPerLiterDay: tariff,
      totals,
      rows,
      daily: history.daily,
      dailyRows: history.dailyRows,
      skippedWithoutVolume: rows.filter((row) => !row.volumeLiters || row.volumeLiters <= 0).length,
    };
  }

  async updateTariff(clientId: string, dto: UpdateStorageTariffDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    return this.prisma.client.update({
      where: { id: clientId },
      data: {
        storagePriceRubPerLiterDay: dto.storagePriceRubPerLiterDay,
      },
      select: {
        id: true,
        code: true,
        name: true,
        storageAccountingEnabled: true,
        storagePriceRubPerLiterDay: true,
      },
    });
  }

  async getOverviewXlsx(query: ListStorageOverviewDto, user: AuthUser) {
    const overview = await this.getOverview(query, user, { includeDailyRows: true });
    const fileName = `storage-${safeFileName(overview.client.code)}-${formatDateKey(new Date(overview.periodFrom))}-${formatDateKey(new Date(overview.periodTo))}.xlsx`;

    return {
      fileName,
      mimeType: storageOverviewXlsxMimeType(),
      content: buildStorageOverviewWorkbook(overview),
    };
  }
}

type StorageSku = Prisma.SkuGetPayload<{ select: typeof storageSkuSelect }>;
type StorageBalanceForOverview = Prisma.StockBalanceGetPayload<{ select: typeof storageBalanceSelect }>;
type StorageMovementForOverview = Pick<Prisma.StockMovementGetPayload<object>, 'skuId' | 'quantity' | 'createdAt'>;
type StorageOpeningBalance = { skuId: string; _sum: { quantity: number | null } };
type StorageFirstReceipt = { skuId: string; _min: { createdAt: Date | null } };

function emptyStorageOverview(
  client: {
    id: string;
    code: string;
    name: string;
    storageAccountingEnabled: boolean;
    storagePriceRubPerLiterDay: Prisma.Decimal | null;
  },
  periodFrom: Date,
  periodTo: Date,
  tariff: number,
) {
  return {
    client,
    periodFrom: periodFrom.toISOString(),
    periodTo: periodTo.toISOString(),
    tariffRubPerLiterDay: tariff,
    totals: {
      skuCount: 0,
      quantity: 0,
      totalLiters: 0,
      literDays: 0,
      storageCostRub: 0,
    },
    rows: [] as StorageOverviewRow[],
    daily: [] as StorageOverviewDaily[],
    dailyRows: [] as StorageOverviewDailyRow[],
    skippedWithoutVolume: 0,
  };
}

function groupCurrentStorage(balances: StorageBalanceForOverview[], skusById: Map<string, StorageSku>) {
  const result = new Map<string, StorageOverviewRow>();
  const boxesBySku = new Map<string, Set<string>>();
  const palletsBySku = new Map<string, Set<string>>();

  balances.forEach((balance) => {
    const sku = skusById.get(balance.skuId);
    if (!sku) {
      return;
    }
    const volumeLiters = calculateSkuVolumeLiters(sku);
    const existing = result.get(balance.skuId) ?? {
      skuId: balance.skuId,
      barcode: primaryBarcode(sku),
      name: sku.name,
      internalSku: sku.internalSku,
      marketplaceArticle: marketplaceArticle(sku),
      size: sku.size ?? '',
      lengthCm: decimalToNumber(sku.lengthCm),
      widthCm: decimalToNumber(sku.widthCm),
      heightCm: decimalToNumber(sku.heightCm),
      volumeLiters,
      quantity: 0,
      totalLiters: 0,
      boxesCount: 0,
      palletsCount: 0,
      boxCodes: [],
      palletCodes: [],
      firstReceiptDate: null,
      literDays: 0,
      storageCostRub: 0,
    };
    const boxCodes = boxesBySku.get(balance.skuId) ?? new Set<string>();
    const palletCodes = palletsBySku.get(balance.skuId) ?? new Set<string>();
    if (balance.box?.code) {
      boxCodes.add(balance.box.code);
    }
    if (balance.pallet?.code) {
      palletCodes.add(balance.pallet.code);
    }

    existing.quantity += balance.quantity;
    existing.totalLiters = roundQuantity(existing.quantity * volumeLiters);
    existing.boxCodes = [...boxCodes].sort((left, right) => left.localeCompare(right, 'ru')).slice(0, 8);
    existing.palletCodes = [...palletCodes].sort((left, right) => left.localeCompare(right, 'ru')).slice(0, 8);
    existing.boxesCount = boxCodes.size;
    existing.palletsCount = palletCodes.size;
    boxesBySku.set(balance.skuId, boxCodes);
    palletsBySku.set(balance.skuId, palletCodes);
    result.set(balance.skuId, existing);
  });

  return result;
}

function calculateStorageHistory(
  openingBalances: StorageOpeningBalance[],
  movements: StorageMovementForOverview[],
  firstReceipts: StorageFirstReceipt[],
  skusById: Map<string, StorageSku>,
  periodFrom: Date,
  periodTo: Date,
  includeDailyRows: boolean,
) {
  const state = new Map<string, StorageState>();
  const skuTotals = new Map<string, StorageOverviewRow>();
  const firstReceiptBySku = new Map(
    firstReceipts
      .filter((row): row is StorageFirstReceipt & { _min: { createdAt: Date } } => Boolean(row._min.createdAt))
      .map((row) => [row.skuId, row._min.createdAt]),
  );
  const daily: Array<{ date: string; totalLiters: number; literDays: number; positions: number }> = [];
  const dailyRows: StorageOverviewDailyRow[] = [];
  const days = listPeriodDays(periodFrom, periodTo);

  openingBalances.forEach((opening) => {
    const sku = skusById.get(opening.skuId);
    if (!sku) {
      return;
    }
    state.set(opening.skuId, storageStateFromSku(sku, opening._sum.quantity ?? 0));
  });

  let movementIndex = 0;

  days.forEach((day) => {
    const dayEnd = endOfUtcDay(day);

    let totalLiters = 0;
    let positions = 0;
    state.forEach((row) => {
      if (row.quantity <= 0 || !row.volumeLiters || row.volumeLiters <= 0) {
        return;
      }
      const rowLiters = row.quantity * row.volumeLiters;
      totalLiters += rowLiters;
      positions += 1;
      if (includeDailyRows) {
        dailyRows.push({
          date: formatDateKey(day),
          skuId: row.skuId,
          barcode: row.barcode,
          name: row.name,
          internalSku: row.internalSku,
          marketplaceArticle: row.marketplaceArticle,
          size: row.size,
          quantity: row.quantity,
          volumeLiters: row.volumeLiters,
          totalLiters: roundQuantity(rowLiters),
          literDays: roundQuantity(rowLiters),
        });
      }
      const total = skuTotals.get(row.skuId) ?? {
        skuId: row.skuId,
        barcode: row.barcode,
        name: row.name,
        internalSku: row.internalSku,
        marketplaceArticle: row.marketplaceArticle,
        size: row.size,
        lengthCm: row.lengthCm,
        widthCm: row.widthCm,
        heightCm: row.heightCm,
        volumeLiters: row.volumeLiters,
        quantity: 0,
        totalLiters: 0,
        boxesCount: 0,
        palletsCount: 0,
        boxCodes: [],
        palletCodes: [],
        firstReceiptDate: null,
        literDays: 0,
        storageCostRub: 0,
      };
      total.literDays += rowLiters;
      skuTotals.set(row.skuId, total);
    });

    const roundedLiters = roundQuantity(totalLiters);
    daily.push({
      date: formatDateKey(day),
      totalLiters: roundedLiters,
      literDays: roundedLiters,
      positions,
    });

    while (movementIndex < movements.length && movements[movementIndex].createdAt <= dayEnd) {
      applyStorageMovement(state, movements[movementIndex], skusById);
      movementIndex += 1;
    }
  });

  return { skuTotals, firstReceiptBySku, daily, dailyRows };
}

function applyStorageMovement(
  state: Map<string, StorageState>,
  movement: StorageMovementForOverview,
  skusById: Map<string, StorageSku>,
) {
  const sku = skusById.get(movement.skuId);
  if (!sku) {
    return;
  }
  const volumeLiters = calculateSkuVolumeLiters(sku);
  const current = state.get(movement.skuId) ?? storageStateFromSku(sku, 0);
  current.quantity += movement.quantity;
  current.volumeLiters = volumeLiters || current.volumeLiters;
  state.set(movement.skuId, current);
}

function storageStateFromSku(sku: StorageSku, quantity: number): StorageState {
  return {
    skuId: sku.id,
    barcode: primaryBarcode(sku),
    name: sku.name,
    internalSku: sku.internalSku,
    marketplaceArticle: marketplaceArticle(sku),
    size: sku.size ?? '',
    lengthCm: decimalToNumber(sku.lengthCm),
    widthCm: decimalToNumber(sku.widthCm),
    heightCm: decimalToNumber(sku.heightCm),
    quantity,
    volumeLiters: calculateSkuVolumeLiters(sku),
  };
}

type StorageState = {
  skuId: string;
  barcode: string;
  name: string;
  internalSku: string;
  marketplaceArticle: string;
  size: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  quantity: number;
  volumeLiters: number;
};

type StorageOverviewRow = {
  skuId: string;
  barcode: string;
  name: string;
  internalSku: string;
  marketplaceArticle: string;
  size: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  volumeLiters: number;
  quantity: number;
  totalLiters: number;
  boxesCount: number;
  palletsCount: number;
  boxCodes: string[];
  palletCodes: string[];
  firstReceiptDate: string | null;
  literDays: number;
  storageCostRub: number;
};

export type StorageOverviewPayload = Awaited<ReturnType<StorageOverviewService['getOverview']>>;

type StorageOverviewDaily = {
  date: string;
  totalLiters: number;
  literDays: number;
  positions: number;
};

type StorageOverviewDailyRow = {
  date: string;
  skuId: string;
  barcode: string;
  name: string;
  internalSku: string;
  marketplaceArticle: string;
  size: string;
  quantity: number;
  volumeLiters: number;
  totalLiters: number;
  literDays: number;
};

function storageRelevantMovementWhere(clientId: string): Prisma.StockMovementWhereInput {
  return {
    clientId,
    OR: [
      {
        type: { notIn: [MovementType.PICK, MovementType.PACK, MovementType.MOVE, MovementType.SHIP] },
        quantity: { not: 0 },
      },
      {
        type: MovementType.SHIP,
        quantity: { lt: 0 },
      },
    ],
  };
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '_');
}

function normalizePeriod(periodFrom?: string, periodTo?: string) {
  const now = new Date();
  const defaultTo = endOfUtcDay(now);
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = periodFrom ? parseDate(periodFrom, 'start') : defaultFrom;
  const to = periodTo ? parseDate(periodTo, 'end') : defaultTo;

  if (from > to) {
    throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
  }

  return { periodFrom: from, periodTo: to };
}

function parseDate(value: string, mode: 'start' | 'end') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Некорректная дата.');
  }

  return mode === 'end' ? endOfUtcDay(date) : startOfUtcDay(date);
}

function listPeriodDays(periodFrom: Date, periodTo: Date) {
  const days: Date[] = [];
  const cursor = startOfUtcDay(periodFrom);
  const end = startOfUtcDay(periodTo).getTime();
  while (cursor.getTime() <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function primaryBarcode(sku: { barcodes: Array<{ value: string; isPrimary: boolean }> }) {
  return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}

function marketplaceArticle(sku: {
  marketplaceOfferId: string | null;
  marketplaceProductId: string | null;
  clientSku: string | null;
  article: string | null;
  internalSku: string;
}) {
  return sku.marketplaceOfferId ?? sku.marketplaceProductId ?? sku.clientSku ?? sku.article ?? sku.internalSku;
}

function decimalToNumber(value: Prisma.Decimal | string | number | null | undefined) {
  return value == null ? undefined : Number(value);
}

function calculateSkuVolumeLiters(sku: {
  volumeLiters?: Prisma.Decimal | string | number | null;
  lengthCm?: Prisma.Decimal | string | number | null;
  widthCm?: Prisma.Decimal | string | number | null;
  heightCm?: Prisma.Decimal | string | number | null;
}) {
  const storedVolume = decimalToNumber(sku.volumeLiters);
  if (storedVolume && storedVolume > 0) {
    return roundQuantity(storedVolume);
  }

  const lengthCm = decimalToNumber(sku.lengthCm);
  const widthCm = decimalToNumber(sku.widthCm);
  const heightCm = decimalToNumber(sku.heightCm);
  if (!lengthCm || !widthCm || !heightCm || lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
    return 0;
  }

  return roundQuantity((lengthCm * widthCm * heightCm) / 1000);
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
