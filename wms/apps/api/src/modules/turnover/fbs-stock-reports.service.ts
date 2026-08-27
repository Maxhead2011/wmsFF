import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import type { FbsBoxReportDto, FbsShipmentReportDto } from './dto/fbs-stock-reports.dto';

export const FBS_STOCK_REPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ShipmentRow = {
  orderId: string;
  marketplace: string;
  shippedAt: string;
  warehouseId: string | null;
  warehouse: string;
  units: number;
  requestNumber: number;
};

type WithoutPalletRow = {
  boxCode: string;
  warehouse: string;
  location: string;
  status: string;
  barcode: string;
  article: string;
  quantity: number;
  boxTotal: number;
};

type PalletAggregate = {
  palletCode: string;
  barcode: string;
  quantity: number;
  boxIds: Set<string>;
};

@Injectable()
export class FbsStockReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClientScopeService) private readonly clientScopes: ClientScopeService,
  ) {}

  // ADDED: shipment date is the actual DONE event; each marketplace order is
  // emitted once even if the WMS request contains several product rows.
  async shipments(filter: FbsShipmentReportDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, filter.clientId, 'read');
    const effectiveFilter = { ...filter, warehouseId: scopedWarehouseId(user, filter.warehouseId) };
    const period = moscowPeriod(filter.dateFrom, filter.dateTo);
    const page = positiveInteger(filter.page, 1);
    const pageSize = boundedInteger(filter.pageSize, 20, 10, 100);
    const daily = new Map<string, { orders: number; units: number }>();
    const items: ShipmentRow[] = [];
    let orders = 0;
    let units = 0;

    for await (const row of this.iterateShipmentRows(effectiveFilter, period)) {
      const index = orders;
      orders += 1;
      units += row.units;
      const day = moscowDateKey(new Date(row.shippedAt));
      const current = daily.get(day) ?? { orders: 0, units: 0 };
      current.orders += 1;
      current.units += row.units;
      daily.set(day, current);
      if (index >= (page - 1) * pageSize && index < page * pageSize) items.push(row);
    }

    return {
      period: { dateFrom: filter.dateFrom, dateTo: filter.dateTo },
      summary: { orders, units },
      daily: [...daily.entries()].map(([date, value]) => ({ date, ...value })),
      items,
      pagination: { page, pageSize, total: orders, pages: Math.max(1, Math.ceil(orders / pageSize)) },
      generatedAt: new Date().toISOString(),
    };
  }

  async exportShipments(filter: FbsShipmentReportDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, filter.clientId, 'read');
    const effectiveFilter = { ...filter, warehouseId: scopedWarehouseId(user, filter.warehouseId) };
    const period = moscowPeriod(filter.dateFrom, filter.dateTo);
    const directory = await mkdtemp(join(tmpdir(), 'fbs-shipment-report-'));
    const fileName = `fbs_shipments_${filter.dateFrom}_${filter.dateTo}.xlsx`;
    const filePath = join(directory, fileName);
    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
      const sheet = workbook.addWorksheet('Отгруженные FBS-заказы', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = [
        { header: 'Заказ', key: 'orderId', width: 22, style: { numFmt: '@' } },
        { header: 'Маркетплейс', key: 'marketplace', width: 18 },
        { header: 'Дата отгрузки', key: 'shippedAt', width: 20 },
        { header: 'Склад', key: 'warehouse', width: 28 },
        { header: 'Количество', key: 'units', width: 14 },
      ];
      sheet.autoFilter = 'A1:E1';
      const header = sheet.getRow(1);
      header.font = { bold: true };
      header.commit();
      let rowCount = 0;
      for await (const item of this.iterateShipmentRows(effectiveFilter, period)) {
        const row = sheet.addRow({ ...item, shippedAt: formatMoscowDateTime(new Date(item.shippedAt)) });
        row.getCell(1).numFmt = '@';
        row.commit();
        rowCount += 1;
      }
      sheet.commit();
      await workbook.commit();
      const fileStat = await stat(filePath);
      return {
        fileName,
        filePath,
        mimeType: FBS_STOCK_REPORT_XLSX_MIME,
        size: fileStat.size,
        rowCount,
        cleanup: () => rm(directory, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  // ADDED: the single StoragePalletBox relation partitions boxes into two
  // mutually exclusive groups; quantities are summed from units, never rows.
  async boxes(filter: FbsBoxReportDto, user: AuthUser) {
    this.clientScopes.requireClientAccess(user, filter.clientId, 'read');
    const warehouseId = scopedWarehouseId(user, filter.warehouseId);
    const page = positiveInteger(filter.page, 1);
    const pageSize = boundedInteger(filter.pageSize, 50, 10, 100);
    const palletPage = positiveInteger(filter.palletPage, 1);
    const palletPageSize = boundedInteger(filter.palletPageSize, 50, 10, 100);
    const withoutItems: WithoutPalletRow[] = [];
    const palletRows = new Map<string, PalletAggregate>();
    const palletBoxIds = new Set<string>();
    const palletCodes = new Set<string>();
    const palletBarcodes = new Set<string>();
    let withoutBoxes = 0;
    let withoutUnits = 0;
    let withoutRows = 0;
    let palletUnits = 0;
    let cursorId: string | undefined;

    for (;;) {
      const boxes = await this.prisma.box.findMany({
        where: {
          clientId: filter.clientId,
          status: { notIn: ['deleted', 'archived', 'shipped'] },
          balances: { some: { quantity: { gt: 0 } } },
          ...(warehouseId
            ? {
                OR: [
                  { storagePlacement: { is: null }, warehouseId },
                  { storagePlacement: { is: { pallet: { warehouseId } } } },
                ],
              }
            : {}),
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        select: {
          id: true,
          code: true,
          status: true,
          warehouse: { select: { id: true, code: true, name: true, city: true } },
          zone: { select: { id: true, code: true, name: true } },
          storagePlacement: {
            select: { pallet: { select: { id: true, code: true, status: true, warehouseId: true } } },
          },
          balances: {
            where: { quantity: { gt: 0 } },
            select: {
              skuId: true,
              quantity: true,
              status: true,
              sku: {
                select: {
                  article: true,
                  internalSku: true,
                  barcodes: {
                    select: { value: true, isPrimary: true },
                    orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }],
                    take: 1,
                  },
                },
              },
            },
          },
        },
        orderBy: { id: 'asc' },
        take: 500,
      });
      if (boxes.length === 0) break;

      for (const box of boxes) {
        const bySku = new Map<string, { barcode: string; article: string; quantity: number }>();
        for (const balance of box.balances) {
          const barcode = balance.sku.barcodes[0]?.value.trim() || '';
          const current = bySku.get(balance.skuId) ?? {
            barcode,
            article: balance.sku.article || balance.sku.internalSku,
            quantity: 0,
          };
          current.quantity += Math.max(0, balance.quantity);
          bySku.set(balance.skuId, current);
        }
        const rows = [...bySku.values()].filter((row) => row.quantity > 0);
        const boxTotal = rows.reduce((sum, row) => sum + row.quantity, 0);
        if (boxTotal <= 0) continue;

        const placement = box.storagePlacement?.pallet ?? null;
        if (!placement) {
          withoutBoxes += 1;
          withoutUnits += boxTotal;
          for (const row of rows) {
            const index = withoutRows;
            withoutRows += 1;
            if (index >= (page - 1) * pageSize && index < page * pageSize) {
              withoutItems.push({
                boxCode: box.code,
                warehouse: warehouseLabel(box.warehouse),
                location: box.zone?.name || box.zone?.code || 'Местоположение не указано',
                status: box.status,
                barcode: row.barcode,
                article: row.article,
                quantity: row.quantity,
                boxTotal,
              });
            }
          }
          continue;
        }

        palletBoxIds.add(box.id);
        palletCodes.add(placement.code);
        palletUnits += boxTotal;
        for (const row of rows) {
          if (row.barcode) palletBarcodes.add(row.barcode);
          const key = `${placement.id}:${row.barcode || `sku:${row.article}`}`;
          const current = palletRows.get(key) ?? {
            palletCode: placement.code,
            barcode: row.barcode,
            quantity: 0,
            boxIds: new Set<string>(),
          };
          current.quantity += row.quantity;
          current.boxIds.add(box.id);
          palletRows.set(key, current);
        }
      }

      cursorId = boxes[boxes.length - 1].id;
      if (boxes.length < 500) break;
    }

    const allPalletItems = [...palletRows.values()]
      .map((row) => ({
        palletCode: row.palletCode,
        barcode: row.barcode,
        quantity: row.quantity,
        boxes: row.boxIds.size,
      }))
      .sort((left, right) => left.palletCode.localeCompare(right.palletCode, 'ru-RU', { numeric: true })
        || left.barcode.localeCompare(right.barcode, 'ru-RU', { numeric: true }));
    const palletStart = (palletPage - 1) * palletPageSize;

    return {
      withoutPallet: {
        summary: { boxes: withoutBoxes, units: withoutUnits, rows: withoutRows },
        items: withoutItems,
        pagination: { page, pageSize, total: withoutRows, pages: Math.max(1, Math.ceil(withoutRows / pageSize)) },
      },
      onPallet: {
        summary: {
          boxes: palletBoxIds.size,
          units: palletUnits,
          barcodes: palletBarcodes.size,
          pallets: palletCodes.size,
        },
        items: allPalletItems.slice(palletStart, palletStart + palletPageSize),
        pagination: {
          page: palletPage,
          pageSize: palletPageSize,
          total: allPalletItems.length,
          pages: Math.max(1, Math.ceil(allPalletItems.length / palletPageSize)),
        },
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private async *iterateShipmentRows(
    filter: FbsShipmentReportDto,
    period: { from: Date; to: Date },
  ): AsyncGenerator<ShipmentRow> {
    const seenRequests = new Set<string>();
    const seenOrders = new Set<string>();
    let cursorId: string | undefined;

    for (;;) {
      const events = await this.prisma.clientRequestEvent.findMany({
        where: {
          clientId: filter.clientId,
          statusTo: ClientRequestStatus.DONE,
          createdAt: { gte: period.from, lte: period.to },
          request: {
            clientId: filter.clientId,
            type: ClientRequestType.OUTBOUND,
            status: ClientRequestStatus.DONE,
            ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
          },
        },
        select: {
          id: true,
          requestId: true,
          createdAt: true,
          request: {
            select: {
              number: true,
              warehouseId: true,
              warehouse: { select: { code: true, name: true, city: true } },
              fbsOrderLinks: {
                select: {
                  connectionId: true,
                  orderId: true,
                  marketplace: true,
                  lastCategory: true,
                  lastItemCount: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (events.length === 0) break;

      for (const event of events) {
        // TEST support and defence in depth: never trust an adapter to widen
        // the requested time range silently.
        if (event.createdAt < period.from || event.createdAt > period.to) continue;
        if (seenRequests.has(event.requestId)) continue;
        seenRequests.add(event.requestId);
        for (const link of event.request.fbsOrderLinks) {
          if (!['shipped', 'archive'].includes(link.lastCategory || '')) continue;
          const key = `${link.marketplace}:${link.connectionId}:${link.orderId}`;
          if (seenOrders.has(key)) continue;
          seenOrders.add(key);
          yield {
            orderId: link.orderId,
            marketplace: link.marketplace,
            shippedAt: event.createdAt.toISOString(),
            warehouseId: event.request.warehouseId,
            warehouse: warehouseLabel(event.request.warehouse),
            units: Math.max(1, link.lastItemCount ?? 1),
            requestNumber: event.request.number,
          };
        }
      }

      cursorId = events[events.length - 1].id;
      if (events.length < 500) break;
    }
  }
}

function moscowPeriod(dateFrom: string, dateTo: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new BadRequestException('Укажите корректный период отчёта.');
  }
  const from = new Date(`${dateFrom}T00:00:00.000+03:00`);
  const to = new Date(`${dateTo}T23:59:59.999+03:00`);
  if (from > to) throw new BadRequestException('Дата начала периода не может быть позже даты окончания.');
  return { from, to };
}

function moscowDateKey(date: Date) {
  return new Date(date.getTime() + 3 * 60 * 60_000).toISOString().slice(0, 10);
}

function formatMoscowDateTime(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function warehouseLabel(warehouse: { code?: string | null; name?: string | null; city?: string | null } | null) {
  return warehouse?.name || warehouse?.city || warehouse?.code || 'Склад не указан';
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value!)) : fallback;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value!))) : fallback;
}

function scopedWarehouseId(user: AuthUser, requestedWarehouseId?: string) {
  if (!user.activeWarehouseId || user.roleCodes.includes('CLIENT') || user.permissionCodes.includes('system:admin')) {
    return requestedWarehouseId;
  }
  return user.activeWarehouseId;
}

