import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, StockStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ListStorageOverviewDto } from './dto/list-storage-overview.dto';
import { UpdateStorageTariffDto } from './dto/update-storage-tariff.dto';
import { buildStorageOverviewWorkbook, storageOverviewXlsxMimeType } from './storage-overview-xlsx';

@Injectable()
export class StorageOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async getOverview(query: ListStorageOverviewDto, user: AuthUser) {
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

    const [balances, movements] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: {
          clientId: query.clientId,
          quantity: { gt: 0 },
          status: { in: [StockStatus.AVAILABLE, StockStatus.PACKING, StockStatus.SHIPPING] },
        },
        include: {
          sku: { include: { barcodes: true } },
          box: { select: { id: true, code: true } },
          pallet: { select: { id: true, code: true } },
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      this.prisma.stockMovement.findMany({
        where: {
          clientId: query.clientId,
          createdAt: { lte: period.periodTo },
        },
        include: {
          sku: { include: { barcodes: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const currentBySku = groupCurrentStorage(balances);
    const history = calculateStorageHistory(movements, period.periodFrom, period.periodTo);
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
    const overview = await this.getOverview(query, user);
    const fileName = `storage-${safeFileName(overview.client.code)}-${formatDateKey(new Date(overview.periodFrom))}-${formatDateKey(new Date(overview.periodTo))}.xlsx`;

    return {
      fileName,
      mimeType: storageOverviewXlsxMimeType(),
      content: buildStorageOverviewWorkbook(overview),
    };
  }
}

type StorageBalanceForOverview = Prisma.StockBalanceGetPayload<{
  include: {
    sku: { include: { barcodes: true } };
    box: { select: { id: true; code: true } };
    pallet: { select: { id: true; code: true } };
  };
}>;

type StorageMovementForOverview = Prisma.StockMovementGetPayload<{
  include: {
    sku: { include: { barcodes: true } };
  };
}>;

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

function groupCurrentStorage(balances: StorageBalanceForOverview[]) {
  const result = new Map<string, StorageOverviewRow>();

  balances.forEach((balance) => {
    const volumeLiters = calculateSkuVolumeLiters(balance.sku);
    const existing = result.get(balance.skuId) ?? {
      skuId: balance.skuId,
      barcode: primaryBarcode(balance.sku),
      name: balance.sku.name,
      internalSku: balance.sku.internalSku,
      marketplaceArticle: marketplaceArticle(balance.sku),
      size: balance.sku.size ?? '',
      lengthCm: decimalToNumber(balance.sku.lengthCm),
      widthCm: decimalToNumber(balance.sku.widthCm),
      heightCm: decimalToNumber(balance.sku.heightCm),
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
    const boxCodes = new Set(existing.boxCodes);
    const palletCodes = new Set(existing.palletCodes);
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
    result.set(balance.skuId, existing);
  });

  return result;
}

function calculateStorageHistory(movements: StorageMovementForOverview[], periodFrom: Date, periodTo: Date) {
  const storageMovements = movements.filter(isStorageRelevantMovement);
  const state = new Map<string, StorageState>();
  const skuTotals = new Map<string, StorageOverviewRow>();
  const firstReceiptBySku = new Map<string, Date>();
  const daily: Array<{ date: string; totalLiters: number; literDays: number; positions: number }> = [];
  const dailyRows: StorageOverviewDailyRow[] = [];
  const days = listPeriodDays(periodFrom, periodTo);

  storageMovements
    .filter((movement) => movement.createdAt < startOfUtcDay(periodFrom))
    .forEach((movement) => applyStorageMovement(state, movement, firstReceiptBySku));

  days.forEach((day) => {
    const dayStart = startOfUtcDay(day);
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

    storageMovements
      .filter((movement) => movement.createdAt >= dayStart && movement.createdAt <= dayEnd)
      .forEach((movement) => applyStorageMovement(state, movement, firstReceiptBySku));
  });

  return { skuTotals, firstReceiptBySku, daily, dailyRows };
}

function isStorageRelevantMovement(movement: StorageMovementForOverview) {
  if (movement.type === MovementType.PICK || movement.type === MovementType.PACK || movement.type === MovementType.MOVE) {
    return false;
  }
  if (movement.type === MovementType.SHIP) {
    return movement.quantity < 0;
  }
  return movement.quantity !== 0;
}

function applyStorageMovement(
  state: Map<string, StorageState>,
  movement: StorageMovementForOverview,
  firstReceiptBySku: Map<string, Date>,
) {
  const volumeLiters = calculateSkuVolumeLiters(movement.sku);
  const current = state.get(movement.skuId) ?? {
    skuId: movement.skuId,
    barcode: primaryBarcode(movement.sku),
    name: movement.sku.name,
    internalSku: movement.sku.internalSku,
    marketplaceArticle: marketplaceArticle(movement.sku),
    size: movement.sku.size ?? '',
    lengthCm: decimalToNumber(movement.sku.lengthCm),
    widthCm: decimalToNumber(movement.sku.widthCm),
    heightCm: decimalToNumber(movement.sku.heightCm),
    quantity: 0,
    volumeLiters,
  };
  current.quantity += movement.quantity;
  current.volumeLiters = volumeLiters || current.volumeLiters;
  state.set(movement.skuId, current);

  if (movement.quantity > 0 && !firstReceiptBySku.has(movement.skuId)) {
    firstReceiptBySku.set(movement.skuId, movement.createdAt);
  }
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
