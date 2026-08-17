import { BadRequestException, Injectable } from '@nestjs/common';
import { ClientRequestStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';

export const FBS_PRODUCT_REPORT_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ReportFilter = {
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

type MutableProductRow = {
  key: string;
  skuId: string | null;
  internalSku: string;
  clientSku: string;
  article: string;
  productName: string;
  color: string;
  size: string;
  barcode: string;
  quantity: number;
  orderNumbers: Set<string>;
  supplyNumbers: Set<string>;
  requestNumbers: Set<number>;
  shipmentDates: Date[];
};

@Injectable()
export class FbsProductShipmentsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async report(filter: ReportFilter, user: AuthUser) {
    const clientId = requiredText(filter.clientId, 'Выберите клиента.');
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    if (!user.activeWarehouseId) {
      throw new BadRequestException('Сначала выберите город в верхней панели WMS.');
    }
    const period = reportPeriod(filter.dateFrom, filter.dateTo);
    const search = cleanSearch(filter.search);
    const [client, warehouse, requests] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.warehouse.findUnique({
        where: { id: user.activeWarehouseId },
        select: { id: true, code: true, name: true, city: true },
      }),
      this.prisma.clientRequest.findMany({
        where: {
          clientId,
          warehouseId: user.activeWarehouseId,
          status: ClientRequestStatus.DONE,
          fbsOrderLinks: { some: {} },
          OR: [
            {
              events: {
                some: {
                  statusTo: ClientRequestStatus.DONE,
                  createdAt: { gte: period.from, lte: period.to },
                },
              },
            },
            {
              events: {
                none: { statusTo: ClientRequestStatus.DONE },
              },
              updatedAt: { gte: period.from, lte: period.to },
            },
          ],
        },
        select: {
          id: true,
          number: true,
          title: true,
          updatedAt: true,
          events: {
            where: { statusTo: ClientRequestStatus.DONE },
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          items: {
            select: {
              skuId: true,
              barcode: true,
              name: true,
              quantity: true,
              comment: true,
              sku: {
                select: {
                  id: true,
                  internalSku: true,
                  clientSku: true,
                  article: true,
                  name: true,
                  color: true,
                  size: true,
                  barcodes: {
                    select: { value: true, isPrimary: true },
                    orderBy: [{ isPrimary: 'desc' }],
                    take: 1,
                  },
                },
              },
            },
          },
          fbsOrderLinks: {
            select: {
              orderId: true,
              lastSkuId: true,
              lastItemCount: true,
              lastSupplyId: true,
              lastCategory: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20_000,
      }),
    ]);
    if (!client) throw new BadRequestException('Клиент не найден.');
    if (!warehouse) throw new BadRequestException('Выбранный филиал не найден.');

    const groups = new Map<string, MutableProductRow>();
    for (const request of requests) {
      const shippedAt = request.events[0]?.createdAt ?? request.updatedAt;
      if (shippedAt < period.from || shippedAt > period.to) continue;
      const linksBySku = new Map<
        string,
        Array<{
          orderId: string;
          lastItemCount: number | null;
          lastSupplyId: string | null;
        }>
      >();
      for (const link of request.fbsOrderLinks) {
        if (
          !link.lastSkuId ||
          !['shipped', 'archive'].includes(link.lastCategory || '')
        ) {
          continue;
        }
        const rows = linksBySku.get(link.lastSkuId) || [];
        rows.push(link);
        linksBySku.set(link.lastSkuId, rows);
      }

      for (const item of request.items) {
        const sku = item.sku;
        const key = sku?.id
          ? `sku:${sku.id}`
          : `fallback:${normalizeKey(item.barcode || '')}:${normalizeKey(item.name || '')}`;
        const current =
          groups.get(key) ||
          ({
            key,
            skuId: sku?.id ?? item.skuId ?? null,
            internalSku: sku?.internalSku ?? '',
            clientSku: sku?.clientSku ?? '',
            article: sku?.article ?? '',
            productName: sku?.name ?? item.name ?? 'Товар без наименования',
            color: sku?.color ?? '',
            size: sku?.size ?? '',
            barcode: sku?.barcodes[0]?.value ?? item.barcode ?? '',
            quantity: 0,
            orderNumbers: new Set<string>(),
            supplyNumbers: new Set<string>(),
            requestNumbers: new Set<number>(),
            shipmentDates: [],
          } satisfies MutableProductRow);
        current.quantity += Math.max(0, item.quantity);
        current.requestNumbers.add(request.number);
        current.shipmentDates.push(shippedAt);

        const matchingLinks = item.skuId ? linksBySku.get(item.skuId) || [] : [];
        if (matchingLinks.length) {
          for (const link of matchingLinks) {
            current.orderNumbers.add(link.orderId);
            if (link.lastSupplyId) current.supplyNumbers.add(link.lastSupplyId);
          }
        } else {
          for (const orderId of orderNumbersFromComment(item.comment)) {
            current.orderNumbers.add(orderId);
          }
        }
        groups.set(key, current);
      }
    }

    const allRows = [...groups.values()]
      .map((row) => {
        const dates = row.shipmentDates
          .map((date) => date.getTime())
          .sort((left, right) => left - right);
        return {
          skuId: row.skuId,
          internalSku: row.internalSku,
          clientSku: row.clientSku,
          article: row.article,
          productName: row.productName,
          color: row.color,
          size: row.size,
          barcode: row.barcode,
          quantity: row.quantity,
          orders: row.orderNumbers.size,
          wbOrderNumbers: [...row.orderNumbers].sort(naturalCompare).join(', '),
          wbSupplyNumbers: [...row.supplyNumbers].sort(naturalCompare).join(', '),
          wmsRequestNumbers: [...row.requestNumbers]
            .sort((left, right) => left - right)
            .map((number) => String(number).padStart(6, '0'))
            .join(', '),
          firstShippedAt: dates.length
            ? new Date(dates[0]).toISOString()
            : '',
          lastShippedAt: dates.length
            ? new Date(dates[dates.length - 1]).toISOString()
            : '',
        };
      })
      .sort(
        (left, right) =>
          right.quantity - left.quantity ||
          left.productName.localeCompare(right.productName, 'ru-RU'),
      );
    const rows = search
      ? allRows.filter((row) =>
          [
            row.internalSku,
            row.clientSku,
            row.article,
            row.productName,
            row.color,
            row.size,
            row.barcode,
            row.wbOrderNumbers,
            row.wbSupplyNumbers,
            row.wmsRequestNumbers,
          ].some((value) => normalizeKey(value).includes(normalizeKey(search))),
        )
      : allRows;

    return {
      client,
      warehouse,
      period: {
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
      },
      search,
      summary: {
        products: rows.length,
        quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
        orders: new Set(
          rows.flatMap((row) =>
            row.wbOrderNumbers
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ).size,
        requests: new Set(
          rows.flatMap((row) =>
            row.wmsRequestNumbers
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ).size,
      },
      rows,
      generatedAt: new Date().toISOString(),
    };
  }

  async export(filter: ReportFilter, user: AuthUser) {
    const report = await this.report(filter, user);
    const headers = [
      'SKU WMS',
      'SKU клиента',
      'Артикул',
      'Товар',
      'Цвет',
      'Размер',
      'Штрихкод',
      'Отгружено, шт.',
      'Заказов WB',
      'Номера заказов WB',
      'Номера поставок WB',
      'Заявки WMS',
      'Первая отгрузка',
      'Последняя отгрузка',
    ];
    const sheet = XLSX.utils.aoa_to_sheet([
      headers,
      ...report.rows.map((row) => [
        row.internalSku,
        row.clientSku,
        row.article,
        row.productName,
        row.color,
        row.size,
        row.barcode,
        row.quantity,
        row.orders,
        row.wbOrderNumbers,
        row.wbSupplyNumbers,
        row.wmsRequestNumbers,
        row.firstShippedAt,
        row.lastShippedAt,
      ]),
    ]);
    sheet['!cols'] = [
      24, 20, 20, 34, 16, 12, 20, 16, 14, 42, 30, 28, 22, 22,
    ].map((wch) => ({ wch }));
    sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:A1' };
    const summary = XLSX.utils.aoa_to_sheet([
      ['Отчёт', 'Отгруженные товары FBS'],
      ['Клиент', `${report.client.code} — ${report.client.name}`],
      ['Филиал', `${report.warehouse.city} — ${report.warehouse.name}`],
      ['Период', `${report.period.dateFrom} — ${report.period.dateTo}`],
      ['Ключевое слово', report.search || 'без фильтра'],
      ['Товаров', report.summary.products],
      ['Отгружено, шт.', report.summary.quantity],
      ['Заказов WB', report.summary.orders],
      ['Сформирован', report.generatedAt],
    ]);
    summary['!cols'] = [{ wch: 22 }, { wch: 55 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Товары FBS');
    XLSX.utils.book_append_sheet(workbook, summary, 'Параметры');
    return {
      fileName: `FBS_товары_${safeFilePart(report.client.code)}_${report.period.dateFrom}_${report.period.dateTo}.xlsx`,
      buffer: XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer,
    };
  }
}

function reportPeriod(dateFromValue?: string, dateToValue?: string) {
  const today = new Date();
  const defaultTo = isoDate(today);
  const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const dateFrom = dateFromValue?.trim() || defaultFrom;
  const dateTo = dateToValue?.trim() || defaultTo;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)
  ) {
    throw new BadRequestException('Период должен быть указан в формате ГГГГ-ММ-ДД.');
  }
  const from = new Date(`${dateFrom}T00:00:00.000+03:00`);
  const to = new Date(`${dateTo}T23:59:59.999+03:00`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    throw new BadRequestException('Период отчёта указан неверно.');
  }
  if (to.getTime() - from.getTime() > 10 * 366 * 86_400_000) {
    throw new BadRequestException('Период отчёта не может превышать 10 лет.');
  }
  return { from, to, dateFrom, dateTo };
}

function orderNumbersFromComment(value: string | null) {
  if (!value) return [];
  const match = value.match(/FBS-заказы:\s*(.+)$/iu);
  return match
    ? match[1]
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function cleanSearch(value?: string) {
  return String(value || '')
    .trim()
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 140);
}

function requiredText(value: string | undefined, message: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function normalizeKey(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'ru-RU', {
    numeric: true,
    sensitivity: 'base',
  });
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zа-яё0-9_-]+/giu, '_').slice(0, 80);
}

function isoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`;
}
