import { BadRequestException, Injectable } from '@nestjs/common';
import { ClientRequestPriority, ClientRequestType, StockStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { ClientRequestsService, type ClientRequestAvailabilityConflict } from './client-requests.service';
import { ImportOutboundRequestXlsxDto } from './dto/import-outbound-request-xlsx.dto';
import {
  parseOutboundRequestXlsxRows,
  type OutboundRequestXlsxLine,
  type OutboundRequestXlsxIssue,
  type SheetMatrix,
} from './parsers/outbound-request-xlsx.parser';

type HydratedOutboundLine = {
  barcode?: string;
  originalName?: string;
  requestedQuantity: number;
  relabelTargetBarcode?: string;
  relabelQuantity?: number;
  city?: string;
  artSeller?: string;
  size?: string;
  needsRelabel: boolean;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  shortageQuantity: number;
  sourceRows: number[];
  skuId: string | null;
  internalSku: string | null;
  name: string | null;
  canFulfill: boolean;
  conflicts: ClientRequestAvailabilityConflict[];
  actionSuggestions: OutboundRequestActionSuggestion[];
};

type OutboundRequestActionSuggestion = {
  type: 'RELABEL' | 'CREATE_SKU';
  title: string;
  message: string;
  sourceSkuId?: string;
  sourceInternalSku?: string;
  sourceName?: string;
  sourceBarcode?: string;
  targetBarcode?: string;
  availableQuantity?: number;
  quantity?: number;
};

type OutboundRequestXlsxPreview = {
  clientId: string;
  title: string;
  canCommit: boolean;
  summary: {
    sourceRows: number;
    lines: number;
    totalQuantity: number;
    availableQuantity: number;
    shortageQuantity: number;
  };
  issues: OutboundRequestXlsxIssue[];
  relabelSourceOptions: OutboundRequestRelabelSourceOption[];
  lines: HydratedOutboundLine[];
};

type OutboundRequestRelabelSourceOption = {
  skuId: string;
  internalSku: string;
  clientSku?: string | null;
  article?: string | null;
  name: string;
  barcode?: string | null;
  size?: string | null;
  availableQuantity: number;
};

type ResolvedSku = {
  id: string;
  internalSku: string;
  clientSku?: string | null;
  article?: string | null;
  name: string;
  size?: string | null;
  needsRelabel: boolean;
  barcodes?: Array<{ value: string; isPrimary: boolean }>;
};

type ResolvedParsedLine = {
  line: OutboundRequestXlsxLine;
  match: { sku: ResolvedSku } | 'duplicate' | null;
  issueMessage: string;
};

@Injectable()
export class ClientRequestXlsxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly clientRequests: ClientRequestsService,
  ) {}

  async previewOutboundRequest(file: Express.Multer.File | undefined, dto: ImportOutboundRequestXlsxDto, user: AuthUser) {
    this.assertFile(file);
    return this.buildPreview(file!.buffer, dto, user);
  }

  async createOutboundRequest(file: Express.Multer.File | undefined, dto: ImportOutboundRequestXlsxDto, user: AuthUser) {
    this.assertFile(file);
    const preview = await this.buildPreview(file!.buffer, dto, user);
    const errors = preview.issues.filter((issue) => issue.severity === 'error');

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Excel-файл содержит ошибки, заявка не создана.',
        errors,
        summary: preview.summary,
      });
    }

    const request = await this.clientRequests.create(
      {
        clientId: preview.clientId,
        type: ClientRequestType.OUTBOUND,
        priority: dto.priority ?? ClientRequestPriority.NORMAL,
        title: preview.title,
        comment: this.buildImportComment(dto.comment, normalizeUploadedFileName(file!.originalname), preview),
        contactName: normalizeText(dto.contactName),
        contactPhone: normalizeText(dto.contactPhone),
        destinationCity: normalizeRequiredText(dto.destinationCity, 'Город поставки обязателен.'),
        deliveryAddress: normalizeText(dto.deliveryAddress),
        desiredDate: dto.desiredDate,
        items: preview.lines.flatMap((line) => this.buildRequestItemsFromLine(line)),
      },
      user,
    );

    await this.attachSourceWorkbook(request.id, request.clientId, file!, user);

    return {
      request,
      preview,
    };
  }

  private async buildPreview(buffer: Buffer, dto: ImportOutboundRequestXlsxDto, user: AuthUser): Promise<OutboundRequestXlsxPreview> {
    const clientId = normalizeRequiredText(dto.clientId, 'Клиент обязателен.');
    normalizeRequiredText(dto.destinationCity, 'Город поставки обязателен.');
    this.clientScopes.requireClientAccess(user, clientId, 'write');

    const parsed = parseOutboundRequestXlsxRows(this.readFirstSheet(buffer));
    const barcodes = parsed.lines.map((line) => line.barcode).filter((barcode): barcode is string => Boolean(barcode));
    const productNames = [
      ...new Set(
        parsed.lines
          .map((line) => line.name || line.artSeller)
          .map((value) => normalizeText(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const barcodeRows = barcodes.length
      ? await this.prisma.barcode.findMany({
          where: {
            value: { in: barcodes },
            sku: { clientId },
          },
          include: {
            sku: {
              select: {
                id: true,
                internalSku: true,
                clientSku: true,
                article: true,
                name: true,
                size: true,
                needsRelabel: true,
                barcodes: {
                  select: {
                    value: true,
                    isPrimary: true,
                  },
                },
              },
            },
          },
        })
      : [];
    const skuRows = productNames.length
      ? await this.prisma.sku.findMany({
          where: {
            clientId,
            OR: [
              { internalSku: { in: productNames } },
              { clientSku: { in: productNames } },
              { article: { in: productNames } },
              { name: { in: productNames } },
            ],
          },
          select: {
            id: true,
            internalSku: true,
            clientSku: true,
            article: true,
            name: true,
            size: true,
            needsRelabel: true,
            barcodes: {
              select: {
                value: true,
                isPrimary: true,
              },
            },
          },
        })
      : [];

    const barcodeMatches = new Map<string, typeof barcodeRows>();
    for (const row of barcodeRows) {
      barcodeMatches.set(row.value, [...(barcodeMatches.get(row.value) ?? []), row]);
    }
    const skuMatches = buildSkuMatchesByProductName(skuRows);
    const resolvedLines = parsed.lines.map((line) => this.resolveParsedLine(line, barcodeMatches, skuMatches));
    const actionSuggestionsByLine = await this.buildCatalogActionSuggestions(clientId, parsed.lines, resolvedLines, skuMatches);
    const relabelSourceOptions = await this.buildRelabelSourceOptions(clientId);

    const availability = await this.clientRequests.previewAvailability(
      {
        clientId,
        type: ClientRequestType.OUTBOUND,
        items: resolvedLines.map(({ line, match }) => ({
          skuId: match && match !== 'duplicate' ? match.sku.id : undefined,
          barcode: line.barcode,
          quantity: line.quantity,
        })),
      },
      user,
    );
    const issues = [...parsed.issues];
    const lines: HydratedOutboundLine[] = [];

    for (const [lineIndex, resolvedLine] of resolvedLines.entries()) {
      const { line, match, issueMessage } = resolvedLine;
      const firstRow = line.sourceRows[0] ?? 1;
      const availabilityLine = availability.lines[lineIndex];
      const actionSuggestions = actionSuggestionsByLine.get(lineIndex) ?? [];

      if (!match) {
        issues.push({
          row: firstRow,
          barcode: line.barcode,
          message: issueMessage,
          severity: 'error',
        });
        lines.push(this.emptyHydratedLine(line, actionSuggestions));
        continue;
      }

      if (match === 'duplicate') {
        issues.push({
          row: firstRow,
          barcode: line.barcode,
          message: issueMessage,
          severity: 'error',
        });
        lines.push(this.emptyHydratedLine(line, actionSuggestions));
        continue;
      }

      const stockQuantity = availabilityLine?.stockQuantity ?? 0;
      const reservedQuantity = availabilityLine?.reservedQuantity ?? 0;
      const availableQuantity = availabilityLine?.availableQuantity ?? 0;
      const shortageQuantity = Math.max(0, line.quantity - availableQuantity);
      const conflicts = availabilityLine?.conflicts ?? [];

      if (shortageQuantity > 0) {
        issues.push({
          row: firstRow,
          barcode: line.barcode,
          message: shortageMessage(line.quantity, availableQuantity, conflicts),
          severity: 'error',
        });
      }

      lines.push({
        barcode: line.barcode,
        originalName: line.name || line.artSeller,
        requestedQuantity: line.quantity,
        relabelTargetBarcode: line.relabelTargetBarcode,
        relabelQuantity: line.relabelQuantity,
        city: line.city,
        artSeller: line.artSeller,
        size: line.size,
        needsRelabel: Boolean(match.sku.needsRelabel),
        stockQuantity,
        reservedQuantity,
        availableQuantity,
        shortageQuantity,
        sourceRows: line.sourceRows,
        skuId: match.sku.id,
        internalSku: match.sku.internalSku,
        name: match.sku.name,
        canFulfill: shortageQuantity === 0,
        conflicts,
        actionSuggestions,
      });
    }

    const totalAvailableQuantity = lines.reduce((sum, line) => sum + Math.min(line.availableQuantity, line.requestedQuantity), 0);
    const totalShortageQuantity = lines.reduce((sum, line) => sum + line.shortageQuantity, 0);
    const errorsCount = issues.filter((issue) => issue.severity === 'error').length;

    return {
      clientId,
      title: normalizeText(dto.title) ?? defaultTitle(),
      canCommit: errorsCount === 0 && lines.length > 0,
      summary: {
        ...parsed.summary,
        availableQuantity: totalAvailableQuantity,
        shortageQuantity: totalShortageQuantity,
      },
      issues,
      relabelSourceOptions,
      lines,
    };
  }

  private readFirstSheet(buffer: Buffer): SheetMatrix {
    // Русский комментарий: для клиентского шаблона берем первый лист, чтобы файл мог называться и оформляться свободно.
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) {
      throw new BadRequestException('В Excel-файле нет листов.');
    }

    return XLSX.utils.sheet_to_json<SheetMatrix[number]>(workbook.Sheets[firstSheet], {
      header: 1,
      raw: false,
      blankrows: false,
    });
  }

  private resolveParsedLine(
    line: OutboundRequestXlsxLine,
    barcodeMatches: Map<string, Array<{ skuId: string; sku: ResolvedSku }>>,
    skuMatches: Map<string, ResolvedSku[]>,
  ): ResolvedParsedLine {
    if (line.barcode) {
      const matches = barcodeMatches.get(line.barcode) ?? [];
      if (matches.length === 0) {
        return { line, match: null, issueMessage: 'Баркод не найден в SKU клиента.' };
      }

      const uniqueMatches = uniqueSkus(matches.map((match) => match.sku));
      if (uniqueMatches.length !== 1) {
        return { line, match: 'duplicate', issueMessage: 'Баркод привязан к нескольким SKU клиента.' };
      }

      const skuByBarcode = uniqueMatches[0];
      if (line.size && !sizesMatch(skuByBarcode.size, line.size)) {
        return {
          line,
          match: null,
          issueMessage: 'Размер в файле не совпадает с размером SKU по баркоду.',
        };
      }

      const productName = normalizeText(line.name || line.artSeller);
      if (productName) {
        const matchesByName = filterSkusBySize(skuMatches.get(normalizeLookupKey(productName)) ?? [], line.size);
        if (matchesByName.length === 0) {
          return {
            line,
            match: null,
            issueMessage: line.size
              ? 'Баркод найден, но наименование и размер не найдены в SKU клиента.'
              : 'Баркод найден, но наименование товара не найдено в SKU клиента.',
          };
        }
        if (!matchesByName.some((sku) => sku.id === skuByBarcode.id)) {
          return {
            line,
            match: null,
            issueMessage: line.size
              ? 'Баркод, наименование и размер относятся к разным SKU клиента.'
              : 'Баркод и наименование товара относятся к разным SKU клиента.',
          };
        }
      }

      return { line, match: { sku: skuByBarcode }, issueMessage: '' };
    }

    const productName = normalizeText(line.name || line.artSeller);
    if (!productName) {
      return { line, match: null, issueMessage: 'Не заполнен товар или баркод.' };
    }

    const allMatches = skuMatches.get(normalizeLookupKey(productName)) ?? [];
    const matches = filterSkusBySize(allMatches, line.size);
    if (matches.length === 0) {
      return {
        line,
        match: null,
        issueMessage:
          allMatches.length > 0 && line.size
            ? 'Наименование найдено, но размер не совпал ни с одним SKU клиента.'
            : 'Наименование товара не найдено в SKU клиента.',
      };
    }

    return matches.length === 1
      ? { line, match: { sku: matches[0] }, issueMessage: '' }
      : { line, match: 'duplicate', issueMessage: 'Наименование товара совпало с несколькими SKU клиента.' };
  }

  private emptyHydratedLine(line: {
    barcode?: string;
    name?: string;
    quantity: number;
    relabelTargetBarcode?: string;
    relabelQuantity?: number;
    city?: string;
    artSeller?: string;
    size?: string;
    sourceRows: number[];
  }, actionSuggestions: OutboundRequestActionSuggestion[] = []): HydratedOutboundLine {
    return {
      barcode: line.barcode,
      originalName: line.name || line.artSeller,
      requestedQuantity: line.quantity,
      relabelTargetBarcode: line.relabelTargetBarcode,
      relabelQuantity: line.relabelQuantity,
      city: line.city,
      artSeller: line.artSeller,
      size: line.size,
      needsRelabel: false,
      stockQuantity: 0,
      reservedQuantity: 0,
      availableQuantity: 0,
      shortageQuantity: line.quantity,
      sourceRows: line.sourceRows,
      skuId: null,
      internalSku: null,
      name: null,
      canFulfill: false,
      conflicts: [],
      actionSuggestions,
    };
  }

  private async buildCatalogActionSuggestions(
    clientId: string,
    lines: OutboundRequestXlsxLine[],
    resolvedLines: ResolvedParsedLine[],
    skuMatches: Map<string, ResolvedSku[]>,
  ) {
    const candidateSkuIds = new Set<string>();
    const lineCandidates = new Map<number, ResolvedSku[]>();

    lines.forEach((line, index) => {
      const productName = normalizeText(line.name || line.artSeller);
      const targetBarcode = line.barcode || line.relabelTargetBarcode;
      if (!productName || !targetBarcode) {
        return;
      }

      const candidates = filterSkusBySize(skuMatches.get(normalizeLookupKey(productName)) ?? [], line.size);
      const currentSkuId = resolvedLines[index]?.match && resolvedLines[index].match !== 'duplicate' ? resolvedLines[index].match.sku.id : null;
      const relabelCandidates = candidates.filter((sku) => sku.id !== currentSkuId || !skuHasBarcode(sku, targetBarcode));
      if (relabelCandidates.length === 0) {
        return;
      }

      lineCandidates.set(index, relabelCandidates);
      relabelCandidates.forEach((sku) => candidateSkuIds.add(sku.id));
    });

    const stockBySkuId = await this.stockQuantityBySkuId(clientId, [...candidateSkuIds]);
    const nomenclatureByBarcode = await this.nomenclatureByBarcode(lines.map((line) => line.barcode).filter((barcode): barcode is string => Boolean(barcode)));
    const result = new Map<number, OutboundRequestActionSuggestion[]>();

    lines.forEach((line, index) => {
      const targetBarcode = line.barcode || line.relabelTargetBarcode;
      const suggestions: OutboundRequestActionSuggestion[] = [];

      for (const sku of lineCandidates.get(index) ?? []) {
        const availableQuantity = stockBySkuId.get(sku.id) ?? 0;
        if (!targetBarcode || availableQuantity <= 0) {
          continue;
        }

        const sourceBarcode = primaryBarcodeValue(sku);
        suggestions.push({
          type: 'RELABEL',
          title: 'Можно переклеить',
          message: `В каталоге найден ${sku.internalSku} с остатком ${availableQuantity} шт. Можно взять этот SKU и переклеить на ${targetBarcode}.`,
          sourceSkuId: sku.id,
          sourceInternalSku: sku.internalSku,
          sourceName: sku.name,
          sourceBarcode: sourceBarcode ?? undefined,
          targetBarcode,
          availableQuantity,
          quantity: Math.min(line.quantity, availableQuantity),
        });
      }

      if (suggestions.length === 0 && targetBarcode && nomenclatureByBarcode.has(targetBarcode)) {
        const item = nomenclatureByBarcode.get(targetBarcode)!;
        suggestions.push({
          type: 'CREATE_SKU',
          title: 'Есть в общей номенклатуре',
          message: `Баркод есть в общем справочнике: ${item.name}. Создайте SKU клиента или загрузите остатки по этому товару.`,
          targetBarcode,
        });
      }

      if (suggestions.length > 0) {
        result.set(index, suggestions);
      }
    });

    return result;
  }

  private async stockQuantityBySkuId(clientId: string, skuIds: string[]) {
    const stockBalance = this.prisma.stockBalance;
    if (skuIds.length === 0 || !stockBalance?.groupBy) {
      return new Map<string, number>();
    }

    const rows = await stockBalance.groupBy({
      by: ['skuId'],
      where: {
        clientId,
        skuId: { in: skuIds },
        status: StockStatus.AVAILABLE,
      },
      _sum: { quantity: true },
    });

    return new Map(rows.map((row) => [row.skuId, Number(row._sum.quantity ?? 0)]));
  }

  private async nomenclatureByBarcode(barcodes: string[]) {
    const nomenclatureItem = this.prisma.nomenclatureItem;
    if (barcodes.length === 0 || !nomenclatureItem?.findMany) {
      return new Map<string, { barcode: string; name: string }>();
    }

    const rows = await nomenclatureItem.findMany({
      where: { barcode: { in: [...new Set(barcodes)] } },
      select: { barcode: true, name: true },
    });

    return new Map(rows.filter((row) => row.barcode).map((row) => [row.barcode!, { barcode: row.barcode!, name: row.name }]));
  }

  private async buildRelabelSourceOptions(clientId: string): Promise<OutboundRequestRelabelSourceOption[]> {
    const stockBalance = this.prisma.stockBalance;
    if (!stockBalance?.findMany) {
      return [];
    }

    const rows = await stockBalance.findMany({
      where: {
        clientId,
        status: StockStatus.AVAILABLE,
        quantity: { gt: 0 },
      },
      select: {
        skuId: true,
        quantity: true,
        sku: {
          select: {
            id: true,
            internalSku: true,
            clientSku: true,
            article: true,
            name: true,
            size: true,
            barcodes: {
              select: {
                value: true,
                isPrimary: true,
              },
            },
          },
        },
      },
    });

    const bySku = new Map<string, { sku: (typeof rows)[number]['sku']; availableQuantity: number }>();
    for (const row of rows) {
      const existing = bySku.get(row.skuId);
      bySku.set(row.skuId, {
        sku: row.sku,
        availableQuantity: (existing?.availableQuantity ?? 0) + Number(row.quantity ?? 0),
      });
    }

    return [...bySku.values()]
      .map(({ sku, availableQuantity }) => ({
        skuId: sku.id,
        internalSku: sku.internalSku,
        clientSku: sku.clientSku,
        article: sku.article,
        name: sku.name,
        barcode: primaryBarcodeValue(sku),
        size: sku.size,
        availableQuantity,
      }))
      .sort((left, right) => left.internalSku.localeCompare(right.internalSku, 'ru'));
  }

  private buildImportComment(comment: string | undefined, sourceFile: string, preview: OutboundRequestXlsxPreview) {
    return [
      normalizeText(comment),
      `Создано из Excel: ${sourceFile}. Позиций: ${preview.summary.lines}, количество: ${preview.summary.totalQuantity}.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildLineComment(line: HydratedOutboundLine) {
    return [
      line.city ? `Город: ${line.city}` : null,
      line.artSeller ? `Артикул продавца: ${line.artSeller}` : null,
      line.size ? `Размер: ${line.size}` : null,
      line.relabelTargetBarcode && line.relabelQuantity ? `Перемаркировка из: ${line.barcode ?? ''}` : null,
      line.relabelTargetBarcode && line.relabelQuantity ? `Перемаркировка в: ${line.relabelTargetBarcode}` : null,
      line.relabelTargetBarcode && line.relabelQuantity ? `Количество перемаркировки: ${line.relabelQuantity}` : null,
      line.needsRelabel ? 'Перемаркировка: да' : null,
      `Excel rows: ${line.sourceRows.join(', ')}`,
    ]
      .filter(Boolean)
      .join('; ');
  }

  private buildRequestItemsFromLine(line: HydratedOutboundLine) {
    const relabelQuantity = line.relabelTargetBarcode ? Math.min(line.relabelQuantity ?? 0, line.requestedQuantity) : 0;
    const normalQuantity = line.requestedQuantity - relabelQuantity;
    const base = {
      skuId: line.skuId ?? undefined,
      barcode: line.barcode,
      name: line.name ?? undefined,
    };
    const items = [];

    if (normalQuantity > 0) {
      items.push({
        ...base,
        quantity: normalQuantity,
        comment: this.buildLineComment({ ...line, relabelTargetBarcode: undefined, relabelQuantity: undefined }),
      });
    }

    if (relabelQuantity > 0) {
      items.push({
        ...base,
        quantity: relabelQuantity,
        comment: this.buildLineComment({ ...line, requestedQuantity: relabelQuantity, needsRelabel: true }),
      });
    }

    return items;
  }

  private async attachSourceWorkbook(requestId: string, clientId: string, file: Express.Multer.File, user: AuthUser) {
    await this.prisma.clientRequestFile?.create({
      data: {
        requestId,
        clientId,
        fileName: normalizeUploadedFileName(file.originalname),
        mimeType: file.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: file.size,
        content: Uint8Array.from(file.buffer),
        uploadedByUserId: user.id,
      },
    });
  }

  private assertFile(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Нужно приложить Excel-файл.');
    }
  }
}

function normalizeText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeUploadedFileName(value?: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 'request.xlsx';
  }

  if (!/[ÃÐÑ]/.test(normalized)) {
    return normalized;
  }

  const decoded = Buffer.from(normalized, 'latin1').toString('utf8');
  return decoded.includes('�') ? normalized : decoded;
}

function normalizeRequiredText(value: string | undefined, message: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new BadRequestException(message);
  }

  return normalized;
}

function buildSkuMatchesByProductName(skus: ResolvedSku[]) {
  const result = new Map<string, ResolvedSku[]>();
  skus.forEach((sku) => {
    [sku.internalSku, sku.clientSku, sku.article, sku.name].forEach((value) => {
      const key = normalizeLookupKey(value);
      if (!key) {
        return;
      }

      const existing = result.get(key) ?? [];
      if (!existing.some((item) => item.id === sku.id)) {
        result.set(key, [...existing, sku]);
      }
    });
  });
  return result;
}

function uniqueSkus(skus: ResolvedSku[]) {
  const byId = new Map<string, ResolvedSku>();
  skus.forEach((sku) => byId.set(sku.id, sku));
  return [...byId.values()];
}

function filterSkusBySize(skus: ResolvedSku[], size?: string) {
  if (!size) {
    return skus;
  }

  return skus.filter((sku) => sizesMatch(sku.size, size));
}

function primaryBarcodeValue(sku: Pick<ResolvedSku, 'barcodes'>) {
  return sku.barcodes?.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes?.[0]?.value ?? null;
}

function skuHasBarcode(sku: Pick<ResolvedSku, 'barcodes'>, barcode: string) {
  return Boolean(sku.barcodes?.some((item) => item.value === barcode));
}

function sizesMatch(skuSize?: string | null, requestedSize?: string | null) {
  const left = normalizeSize(skuSize);
  const right = normalizeSize(requestedSize);
  return !right || Boolean(left && left === right);
}

function normalizeSize(value?: string | null) {
  const raw = normalizeText(value)?.toUpperCase().replace(/М/g, 'M').replace(/Х/g, 'X') ?? '';
  const match = raw.match(/\(([^)]+)\)/);
  return (match?.[1] ?? raw).replace(/\s+/g, '');
}

function normalizeLookupKey(value?: string | null) {
  return normalizeText(value)?.toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function shortageMessage(needed: number, available: number, conflicts: ClientRequestAvailabilityConflict[]) {
  const base = `Недостаточно доступного остатка: нужно ${needed}, доступно ${available}.`;
  if (conflicts.length === 0) {
    return base;
  }

  const conflictText = conflicts
    .slice(0, 3)
    .map((conflict) => `${conflict.title} от ${new Date(conflict.createdAt).toLocaleDateString('ru-RU')} (${conflict.type})`)
    .join('; ');

  return `${base} Товар участвует в активной заявке: ${conflictText}.`;
}

function defaultTitle() {
  return `Сборка из Excel ${new Date().toLocaleDateString('ru-RU')}`;
}
