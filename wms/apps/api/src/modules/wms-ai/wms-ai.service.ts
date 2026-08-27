import { BadRequestException, Injectable } from '@nestjs/common';
import { StockStatus } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import type { WmsAiLearnDto } from './dto/wms-ai-chat.dto';
import { WmsAiInternetService, type WmsAiWebSource } from './wms-ai-internet.service';
import { WmsAiLocalModelService, type LocalToolPlan } from './wms-ai-local-model.service';
import { buildWmsAiWorkbook } from './wms-ai-xlsx';

export type WmsAiTool =
  | 'BOXES_NOT_IN_PALLET_SORT'
  | 'UNRECOGNIZED_BOXES_IN_PALLET_SORT'
  | 'PRODUCT_BOX_STOCK'
  | 'BOX_CONTENTS'
  | 'PALLET_CONTENTS'
  | 'LOW_STOCK_SKUS'
  | 'CLIENT_STOCK_SUMMARY'
  | 'REQUEST_OVERVIEW'
  | 'RECENT_STOCK_MOVEMENTS'
  | 'KIZ_PROBLEMS'
  | 'INTERBRANCH_TRANSFERS';

export type WmsAiToolParams = {
  search?: string;
  boxCode?: string;
  palletCode?: string;
  maxTotal?: number;
  minTotal?: number;
  clientSearch?: string;
  requestNumber?: number;
  days?: number;
  status?: string;
};

type WmsAiColumn = { key: string; label: string };
type WmsAiRow = Record<string, string | number | null>;
type WarehouseBrief = { id: string; code: string; name: string; city: string };
type ToolPlan = { tool: WmsAiTool; params: WmsAiToolParams };

export type WmsAiResponse = {
  id: string;
  role: 'assistant';
  intent: WmsAiTool | 'KNOWLEDGE' | 'WEB_RESEARCH' | 'HELP';
  title: string;
  answer: string;
  generatedAt: string;
  engine: 'WMS_TOOL' | 'LOCAL_KNOWLEDGE' | 'LOCAL_MODEL' | 'LOCAL_RULES';
  warehouse: WarehouseBrief;
  summary?: {
    rows: number;
    boxes?: number;
    pallets?: number;
    skus?: number;
    clients?: number;
    requests?: number;
    issues?: number;
    transfers?: number;
    totalQuantity?: number;
  };
  columns?: WmsAiColumn[];
  rows?: WmsAiRow[];
  export?: {
    available: boolean;
    tool: WmsAiTool;
    params?: WmsAiToolParams;
    fileName: string;
  };
  sources?: WmsAiWebSource[];
  canTeach?: boolean;
  suggestions: string[];
};

const CHAT_ROW_LIMIT = 500;
const EXPORT_ROW_LIMIT = 20_000;
const SUGGESTIONS = [
  'Покажи товар «Корея_2голубой» по размерам с остатком до 30 шт. и короба',
  'Что лежит в коробе FFL_LKB79_095?',
  'Покажи мне короба, которые не попали в палет-сорт',
  'Выведи неопознанные WMS короба в палет-сорте',
  'Покажи товары с остатком до 10 штук',
  'Покажи заявку №65 и её товары',
  'Покажи открытые проблемы КИЗ в выбранном городе',
  'Покажи межфилиальные перемещения за последние 30 дней',
];

const CAPABILITIES = [
  'остатки товара по артикулам, цветам, размерам и коробам',
  'товары с остатком меньше или больше заданного количества',
  'содержимое конкретного короба или палет-сорта',
  'короба вне палет-сорта и неопознанные короба',
  'сводка остатков по клиентам',
  'состав и статус заявки по её номеру',
  'последние движения товара',
  'открытые ошибки КИЗ и проблемные FBS-сборки',
  'межфилиальные перемещения и остаток товара в пути',
].join('; ');

@Injectable()
export class WmsAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly internet: WmsAiInternetService,
    private readonly localModel: WmsAiLocalModelService,
    private readonly clientScope: ClientScopeService,
  ) {}

  async chat(message: string, user: AuthUser): Promise<WmsAiResponse> {
    const warehouse = await this.activeWarehouse(user);
    const directPlan = detectToolPlan(message);

    let response: WmsAiResponse;
    if (directPlan === 'HELP') {
      response = this.helpResponse(warehouse);
    } else if (directPlan) {
      response = await this.executeTool(directPlan, user, warehouse, CHAT_ROW_LIMIT);
    } else {
      response = await this.answerUnknown(message, user, warehouse);
    }

    await this.audit.write({
      userId: user.id,
      action: 'WMS_AI_QUERY',
      entity: 'Warehouse',
      entityId: warehouse.id,
      payload: {
        message: message.trim().slice(0, 1000),
        intent: response.intent,
        engine: response.engine,
        rows: response.summary?.rows ?? 0,
        params: response.export?.params,
      },
    });
    return response;
  }

  async export(tool: WmsAiTool, params: WmsAiToolParams, user: AuthUser) {
    const warehouse = await this.activeWarehouse(user);
    const report = await this.executeTool(
      { tool, params: sanitizeParams(params) },
      user,
      warehouse,
      EXPORT_ROW_LIMIT,
    );
    if (!report.columns || !report.rows) {
      throw new BadRequestException('Этот ответ нельзя выгрузить в Excel.');
    }

    await this.audit.write({
      userId: user.id,
      action: 'WMS_AI_EXPORT',
      entity: 'Warehouse',
      entityId: warehouse.id,
      payload: { tool, params: sanitizeParams(params), rows: report.rows.length },
    });

    return {
      fileName: report.export?.fileName || 'wms-ai.xlsx',
      buffer: buildWmsAiWorkbook({
        title: report.title,
        warehouse,
        columns: report.columns,
        rows: report.rows,
        generatedAt: report.generatedAt,
      }),
    };
  }

  async learn(dto: WmsAiLearnDto, user: AuthUser) {
    const warehouse = await this.activeWarehouse(user);
    const keywords = keywordsFor(dto.question);
    const record = await this.audit.write({
      userId: user.id,
      action: 'WMS_AI_KNOWLEDGE',
      entity: 'Warehouse',
      entityId: warehouse.id,
      payload: {
        question: dto.question.trim(),
        solution: dto.solution.trim(),
        keywords,
        sourceUrls: (dto.sourceUrls || []).filter((url) => /^https?:\/\//i.test(url)),
        createdByName: user.name,
        active: true,
      },
    });
    return {
      id: record.id,
      message: 'Решение сохранено в локальной базе знаний этого склада.',
      keywords,
    };
  }

  private async executeTool(
    plan: ToolPlan,
    user: AuthUser,
    warehouse: WarehouseBrief,
    limit: number,
  ) {
    switch (plan.tool) {
      case 'BOXES_NOT_IN_PALLET_SORT':
        return this.boxesNotInPalletSort(user, warehouse, limit);
      case 'UNRECOGNIZED_BOXES_IN_PALLET_SORT':
        return this.unrecognizedBoxes(user, warehouse, limit);
      case 'PRODUCT_BOX_STOCK':
        return this.productBoxStock(user, warehouse, plan.params, limit);
      case 'BOX_CONTENTS':
        return this.boxContents(user, warehouse, plan.params, limit);
      case 'PALLET_CONTENTS':
        return this.palletContents(user, warehouse, plan.params, limit);
      case 'LOW_STOCK_SKUS':
        return this.productBoxStock(
          user,
          warehouse,
          { ...plan.params, maxTotal: plan.params.maxTotal ?? 10 },
          limit,
          true,
        );
      case 'CLIENT_STOCK_SUMMARY':
        return this.clientStockSummary(user, warehouse, plan.params, limit);
      case 'REQUEST_OVERVIEW':
        return this.requestOverview(user, warehouse, plan.params, limit);
      case 'RECENT_STOCK_MOVEMENTS':
        return this.recentStockMovements(user, warehouse, plan.params, limit);
      case 'KIZ_PROBLEMS':
        return this.kizProblems(user, warehouse, plan.params, limit);
      case 'INTERBRANCH_TRANSFERS':
        return this.interbranchTransfers(user, warehouse, plan.params, limit);
      default:
        throw new BadRequestException('Неизвестный инструмент WMS.');
    }
  }

  private async boxesNotInPalletSort(
    user: AuthUser,
    warehouse: WarehouseBrief,
    limit: number,
  ): Promise<WmsAiResponse> {
    const clientId = this.clientScope.resolveClientFilter(user);
    const boxes = await this.prisma.box.findMany({
      where: {
        warehouseId: warehouse.id,
        ...(clientId === undefined ? {} : { clientId }),
        storagePlacement: null,
        balances: { some: { quantity: { gt: 0 } } },
        status: { notIn: ['deleted', 'archived'] },
      },
      select: {
        code: true,
        status: true,
        client: { select: { code: true, name: true } },
        zone: { select: { code: true, name: true } },
        pallet: { select: { code: true } },
        balances: {
          where: { quantity: { gt: 0 } },
          select: { quantity: true, status: true },
        },
      },
      orderBy: { code: 'asc' },
      take: limit,
    });

    const rows: WmsAiRow[] = boxes.map((box) => ({
      boxCode: box.code,
      clientCode: box.client.code,
      clientName: box.client.name,
      quantity: box.balances.reduce((sum, row) => sum + row.quantity, 0),
      availableQuantity: box.balances
        .filter((row) => row.status === StockStatus.AVAILABLE)
        .reduce((sum, row) => sum + row.quantity, 0),
      stockStatuses: [...new Set(box.balances.map((row) => row.status))].join(', '),
      zone: box.zone ? `${box.zone.code} — ${box.zone.name}` : '',
      legacyPallet: box.pallet?.code || '',
      boxStatus: box.status,
      problem: 'Нет в палет-сорте',
    }));
    return this.toolResponse({
      intent: 'BOXES_NOT_IN_PALLET_SORT',
      title: 'Короба, которые не попали в палет-сорт',
      answer: rows.length
        ? `Нашёл ${rows.length} коробов с положительным остатком, которые не привязаны к палет-сорту в городе ${warehouse.city}.`
        : `В городе ${warehouse.city} все доступные вам короба с положительным остатком привязаны к палет-сорту.`,
      warehouse,
      columns: [
        { key: 'boxCode', label: 'Короб' },
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент' },
        { key: 'quantity', label: 'Остаток, шт.' },
        { key: 'availableQuantity', label: 'Доступно, шт.' },
        { key: 'stockStatuses', label: 'Статусы остатка' },
        { key: 'zone', label: 'Зона WMS' },
        { key: 'legacyPallet', label: 'Старая паллета' },
        { key: 'boxStatus', label: 'Статус короба' },
        { key: 'problem', label: 'Проблема' },
      ],
      rows,
      summary: {
        rows: rows.length,
        boxes: rows.length,
        totalQuantity: sumRows(rows, 'quantity'),
      },
      params: {},
      fileName: `Короба_вне_палет-сорта_${safeFilePart(warehouse.code)}.xlsx`,
    });
  }

  private async unrecognizedBoxes(
    user: AuthUser,
    warehouse: WarehouseBrief,
    limit: number,
  ): Promise<WmsAiResponse> {
    const clientId = this.clientScope.resolveClientFilter(user);
    const placements = await this.prisma.storagePalletBox.findMany({
      where: {
        boxId: null,
        pallet: {
          warehouseId: warehouse.id,
          ...(clientId === undefined ? {} : { clientId }),
        },
      },
      select: {
        boxCode: true,
        source: true,
        scannedAt: true,
        pallet: {
          select: {
            code: true,
            status: true,
            source: true,
            zone: { select: { code: true, name: true } },
            client: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { scannedAt: 'desc' },
      take: limit,
    });
    placements.sort(
      (a, b) =>
        a.pallet.code.localeCompare(b.pallet.code, 'ru') ||
        a.boxCode.localeCompare(b.boxCode, 'ru'),
    );
    const rows: WmsAiRow[] = placements.map((placement) => ({
      palletCode: placement.pallet.code,
      palletStatus: placement.pallet.status,
      zone: placement.pallet.zone
        ? `${placement.pallet.zone.code} — ${placement.pallet.zone.name}`
        : '',
      boxCode: placement.boxCode,
      clientCode: placement.pallet.client.code,
      clientName: placement.pallet.client.name,
      source: placement.source || placement.pallet.source,
      scannedAt: placement.scannedAt.toISOString(),
      problem: 'Короб из палет-сорта не найден в WMS',
    }));
    const pallets = new Set(rows.map((row) => row.palletCode)).size;
    return this.toolResponse({
      intent: 'UNRECOGNIZED_BOXES_IN_PALLET_SORT',
      title: 'Неопознанные WMS короба в палет-сорте',
      answer: rows.length
        ? `Нашёл ${rows.length} неопознанных коробов в ${pallets} палет-сортах города ${warehouse.city}.`
        : `В доступном вам палет-сорте города ${warehouse.city} нет неопознанных WMS коробов.`,
      warehouse,
      columns: [
        { key: 'palletCode', label: 'Паллета / палет-сорт' },
        { key: 'palletStatus', label: 'Статус паллеты' },
        { key: 'zone', label: 'Где искать' },
        { key: 'boxCode', label: 'Неопознанный короб' },
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент паллеты' },
        { key: 'source', label: 'Источник сканирования' },
        { key: 'scannedAt', label: 'Когда отсканирован' },
        { key: 'problem', label: 'Проблема' },
      ],
      rows,
      summary: { rows: rows.length, boxes: rows.length, pallets },
      params: {},
      fileName: `Неопознанные_короба_${safeFilePart(warehouse.code)}.xlsx`,
    });
  }

  private async productBoxStock(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
    lowStockMode = false,
  ): Promise<WmsAiResponse> {
    const clientId = this.clientScope.resolveClientFilter(user);
    const search = cleanText(params.search, 140);
    const maxTotal = positiveInteger(params.maxTotal);
    const minTotal = positiveInteger(params.minTotal);
    if (!lowStockMode && !search) {
      throw new BadRequestException('Укажите название, артикул или код товара.');
    }

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        ...(clientId === undefined ? {} : { clientId }),
        box: { warehouseId: warehouse.id },
        ...(search
          ? {
              sku: {
                OR: [
                  { internalSku: { contains: search, mode: 'insensitive' } },
                  { clientSku: { contains: search, mode: 'insensitive' } },
                  { article: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                  { color: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      select: {
        quantity: true,
        status: true,
        sku: {
          select: {
            id: true,
            internalSku: true,
            clientSku: true,
            article: true,
            name: true,
            color: true,
            size: true,
            client: { select: { code: true, name: true } },
          },
        },
        box: {
          select: {
            code: true,
            zone: { select: { code: true, name: true } },
            storagePlacement: {
              select: { pallet: { select: { code: true } } },
            },
          },
        },
      },
      orderBy: [{ sku: { internalSku: 'asc' } }, { box: { code: 'asc' } }],
      take: EXPORT_ROW_LIMIT,
    });

    const skuTotals = new Map<string, number>();
    for (const balance of balances) {
      skuTotals.set(
        balance.sku.id,
        (skuTotals.get(balance.sku.id) || 0) + balance.quantity,
      );
    }
    const grouped = new Map<string, WmsAiRow & { statuses: Set<string> }>();
    for (const balance of balances) {
      const total = skuTotals.get(balance.sku.id) || 0;
      if ((maxTotal !== undefined && total > maxTotal) || (minTotal !== undefined && total < minTotal)) {
        continue;
      }
      const boxCode = balance.box?.code || 'БЕЗ КОРОБА';
      const key = `${balance.sku.id}:${boxCode}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.boxQuantity = Number(existing.boxQuantity) + balance.quantity;
        existing.statuses.add(balance.status);
        existing.stockStatuses = [...existing.statuses].join(', ');
        continue;
      }
      grouped.set(key, {
        clientCode: balance.sku.client.code,
        clientName: balance.sku.client.name,
        internalSku: balance.sku.internalSku,
        clientSku: balance.sku.clientSku || '',
        article: balance.sku.article || '',
        productName: balance.sku.name,
        color: balance.sku.color || '',
        size: balance.sku.size || '',
        totalSkuQuantity: total,
        boxCode,
        boxQuantity: balance.quantity,
        stockStatuses: balance.status,
        palletCode: balance.box?.storagePlacement?.pallet.code || '',
        zone: balance.box?.zone
          ? `${balance.box.zone.code} — ${balance.box.zone.name}`
          : '',
        statuses: new Set([balance.status]),
      } as unknown as WmsAiRow & { statuses: Set<string> });
    }
    const rows = [...grouped.values()]
      .map(({ statuses: _statuses, ...row }) => row)
      .slice(0, limit);
    const skuCount = new Set(rows.map((row) => String(row.internalSku))).size;
    const boxCount = new Set(rows.map((row) => String(row.boxCode))).size;
    const title = search
      ? `Остатки «${search}» по размерам и коробам`
      : `Товары с остатком до ${maxTotal ?? 10} шт.`;
    const condition = [
      maxTotal !== undefined ? `не более ${maxTotal}` : '',
      minTotal !== undefined ? `не менее ${minTotal}` : '',
    ].filter(Boolean).join(' и ');
    const answer = rows.length
      ? `Нашёл ${skuCount} товарных позиций в ${boxCount} коробах города ${warehouse.city}${condition ? ` с суммарным остатком по размеру ${condition} шт.` : '.'}`
      : `По заданным условиям${condition ? ` — суммарный остаток по размеру ${condition} шт.` : ''} в доступных вам остатках города ${warehouse.city} ничего не найдено.`;
    const tool: WmsAiTool = lowStockMode ? 'LOW_STOCK_SKUS' : 'PRODUCT_BOX_STOCK';
    return this.toolResponse({
      intent: tool,
      title,
      answer,
      warehouse,
      columns: stockColumns(),
      rows,
      summary: {
        rows: rows.length,
        boxes: boxCount,
        skus: skuCount,
        totalQuantity: sumRows(rows, 'boxQuantity'),
      },
      params: { search: search || undefined, maxTotal, minTotal },
      fileName: `${safeFilePart(title)}_${safeFilePart(warehouse.code)}.xlsx`,
    });
  }

  private async boxContents(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
  ): Promise<WmsAiResponse> {
    const boxCode = cleanText(params.boxCode, 160);
    if (!boxCode) throw new BadRequestException('Укажите код короба.');
    const clientId = this.clientScope.resolveClientFilter(user);
    const box = await this.prisma.box.findFirst({
      where: {
        code: { equals: boxCode, mode: 'insensitive' },
        warehouseId: warehouse.id,
        ...(clientId === undefined ? {} : { clientId }),
      },
      select: {
        code: true,
        status: true,
        client: { select: { code: true, name: true } },
        zone: { select: { code: true, name: true } },
        storagePlacement: {
          select: { pallet: { select: { code: true } } },
        },
        balances: {
          where: { quantity: { gt: 0 } },
          select: {
            quantity: true,
            status: true,
            sku: {
              select: {
                internalSku: true,
                clientSku: true,
                article: true,
                name: true,
                color: true,
                size: true,
              },
            },
          },
        },
      },
    });
    const rows: WmsAiRow[] = (box?.balances || []).slice(0, limit).map((balance) => ({
      boxCode: box?.code || boxCode,
      clientCode: box?.client.code || '',
      clientName: box?.client.name || '',
      internalSku: balance.sku.internalSku,
      clientSku: balance.sku.clientSku || '',
      article: balance.sku.article || '',
      productName: balance.sku.name,
      color: balance.sku.color || '',
      size: balance.sku.size || '',
      quantity: balance.quantity,
      stockStatus: balance.status,
      palletCode: box?.storagePlacement?.pallet.code || '',
      zone: box?.zone ? `${box.zone.code} — ${box.zone.name}` : '',
    }));
    return this.toolResponse({
      intent: 'BOX_CONTENTS',
      title: `Содержимое короба ${boxCode}`,
      answer: box
        ? `В коробе ${box.code} найдено ${rows.length} товарных строк, всего ${sumRows(rows, 'quantity')} шт.`
        : `Короб ${boxCode} не найден в выбранном городе или недоступен по вашим правам.`,
      warehouse,
      columns: [
        { key: 'boxCode', label: 'Короб' },
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент' },
        { key: 'internalSku', label: 'SKU WMS' },
        { key: 'clientSku', label: 'SKU клиента' },
        { key: 'article', label: 'Артикул' },
        { key: 'productName', label: 'Товар' },
        { key: 'color', label: 'Цвет' },
        { key: 'size', label: 'Размер' },
        { key: 'quantity', label: 'Количество' },
        { key: 'stockStatus', label: 'Статус' },
        { key: 'palletCode', label: 'Палет-сорт' },
        { key: 'zone', label: 'Зона' },
      ],
      rows,
      summary: {
        rows: rows.length,
        boxes: box ? 1 : 0,
        skus: new Set(rows.map((row) => row.internalSku)).size,
        totalQuantity: sumRows(rows, 'quantity'),
      },
      params: { boxCode },
      fileName: `Короб_${safeFilePart(boxCode)}.xlsx`,
    });
  }

  private async palletContents(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
  ): Promise<WmsAiResponse> {
    const palletCode = cleanText(params.palletCode, 160);
    if (!palletCode) throw new BadRequestException('Укажите код палет-сорта.');
    const clientId = this.clientScope.resolveClientFilter(user);
    const pallet = await this.prisma.storagePallet.findFirst({
      where: {
        code: { equals: palletCode, mode: 'insensitive' },
        warehouseId: warehouse.id,
        ...(clientId === undefined ? {} : { clientId }),
      },
      select: {
        code: true,
        status: true,
        client: { select: { code: true, name: true } },
        zone: { select: { code: true, name: true } },
        boxes: {
          select: {
            boxCode: true,
            box: {
              select: {
                balances: {
                  where: { quantity: { gt: 0 } },
                  select: {
                    quantity: true,
                    status: true,
                    sku: {
                      select: {
                        internalSku: true,
                        article: true,
                        name: true,
                        color: true,
                        size: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const rows: WmsAiRow[] = [];
    for (const placement of pallet?.boxes || []) {
      if (!placement.box) {
        rows.push({
          palletCode: pallet?.code || palletCode,
          boxCode: placement.boxCode,
          recognized: 'Нет',
          internalSku: '',
          article: '',
          productName: '',
          color: '',
          size: '',
          quantity: 0,
          stockStatus: '',
        });
        continue;
      }
      for (const balance of placement.box.balances) {
        rows.push({
          palletCode: pallet?.code || palletCode,
          boxCode: placement.boxCode,
          recognized: 'Да',
          internalSku: balance.sku.internalSku,
          article: balance.sku.article || '',
          productName: balance.sku.name,
          color: balance.sku.color || '',
          size: balance.sku.size || '',
          quantity: balance.quantity,
          stockStatus: balance.status,
        });
      }
    }
    const limitedRows = rows.slice(0, limit);
    return this.toolResponse({
      intent: 'PALLET_CONTENTS',
      title: `Содержимое палет-сорта ${palletCode}`,
      answer: pallet
        ? `В палет-сорте ${pallet.code} найдено ${pallet.boxes.length} коробов и ${sumRows(rows, 'quantity')} шт. товара.`
        : `Палет-сорт ${palletCode} не найден в выбранном городе или недоступен по вашим правам.`,
      warehouse,
      columns: [
        { key: 'palletCode', label: 'Палет-сорт' },
        { key: 'boxCode', label: 'Короб' },
        { key: 'recognized', label: 'Распознан WMS' },
        { key: 'internalSku', label: 'SKU WMS' },
        { key: 'article', label: 'Артикул' },
        { key: 'productName', label: 'Товар' },
        { key: 'color', label: 'Цвет' },
        { key: 'size', label: 'Размер' },
        { key: 'quantity', label: 'Количество' },
        { key: 'stockStatus', label: 'Статус' },
      ],
      rows: limitedRows,
      summary: {
        rows: limitedRows.length,
        boxes: pallet?.boxes.length || 0,
        skus: new Set(limitedRows.map((row) => row.internalSku).filter(Boolean)).size,
        totalQuantity: sumRows(rows, 'quantity'),
      },
      params: { palletCode },
      fileName: `Палет-сорт_${safeFilePart(palletCode)}.xlsx`,
    });
  }

  private async clientStockSummary(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
  ): Promise<WmsAiResponse> {
    const clientId = this.clientScope.resolveClientFilter(user);
    const clientSearch = cleanText(params.clientSearch, 140);
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        ...(clientId === undefined ? {} : { clientId }),
        box: { warehouseId: warehouse.id },
        ...(clientSearch
          ? {
              sku: {
                client: {
                  OR: [
                    { code: { contains: clientSearch, mode: 'insensitive' } },
                    { name: { contains: clientSearch, mode: 'insensitive' } },
                  ],
                },
              },
            }
          : {}),
      },
      select: {
        quantity: true,
        status: true,
        skuId: true,
        boxId: true,
        sku: { select: { client: { select: { id: true, code: true, name: true } } } },
      },
      take: EXPORT_ROW_LIMIT,
    });
    const groups = new Map<
      string,
      { code: string; name: string; quantity: number; available: number; skus: Set<string>; boxes: Set<string> }
    >();
    for (const balance of balances) {
      const client = balance.sku.client;
      const group = groups.get(client.id) || {
        code: client.code,
        name: client.name,
        quantity: 0,
        available: 0,
        skus: new Set<string>(),
        boxes: new Set<string>(),
      };
      group.quantity += balance.quantity;
      if (balance.status === StockStatus.AVAILABLE) group.available += balance.quantity;
      group.skus.add(balance.skuId);
      if (balance.boxId) group.boxes.add(balance.boxId);
      groups.set(client.id, group);
    }
    const rows: WmsAiRow[] = [...groups.values()].slice(0, limit).map((group) => ({
      clientCode: group.code,
      clientName: group.name,
      totalQuantity: group.quantity,
      availableQuantity: group.available,
      skuCount: group.skus.size,
      boxCount: group.boxes.size,
    }));
    return this.toolResponse({
      intent: 'CLIENT_STOCK_SUMMARY',
      title: clientSearch ? `Остатки клиента «${clientSearch}»` : 'Остатки по клиентам',
      answer: `Показана сводка по ${rows.length} клиентам города ${warehouse.city}.`,
      warehouse,
      columns: [
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент' },
        { key: 'totalQuantity', label: 'Всего, шт.' },
        { key: 'availableQuantity', label: 'Доступно, шт.' },
        { key: 'skuCount', label: 'SKU' },
        { key: 'boxCount', label: 'Коробов' },
      ],
      rows,
      summary: {
        rows: rows.length,
        clients: rows.length,
        boxes: sumRows(rows, 'boxCount'),
        skus: sumRows(rows, 'skuCount'),
        totalQuantity: sumRows(rows, 'totalQuantity'),
      },
      params: { clientSearch: clientSearch || undefined },
      fileName: `Остатки_по_клиентам_${safeFilePart(warehouse.code)}.xlsx`,
    });
  }

  private async requestOverview(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
  ): Promise<WmsAiResponse> {
    const requestNumber = positiveInteger(params.requestNumber);
    if (!requestNumber) throw new BadRequestException('Укажите номер заявки.');
    const clientId = this.clientScope.resolveClientFilter(user);
    const request = await this.prisma.clientRequest.findFirst({
      where: {
        number: requestNumber,
        warehouseId: warehouse.id,
        ...(clientId === undefined ? {} : { clientId }),
      },
      select: {
        number: true,
        type: true,
        status: true,
        priority: true,
        title: true,
        desiredDate: true,
        destinationCity: true,
        client: { select: { code: true, name: true } },
        items: {
          select: {
            barcode: true,
            name: true,
            quantity: true,
            comment: true,
            sku: {
              select: {
                internalSku: true,
                article: true,
                name: true,
                color: true,
                size: true,
              },
            },
          },
        },
      },
    });
    const rows: WmsAiRow[] = (request?.items || []).slice(0, limit).map((item) => ({
      requestNumber: request?.number || requestNumber,
      requestStatus: request?.status || '',
      requestType: request?.type || '',
      clientCode: request?.client.code || '',
      clientName: request?.client.name || '',
      internalSku: item.sku?.internalSku || '',
      article: item.sku?.article || '',
      productName: item.sku?.name || item.name || '',
      color: item.sku?.color || '',
      size: item.sku?.size || '',
      barcode: item.barcode || '',
      quantity: item.quantity,
      comment: item.comment || '',
    }));
    return this.toolResponse({
      intent: 'REQUEST_OVERVIEW',
      title: `Заявка №${requestNumber}`,
      answer: request
        ? `${request.title}. Статус: ${request.status}. Клиент: ${request.client.name}. Позиций: ${rows.length}, единиц: ${sumRows(rows, 'quantity')}.`
        : `Заявка №${requestNumber} не найдена в выбранном городе или недоступна по вашим правам.`,
      warehouse,
      columns: [
        { key: 'requestNumber', label: 'Заявка' },
        { key: 'requestStatus', label: 'Статус' },
        { key: 'requestType', label: 'Тип' },
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент' },
        { key: 'internalSku', label: 'SKU WMS' },
        { key: 'article', label: 'Артикул' },
        { key: 'productName', label: 'Товар' },
        { key: 'color', label: 'Цвет' },
        { key: 'size', label: 'Размер' },
        { key: 'barcode', label: 'Штрихкод' },
        { key: 'quantity', label: 'Количество' },
        { key: 'comment', label: 'Комментарий' },
      ],
      rows,
      summary: {
        rows: rows.length,
        requests: request ? 1 : 0,
        skus: new Set(rows.map((row) => row.internalSku).filter(Boolean)).size,
        totalQuantity: sumRows(rows, 'quantity'),
      },
      params: { requestNumber },
      fileName: `Заявка_${requestNumber}.xlsx`,
    });
  }

  private async recentStockMovements(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
  ): Promise<WmsAiResponse> {
    const days = Math.min(365, positiveInteger(params.days) || 7);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const search = cleanText(params.search, 140);
    const clientId = this.clientScope.resolveClientFilter(user);
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: from },
        ...(clientId === undefined ? {} : { clientId }),
        box: { warehouseId: warehouse.id },
        ...(search
          ? {
              sku: {
                OR: [
                  { internalSku: { contains: search, mode: 'insensitive' } },
                  { article: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      select: {
        type: true,
        status: true,
        quantity: true,
        sourceDocument: true,
        comment: true,
        createdAt: true,
        client: { select: { code: true, name: true } },
        sku: { select: { internalSku: true, article: true, name: true, size: true } },
        box: { select: { code: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const rows: WmsAiRow[] = movements.map((movement) => ({
      createdAt: movement.createdAt.toISOString(),
      movementType: movement.type,
      stockStatus: movement.status,
      quantity: movement.quantity,
      boxCode: movement.box?.code || '',
      internalSku: movement.sku.internalSku,
      article: movement.sku.article || '',
      productName: movement.sku.name,
      size: movement.sku.size || '',
      clientCode: movement.client.code,
      clientName: movement.client.name,
      sourceDocument: movement.sourceDocument || '',
      comment: movement.comment || '',
    }));
    return this.toolResponse({
      intent: 'RECENT_STOCK_MOVEMENTS',
      title: `Движения товара за ${days} дн.`,
      answer: `Найдено ${rows.length} движений товара в городе ${warehouse.city}.`,
      warehouse,
      columns: [
        { key: 'createdAt', label: 'Дата и время' },
        { key: 'movementType', label: 'Операция' },
        { key: 'stockStatus', label: 'Статус' },
        { key: 'quantity', label: 'Количество' },
        { key: 'boxCode', label: 'Короб' },
        { key: 'internalSku', label: 'SKU WMS' },
        { key: 'article', label: 'Артикул' },
        { key: 'productName', label: 'Товар' },
        { key: 'size', label: 'Размер' },
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент' },
        { key: 'sourceDocument', label: 'Документ' },
        { key: 'comment', label: 'Комментарий' },
      ],
      rows,
      summary: { rows: rows.length, totalQuantity: sumRows(rows, 'quantity') },
      params: { days, search: search || undefined },
      fileName: `Движения_${days}_дней_${safeFilePart(warehouse.code)}.xlsx`,
    });
  }

  private async kizProblems(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
  ): Promise<WmsAiResponse> {
    const days = Math.min(365, positiveInteger(params.days) || 120);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const clientId = this.clientScope.resolveClientFilter(user);
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        warehouseId: warehouse.id,
        createdAt: { gte: from },
        ...(clientId === undefined ? {} : { clientId }),
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        client: { select: { code: true, name: true } },
      },
      take: EXPORT_ROW_LIMIT,
    });
    const requestById = new Map(requests.map((request) => [request.id, request]));
    const requestIds = requests.map((request) => request.id);
    const tasks = requestIds.length
      ? await this.prisma.fbsTsdAssembly.findMany({
          where: {
            requestId: { in: requestIds },
            requiresKiz: true,
            updatedAt: { gte: from },
            OR: [
              { wbMetaStatus: { in: ['REJECTED', 'REMOVING'] } },
              { errorMessage: { not: null } },
              {
                status: 'COMPLETED',
                OR: [
                  { kiz: null },
                  { wbMetaStatus: { not: 'ACCEPTED' } },
                ],
              },
            ],
          },
          select: {
            id: true,
            requestId: true,
            orderId: true,
            skuId: true,
            productName: true,
            article: true,
            status: true,
            boxCode: true,
            kiz: true,
            wbMetaStatus: true,
            workerName: true,
            errorMessage: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        })
      : [];
    const skus = tasks.length
      ? await this.prisma.sku.findMany({
          where: { id: { in: [...new Set(tasks.map((task) => task.skuId))] } },
          select: { id: true, internalSku: true, size: true, color: true },
        })
      : [];
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));

    const rows: WmsAiRow[] = tasks.map((task) => {
      const request = requestById.get(task.requestId);
      const sku = skuById.get(task.skuId);
      return {
        detectedAt: task.updatedAt.toISOString(),
        issue: kizIssueLabel(task),
        requestNumber: request?.number ?? null,
        requestStatus: request?.status ?? '',
        orderId: task.orderId,
        clientCode: request?.client.code ?? '',
        clientName: request?.client.name ?? '',
        internalSku: sku?.internalSku ?? '',
        article: task.article ?? '',
        productName: task.productName,
        color: sku?.color ?? '',
        size: sku?.size ?? '',
        boxCode: task.boxCode ?? '',
        kiz: printableCode(task.kiz),
        assemblyStatus: task.status,
        wbMetaStatus: task.wbMetaStatus,
        workerName: task.workerName ?? '',
        errorMessage: task.errorMessage ?? '',
      };
    });
    const title = `Проблемы КИЗ за ${days} дней`;
    return this.toolResponse({
      intent: 'KIZ_PROBLEMS',
      title,
      answer: rows.length
        ? `В городе ${warehouse.city} найдено ${rows.length} проблемных FBS-сборок с КИЗ. Изменения не выполнялись — это диагностический список.`
        : `В доступных вам заявках города ${warehouse.city} открытых проблем КИЗ за ${days} дней не найдено.`,
      warehouse,
      columns: [
        { key: 'detectedAt', label: 'Обнаружено' },
        { key: 'issue', label: 'Проблема' },
        { key: 'requestNumber', label: 'Заявка' },
        { key: 'requestStatus', label: 'Статус заявки' },
        { key: 'orderId', label: 'Заказ WB' },
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент' },
        { key: 'internalSku', label: 'SKU WMS' },
        { key: 'article', label: 'Артикул' },
        { key: 'productName', label: 'Товар' },
        { key: 'color', label: 'Цвет' },
        { key: 'size', label: 'Размер' },
        { key: 'boxCode', label: 'Короб' },
        { key: 'kiz', label: 'КИЗ' },
        { key: 'assemblyStatus', label: 'Статус сборки' },
        { key: 'wbMetaStatus', label: 'Статус КИЗ WB' },
        { key: 'workerName', label: 'Сотрудник' },
        { key: 'errorMessage', label: 'Сообщение ошибки' },
      ],
      rows,
      summary: {
        rows: rows.length,
        issues: rows.length,
        requests: new Set(rows.map((row) => row.requestNumber).filter(Boolean)).size,
        boxes: new Set(rows.map((row) => row.boxCode).filter(Boolean)).size,
      },
      params: { days },
      fileName: `Проблемы_КИЗ_${days}_дней_${safeFilePart(warehouse.code)}.xlsx`,
    });
  }

  private async interbranchTransfers(
    user: AuthUser,
    warehouse: WarehouseBrief,
    params: WmsAiToolParams,
    limit: number,
  ): Promise<WmsAiResponse> {
    const days = Math.min(365, positiveInteger(params.days) || 30);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const clientId = this.clientScope.resolveClientFilter(user);
    const clientSearch = cleanText(params.clientSearch, 140);
    const status = cleanText(params.status, 40).toUpperCase();
    const statusFilter =
      status === 'OPEN'
        ? { in: ['PENDING_RECEIPT', 'PARTIALLY_RECEIVED'] }
        : ['PENDING_RECEIPT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].includes(status)
          ? status
          : undefined;
    const transfers = await this.prisma.interWarehouseTransfer.findMany({
      where: {
        createdAt: { gte: from },
        OR: [
          { fromWarehouseId: warehouse.id },
          { toWarehouseId: warehouse.id },
        ],
        ...(clientId === undefined ? {} : { clientId }),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(clientSearch
          ? {
              client: {
                OR: [
                  { code: { contains: clientSearch, mode: 'insensitive' } },
                  { name: { contains: clientSearch, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      select: {
        number: true,
        status: true,
        transferMode: true,
        totalQuantity: true,
        receivedQuantity: true,
        sourceBoxCodes: true,
        destinationBoxCode: true,
        comment: true,
        createdByName: true,
        receivedByName: true,
        dispatchedAt: true,
        receivedAt: true,
        createdAt: true,
        client: { select: { code: true, name: true } },
        fromWarehouse: { select: { code: true, city: true } },
        toWarehouse: { select: { code: true, city: true } },
        _count: { select: { issues: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const rows: WmsAiRow[] = transfers.map((transfer) => {
      const receivedQuantity =
        transfer.status === 'RECEIVED'
          ? transfer.totalQuantity
          : transfer.receivedQuantity;
      const inTransitQuantity = ['RECEIVED', 'CANCELLED'].includes(
        transfer.status,
      )
        ? 0
        : Math.max(0, transfer.totalQuantity - receivedQuantity);
      return {
        number: transfer.number,
        status: transfer.status,
        clientCode: transfer.client.code,
        clientName: transfer.client.name,
        fromCity: transfer.fromWarehouse.city,
        toCity: transfer.toWarehouse.city,
        transferMode: transfer.transferMode,
        totalQuantity: transfer.totalQuantity,
        receivedQuantity,
        inTransitQuantity,
        sourceBoxCodes: jsonStringList(transfer.sourceBoxCodes).join(', '),
        destinationBoxCode: transfer.destinationBoxCode ?? '',
        issues: transfer._count.issues,
        createdByName: transfer.createdByName,
        receivedByName: transfer.receivedByName ?? '',
        dispatchedAt: transfer.dispatchedAt?.toISOString() ?? '',
        receivedAt: transfer.receivedAt?.toISOString() ?? '',
        createdAt: transfer.createdAt.toISOString(),
        comment: transfer.comment ?? '',
      };
    });
    const openTransfers = rows.filter((row) =>
      ['PENDING_RECEIPT', 'PARTIALLY_RECEIVED'].includes(String(row.status)),
    ).length;
    const title = `Межфилиальные перемещения за ${days} дней`;
    return this.toolResponse({
      intent: 'INTERBRANCH_TRANSFERS',
      title,
      answer: `Найдено ${rows.length} перемещений, связанных с городом ${warehouse.city}. В пути сейчас ${openTransfers}.`,
      warehouse,
      columns: [
        { key: 'number', label: 'Номер' },
        { key: 'status', label: 'Статус' },
        { key: 'clientCode', label: 'Код клиента' },
        { key: 'clientName', label: 'Клиент' },
        { key: 'fromCity', label: 'Откуда' },
        { key: 'toCity', label: 'Куда' },
        { key: 'transferMode', label: 'Режим' },
        { key: 'totalQuantity', label: 'Отправлено, шт.' },
        { key: 'receivedQuantity', label: 'Принято, шт.' },
        { key: 'inTransitQuantity', label: 'В пути, шт.' },
        { key: 'sourceBoxCodes', label: 'Короба' },
        { key: 'destinationBoxCode', label: 'Сборный короб' },
        { key: 'issues', label: 'Проблемы' },
        { key: 'createdByName', label: 'Отправил' },
        { key: 'receivedByName', label: 'Принял' },
        { key: 'dispatchedAt', label: 'Отправлено' },
        { key: 'receivedAt', label: 'Принято' },
        { key: 'createdAt', label: 'Создано' },
        { key: 'comment', label: 'Комментарий' },
      ],
      rows,
      summary: {
        rows: rows.length,
        transfers: rows.length,
        issues: sumRows(rows, 'issues'),
        boxes: new Set(
          rows.flatMap((row) =>
            String(row.sourceBoxCodes || '')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ).size,
        totalQuantity: sumRows(rows, 'inTransitQuantity'),
      },
      params: {
        days,
        status: status || undefined,
        clientSearch: clientSearch || undefined,
      },
      fileName: `Межфилиальные_перемещения_${days}_дней_${safeFilePart(warehouse.code)}.xlsx`,
    });
  }

  private toolResponse(input: {
    intent: WmsAiTool;
    title: string;
    answer: string;
    warehouse: WarehouseBrief;
    columns: WmsAiColumn[];
    rows: WmsAiRow[];
    summary: NonNullable<WmsAiResponse['summary']>;
    params: WmsAiToolParams;
    fileName: string;
  }): WmsAiResponse {
    return {
      id: randomId(),
      role: 'assistant',
      intent: input.intent,
      title: input.title,
      answer: input.answer,
      generatedAt: new Date().toISOString(),
      engine: 'WMS_TOOL',
      warehouse: input.warehouse,
      summary: input.summary,
      columns: input.columns,
      rows: input.rows,
      export: {
        available: true,
        tool: input.intent,
        params: input.params,
        fileName: input.fileName,
      },
      suggestions: SUGGESTIONS,
    };
  }

  private async answerUnknown(
    message: string,
    user: AuthUser,
    warehouse: WarehouseBrief,
  ): Promise<WmsAiResponse> {
    const knowledge = await this.findKnowledge(message, warehouse.id);
    if (knowledge) {
      return {
        id: randomId(),
        role: 'assistant',
        intent: 'KNOWLEDGE',
        title: 'Решение из локальной базы знаний',
        answer: knowledge.solution,
        generatedAt: new Date().toISOString(),
        engine: 'LOCAL_KNOWLEDGE',
        warehouse,
        sources: knowledge.sourceUrls.map((url) => ({
          title: url,
          url,
          snippet: 'Источник сохранённого решения',
        })),
        canTeach: true,
        suggestions: SUGGESTIONS,
      };
    }

    const modelPlan = validateModelPlan(await this.localModel.planTool(message));
    if (modelPlan) {
      return this.executeTool(modelPlan, user, warehouse, CHAT_ROW_LIMIT);
    }

    const sources = await this.internet.search(message);
    const modelAnswer = await this.localModel.answer(message, warehouse, sources);
    return {
      id: randomId(),
      role: 'assistant',
      intent: sources.length ? 'WEB_RESEARCH' : 'HELP',
      title: sources.length ? 'Диагностика и поиск решения' : 'Нужно больше данных',
      answer: modelAnswer.text,
      generatedAt: new Date().toISOString(),
      engine: modelAnswer.engine,
      warehouse,
      sources,
      canTeach: true,
      suggestions: SUGGESTIONS,
    };
  }

  private helpResponse(warehouse: WarehouseBrief): WmsAiResponse {
    return {
      id: randomId(),
      role: 'assistant',
      intent: 'HELP',
      title: 'Инструменты ИИ для WMS',
      answer: `Я умею безопасно читать данные выбранного города: ${CAPABILITIES}. Если запрос не относится к данным WMS, сначала проверю локальную базу знаний, затем выполню интернет-поиск.`,
      generatedAt: new Date().toISOString(),
      engine: 'LOCAL_RULES',
      warehouse,
      suggestions: SUGGESTIONS,
    };
  }

  private async findKnowledge(question: string, warehouseId: string) {
    const requested = keywordsFor(question);
    if (requested.length < 2) return null;
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: 'WMS_AI_KNOWLEDGE',
        entity: 'Warehouse',
        entityId: warehouseId,
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    let best: { score: number; solution: string; sourceUrls: string[] } | null = null;
    for (const log of logs) {
      const payload = asRecord(log.payload);
      if (payload.active === false || typeof payload.solution !== 'string') continue;
      const stored = Array.isArray(payload.keywords)
        ? payload.keywords.filter((item): item is string => typeof item === 'string')
        : keywordsFor(String(payload.question || ''));
      const score = similarity(requested, stored);
      if (score >= 0.42 && (!best || score > best.score)) {
        best = {
          score,
          solution: payload.solution,
          sourceUrls: Array.isArray(payload.sourceUrls)
            ? payload.sourceUrls.filter((item): item is string => typeof item === 'string')
            : [],
        };
      }
    }
    return best;
  }

  private async activeWarehouse(user: AuthUser): Promise<WarehouseBrief> {
    if (!user.activeWarehouseId) {
      throw new BadRequestException(
        'Сначала выберите город (активный склад) в верхней панели WMS.',
      );
    }
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: user.activeWarehouseId },
      select: { id: true, code: true, name: true, city: true },
    });
    if (!warehouse) throw new BadRequestException('Выбранный склад не найден.');
    return warehouse;
  }
}

export function detectIntent(message: string): WmsAiTool | 'UNKNOWN' {
  const plan = detectToolPlan(message);
  return plan && plan !== 'HELP' ? plan.tool : 'UNKNOWN';
}

export function detectToolPlan(message: string): ToolPlan | 'HELP' | null {
  const text = normalize(message);
  if (/^(помощь|что умеешь|какие инструменты|возможности)/.test(text)) return 'HELP';
  const mentionsPalletSort = /палет|паллет/.test(text);
  if (
    mentionsPalletSort &&
    /(неопознан|нераспознан|не распознан|неизвестн|не найден.*wms|не найден.*вмс|не видит.*wms|не видит.*вмс)/.test(text)
  ) {
    return { tool: 'UNRECOGNIZED_BOXES_IN_PALLET_SORT', params: {} };
  }
  if (
    mentionsPalletSort &&
    /(не попал|не попали|не попав|без пал|вне пал|не в пал|не привязан)/.test(text)
  ) {
    return { tool: 'BOXES_NOT_IN_PALLET_SORT', params: {} };
  }

  if (/(киз|честн\w*\s+знак)/.test(text) && /(проблем|ошиб|отклон|завис|не принят|не подтверж|не хватает|неверн)/.test(text)) {
    return {
      tool: 'KIZ_PROBLEMS',
      params: {
        days: extractPeriodDays(message) || 120,
      },
    };
  }

  if (
    /(межфилиал|между\s+филиал|между\s+город|перемещ\w*\s+(?:в|из|между).*(?:москв|краснодар|филиал|город)|товар\w*\s+в\s+пути)/.test(text)
  ) {
    return {
      tool: 'INTERBRANCH_TRANSFERS',
      params: {
        days: extractPeriodDays(message) || 30,
        status: /(в\s+пути|открыт|не\s+принят)/.test(text)
          ? 'OPEN'
          : /принят|заверш/.test(text)
            ? 'RECEIVED'
            : undefined,
        clientSearch: extractQuoted(message),
      },
    };
  }

  const requestNumber = extractNumber(
    message,
    /(?:заявк\w*|request)\s*(?:№|номер|#)?\s*(\d+)/iu,
  );
  if (requestNumber && /заявк|request/.test(text)) {
    return { tool: 'REQUEST_OVERVIEW', params: { requestNumber } };
  }

  const boxCode = extractCode(message, /короб\w*\s*(?:№|номер|#)?\s*([a-zа-я0-9_-]{4,})/iu);
  if (boxCode && /(что|содерж|леж|товар|остат)/.test(text)) {
    return { tool: 'BOX_CONTENTS', params: { boxCode } };
  }

  const palletCode = extractCode(
    message,
    /(?:палет|паллет)\w*\s*(?:№|номер|#)?\s*([a-zа-я0-9_-]{4,})/iu,
  );
  if (palletCode && /(что|содерж|леж|короб|товар)/.test(text)) {
    return { tool: 'PALLET_CONTENTS', params: { palletCode } };
  }

  const maxTotal = extractNumber(
    message,
    /(?:до|не более|меньше|менее|<=)\s*(\d+)/iu,
  );
  const minTotal = extractNumber(
    message,
    /(?:от|не менее|больше|более|>=)\s*(\d+)/iu,
  );
  const search = extractProductSearch(message);
  if (
    search &&
    /(остат|короб|леж|товар|размер|склад|наход)/.test(text)
  ) {
    return {
      tool: 'PRODUCT_BOX_STOCK',
      params: { search, maxTotal, minTotal },
    };
  }
  if (!search && maxTotal && /(товар|sku|остат|дефицит|мало)/.test(text)) {
    return { tool: 'LOW_STOCK_SKUS', params: { maxTotal } };
  }

  if (/остат\w*\s+по\s+клиент|клиент\w*\s+остат/.test(text)) {
    return {
      tool: 'CLIENT_STOCK_SUMMARY',
      params: { clientSearch: extractQuoted(message) },
    };
  }
  if (/движен|приход|расход|перемещен/.test(text)) {
    return {
      tool: 'RECENT_STOCK_MOVEMENTS',
      params: {
        days: extractPeriodDays(message) || 7,
        search: extractProductSearch(message),
      },
    };
  }
  return null;
}

function validateModelPlan(plan: LocalToolPlan | null): ToolPlan | null {
  if (!plan || plan.confidence < 0.55 || !isWmsTool(plan.tool)) return null;
  return { tool: plan.tool, params: sanitizeParams(plan.params || {}) };
}

function isWmsTool(value: string): value is WmsAiTool {
  return [
    'BOXES_NOT_IN_PALLET_SORT',
    'UNRECOGNIZED_BOXES_IN_PALLET_SORT',
    'PRODUCT_BOX_STOCK',
    'BOX_CONTENTS',
    'PALLET_CONTENTS',
    'LOW_STOCK_SKUS',
    'CLIENT_STOCK_SUMMARY',
    'REQUEST_OVERVIEW',
    'RECENT_STOCK_MOVEMENTS',
    'KIZ_PROBLEMS',
    'INTERBRANCH_TRANSFERS',
  ].includes(value);
}

function sanitizeParams(params: WmsAiToolParams): WmsAiToolParams {
  return {
    search: cleanText(params.search, 140) || undefined,
    boxCode: cleanText(params.boxCode, 160) || undefined,
    palletCode: cleanText(params.palletCode, 160) || undefined,
    maxTotal: positiveInteger(params.maxTotal),
    minTotal: positiveInteger(params.minTotal),
    clientSearch: cleanText(params.clientSearch, 140) || undefined,
    requestNumber: positiveInteger(params.requestNumber),
    days: Math.min(365, positiveInteger(params.days) || 0) || undefined,
    status: cleanText(params.status, 40) || undefined,
  };
}

function stockColumns(): WmsAiColumn[] {
  return [
    { key: 'clientCode', label: 'Код клиента' },
    { key: 'clientName', label: 'Клиент' },
    { key: 'internalSku', label: 'SKU WMS' },
    { key: 'clientSku', label: 'SKU клиента' },
    { key: 'article', label: 'Артикул' },
    { key: 'productName', label: 'Товар' },
    { key: 'color', label: 'Цвет' },
    { key: 'size', label: 'Размер' },
    { key: 'totalSkuQuantity', label: 'Всего этого размера, шт.' },
    { key: 'boxCode', label: 'Короб' },
    { key: 'boxQuantity', label: 'В коробе, шт.' },
    { key: 'stockStatuses', label: 'Статусы' },
    { key: 'palletCode', label: 'Палет-сорт' },
    { key: 'zone', label: 'Зона' },
  ];
}

function extractProductSearch(value: string) {
  const quoted = extractQuoted(value);
  if (quoted) return quoted;
  const coded = value.match(/([\p{L}\p{N}]+_[\p{L}\p{N}_-]+)/u)?.[1];
  if (coded) return coded.trim();
  return (
    value.match(
      /(?:товар\w*|артикул\w*|sku)\s+([a-zа-я0-9][a-zа-я0-9 _.-]{2,}?)(?=\s+(?:по|в|где|котор|с\s+остат|до|от|и\s+короб)|[?.!,]|$)/iu,
    )?.[1]?.trim() || undefined
  );
}

function extractQuoted(value: string) {
  return value.match(/[«"]([^»"]{2,140})[»"]/u)?.[1]?.trim();
}

function extractCode(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.trim();
}

function extractNumber(value: string, pattern: RegExp) {
  return positiveInteger(value.match(pattern)?.[1]);
}

function extractPeriodDays(value: string) {
  return extractNumber(
    value,
    /(?:за\s+(?:последн[а-яё]*\s+)?|последн[а-яё]*\s+)(\d+)\s*(?:дн(?:ей|я)?|день)/iu,
  );
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 1_000_000
    ? number
    : undefined;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string'
    ? value.trim().replace(/[\u0000-\u001f]/g, '').slice(0, maxLength)
    : '';
}

function sumRows(rows: WmsAiRow[], key: string) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function keywordsFor(value: string) {
  const stop = new Set([
    'который', 'которые', 'почему', 'чтобы', 'этот', 'такие', 'какой', 'какая',
    'мне', 'меня', 'весь', 'все', 'как', 'для', 'при', 'что', 'это', 'или',
    'wms', 'вмс', 'покажи', 'выведи', 'список', 'помоги', 'нужно',
  ]);
  return [
    ...new Set(
      normalize(value)
        .split(/\s+/)
        .filter((word) => word.length > 2 && !stop.has(word)),
    ),
  ].sort();
}

function similarity(left: string[], right: string[]) {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / Math.max(1, Math.min(a.size, b.size));
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9_№#-]+/gi, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function kizIssueLabel(task: {
  status: string;
  kiz: string | null;
  wbMetaStatus: string;
  errorMessage: string | null;
}) {
  if (task.wbMetaStatus === 'REJECTED') return 'Wildberries отклонил КИЗ';
  if (task.wbMetaStatus === 'REMOVING') return 'Удаление КИЗ зависло';
  if (task.status === 'COMPLETED' && !task.kiz) {
    return 'Сборка завершена без КИЗ';
  }
  if (task.status === 'COMPLETED' && task.wbMetaStatus !== 'ACCEPTED') {
    return 'Сборка завершена без подтверждения КИЗ';
  }
  return task.errorMessage ? 'Ошибка обработки КИЗ' : 'Проблема КИЗ';
}

function printableCode(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jsonStringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
    : [];
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zа-я0-9_-]+/gi, '_').slice(0, 120);
}

function randomId() {
  return `wms-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
