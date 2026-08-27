import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { MarketplaceType } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';

export const FBS_PENALTIES_REPORT_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const WB_FINANCE_REPORT_URL =
  'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed';
const WB_REPORT_LIMIT = 100_000;
const WB_REPORT_CACHE_MS = 65_000;
const WB_REPORT_FIELDS = [
  'rrdId',
  'reportId',
  'dateFrom',
  'dateTo',
  'createDate',
  'currency',
  'giId',
  'nmId',
  'vendorCode',
  'title',
  'techSize',
  'sku',
  'officeName',
  'orderDt',
  'saleDt',
  'rrDate',
  'bonusTypeName',
  'stickerId',
  'penalty',
  'orderId',
  'trbxId',
  'deliveryMethod',
  'orderUid',
  'srid',
] as const;

export type FbsPenaltiesReportFilter = {
  clientId?: string;
  connectionId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

type WbFinanceRow = Record<string, unknown>;

type PenaltySource = {
  connectionId: string;
  accountName: string;
  status: 'READY' | 'ERROR';
  rows: number;
  error: string | null;
};

type CachedConnectionRows = {
  expiresAt: number;
  rows: WbFinanceRow[];
  truncated: boolean;
};

@Injectable()
export class FbsPenaltiesReportService {
  // FIX: screen and Excel share the same snapshot to respect WB's 1 request/minute limit.
  private readonly connectionCache = new Map<string, CachedConnectionRows>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async report(filter: FbsPenaltiesReportFilter, user: AuthUser) {
    const clientId = requiredText(filter.clientId, 'Выберите клиента.');
    this.clientScopes.requireClientAccess(user, clientId, 'read');
    const period = reportPeriod(filter.dateFrom, filter.dateTo);
    const search = cleanSearch(filter.search);
    const connectionId = cleanIdentifier(filter.connectionId);
    const [client, connections] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.clientMarketplaceConnection.findMany({
        where: {
          clientId,
          marketplace: MarketplaceType.WILDBERRIES,
          isActive: true,
          ...(connectionId ? { id: connectionId } : {}),
        },
        select: { id: true, accountName: true, apiKey: true },
        orderBy: [{ accountName: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    if (!client) throw new BadRequestException('Клиент не найден.');
    if (connections.length === 0) {
      throw new BadRequestException(
        connectionId
          ? 'Выбранный кабинет Wildberries не найден или отключён.'
          : 'У клиента нет активного подключения Wildberries.',
      );
    }

    const loaded = await Promise.all(
      connections.map(async (connection) => {
        const accountName = connection.accountName?.trim() || 'Кабинет Wildberries';
        try {
          const result = await this.loadConnectionRows(
            connection.id,
            connection.apiKey,
            period.dateFrom,
            period.dateTo,
          );
          return {
            source: {
              connectionId: connection.id,
              accountName,
              status: 'READY',
              rows: result.rows.length,
              error: null,
            } satisfies PenaltySource,
            rows: result.rows,
            truncated: result.truncated,
            connectionId: connection.id,
            accountName,
          };
        } catch (caught) {
          return {
            source: {
              connectionId: connection.id,
              accountName,
              status: 'ERROR',
              rows: 0,
              error: safeErrorMessage(caught),
            } satisfies PenaltySource,
            rows: [] as WbFinanceRow[],
            truncated: false,
            connectionId: connection.id,
            accountName,
          };
        }
      }),
    );
    const sources = loaded.map((item) => item.source);
    const readySources = sources.filter((source) => source.status === 'READY');
    if (readySources.length === 0) {
      throw new BadGatewayException(
        sources[0]?.error || 'Wildberries не вернул отчёт о штрафах FBS.',
      );
    }

    // ADDED: only explicit FBS financial rows are allowed into this report.
    const allRows = loaded
      .flatMap((loadedSource) =>
        loadedSource.rows.map((row) =>
          normalizePenaltyRow(row, loadedSource.connectionId, loadedSource.accountName),
        ),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort(
        (left, right) =>
          right.reportDate.localeCompare(left.reportDate) ||
          right.rrdId.localeCompare(left.rrdId, 'ru-RU', { numeric: true }),
      );
    const rows = search
      ? allRows.filter((row) =>
          [
            row.accountName,
            row.reason,
            row.productName,
            row.vendorCode,
            row.barcode,
            row.size,
            row.orderId,
            row.cargoPlaceId,
            row.officeName,
            row.reportId,
          ].some((value) => normalizeKey(value).includes(normalizeKey(search))),
        )
      : allRows;
    const reasons = groupReasons(rows);
    const orderIds = new Set(rows.map((row) => row.orderId).filter(Boolean));
    const chargedPenalty = roundMoney(
      rows.reduce((sum, row) => sum + Math.max(0, row.penalty), 0),
    );
    const reversedPenalty = roundMoney(
      rows.reduce((sum, row) => sum + Math.abs(Math.min(0, row.penalty)), 0),
    );

    return {
      client,
      period: { dateFrom: period.dateFrom, dateTo: period.dateTo },
      selectedConnectionId: connectionId || null,
      search,
      summary: {
        penalties: rows.length,
        chargedPenalty,
        reversedPenalty,
        netPenalty: roundMoney(chargedPenalty - reversedPenalty),
        orders: orderIds.size,
        reasons: reasons.length,
        accounts: new Set(rows.map((row) => row.connectionId)).size,
        currency: rows.find((row) => row.currency)?.currency || 'RUB',
      },
      reasons,
      rows,
      sources,
      truncated: loaded.some((item) => item.truncated),
      generatedAt: new Date().toISOString(),
    };
  }

  async export(filter: FbsPenaltiesReportFilter, user: AuthUser) {
    const report = await this.report(filter, user);
    const details = XLSX.utils.aoa_to_sheet([
      [
        'Дата отчёта',
        'Кабинет WB',
        'Причина штрафа',
        'Штраф',
        'Валюта',
        'Заказ WB',
        'Грузоместо',
        'Артикул продавца',
        'Наименование',
        'Размер',
        'Штрихкод',
        'nmID',
        'Склад WB',
        'Способ доставки',
        'Отчёт WB',
        'Строка отчёта',
      ],
      ...report.rows.map((row) => [
        row.reportDate,
        excelText(row.accountName),
        excelText(row.reason),
        row.penalty,
        excelText(row.currency),
        excelText(row.orderId),
        excelText(row.cargoPlaceId),
        excelText(row.vendorCode),
        excelText(row.productName),
        excelText(row.size),
        excelText(row.barcode),
        excelText(row.nmId),
        excelText(row.officeName),
        excelText(row.deliveryMethod),
        excelText(row.reportId),
        excelText(row.rrdId),
      ]),
    ]);
    details['!cols'] = [
      14, 24, 48, 14, 10, 18, 22, 20, 34, 12, 20, 14, 24, 18, 16, 18,
    ].map((wch) => ({ wch }));
    details['!autofilter'] = { ref: details['!ref'] || 'A1:A1' };
    const reasons = XLSX.utils.aoa_to_sheet([
      ['Причина', 'Строк', 'Начислено', 'Возвращено', 'Итого'],
      ...report.reasons.map((row) => [
        excelText(row.reason),
        row.penalties,
        row.chargedPenalty,
        row.reversedPenalty,
        row.netPenalty,
      ]),
    ]);
    reasons['!cols'] = [50, 12, 16, 16, 16].map((wch) => ({ wch }));
    const parameters = XLSX.utils.aoa_to_sheet([
      ['Отчёт', 'Штрафы по FBS'],
      ['Клиент', excelText(`${report.client.code} — ${report.client.name}`)],
      ['Период', `${report.period.dateFrom} — ${report.period.dateTo}`],
      ['Ключевое слово', excelText(report.search || 'без фильтра')],
      ['Штрафов', report.summary.penalties],
      ['Начислено', report.summary.chargedPenalty],
      ['Возвращено', report.summary.reversedPenalty],
      ['Итого', report.summary.netPenalty],
      ['Валюта', report.summary.currency],
      ['Сформирован', report.generatedAt],
      ['Данные ограничены лимитом WB', report.truncated ? 'Да' : 'Нет'],
    ]);
    parameters['!cols'] = [{ wch: 30 }, { wch: 60 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, details, 'Штрафы');
    XLSX.utils.book_append_sheet(workbook, reasons, 'По причинам');
    XLSX.utils.book_append_sheet(workbook, parameters, 'Параметры');
    return {
      fileName: `FBS_штрафы_${safeFilePart(report.client.code)}_${report.period.dateFrom}_${report.period.dateTo}.xlsx`,
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    };
  }

  private async loadConnectionRows(
    connectionId: string,
    apiKey: string,
    dateFrom: string,
    dateTo: string,
  ) {
    const cacheKey = `${connectionId}:${dateFrom}:${dateTo}`;
    const cached = this.connectionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const response = await fetch(WB_FINANCE_REPORT_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateFrom,
        dateTo,
        limit: WB_REPORT_LIMIT,
        rrdId: 0,
        period: 'daily',
        fields: WB_REPORT_FIELDS,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 204) {
      const empty = { expiresAt: Date.now() + WB_REPORT_CACHE_MS, rows: [], truncated: false };
      this.connectionCache.set(cacheKey, empty);
      return empty;
    }
    if (!response.ok) {
      throw new BadGatewayException(await wbFinanceError(response));
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new BadGatewayException('Wildberries вернул неизвестный формат финансового отчёта.');
    }
    const result = {
      expiresAt: Date.now() + WB_REPORT_CACHE_MS,
      rows: payload.filter(isRecord),
      truncated: payload.length >= WB_REPORT_LIMIT,
    };
    this.connectionCache.set(cacheKey, result);
    return result;
  }
}

function normalizePenaltyRow(row: WbFinanceRow, connectionId: string, accountName: string) {
  const deliveryMethod = textValue(row.deliveryMethod);
  const penalty = numberValue(row.penalty);
  if (!/^FBS(?:\b|\s*,)/iu.test(deliveryMethod) || penalty === 0) return null;
  return {
    id: `${connectionId}:${textValue(row.rrdId) || textValue(row.reportId)}`,
    connectionId,
    accountName,
    reportDate: dateValue(row.rrDate) || dateValue(row.createDate) || dateValue(row.saleDt),
    reason: textValue(row.bonusTypeName) || 'Причина не указана Wildberries',
    penalty: roundMoney(penalty),
    currency: textValue(row.currency) || 'RUB',
    orderId: textValue(row.orderId),
    orderUid: textValue(row.orderUid),
    cargoPlaceId: textValue(row.trbxId),
    vendorCode: textValue(row.vendorCode),
    productName: textValue(row.title),
    size: textValue(row.techSize),
    barcode: textValue(row.sku),
    nmId: textValue(row.nmId),
    officeName: textValue(row.officeName),
    deliveryMethod,
    reportId: textValue(row.reportId),
    rrdId: textValue(row.rrdId),
  };
}

function groupReasons(rows: Array<NonNullable<ReturnType<typeof normalizePenaltyRow>>>) {
  const groups = new Map<
    string,
    { reason: string; penalties: number; chargedPenalty: number; reversedPenalty: number }
  >();
  for (const row of rows) {
    const current = groups.get(row.reason) || {
      reason: row.reason,
      penalties: 0,
      chargedPenalty: 0,
      reversedPenalty: 0,
    };
    current.penalties += 1;
    current.chargedPenalty += Math.max(0, row.penalty);
    current.reversedPenalty += Math.abs(Math.min(0, row.penalty));
    groups.set(row.reason, current);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      chargedPenalty: roundMoney(row.chargedPenalty),
      reversedPenalty: roundMoney(row.reversedPenalty),
      netPenalty: roundMoney(row.chargedPenalty - row.reversedPenalty),
    }))
    .sort((left, right) => right.netPenalty - left.netPenalty || left.reason.localeCompare(right.reason, 'ru-RU'));
}

function reportPeriod(dateFromValue?: string, dateToValue?: string) {
  const today = new Date();
  const dateTo = dateToValue?.trim() || isoDate(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const dateFrom = dateFromValue?.trim() || isoDate(monthStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new BadRequestException('Период должен быть указан в формате ГГГГ-ММ-ДД.');
  }
  const from = new Date(`${dateFrom}T00:00:00.000+03:00`);
  const to = new Date(`${dateTo}T23:59:59.999+03:00`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    throw new BadRequestException('Период отчёта указан неверно.');
  }
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw new BadRequestException('Период отчёта о штрафах не может превышать 366 дней.');
  }
  return { dateFrom, dateTo };
}

async function wbFinanceError(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return 'Токен Wildberries не имеет доступа к категории «Финансы». Обновите токен кабинета и повторите запрос.';
  }
  if (response.status === 429) {
    return 'Wildberries разрешает получать финансовый отчёт не чаще одного раза в минуту. Подождите и повторите запрос.';
  }
  const body = (await response.text()).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  return `Wildberries не вернул финансовый отчёт: HTTP ${response.status}${body ? ` · ${body}` : ''}`;
}

function requiredText(value: string | undefined, message: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function cleanIdentifier(value?: string) {
  return String(value || '').trim().slice(0, 120);
}

function cleanSearch(value?: string) {
  return String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 140);
}

function textValue(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? '0').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown) {
  const text = textValue(value);
  if (!text) return '';
  return text.slice(0, 10);
}

function normalizeKey(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zа-яё0-9_-]+/giu, '_').slice(0, 80);
}

function excelText(value: string) {
  // FIX: values received from WB must not become formulas when the XLSX is opened.
  return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

function isoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function safeErrorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Неизвестная ошибка WB');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
