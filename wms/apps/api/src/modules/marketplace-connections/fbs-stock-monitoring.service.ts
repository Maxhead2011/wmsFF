import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientRequestStatus, ClientRequestType, MarketplaceType, Prisma, StockStatus, type FbsStockMonitorEvent } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { WmsStockAvailabilityService } from '../stock/wms-stock-availability.service';
import type { RefreshFbsStockMonitorDto, RepairFbsStockMonitorDto, UpdateFbsStockMonitorConfigDto } from './dto/fbs-stock-monitoring.dto';
import {
  evaluateFbsStockMonitorWb,
  evaluateFbsStockMonitorWms,
  fbsStockMonitorEventKey,
  fbsStockMonitorExpectedAfter,
  fbsStockMonitorNeedsRetry,
  fbsStockMonitorOverallStatus,
  type FbsStockMonitorCheckStatus,
  type FbsStockMonitorEventType,
} from './fbs-stock-monitoring.rules';

export type FbsStockMonitorOrderInput = {
  clientId: string;
  connectionId: string;
  orderId: string;
  orderUid: string | null;
  category: 'active' | 'shipped' | 'cancelled' | 'archive';
  supplierStatus: string;
  wbStatus: string;
  skuId: string;
  productName: string;
  article: string | null;
  barcode: string | null;
  size: string | null;
  quantity: number;
  createdAt: string | null;
  sellerDate: string | null;
  marketplaceWarehouseId: string | null;
  marketplaceWarehouseName: string | null;
};

export type FbsStockMonitorProbeInput = {
  eventId: string;
  eventType: FbsStockMonitorEventType;
  clientId: string;
  connectionId: string;
  orderId: string;
  skuId: string;
  quantity: number;
  chrtId: number | null;
  marketplaceWarehouseId: string | null;
  executionWarehouseId: string | null;
};

export type FbsStockMonitorProbeResult = {
  eventId: string;
  wbCurrentAmount: number | null;
  wbOrderMatched: boolean;
  wbError?: string | null;
  wmsCurrentAmount: number | null;
  wmsSellableAmount: number | null;
  wmsReservedAmount: number | null;
  wmsReservationMatched: boolean;
  wmsReservationReleased: boolean;
  wmsError?: string | null;
  sourceIds?: Record<string, unknown>;
};

export type FbsStockMonitorProbe = (
  events: FbsStockMonitorProbeInput[],
) => Promise<FbsStockMonitorProbeResult[]>;

export type FbsStockMonitorRepairInput = {
  clientId: string;
  connectionId: string;
  warehouseId: string;
  skuId: string;
};

export type FbsStockMonitorRepairSnapshot = {
  skuId: string;
  previousAmount: number;
  targetAmount: number;
  wmsAvailableAmount: number;
  wmsReservedAmount: number;
  checkedAt: string;
};

export type FbsStockMonitorRepairResult = FbsStockMonitorRepairSnapshot & {
  corrected: boolean;
  amount: number;
  externalResponse: Record<string, unknown> | null;
};

export type FbsStockMonitorRepairHandler = {
  // ADDED: both preview and apply reuse the existing WMS-based WB repair path.
  preview: (input: FbsStockMonitorRepairInput, user: AuthUser) => Promise<FbsStockMonitorRepairSnapshot>;
  apply: (input: FbsStockMonitorRepairInput, user: AuthUser) => Promise<FbsStockMonitorRepairResult>;
};

type MonitorDefaults = {
  enabled: boolean;
  allowedDelaySeconds: number;
  retryIntervalSeconds: number;
  maxAttempts: number;
  lookbackHours: number;
  batchSize: number;
  workerIntervalMs: number;
};

type MonitorConfig = {
  clientId: string;
  connectionId: string;
  enabled: boolean;
  allowedDelaySeconds: number;
  retryIntervalSeconds: number;
  maxAttempts: number;
  wbRule: string;
  wmsRule: string;
};

type WmsStockExportAggregate = { total: number; reserved: number };

export type WmsStockExportFile = {
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
  rowCount: number;
  missingBarcodeCount: number;
  cleanup: () => Promise<void>;
};

export const WMS_STOCK_EXPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class FbsStockMonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FbsStockMonitoringService.name);
  private readonly defaults: MonitorDefaults;
  private readonly workerId = `stock-monitor:${process.pid}:${randomUUID()}`;
  private readonly exportBatchSize: number;
  private probe: FbsStockMonitorProbe | null = null;
  private repairHandler: FbsStockMonitorRepairHandler | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    config: ConfigService,
    private readonly stockAvailability: WmsStockAvailabilityService,
  ) {
    this.defaults = {
      enabled: config.get<string>('FBS_STOCK_MONITOR_ENABLED', 'true') !== 'false',
      allowedDelaySeconds: boundedInteger(config.get('FBS_STOCK_MONITOR_ALLOWED_DELAY_SECONDS'), 300, 30, 86_400),
      retryIntervalSeconds: boundedInteger(config.get('FBS_STOCK_MONITOR_RETRY_INTERVAL_SECONDS'), 30, 5, 3_600),
      maxAttempts: boundedInteger(config.get('FBS_STOCK_MONITOR_MAX_ATTEMPTS'), 10, 1, 100),
      lookbackHours: boundedInteger(config.get('FBS_STOCK_MONITOR_EVENT_LOOKBACK_HOURS'), 24, 1, 168),
      batchSize: boundedInteger(config.get('FBS_STOCK_MONITOR_BATCH_SIZE'), 100, 1, 500),
      workerIntervalMs: boundedInteger(config.get('FBS_STOCK_MONITOR_WORKER_INTERVAL_MS'), 15_000, 5_000, 300_000),
    };
    this.exportBatchSize = boundedInteger(config.get('WMS_STOCK_EXPORT_BATCH_SIZE'), 1_000, 1, 5_000);
  }

  onModuleInit() {
    this.stopped = false;
    this.schedule(this.defaults.workerIntervalMs);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  registerProbe(probe: FbsStockMonitorProbe) {
    this.probe = probe;
  }

  registerRepair(handler: FbsStockMonitorRepairHandler) {
    this.repairHandler = handler;
  }

  // FIX: export is independent from monitoring pagination; reads are bounded
  // and the XLSX is completed before it can be sent to the client.
  async exportWmsStocks(
    clientIdValue: string | undefined,
    user: AuthUser,
    warehouseId?: string,
  ): Promise<WmsStockExportFile> {
    const requestedClientId = clientIdValue?.trim() || undefined;
    let clientId: string | undefined;
    let temporaryDirectory: string | undefined;
    try {
      clientId = await this.resolveWmsStockExportClientId(requestedClientId, user);
      // FIX: use the same warehouse-aware availability rules as the on-screen report.
      const snapshot = await this.stockAvailability.snapshot(clientId, user, { warehouseId });
      const generatedAt = new Date();
      const fileName = wmsStockExportFileName(generatedAt);
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'wms-stock-export-'));
      const filePath = join(temporaryDirectory, fileName);
      const rowCount = await this.writeWmsStockExportWorkbook(filePath, snapshot.rows);
      const fileStat = await stat(filePath);
      await this.auditWmsStockExport(user.id, clientId, {
        status: 'SUCCESS',
        fileName,
        rowCount,
        missingBarcodeCount: snapshot.missingBarcodeCount,
        generatedAt: generatedAt.toISOString(),
        warehouseId: warehouseId || null,
      });
      if (snapshot.missingBarcodeCount > 0) {
        this.logger.warn(`WMS stock export skipped ${snapshot.missingBarcodeCount} SKU(s) without barcode for client ${clientId}.`);
      }
      const directoryToRemove = temporaryDirectory;
      return {
        fileName, filePath, mimeType: WMS_STOCK_EXPORT_XLSX_MIME, size: fileStat.size,
        rowCount, missingBarcodeCount: snapshot.missingBarcodeCount,
        cleanup: () => rm(directoryToRemove, { recursive: true, force: true }),
      };
    } catch (error) {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (clientId) {
        await this.auditWmsStockExport(user.id, clientId, {
          status: 'FAILED', message: exportErrorMessage(error), failedAt: new Date().toISOString(),
        });
      }
      if (error instanceof HttpException) throw error;
      this.logger.error(`WMS stock export failed for client ${clientId || requestedClientId || 'unknown'}: ${exportErrorMessage(error)}`);
      throw new ServiceUnavailableException('Не удалось получить актуальные остатки WMS и сформировать Excel. Повторите попытку позже.');
    }
  }

  private async resolveWmsStockExportClientId(requestedClientId: string | undefined, user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user, requestedClientId);
    const clients = await this.prisma.client.findMany({
      where: { id: clientFilter }, select: { id: true }, orderBy: { id: 'asc' }, take: 2,
    });
    if (clients.length === 0) throw new NotFoundException('Клиент для выгрузки остатков не найден.');
    if (clients.length > 1) throw new BadRequestException('Выберите одного клиента для выгрузки остатков.');
    return clients[0].id;
  }

  private async loadWmsStockExportAggregates(clientId: string) {
    const aggregates = new Map<string, WmsStockExportAggregate>();
    let missingBarcodeCount = 0;
    let cursorId: string | undefined;
    for (;;) {
      const skus = await this.prisma.sku.findMany({
        where: { clientId, ...(cursorId ? { id: { gt: cursorId } } : {}) },
        select: {
          id: true,
          barcodes: { select: { value: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
        },
        orderBy: { id: 'asc' }, take: this.exportBatchSize,
      });
      if (skus.length === 0) break;
      const skuIds = skus.map((sku) => sku.id);
      const [balances, requestItems] = await Promise.all([
        this.prisma.stockBalance.groupBy({
          by: ['skuId'], where: { clientId, skuId: { in: skuIds }, status: StockStatus.AVAILABLE },
          _sum: { quantity: true },
        }),
        this.prisma.clientRequestItem.groupBy({
          by: ['requestId', 'skuId'],
          where: {
            skuId: { in: skuIds },
            request: { clientId, type: ClientRequestType.OUTBOUND, status: { in: WMS_STOCK_EXPORT_REQUEST_STATUSES } },
          },
          _sum: { quantity: true },
        }),
      ]);
      const requestIds = [...new Set(requestItems.map((row) => row.requestId))];
      const pickedRows = requestIds.length > 0
        ? await this.prisma.stockMovement.groupBy({
            by: ['sourceDocument', 'skuId'],
            where: {
              clientId, skuId: { in: skuIds }, sourceDocument: { in: requestIds }, status: StockStatus.PACKING,
            },
            _sum: { quantity: true },
          })
        : [];
      const totalBySku = new Map(balances.map((row) => [row.skuId, row._sum.quantity ?? 0]));
      const pickedByRequestSku = new Map(pickedRows.map((row) => [
        requestSkuKey(row.sourceDocument, row.skuId), Math.max(0, row._sum.quantity ?? 0),
      ]));
      const reservedBySku = new Map<string, number>();
      requestItems.forEach((row) => {
        if (!row.skuId) return;
        const requested = Math.max(0, row._sum.quantity ?? 0);
        const alreadyRemoved = pickedByRequestSku.get(requestSkuKey(row.requestId, row.skuId)) ?? 0;
        reservedBySku.set(row.skuId, (reservedBySku.get(row.skuId) ?? 0) + Math.max(0, requested - alreadyRemoved));
      });
      skus.forEach((sku) => {
        const barcode = sku.barcodes[0]?.value.trim();
        if (!barcode) { missingBarcodeCount += 1; return; }
        const current = aggregates.get(barcode) ?? { total: 0, reserved: 0 };
        current.total += totalBySku.get(sku.id) ?? 0;
        current.reserved += Math.max(0, reservedBySku.get(sku.id) ?? 0);
        aggregates.set(barcode, current);
      });
      cursorId = skus[skus.length - 1].id;
      if (skus.length < this.exportBatchSize) break;
    }
    return { aggregates, missingBarcodeCount };
  }

  private async writeWmsStockExportWorkbook(
    filePath: string,
    rows: Array<{ barcode: string; available: number }>,
  ) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useSharedStrings: false, useStyles: true });
    const worksheet = workbook.addWorksheet('Остатки', { views: [{ state: 'frozen', ySplit: 1 }] });
    worksheet.columns = [
      { header: 'ШК', key: 'barcode', width: 26, style: { numFmt: '@' } },
      { header: 'Количество', key: 'quantity', width: 14 },
    ];
    worksheet.autoFilter = 'A1:B1';
    const header = worksheet.getRow(1); header.font = { bold: true }; header.commit();
    let rowCount = 0;
    for (const item of rows) {
      if (rowCount >= 1_048_575) throw new BadRequestException('Выгрузка превышает максимальное количество строк Excel.');
      const row = worksheet.addRow({ barcode: item.barcode, quantity: item.available });
      row.getCell(1).numFmt = '@'; row.commit(); rowCount += 1;
    }
    worksheet.commit(); await workbook.commit(); return rowCount;
  }

  private async auditWmsStockExport(userId: string, clientId: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.auditLog.create({
        data: { userId, action: 'FBS_STOCK_MONITOR_WMS_EXPORT', entity: 'Client', entityId: clientId, payload: payload as Prisma.InputJsonValue },
      });
    } catch (error) {
      this.logger.error(`Could not write WMS stock export audit for client ${clientId}: ${exportErrorMessage(error)}`);
    }
  }

  // ADDED: the existing marketplace refresh hands changed orders to the
  // observer. Upsert keys and a database unique index stop repeat deliveries.
  async ingestOrders(orders: FbsStockMonitorOrderInput[]) {
    if (!this.defaults.enabled || orders.length === 0) return { ingested: 0 };
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.defaults.lookbackHours * 60 * 60_000);
    const eligible = orders.filter((order) => {
      const saleAt = monitorDate(order.createdAt || order.sellerDate);
      return order.skuId && saleAt && saleAt >= cutoff && order.category !== 'archive';
    });
    if (eligible.length === 0) return { ingested: 0 };

    const connectionIds = uniqueStrings(eligible.map((order) => order.connectionId));
    const skuIds = uniqueStrings(eligible.map((order) => order.skuId));
    const [connections, skus, storedConfigs] = await Promise.all([
      this.prisma.clientMarketplaceConnection.findMany({
        where: { id: { in: connectionIds }, marketplace: MarketplaceType.WILDBERRIES, isActive: true },
        select: {
          id: true,
          clientId: true,
          fbsWarehouseId: true,
          fbsWarehouseName: true,
          fbsExecutionWarehouseId: true,
        },
      }),
      this.prisma.sku.findMany({
        where: { id: { in: skuIds } },
        select: {
          id: true,
          color: true,
          size: true,
          marketplaceProductId: true,
          barcodes: { select: { value: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }] },
        },
      }),
      this.prisma.fbsStockMonitorConfig.findMany({ where: { connectionId: { in: connectionIds } } }),
    ]);
    const connectionById = new Map(connections.map((item) => [item.id, item]));
    const skuById = new Map(skus.map((item) => [item.id, item]));
    const configByConnection = new Map(storedConfigs.map((item) => [item.connectionId, item]));

    const candidates = eligible.flatMap((order) => {
      const connection = connectionById.get(order.connectionId);
      if (!connection || connection.clientId !== order.clientId) return [];
      const config = this.configFor(order.clientId, order.connectionId, configByConnection.get(order.connectionId));
      if (!config.enabled) return [];
      const sku = skuById.get(order.skuId);
      const ids = monitorWbProductIds(sku?.marketplaceProductId);
      const eventTypes: FbsStockMonitorEventType[] = order.category === 'cancelled'
        ? ['SALE', 'CANCEL']
        : ['SALE'];
      return eventTypes.map((eventType) => ({
        order,
        eventType,
        config,
        connection,
        sku,
        nmId: ids?.nmId ?? null,
        chrtId: ids?.chrtId ?? null,
        eventKey: fbsStockMonitorEventKey({
          connectionId: order.connectionId,
          orderId: order.orderId,
          skuId: order.skuId,
          eventType,
        }),
      }));
    });
    if (candidates.length === 0) return { ingested: 0 };

    const existing = await this.prisma.fbsStockMonitorEvent.findMany({
      where: { eventKey: { in: candidates.map((candidate) => candidate.eventKey) } },
      select: { eventKey: true },
    });
    const existingKeys = new Set(existing.map((item) => item.eventKey));
    const pending = candidates.filter((candidate) => !existingKeys.has(candidate.eventKey));
    if (pending.length === 0) return { ingested: 0 };

    const groupKeys = uniqueStrings(pending.map((candidate) => monitorGroupKey(
      candidate.order.connectionId,
      candidate.order.marketplaceWarehouseId || candidate.connection.fbsWarehouseId,
      candidate.order.skuId,
    )));
    const publications = await this.prisma.fbsStockPublication.findMany({
      where: {
        OR: pending.map((candidate) => ({
          connectionId: candidate.order.connectionId,
          warehouseId: candidate.order.marketplaceWarehouseId || candidate.connection.fbsWarehouseId || '',
          skuId: candidate.order.skuId,
        })),
      },
      select: { connectionId: true, warehouseId: true, skuId: true, lastWbAmount: true, lastWmsAmount: true },
    });
    const publicationByGroup = new Map(publications.map((item) => [
      monitorGroupKey(item.connectionId, item.warehouseId, item.skuId),
      item,
    ]));
    const latestSnapshots = await this.loadLatestGroupSnapshots(groupKeys, pending);
    const cursors = new Map<string, { wb: number | null; wms: number | null }>();
    const ordered = [...pending].sort((left, right) => {
      const date = String(left.order.createdAt || left.order.sellerDate || '').localeCompare(
        String(right.order.createdAt || right.order.sellerDate || ''),
      );
      if (date !== 0) return date;
      if (left.eventType === right.eventType) return left.order.orderId.localeCompare(right.order.orderId);
      return left.eventType === 'SALE' ? -1 : 1;
    });
    let ingested = 0;

    for (const candidate of ordered) {
      const wbWarehouseId = candidate.order.marketplaceWarehouseId || candidate.connection.fbsWarehouseId;
      const groupKey = monitorGroupKey(candidate.order.connectionId, wbWarehouseId, candidate.order.skuId);
      const publication = publicationByGroup.get(groupKey);
      const latest = latestSnapshots.get(groupKey);
      const cursor = cursors.get(groupKey) ?? {
        wb: latest?.wbCurrentAmount ?? latest?.wbAfterAmount ?? publication?.lastWbAmount ?? null,
        wms: latest?.wmsCurrentAmount ?? latest?.wmsAfterAmount ?? publication?.lastWmsAmount ?? null,
      };
      const wbExpected = fbsStockMonitorExpectedAfter(cursor.wb, candidate.order.quantity, candidate.eventType);
      const wmsExpected = fbsStockMonitorExpectedAfter(cursor.wms, candidate.order.quantity, candidate.eventType);
      const detectedAt = new Date();
      const saleAt = monitorDate(candidate.order.createdAt || candidate.order.sellerDate) ?? detectedAt;
      const deadlineAt = new Date(detectedAt.getTime() + candidate.config.allowedDelaySeconds * 1_000);
      const sourceIds = {
        marketplace: 'WILDBERRIES',
        connectionId: candidate.order.connectionId,
        orderId: candidate.order.orderId,
        orderUid: candidate.order.orderUid,
        skuId: candidate.order.skuId,
        warehouseId: wbWarehouseId,
      } satisfies Record<string, unknown>;
      try {
        await this.prisma.fbsStockMonitorEvent.create({
          data: {
            eventKey: candidate.eventKey,
            clientId: candidate.order.clientId,
            connectionId: candidate.order.connectionId,
            marketplace: MarketplaceType.WILDBERRIES,
            marketplaceWarehouseId: wbWarehouseId,
            marketplaceWarehouseName: candidate.order.marketplaceWarehouseName || candidate.connection.fbsWarehouseName,
            executionWarehouseId: candidate.connection.fbsExecutionWarehouseId,
            orderId: candidate.order.orderId,
            orderUid: candidate.order.orderUid,
            eventType: candidate.eventType,
            sourceFingerprint: monitorSourceFingerprint(candidate.order, candidate.eventType),
            sourceIds: sourceIds as Prisma.InputJsonValue,
            skuId: candidate.order.skuId,
            productName: candidate.order.productName,
            article: candidate.order.article,
            nmId: candidate.nmId,
            chrtId: candidate.chrtId,
            barcode: candidate.order.barcode || candidate.sku?.barcodes[0]?.value || null,
            size: candidate.order.size || candidate.sku?.size || null,
            color: candidate.sku?.color || null,
            quantity: Math.max(1, Math.trunc(candidate.order.quantity)),
            saleAt,
            detectedAt,
            deadlineAt,
            wbBeforeAmount: cursor.wb,
            wbExpectedAfterAmount: wbExpected,
            wmsBeforeAmount: cursor.wms,
            wmsExpectedAfterAmount: wmsExpected,
            nextCheckAt: new Date(detectedAt.getTime() + candidate.config.retryIntervalSeconds * 1_000),
            histories: {
              create: [
                {
                  system: 'WB', kind: 'EVENT_DETECTED', status: cursor.wb == null ? 'UNAVAILABLE' : 'PENDING',
                  beforeAmount: cursor.wb, expectedAmount: wbExpected, sourceIds: sourceIds as Prisma.InputJsonValue,
                  message: cursor.wb == null ? 'Нет предыдущего достоверного снимка WB.' : 'Событие принято, ожидается проверка WB.',
                },
                {
                  system: 'WMS', kind: 'EVENT_DETECTED', status: cursor.wms == null ? 'UNAVAILABLE' : 'PENDING',
                  beforeAmount: cursor.wms, expectedAmount: wmsExpected, sourceIds: sourceIds as Prisma.InputJsonValue,
                  message: cursor.wms == null ? 'Нет предыдущего достоверного снимка WMS.' : 'Событие принято, ожидается проверка WMS.',
                },
              ],
            },
          },
        });
        ingested += 1;
        cursors.set(groupKey, { wb: wbExpected, wms: wmsExpected });
      } catch (caught) {
        if (!isPrismaUniqueError(caught)) throw caught;
      }
    }

    if (ingested > 0) {
      await this.prisma.fbsStockMonitorRun.create({
        data: { startedAt: now, completedAt: new Date(), durationMs: Date.now() - now.getTime(), ingested },
      });
    }
    return { ingested };
  }

  async list(
    query: {
      clientId?: string;
      connectionId?: string;
      warehouseId?: string;
      status?: string;
      system?: string;
      product?: string;
      q?: string;
      dateFrom?: string;
      dateTo?: string;
      sort?: string;
      direction?: string;
      page?: string;
      pageSize?: string;
    },
    user: AuthUser,
  ) {
    const clientId = query.clientId?.trim() || undefined;
    const clientFilter = this.clientScopes.resolveClientFilter(user, clientId);
    const page = boundedInteger(query.page, 1, 1, 100_000);
    const pageSize = boundedInteger(query.pageSize, 50, 10, 200);
    const status = monitorStatus(query.status);
    const system = (query.system || 'ALL').trim().toUpperCase();
    const dateFrom = monitorDateBoundary(query.dateFrom, false);
    const dateTo = monitorDateBoundary(query.dateTo, true);
    const search = query.q?.trim();
    const product = query.product?.trim();
    const where: Prisma.FbsStockMonitorEventWhereInput = {
      clientId: clientFilter,
      // FIX: numeric WB zeroes are excluded in SQL before count/skip/take.
      // NULL remains visible because it means that the current stock is unknown.
      AND: [fbsStockMonitorVisibleWbWhere()],
      ...(query.connectionId?.trim() ? { connectionId: query.connectionId.trim() } : {}),
      ...(query.warehouseId?.trim() ? { marketplaceWarehouseId: query.warehouseId.trim() } : {}),
      ...(dateFrom || dateTo ? { saleAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
      ...(status
        ? system === 'WB'
          ? { wbStatus: status }
          : system === 'WMS'
            ? { wmsStatus: status }
            : { overallStatus: status }
        : {}),
      ...(product ? { productName: { contains: product, mode: 'insensitive' } } : {}),
      ...(search ? {
        OR: [
          { productName: { contains: search, mode: 'insensitive' } },
          { article: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
          { size: { contains: search, mode: 'insensitive' } },
          { color: { contains: search, mode: 'insensitive' } },
          { orderId: { contains: search, mode: 'insensitive' } },
          { nmId: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const direction: Prisma.SortOrder = query.direction?.toLowerCase() === 'asc' ? 'asc' : 'desc';
    // FIX: confirmed errors always lead the server result, including across
    // page boundaries. The selected time direction applies inside the group.
    const orderBy: Prisma.FbsStockMonitorEventOrderByWithRelationInput[] = [
      { statusRank: 'asc' },
      { saleAt: query.sort === 'status' ? 'desc' : direction },
      { id: 'desc' },
    ];
    const last24h = new Date(Date.now() - 24 * 60 * 60_000);

    const [total, items, grouped, latestRun, checks24h, clients, connections, warehouses] = await Promise.all([
      this.prisma.fbsStockMonitorEvent.count({ where }),
      this.prisma.fbsStockMonitorEvent.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.fbsStockMonitorEvent.groupBy({
        by: ['overallStatus'],
        where,
        _count: { _all: true },
      }),
      this.prisma.fbsStockMonitorRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.fbsStockMonitorHistory.count({ where: { createdAt: { gte: last24h }, kind: 'CHECK' } }),
      this.prisma.client.findMany({
        where: { id: clientFilter },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.clientMarketplaceConnection.findMany({
        where: { clientId: clientFilter, marketplace: MarketplaceType.WILDBERRIES, isActive: true },
        select: { id: true, clientId: true, accountName: true, fbsWarehouseId: true, fbsWarehouseName: true },
        orderBy: [{ clientId: 'asc' }, { accountName: 'asc' }],
      }),
      this.prisma.fbsStockMonitorEvent.findMany({
        where: { clientId: clientFilter, marketplaceWarehouseId: { not: null } },
        distinct: ['marketplaceWarehouseId'],
        select: { marketplaceWarehouseId: true, marketplaceWarehouseName: true },
        orderBy: { marketplaceWarehouseId: 'asc' },
      }),
    ]);
    const counts = { SUCCESS: 0, ERROR: 0, PENDING: 0, UNAVAILABLE: 0 };
    grouped.forEach((row) => {
      const key = monitorStatus(row.overallStatus);
      if (key) counts[key] = row._count._all;
    });
    return {
      checkedAt: new Date().toISOString(),
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      counts,
      technical: {
        enabled: this.defaults.enabled,
        workerRunning: this.running,
        lastRunAt: latestRun?.startedAt.toISOString() ?? null,
        lastRunCompletedAt: latestRun?.completedAt?.toISOString() ?? null,
        lastRunDurationMs: latestRun?.durationMs ?? null,
        lastRunError: latestRun?.errorMessage ?? null,
        checks24h,
      },
      filters: {
        clients,
        connections,
        warehouses: warehouses.map((item) => ({
          id: item.marketplaceWarehouseId,
          name: item.marketplaceWarehouseName || item.marketplaceWarehouseId,
        })),
      },
      items: items.map(formatMonitorEvent),
    };
  }

  async detail(id: string, user: AuthUser) {
    const event = await this.prisma.fbsStockMonitorEvent.findUnique({
      where: { id },
      include: { histories: { orderBy: { createdAt: 'desc' } } },
    });
    if (!event) throw new NotFoundException('Событие мониторинга не найдено.');
    this.clientScopes.requireClientAccess(user, event.clientId, 'read');
    return {
      ...formatMonitorEvent(event),
      history: event.histories.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  async getConfig(connectionId: string, user: AuthUser) {
    const connection = await this.requireConnection(connectionId, user, 'read');
    const stored = await this.prisma.fbsStockMonitorConfig.findUnique({ where: { connectionId } });
    return this.configFor(connection.clientId, connection.id, stored);
  }

  async updateConfig(connectionId: string, dto: UpdateFbsStockMonitorConfigDto, user: AuthUser) {
    const connection = await this.requireConnection(connectionId, user, 'write');
    const updated = await this.prisma.fbsStockMonitorConfig.upsert({
      where: { connectionId },
      create: { clientId: connection.clientId, connectionId, ...dto },
      update: { ...dto },
    });
    return this.configFor(connection.clientId, connection.id, updated);
  }

  async refresh(dto: RefreshFbsStockMonitorDto, user: AuthUser) {
    const clientId = dto.clientId?.trim();
    const connectionId = dto.connectionId?.trim();
    if (clientId) this.clientScopes.requireClientAccess(user, clientId, 'read');
    if (connectionId) await this.requireConnection(connectionId, user, 'read');
    const clientFilter = this.clientScopes.resolveClientFilter(user, clientId || undefined);
    const eventIds = uniqueStrings(dto.eventIds ?? []);
    if (eventIds.length > 200) throw new BadRequestException('За один запуск можно проверить не более 200 событий.');
    return this.runChecks({
      force: true,
      where: {
        clientId: clientFilter,
        ...(connectionId ? { connectionId } : {}),
        ...(eventIds.length ? { id: { in: eventIds } } : {}),
      },
    });
  }

  async previewRepair(eventId: string, user: AuthUser) {
    // FIX: first re-run the ordinary monitor check; the repair preview then
    // obtains a second live WB/WMS snapshot through the established stock path.
    await this.refresh({ eventIds: [eventId] }, user);
    const event = await this.requireRepairEvent(eventId, user);
    this.assertRepairState(event);
    const snapshot = await this.requireRepairHandler().preview(this.repairInput(event), user);
    if (snapshot.previousAmount <= snapshot.targetAmount) {
      throw new ConflictException(
        'Повторная проверка показала, что превышения WB над доступным остатком WMS уже нет. Остаток WB не повышается.',
      );
    }
    return this.repairPreviewResponse(event, snapshot);
  }

  async repair(eventId: string, dto: RepairFbsStockMonitorDto, user: AuthUser) {
    const idempotencyKey = dto.idempotencyKey.trim();
    if (idempotencyKey.length < 12) {
      throw new BadRequestException('Некорректный ключ операции исправления. Обновите страницу и повторите действие.');
    }

    const event = await this.requireRepairEvent(eventId, user);
    const existing = await this.prisma.fbsStockMonitorHistory.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.eventId !== event.id) {
        throw new ConflictException('Этот ключ операции уже использован для другой строки мониторинга.');
      }
      if (existing.status === 'SUCCESS') {
        return {
          success: true,
          corrected: false,
          idempotent: true,
          message: existing.message || 'Эта операция уже была успешно выполнена.',
          event: await this.detail(event.id, user),
        };
      }
      throw new ConflictException(
        existing.status === 'PENDING'
          ? 'Исправление этой строки уже выполняется.'
          : existing.message || 'Эта попытка исправления уже завершилась ошибкой. Повторите действие новой кнопкой.',
      );
    }

    this.assertRepairState(event);
    const lockOwner = `stock-monitor-repair:${idempotencyKey}`;
    const staleProcessingAt = new Date(Date.now() - 5 * 60_000);
    const locked = await this.prisma.fbsStockMonitorEvent.updateMany({
      where: {
        id: event.id,
        OR: [{ processingAt: null }, { processingAt: { lt: staleProcessingAt } }],
      },
      data: { processingAt: new Date(), processingBy: lockOwner },
    });
    if (locked.count !== 1) {
      throw new ConflictException('Строка уже проверяется или исправляется. Дождитесь завершения операции.');
    }

    const sourceBase = {
      userId: user.id,
      userName: user.name,
      article: event.article,
      barcode: event.barcode,
      orderId: event.orderId,
      skuId: event.skuId,
      connectionId: event.connectionId,
      warehouseId: event.marketplaceWarehouseId,
    };
    let historyId = '';
    let preview: FbsStockMonitorRepairSnapshot | null = null;
    let applied: FbsStockMonitorRepairResult | null = null;
    let verification: FbsStockMonitorRepairSnapshot | null = null;

    try {
      const history = await this.prisma.fbsStockMonitorHistory.create({
        data: {
          eventId: event.id,
          idempotencyKey,
          system: 'WB',
          kind: 'MANUAL_REPAIR',
          status: 'PENDING',
          attempt: 1,
          beforeAmount: event.wbCurrentAmount,
          expectedAmount: event.wmsAfterAmount,
          currentAmount: event.wbCurrentAmount,
          reservedAmount: event.wmsReservedAmount,
          message: `Пользователь ${user.name} подтвердил повторную проверку и исправление остатка WB по правилам WMS.`,
          sourceIds: manualRepairSource(sourceBase),
        },
      });
      historyId = history.id;

      const handler = this.requireRepairHandler();
      preview = await handler.preview(this.repairInput(event), user);
      if (preview.previousAmount <= preview.targetAmount) {
        const message = 'Повторная проверка выполнена: превышения WB над доступным остатком WMS уже нет.';
        const now = new Date();
        await this.prisma.$transaction([
          this.prisma.fbsStockMonitorHistory.update({
            where: { id: historyId },
            data: {
              status: 'SUCCESS',
              beforeAmount: preview.previousAmount,
              expectedAmount: preview.targetAmount,
              currentAmount: preview.previousAmount,
              reservedAmount: preview.wmsReservedAmount,
              message,
              sourceIds: manualRepairSource({ ...sourceBase, preview, corrected: false, externalResponse: null }),
            },
          }),
          this.prisma.fbsStockMonitorEvent.update({
            where: { id: event.id },
            data: {
              wbCurrentAmount: preview.previousAmount,
              wbAfterAmount: preview.previousAmount,
              wbStatus: 'SUCCESS',
              wbMessage: null,
              wmsCurrentAmount: preview.wmsAvailableAmount,
              wmsAfterAmount: preview.targetAmount,
              wmsReservedAmount: preview.wmsReservedAmount,
              overallStatus: 'SUCCESS',
              statusRank: monitorStatusRank('SUCCESS'),
              nextCheckAt: null,
              lastCheckedAt: now,
              processingAt: null,
              processingBy: null,
            },
          }),
        ]);
        return {
          success: true,
          corrected: false,
          idempotent: false,
          message,
          preview: this.repairPreviewResponse(event, preview),
          event: await this.detail(event.id, user),
        };
      }

      // FIX: this is the same external WB correction used by the FBS stock
      // screen; no local-only amount or alternative calculation is introduced.
      applied = await handler.apply(this.repairInput(event), user);
      verification = await handler.preview(this.repairInput(event), user);
      const succeeded = verification.previousAmount <= verification.targetAmount;
      if (!succeeded) {
        throw new BadRequestException(
          `Wildberries принял запрос, но контрольный остаток ${verification.previousAmount} всё ещё превышает WMS ${verification.targetAmount}.`,
        );
      }

      const message = applied.corrected
        ? `Остаток WB исправлен: ${applied.previousAmount} → ${verification.previousAmount}. Установлено по WMS: ${verification.targetAmount}.`
        : 'Повторная проверка выполнена: другой процесс уже устранил превышение.';
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.fbsStockMonitorHistory.update({
          where: { id: historyId },
          data: {
            status: 'SUCCESS',
            beforeAmount: preview.previousAmount,
            expectedAmount: preview.targetAmount,
            currentAmount: verification.previousAmount,
            reservedAmount: verification.wmsReservedAmount,
            message,
            sourceIds: manualRepairSource({
              ...sourceBase,
              preview,
              verification,
              corrected: applied.corrected,
              externalResponse: applied.externalResponse,
            }),
          },
        }),
        this.prisma.fbsStockMonitorEvent.update({
          where: { id: event.id },
          data: {
            wbCurrentAmount: verification.previousAmount,
            wbAfterAmount: verification.previousAmount,
            wbStatus: 'SUCCESS',
            wbMessage: null,
            wmsCurrentAmount: verification.wmsAvailableAmount,
            wmsAfterAmount: verification.targetAmount,
            wmsReservedAmount: verification.wmsReservedAmount,
            overallStatus: 'SUCCESS',
            statusRank: monitorStatusRank('SUCCESS'),
            nextCheckAt: null,
            lastCheckedAt: now,
            processingAt: null,
            processingBy: null,
          },
        }),
      ]);
      return {
        success: true,
        corrected: applied.corrected,
        idempotent: false,
        message,
        preview: this.repairPreviewResponse(event, preview),
        verification: this.repairPreviewResponse(event, verification),
        externalResponse: applied.externalResponse,
        event: await this.detail(event.id, user),
      };
    } catch (caught) {
      const message = monitorError(caught);
      if (historyId) {
        await this.prisma.fbsStockMonitorHistory.update({
          where: { id: historyId },
          data: {
            status: 'ERROR',
            beforeAmount: preview?.previousAmount ?? event.wbCurrentAmount,
            expectedAmount: preview?.targetAmount ?? event.wmsAfterAmount,
            currentAmount: verification?.previousAmount ?? applied?.amount ?? event.wbCurrentAmount,
            reservedAmount: verification?.wmsReservedAmount ?? preview?.wmsReservedAmount ?? event.wmsReservedAmount,
            message,
            sourceIds: manualRepairSource({
              ...sourceBase,
              preview,
              verification,
              corrected: applied?.corrected ?? false,
              externalResponse: applied?.externalResponse ?? null,
              error: message,
            }),
          },
        }).catch(() => undefined);
      }
      await this.prisma.fbsStockMonitorEvent.updateMany({
        where: { id: event.id, processingBy: lockOwner },
        data: {
          wbStatus: 'ERROR',
          wbMessage: message,
          overallStatus: 'ERROR',
          statusRank: monitorStatusRank('ERROR'),
          lastCheckedAt: new Date(),
          processingAt: null,
          processingBy: null,
        },
      }).catch(() => undefined);
      throw caught;
    } finally {
      await this.prisma.fbsStockMonitorEvent.updateMany({
        where: { id: event.id, processingBy: lockOwner },
        data: { processingAt: null, processingBy: null },
      }).catch(() => undefined);
    }
  }

  async runDueChecks() {
    return this.runChecks({ force: false, where: {} });
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      try {
        await this.runDueChecks();
      } catch (caught) {
        this.logger.error(`FBS stock monitor worker failed: ${monitorError(caught)}`);
      } finally {
        this.schedule(this.defaults.workerIntervalMs);
      }
    }, delayMs);
    this.timer.unref?.();
  }

  private async runChecks(options: { force: boolean; where: Prisma.FbsStockMonitorEventWhereInput }) {
    if (!this.defaults.enabled && !options.force) return emptyRunResult('Мониторинг отключён настройкой окружения.');
    if (this.running) return emptyRunResult('Проверка уже выполняется.');
    if (!this.probe) return emptyRunResult('Проверка ещё не подключена к интеграции остатков.');
    this.running = true;
    const startedAt = new Date();
    const run = await this.prisma.fbsStockMonitorRun.create({ data: { startedAt } });
    try {
      const staleProcessingAt = new Date(Date.now() - Math.max(120_000, this.defaults.workerIntervalMs * 4));
      const candidates = await this.prisma.fbsStockMonitorEvent.findMany({
        where: {
          ...options.where,
          ...(options.force ? {} : { overallStatus: { in: ['PENDING', 'UNAVAILABLE'] } }),
          ...(options.force ? {} : { nextCheckAt: { lte: new Date() } }),
          OR: [{ processingAt: null }, { processingAt: { lt: staleProcessingAt } }],
        },
        orderBy: [{ nextCheckAt: 'asc' }, { saleAt: 'asc' }],
        take: this.defaults.batchSize,
      });
      const claimed = [];
      for (const event of candidates) {
        const claim = await this.prisma.fbsStockMonitorEvent.updateMany({
          where: {
            id: event.id,
            OR: [{ processingAt: null }, { processingAt: { lt: staleProcessingAt } }],
          },
          data: { processingAt: new Date(), processingBy: this.workerId },
        });
        if (claim.count === 1) claimed.push(event);
      }
      if (claimed.length === 0) {
        await this.finishRun(run.id, startedAt, { checked: 0 });
        return { checked: 0, succeeded: 0, pending: 0, failed: 0, unavailable: 0 };
      }

      let probeResults: FbsStockMonitorProbeResult[] = [];
      try {
        probeResults = await this.probe(claimed.map((event) => ({
          eventId: event.id,
          eventType: requireEventType(event.eventType),
          clientId: event.clientId,
          connectionId: event.connectionId,
          orderId: event.orderId,
          skuId: event.skuId,
          quantity: event.quantity,
          chrtId: event.chrtId,
          marketplaceWarehouseId: event.marketplaceWarehouseId,
          executionWarehouseId: event.executionWarehouseId,
        })));
      } catch (caught) {
        const message = monitorError(caught);
        probeResults = claimed.map((event) => ({
          eventId: event.id,
          wbCurrentAmount: null,
          wbOrderMatched: false,
          wbError: message,
          wmsCurrentAmount: null,
          wmsSellableAmount: null,
          wmsReservedAmount: null,
          wmsReservationMatched: false,
          wmsReservationReleased: false,
          wmsError: message,
        }));
      }
      const resultById = new Map(probeResults.map((result) => [result.eventId, result]));
      const configs = await this.prisma.fbsStockMonitorConfig.findMany({
        where: { connectionId: { in: uniqueStrings(claimed.map((event) => event.connectionId)) } },
      });
      const configByConnection = new Map(configs.map((config) => [config.connectionId, config]));
      const summary = { checked: 0, succeeded: 0, pending: 0, failed: 0, unavailable: 0, wbErrors: 0, wmsErrors: 0 };

      for (const event of claimed) {
        const probeResult = resultById.get(event.id) ?? missingProbeResult(event.id);
        const config = this.configFor(event.clientId, event.connectionId, configByConnection.get(event.connectionId));
        const eventType = requireEventType(event.eventType);
        const now = new Date();
        const wbAttempt = event.wbStatus === 'SUCCESS' ? event.wbAttempts : event.wbAttempts + 1;
        const wmsAttempt = event.wmsStatus === 'SUCCESS' ? event.wmsAttempts : event.wmsAttempts + 1;
        const wbResult = event.wbStatus === 'SUCCESS'
          ? { status: 'SUCCESS' as const, expectedAfterAmount: event.wbExpectedAfterAmount, observedDelta: null, message: event.wbMessage }
          : evaluateFbsStockMonitorWb({
              eventType,
              quantity: event.quantity,
              beforeAmount: event.wbBeforeAmount,
              expectedAfterAmount: event.wbExpectedAfterAmount,
              currentAmount: probeResult.wbCurrentAmount,
              exactOrderMatched: probeResult.wbOrderMatched,
              nowMs: now.getTime(),
              deadlineMs: event.deadlineAt.getTime(),
              attempt: wbAttempt,
              maxAttempts: config.maxAttempts,
              temporarilyUnavailable: Boolean(probeResult.wbError),
              unavailableMessage: probeResult.wbError,
            });
        const wmsResult = event.wmsStatus === 'SUCCESS'
          ? { status: 'SUCCESS' as const, expectedAfterAmount: event.wmsExpectedAfterAmount, observedDelta: null, message: event.wmsMessage }
          : evaluateFbsStockMonitorWms({
              eventType,
              quantity: event.quantity,
              beforeAmount: event.wmsBeforeAmount,
              expectedAfterAmount: event.wmsExpectedAfterAmount,
              currentAmount: probeResult.wmsSellableAmount,
              exactOrderMatched: probeResult.wbOrderMatched,
              exactReservationMatched: probeResult.wmsReservationMatched,
              exactReservationReleased: probeResult.wmsReservationReleased,
              nowMs: now.getTime(),
              deadlineMs: event.deadlineAt.getTime(),
              attempt: wmsAttempt,
              maxAttempts: config.maxAttempts,
              temporarilyUnavailable: Boolean(probeResult.wmsError),
              unavailableMessage: probeResult.wmsError,
            });
        const overallStatus = fbsStockMonitorOverallStatus(wbResult.status, wmsResult.status);
        const retry = (
          fbsStockMonitorNeedsRetry(wbResult.status) || fbsStockMonitorNeedsRetry(wmsResult.status)
        ) && Math.max(wbAttempt, wmsAttempt) < config.maxAttempts;
        const nextCheckAt = retry
          ? new Date(now.getTime() + config.retryIntervalSeconds * 1_000)
          : null;
        const sourceIds = probeResult.sourceIds
          ? probeResult.sourceIds as Prisma.InputJsonValue
          : undefined;
        await this.prisma.$transaction([
          this.prisma.fbsStockMonitorEvent.update({
            where: { id: event.id },
            data: {
              wbCurrentAmount: probeResult.wbCurrentAmount,
              wbAfterAmount: wbResult.status === 'SUCCESS'
                ? probeResult.wbCurrentAmount
                : event.wbAfterAmount,
              wbStatus: wbResult.status,
              wbAttempts: wbAttempt,
              wbMessage: wbResult.message,
              wmsCurrentAmount: probeResult.wmsCurrentAmount,
              wmsAfterAmount: wmsResult.status === 'SUCCESS'
                ? probeResult.wmsSellableAmount
                : event.wmsAfterAmount,
              wmsReservedAmount: probeResult.wmsReservedAmount,
              wmsStatus: wmsResult.status,
              wmsAttempts: wmsAttempt,
              wmsMessage: wmsResult.message,
              overallStatus,
              statusRank: monitorStatusRank(overallStatus),
              nextCheckAt,
              lastCheckedAt: now,
              processingAt: null,
              processingBy: null,
            },
          }),
          this.prisma.fbsStockMonitorHistory.create({
            data: {
              eventId: event.id,
              system: 'WB',
              kind: 'CHECK',
              status: wbResult.status,
              attempt: wbAttempt,
              beforeAmount: event.wbBeforeAmount,
              expectedAmount: wbResult.expectedAfterAmount,
              currentAmount: probeResult.wbCurrentAmount,
              message: wbResult.message,
              sourceIds,
            },
          }),
          this.prisma.fbsStockMonitorHistory.create({
            data: {
              eventId: event.id,
              system: 'WMS',
              kind: 'CHECK',
              status: wmsResult.status,
              attempt: wmsAttempt,
              beforeAmount: event.wmsBeforeAmount,
              expectedAmount: wmsResult.expectedAfterAmount,
              currentAmount: probeResult.wmsSellableAmount,
              reservedAmount: probeResult.wmsReservedAmount,
              message: wmsResult.message,
              sourceIds,
            },
          }),
        ]);
        summary.checked += 1;
        if (overallStatus === 'SUCCESS') summary.succeeded += 1;
        else if (overallStatus === 'ERROR') summary.failed += 1;
        else if (overallStatus === 'UNAVAILABLE') summary.unavailable += 1;
        else summary.pending += 1;
        if (probeResult.wbError) summary.wbErrors += 1;
        if (probeResult.wmsError) summary.wmsErrors += 1;
      }
      await this.finishRun(run.id, startedAt, summary);
      return summary;
    } catch (caught) {
      await this.prisma.fbsStockMonitorEvent.updateMany({
        where: { processingBy: this.workerId },
        data: { processingAt: null, processingBy: null },
      }).catch(() => undefined);
      await this.finishRun(run.id, startedAt, { checked: 0, errorMessage: monitorError(caught) });
      throw caught;
    } finally {
      this.running = false;
    }
  }

  private async requireRepairEvent(eventId: string, user: AuthUser) {
    const event = await this.prisma.fbsStockMonitorEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Строка мониторинга не найдена.');
    this.clientScopes.requireClientAccess(user, event.clientId, 'read');
    return event;
  }

  private assertRepairState(event: FbsStockMonitorEvent) {
    if (event.processingAt) {
      throw new ConflictException('Строка уже проверяется или исправляется. Дождитесь завершения операции.');
    }
    if (!fbsStockMonitorRepairAvailable(event)) {
      throw new ConflictException(
        'Исправление доступно только для завершённой красной проверки, когда WB превышает доступный остаток WMS, а проверка WMS подтверждена.',
      );
    }
  }

  private repairInput(event: FbsStockMonitorEvent): FbsStockMonitorRepairInput {
    if (!event.marketplaceWarehouseId) {
      throw new BadRequestException('Для строки не определён склад Wildberries.');
    }
    return {
      clientId: event.clientId,
      connectionId: event.connectionId,
      warehouseId: event.marketplaceWarehouseId,
      skuId: event.skuId,
    };
  }

  private repairPreviewResponse(event: FbsStockMonitorEvent, snapshot: FbsStockMonitorRepairSnapshot) {
    return {
      eventId: event.id,
      article: event.article,
      barcode: event.barcode,
      currentWbAmount: snapshot.previousAmount,
      currentWmsAvailableAmount: snapshot.wmsAvailableAmount,
      currentWmsReservedAmount: snapshot.wmsReservedAmount,
      targetAmount: snapshot.targetAmount,
      checkedAt: snapshot.checkedAt,
    };
  }

  private requireRepairHandler() {
    if (!this.repairHandler) {
      throw new ServiceUnavailableException('Исправление остатков ещё не подключено к интеграции Wildberries.');
    }
    return this.repairHandler;
  }

  private async finishRun(
    id: string,
    startedAt: Date,
    values: Partial<{
      checked: number;
      succeeded: number;
      pending: number;
      failed: number;
      unavailable: number;
      wbErrors: number;
      wmsErrors: number;
      errorMessage: string;
    }>,
  ) {
    await this.prisma.fbsStockMonitorRun.update({
      where: { id },
      data: {
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        ...values,
      },
    });
  }

  private configFor(
    clientId: string,
    connectionId: string,
    stored?: Partial<MonitorConfig> | null,
  ): MonitorConfig {
    return {
      clientId,
      connectionId,
      enabled: stored?.enabled ?? this.defaults.enabled,
      allowedDelaySeconds: stored?.allowedDelaySeconds ?? this.defaults.allowedDelaySeconds,
      retryIntervalSeconds: stored?.retryIntervalSeconds ?? this.defaults.retryIntervalSeconds,
      maxAttempts: stored?.maxAttempts ?? this.defaults.maxAttempts,
      wbRule: stored?.wbRule ?? 'ORDER_AND_STOCK_DELTA',
      wmsRule: stored?.wmsRule ?? 'ORDER_RESERVATION_OR_SELLABLE_DELTA',
    };
  }

  private async requireConnection(connectionId: string, user: AuthUser, mode: 'read' | 'write') {
    const connection = await this.prisma.clientMarketplaceConnection.findFirst({
      where: { id: connectionId, marketplace: MarketplaceType.WILDBERRIES, isActive: true },
      select: { id: true, clientId: true },
    });
    if (!connection) throw new NotFoundException('Активное подключение Wildberries не найдено.');
    this.clientScopes.requireClientAccess(user, connection.clientId, mode);
    return connection;
  }

  private async loadLatestGroupSnapshots(
    groupKeys: string[],
    candidates: Array<{
      order: FbsStockMonitorOrderInput;
      connection: { fbsWarehouseId: string | null };
    }>,
  ) {
    if (groupKeys.length === 0) return new Map<string, {
      wbCurrentAmount: number | null;
      wbAfterAmount: number | null;
      wmsCurrentAmount: number | null;
      wmsAfterAmount: number | null;
    }>();
    const latest = await this.prisma.fbsStockMonitorEvent.findMany({
      where: {
        OR: candidates.map((candidate) => ({
          connectionId: candidate.order.connectionId,
          marketplaceWarehouseId: candidate.order.marketplaceWarehouseId || candidate.connection.fbsWarehouseId,
          skuId: candidate.order.skuId,
        })),
      },
      select: {
        connectionId: true,
        marketplaceWarehouseId: true,
        skuId: true,
        wbCurrentAmount: true,
        wbAfterAmount: true,
        wmsCurrentAmount: true,
        wmsAfterAmount: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const result = new Map<string, typeof latest[number]>();
    for (const item of latest) {
      const key = monitorGroupKey(item.connectionId, item.marketplaceWarehouseId, item.skuId);
      if (!result.has(key)) result.set(key, item);
    }
    return result;
  }
}

function formatMonitorEvent(event: {
  id: string;
  eventKey: string;
  clientId: string;
  connectionId: string;
  marketplace: MarketplaceType;
  marketplaceWarehouseId: string | null;
  marketplaceWarehouseName: string | null;
  executionWarehouseId: string | null;
  orderId: string;
  orderUid: string | null;
  eventType: string;
  sourceIds: Prisma.JsonValue | null;
  skuId: string;
  productName: string;
  article: string | null;
  nmId: string | null;
  chrtId: number | null;
  barcode: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  saleAt: Date;
  detectedAt: Date;
  deadlineAt: Date;
  wbBeforeAmount: number | null;
  wbExpectedAfterAmount: number | null;
  wbAfterAmount: number | null;
  wbCurrentAmount: number | null;
  wbStatus: string;
  wbAttempts: number;
  wbMessage: string | null;
  wmsBeforeAmount: number | null;
  wmsExpectedAfterAmount: number | null;
  wmsAfterAmount: number | null;
  wmsCurrentAmount: number | null;
  wmsReservedAmount: number | null;
  wmsStatus: string;
  wmsAttempts: number;
  wmsMessage: string | null;
  overallStatus: string;
  nextCheckAt: Date | null;
  lastCheckedAt: Date | null;
  processingAt: Date | null;
  processingBy: string | null;
}) {
  return {
    // FIX: expose only the documented monitoring contract; worker locks and
    // internal ranking/fingerprints must never leak through a Prisma object.
    id: event.id,
    eventKey: event.eventKey,
    clientId: event.clientId,
    connectionId: event.connectionId,
    marketplace: event.marketplace,
    marketplaceWarehouseId: event.marketplaceWarehouseId,
    marketplaceWarehouseName: event.marketplaceWarehouseName,
    executionWarehouseId: event.executionWarehouseId,
    orderId: event.orderId,
    orderUid: event.orderUid,
    eventType: event.eventType,
    sourceIds: event.sourceIds,
    skuId: event.skuId,
    productName: event.productName,
    article: event.article,
    nmId: event.nmId,
    chrtId: event.chrtId,
    barcode: event.barcode,
    size: event.size,
    color: event.color,
    quantity: event.quantity,
    saleAt: event.saleAt.toISOString(),
    detectedAt: event.detectedAt.toISOString(),
    deadlineAt: event.deadlineAt.toISOString(),
    wbBeforeAmount: event.wbBeforeAmount,
    wbExpectedAfterAmount: event.wbExpectedAfterAmount,
    wbAfterAmount: event.wbAfterAmount,
    wbCurrentAmount: event.wbCurrentAmount,
    wbStatus: event.wbStatus,
    wbAttempts: event.wbAttempts,
    wbMessage: event.wbMessage,
    wmsBeforeAmount: event.wmsBeforeAmount,
    wmsExpectedAfterAmount: event.wmsExpectedAfterAmount,
    wmsAfterAmount: event.wmsAfterAmount,
    wmsCurrentAmount: event.wmsCurrentAmount,
    wmsReservedAmount: event.wmsReservedAmount,
    wmsStatus: event.wmsStatus,
    wmsAttempts: event.wmsAttempts,
    wmsMessage: event.wmsMessage,
    overallStatus: event.overallStatus,
    nextCheckAt: event.nextCheckAt?.toISOString() ?? null,
    lastCheckedAt: event.lastCheckedAt?.toISOString() ?? null,
    // ADDED: expose only actionable booleans, never the internal lock owner.
    repairAvailable: fbsStockMonitorRepairAvailable(event),
    repairInProgress: Boolean(event.processingAt && event.processingBy?.startsWith('stock-monitor-repair:')),
  };
}

// FIX: SQL `not: 0` alone also drops NULL. This explicit OR preserves unknown
// or unavailable WB values while excluding a confirmed numeric zero.
export function fbsStockMonitorVisibleWbWhere(): Prisma.FbsStockMonitorEventWhereInput {
  return {
    OR: [
      { wbCurrentAmount: null },
      { wbCurrentAmount: { not: 0 } },
    ],
  };
}

export function fbsStockMonitorRepairAvailable(event: Pick<
  FbsStockMonitorEvent,
  'overallStatus' | 'wbStatus' | 'wmsStatus' | 'lastCheckedAt' | 'wbCurrentAmount' | 'wmsAfterAmount' | 'processingAt'
>) {
  return event.overallStatus === 'ERROR'
    && event.wbStatus === 'ERROR'
    && event.wmsStatus === 'SUCCESS'
    && event.lastCheckedAt !== null
    && event.wbCurrentAmount !== null
    && event.wmsAfterAmount !== null
    && event.wbCurrentAmount > event.wmsAfterAmount
    && event.processingAt === null;
}

function manualRepairSource(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function monitorGroupKey(connectionId: string, warehouseId: string | null | undefined, skuId: string) {
  return `${connectionId}:${warehouseId || '-'}:${skuId}`;
}

function monitorSourceFingerprint(order: FbsStockMonitorOrderInput, eventType: FbsStockMonitorEventType) {
  return [
    eventType,
    order.category,
    order.supplierStatus,
    order.wbStatus,
    order.orderUid || '-',
    order.createdAt || order.sellerDate || '-',
    order.quantity,
  ].join('|');
}

function monitorWbProductIds(value: string | null | undefined) {
  const [nmId = '', chrtIdText = ''] = String(value ?? '').trim().split(':');
  const chrtId = Number(chrtIdText);
  return nmId && Number.isSafeInteger(chrtId) && chrtId > 0 ? { nmId, chrtId } : null;
}

function monitorDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monitorDateBoundary(value: string | null | undefined, endOfDay: boolean) {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+03:00`
      : normalized,
  );
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`Некорректная дата: ${normalized}.`);
  return parsed;
}

function monitorStatus(value: string | null | undefined): FbsStockMonitorCheckStatus | null {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'SUCCESS' || normalized === 'ERROR' || normalized === 'PENDING' || normalized === 'UNAVAILABLE'
    ? normalized
    : null;
}

function monitorStatusRank(status: FbsStockMonitorCheckStatus) {
  if (status === 'ERROR') return 0;
  if (status === 'PENDING') return 1;
  if (status === 'UNAVAILABLE') return 2;
  return 3;
}

function requireEventType(value: string): FbsStockMonitorEventType {
  if (value === 'SALE' || value === 'CANCEL' || value === 'RETURN') return value;
  throw new BadRequestException(`Неизвестный тип события мониторинга: ${value}.`);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

// FIX: clamp after totals and reservations from every matching location have
// been combined for the barcode.
export function availableWmsStockQuantity(total: number, reserved: number) {
  return Math.max(0, Math.trunc(total) - Math.max(0, Math.trunc(reserved)));
}

export function wmsStockExportFileName(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00';
  return `wms_stocks_${value('year')}-${value('month')}-${value('day')}_${value('hour')}-${value('minute')}.xlsx`;
}

const WMS_STOCK_EXPORT_REQUEST_STATUSES = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
  ClientRequestStatus.PACKED,
];

function requestSkuKey(requestId: string | null, skuId: string) {
  return `${requestId || '-'}:${skuId}`;
}

function exportErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка выгрузки остатков WMS.';
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isPrismaUniqueError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002';
}

function monitorError(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Неизвестная ошибка проверки остатков.';
}

function missingProbeResult(eventId: string): FbsStockMonitorProbeResult {
  return {
    eventId,
    wbCurrentAmount: null,
    wbOrderMatched: false,
    wbError: 'Интеграция не вернула результат проверки WB.',
    wmsCurrentAmount: null,
    wmsSellableAmount: null,
    wmsReservedAmount: null,
    wmsReservationMatched: false,
    wmsReservationReleased: false,
    wmsError: 'Интеграция не вернула результат проверки WMS.',
  };
}

function emptyRunResult(message: string) {
  return { checked: 0, succeeded: 0, pending: 0, failed: 0, unavailable: 0, message };
}
