import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLockService } from '../../common/inventory/inventory-lock.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { LogisticsService } from '../logistics/logistics.service';
import { StockBalancesService } from '../stock/stock-balances.service';
import { parseLogisticsTariffSheet } from './parsers/logistics-xlsx.parser';
import { parseReceiptSheet, type ReceiptImportItem } from './parsers/receipt-xlsx.parser';
import { parseStockSheet, type SheetMatrix, type StockImportIssue, type StockImportItem } from './parsers/stock-xlsx.parser';

type CommitStockOptions = {
  clientId: string;
  sourceDocument: string;
  user: AuthUser;
};

type CommitLogisticsOptions = {
  name: string;
  sourceFile?: string;
  activeFrom?: string;
  activeTo?: string;
};

type StockImportSuggestion = {
  row: number;
  type: 'FILL_BARCODE_FROM_CATALOG';
  title: string;
  message: string;
  barcode?: string;
  name?: string;
  article?: string | null;
  color?: string | null;
  size?: string | null;
  applied: boolean;
};

const STOCK_IMPORT_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 180_000,
};

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: StockBalancesService,
    private readonly clientScopes: ClientScopeService,
    private readonly logistics: LogisticsService,
    private readonly inventoryLock?: InventoryLockService,
  ) {}

  async previewStockWorkbook(buffer: Buffer, clientId: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const parsed = await this.parseStockWorkbookWithCatalog(buffer, clientId);

    return {
      clientId,
      summary: parsed.summary,
      issues: parsed.issues,
      suggestions: parsed.suggestions,
      sample: parsed.items.slice(0, 20),
    };
  }

  async previewReceiptWorkbook(buffer: Buffer, clientId: string, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const rows = this.readReceiptSheet(buffer);
    const parsed = parseReceiptSheet(rows, { clientId });
    const issues = [...parsed.issues, ...(await this.duplicateKizIssues(parsed.items))];

    return {
      clientId,
      summary: parsed.summary,
      issues,
      sample: parsed.items.slice(0, 20),
    };
  }

  previewLogisticsWorkbook(buffer: Buffer) {
    const rows = this.readFirstSheet(buffer);
    const parsed = parseLogisticsTariffSheet(rows);

    return {
      note: parsed.note,
      directionsCount: parsed.directions.length,
      directions: parsed.directions,
      issues: parsed.issues,
    };
  }

  async commitLogisticsWorkbook(buffer: Buffer, options: CommitLogisticsOptions) {
    const rows = this.readFirstSheet(buffer);
    const parsed = parseLogisticsTariffSheet(rows);
    const tariffSet = await this.logistics.commitTariffSet(parsed, options);

    return {
      tariffSetId: tariffSet.id,
      name: tariffSet.name,
      sourceFile: tariffSet.sourceFile,
      directionsCount: tariffSet.directions.length,
      tiersCount: tariffSet.directions.reduce((sum, direction) => sum + direction.tiers.length, 0),
    };
  }

  async commitStockWorkbook(buffer: Buffer, options: CommitStockOptions) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    this.clientScopes.requireClientAccess(options.user, options.clientId, 'write');

    const parsed = await this.parseStockWorkbookWithCatalog(buffer, options.clientId);
    const errors = parsed.issues.filter((issue) => issue.severity === 'error');

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Файл содержит ошибки, импорт в WMS остановлен.',
        errors,
        summary: parsed.summary,
      });
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const counters = {
          boxesTouched: 0,
          skusTouched: 0,
          movementsCreated: 0,
          balancesTouched: 0,
        };

        for (const item of parsed.items) {
          const box = await this.ensureBox(tx, item);
          const sku = await this.ensureSku(tx, item);

          await this.ensureBarcode(tx, sku.id, item.barcode);
          const movementCreated = await this.createInitialMovement(tx, item, sku.id, box.id, options.sourceDocument);
          await this.addToBalance(tx, item, sku.id, box.id, 'AVAILABLE');

          counters.boxesTouched += 1;
          counters.skusTouched += 1;
          counters.movementsCreated += movementCreated ? 1 : 0;
          counters.balancesTouched += 1;
        }

        return counters;
      },
      STOCK_IMPORT_TRANSACTION_OPTIONS,
    );

    return {
      sourceDocument: options.sourceDocument,
      summary: parsed.summary,
      suggestions: parsed.suggestions,
      warnings: parsed.issues.filter((issue) => issue.severity === 'warning'),
      result,
    };
  }

  private async parseStockWorkbookWithCatalog(buffer: Buffer, clientId: string) {
    const rows = this.readFirstSheet(buffer);
    const parsed = parseStockSheet(rows, { clientId });
    const enriched = await this.enrichStockItemsFromCatalog(parsed.items);

    return {
      ...parsed,
      items: enriched.items,
      issues: [...parsed.issues, ...enriched.issues],
      suggestions: enriched.suggestions,
      summary: stockImportSummary(enriched.items),
    };
  }

  async commitReceiptWorkbook(buffer: Buffer, options: CommitStockOptions) {
    await this.inventoryLock?.assertStockMovementsAllowed();
    this.clientScopes.requireClientAccess(options.user, options.clientId, 'write');

    const rows = this.readReceiptSheet(buffer);
    const parsed = parseReceiptSheet(rows, { clientId: options.clientId });
    const issues = [...parsed.issues, ...(await this.duplicateKizIssues(parsed.items))];
    const errors = issues.filter((issue) => issue.severity === 'error');

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Файл приемки содержит ошибки, запись в WMS остановлена.',
        errors,
        summary: parsed.summary,
      });
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const counters = {
          boxesTouched: 0,
          skusTouched: 0,
          movementsCreated: 0,
          balancesTouched: 0,
          kizCreated: 0,
        };

        for (const item of parsed.items) {
          const box = await this.ensureBox(tx, item);
          const sku = await this.ensureSku(tx, item);

          await this.ensureBarcode(tx, sku.id, item.barcode);
          const movement = await this.createReceiptMovement(tx, item, sku.id, box.id, options.sourceDocument);
          await this.addToBalance(tx, item, sku.id, box.id, 'AVAILABLE');
          await tx.productMark.create({
            data: {
              clientId: item.clientId,
              skuId: sku.id,
              boxId: box.id,
              stockMovementId: movement.id,
              value: item.kiz,
              sourceDocument: options.sourceDocument,
              sourceRow: item.sourceRow,
              status: 'AVAILABLE',
            },
          });

          counters.boxesTouched += 1;
          counters.skusTouched += 1;
          counters.movementsCreated += 1;
          counters.balancesTouched += 1;
          counters.kizCreated += 1;
        }

        return counters;
      },
      STOCK_IMPORT_TRANSACTION_OPTIONS,
    );

    return {
      sourceDocument: options.sourceDocument,
      summary: parsed.summary,
      warnings: issues.filter((issue) => issue.severity === 'warning'),
      result,
    };
  }

  private readFirstSheet(buffer: Buffer): SheetMatrix {
    // Русский комментарий: XLSX читаем как матрицу, чтобы не зависеть от кривых merged cells в исходных файлах.
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheet];
    return XLSX.utils.sheet_to_json<SheetMatrix[number]>(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });
  }

  private readReceiptSheet(buffer: Buffer): SheetMatrix {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName =
      workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'тсд') ??
      workbook.SheetNames.find((name) => {
        const rows = XLSX.utils.sheet_to_json<SheetMatrix[number]>(workbook.Sheets[name], {
          header: 1,
          raw: false,
          blankrows: false,
        });
        return rows.some((row) => {
          const cells = row.map((cell) => String(cell ?? '').toLowerCase());
          return cells.some((cell) => cell.includes('баркод')) && cells.some((cell) => cell.includes('киз'));
        });
      }) ??
      workbook.SheetNames[0];

    return XLSX.utils.sheet_to_json<SheetMatrix[number]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      blankrows: false,
    });
  }

  private ensureBox(tx: Prisma.TransactionClient, item: StockImportItem) {
    return tx.box.upsert({
      where: {
        clientId_code: {
          clientId: item.clientId,
          code: item.boxCode,
        },
      },
      update: {},
      create: {
        clientId: item.clientId,
        code: item.boxCode,
      },
    });
  }

  private async ensureSku(tx: Prisma.TransactionClient, item: StockImportItem) {
    const existingBarcode = await tx.barcode.findFirst({
      where: {
        value: item.barcode,
        sku: { clientId: item.clientId },
      },
      include: { sku: true },
    });

    if (existingBarcode) {
      return existingBarcode.sku;
    }

    // Русский комментарий: для первичного импорта внутренний SKU строим из штрихкода, потому что это самый стабильный идентификатор в файле.
    return tx.sku.create({
      data: {
        clientId: item.clientId,
        internalSku: `BAR-${item.barcode}`,
        name: item.name,
        color: item.color,
        size: item.size,
      },
    });
  }

  private ensureBarcode(tx: Prisma.TransactionClient, skuId: string, barcode: string) {
    return tx.barcode.upsert({
      where: {
        skuId_value: {
          skuId,
          value: barcode,
        },
      },
      update: { isPrimary: true },
      create: {
        skuId,
        value: barcode,
        isPrimary: true,
      },
    });
  }

  private async createInitialMovement(
    tx: Prisma.TransactionClient,
    item: StockImportItem,
    skuId: string,
    boxId: string,
    sourceDocument: string,
  ) {
    const idempotencyKey = ['stock-import', sourceDocument, item.sourceRow, item.boxCode, item.barcode].join(':');
    const exists = await tx.stockMovement.findUnique({ where: { idempotencyKey } });

    if (exists) {
      return false;
    }

    await tx.stockMovement.create({
      data: {
        clientId: item.clientId,
        skuId,
        boxId,
        type: 'INITIAL_IMPORT',
        status: 'AVAILABLE',
        quantity: item.quantity,
        sourceDocument,
        idempotencyKey,
        comment: 'Первичная загрузка остатков из XLSX',
      },
    });

    return true;
  }

  private async createReceiptMovement(
    tx: Prisma.TransactionClient,
    item: ReceiptImportItem,
    skuId: string,
    boxId: string,
    sourceDocument: string,
  ) {
    return tx.stockMovement.create({
      data: {
        clientId: item.clientId,
        skuId,
        boxId,
        type: 'RECEIPT',
        status: 'AVAILABLE',
        quantity: 1,
        sourceDocument,
        idempotencyKey: ['receipt-import', sourceDocument, item.sourceRow, item.boxCode, item.kiz].join(':'),
        comment: 'Приемка товара из XLSX с КИЗ',
      },
    });
  }

  private async addToBalance(
    tx: Prisma.TransactionClient,
    item: StockImportItem,
    skuId: string,
    boxId: string,
    status: StockStatus,
  ) {
    const balanceKey = this.balances.balanceKey({
      clientId: item.clientId,
      skuId,
      boxId,
      status,
    });

    await tx.stockBalance.upsert({
      where: { balanceKey },
      update: {
        quantity: { increment: item.quantity },
      },
      create: {
        balanceKey,
        clientId: item.clientId,
        skuId,
        boxId,
        status,
        quantity: item.quantity,
      },
    });
  }

  private async duplicateKizIssues(items: ReceiptImportItem[]) {
    const uniqueKiz = [...new Set(items.map((item) => item.kiz))];
    if (uniqueKiz.length === 0) {
      return [];
    }

    const existing = await this.prisma.productMark.findMany({
      where: {
        clientId: items[0]?.clientId,
        value: { in: uniqueKiz },
      },
      select: {
        value: true,
      },
    });
    const existingKiz = new Set(existing.map((item) => item.value));

    return items
      .filter((item) => existingKiz.has(item.kiz))
      .map((item) => ({
        row: item.sourceRow,
        message: 'КИЗ уже есть в WMS, повторная приемка запрещена.',
        severity: 'error' as const,
      }));
  }

  private async enrichStockItemsFromCatalog(items: StockImportItem[]) {
    const missingBarcodeItems = items.filter((item) => !item.barcode);
    if (missingBarcodeItems.length === 0) {
      return { items, issues: [] as StockImportIssue[], suggestions: [] as StockImportSuggestion[] };
    }

    const lookupValues = [...new Set(missingBarcodeItems.map((item) => item.name).filter(Boolean))];
    const catalogRows = lookupValues.length
      ? await this.prisma.nomenclatureItem.findMany({
          where: {
            OR: [{ name: { in: lookupValues } }, { internalSku: { in: lookupValues } }, { article: { in: lookupValues } }],
          },
          select: {
            barcode: true,
            name: true,
            article: true,
            internalSku: true,
            color: true,
            size: true,
          },
        })
      : [];
    const catalogByKey = new Map<string, typeof catalogRows>();

    for (const row of catalogRows) {
      [row.name, row.internalSku, row.article].forEach((value) => {
        const key = stockCatalogKey(value);
        if (!key) {
          return;
        }

        catalogByKey.set(key, [...(catalogByKey.get(key) ?? []), row]);
      });
    }

    const issues: StockImportIssue[] = [];
    const suggestions: StockImportSuggestion[] = [];
    const enrichedItems: StockImportItem[] = items.map((item) => {
      if (item.barcode) {
        return item;
      }

      const matches = (catalogByKey.get(stockCatalogKey(item.name)) ?? []).filter((row) => stockCatalogPropertiesMatch(row, item));
      const exactMatches = uniqueCatalogRows(matches);

      const matchedBarcode = exactMatches[0]?.barcode;
      if (exactMatches.length === 1 && matchedBarcode) {
        const match = exactMatches[0];
        suggestions.push({
          row: item.sourceRow,
          type: 'FILL_BARCODE_FROM_CATALOG',
          title: 'Баркод взят из каталога',
          message: `${match.name}: ${matchedBarcode}`,
          barcode: matchedBarcode,
          name: match.name,
          article: match.article,
          color: match.color,
          size: match.size,
          applied: true,
        });
        issues.push({
          row: item.sourceRow,
          message: `Штрихкод не был заполнен в файле, WMS взяла его из каталога: ${matchedBarcode}.`,
          severity: 'warning',
        });

        return {
          ...item,
          barcode: matchedBarcode,
          name: item.name || match.name,
          color: item.color ?? match.color ?? undefined,
          size: item.size ?? match.size ?? undefined,
        };
      }

      if (exactMatches.length > 1) {
        suggestions.push({
          row: item.sourceRow,
          type: 'FILL_BARCODE_FROM_CATALOG',
          title: 'Нужно выбрать товар',
          message: `В каталоге найдено несколько похожих карточек: ${exactMatches
            .slice(0, 3)
            .map((match) => [match.name, match.size, match.barcode].filter(Boolean).join(' / '))
            .join('; ')}.`,
          applied: false,
        });
        issues.push({
          row: item.sourceRow,
          message: 'Штрихкод не заполнен, а в каталоге найдено несколько вариантов. Уточните баркод в файле или карточку товара.',
          severity: 'error',
        });
        return item;
      }

      const matchedWithoutBarcode = exactMatches[0];
      if (matchedWithoutBarcode && !matchedWithoutBarcode.barcode) {
        suggestions.push({
          row: item.sourceRow,
          type: 'FILL_BARCODE_FROM_CATALOG',
          title: 'Карточка есть без баркода',
          message: `${matchedWithoutBarcode.name}: заполните баркод в каталоге или в файле остатков.`,
          name: matchedWithoutBarcode.name,
          article: matchedWithoutBarcode.article,
          color: matchedWithoutBarcode.color,
          size: matchedWithoutBarcode.size,
          applied: false,
        });
      }

      issues.push({
        row: item.sourceRow,
        message: 'Не заполнен штрихкод. WMS не нашла один точный баркод в каталоге.',
        severity: 'error',
      });
      return item;
    });

    return { items: enrichedItems, issues, suggestions };
  }
}

function stockImportSummary(items: StockImportItem[]) {
  const uniqueBoxes = new Set(items.map((item) => item.boxCode));
  const uniqueBarcodes = new Set(items.map((item) => item.barcode).filter(Boolean));
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    rows: items.length,
    boxes: uniqueBoxes.size,
    barcodes: uniqueBarcodes.size,
    totalQuantity,
  };
}

function stockCatalogKey(value?: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function stockCatalogPropertiesMatch(
  row: { color?: string | null; size?: string | null },
  item: Pick<StockImportItem, 'color' | 'size'>,
) {
  return stockOptionalMatch(row.color, item.color) && stockOptionalMatch(row.size, item.size);
}

function stockOptionalMatch(left?: string | null, right?: string | null) {
  const normalizedRight = stockCatalogKey(right);
  return !normalizedRight || stockCatalogKey(left) === normalizedRight;
}

function uniqueCatalogRows<T extends { internalSku: string }>(rows: T[]) {
  const result = new Map<string, T>();
  rows.forEach((row) => result.set(row.internalSku, row));
  return [...result.values()];
}
