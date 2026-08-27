import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { assertWarehouseAccess } from './client-request-warehouse-scope';

const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const marketplaceReadyStatuses = new Set<ClientRequestStatus>([
  ClientRequestStatus.PACKED,
  ClientRequestStatus.DONE,
]);

type MarketplaceRequest = Prisma.ClientRequestGetPayload<typeof marketplaceRequestArgs>;
type MarketplacePackageItem = MarketplaceRequest['packages'][number]['items'][number];

@Injectable()
export class ClientRequestMarketplaceFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async getWbProductsTemplate(requestId: string, user: AuthUser) {
    const request = await this.loadReadyRequest(requestId, user);
    const totals = new Map<string, number>();

    request.packages.forEach((packagePlace) => {
      packagePlace.items.forEach((item) => {
        const barcode = resolveItemBarcode(item);
        if (barcode) {
          totals.set(barcode, (totals.get(barcode) ?? 0) + item.quantity);
        }
      });
    });

    const rows: CellValue[][] = [['Баркод', 'Количество']];
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'ru', { numeric: true }))
      .forEach(([barcode, quantity]) => rows.push([barcode, quantity]));
    if (rows.length === 1) {
      throw new BadRequestException('В упакованной заявке нет строк с баркодами для шаблона товаров WB.');
    }

    return {
      fileName: `${safeFileName(`wb-products-${request.title}-${request.id.slice(0, 8)}`)}.xlsx`,
      mimeType: xlsxMimeType,
      content: buildWorkbook('Sheet1', rows, [22, 14]),
    };
  }

  async getWbPackagingTemplate(requestId: string, user: AuthUser) {
    const request = await this.loadReadyRequest(requestId, user);
    const rows: CellValue[][] = [['Баркод товара', 'Кол-во товаров', 'ШК короба', 'Срок годности']];

    request.packages
      .slice()
      .sort((left, right) => left.packageCode.localeCompare(right.packageCode, 'ru', { numeric: true }))
      .forEach((packagePlace) => {
        packagePlace.items.forEach((item) => {
          const barcode = resolveItemBarcode(item);
          if (!barcode) {
            return;
          }
          rows.push([
            barcode,
            item.quantity,
            packagePlace.packageCode,
            formatDate(item.sku?.shelfLifeUntil ?? item.requestItem.sku?.shelfLifeUntil ?? null),
          ]);
        });
      });
    if (rows.length === 1) {
      throw new BadRequestException('В упакованной заявке нет строк с коробами для шаблона упаковки WB.');
    }

    return {
      fileName: `${safeFileName(`wb-packages-${request.title}-${request.id.slice(0, 8)}`)}.xlsx`,
      mimeType: xlsxMimeType,
      content: buildWorkbook('TDSheet', rows, [22, 16, 24, 16]),
    };
  }

  private async loadReadyRequest(requestId: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      ...marketplaceRequestArgs,
    });
    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }
    this.clientScopes.requireClientAccess(user, request.clientId, 'read');
    assertWarehouseAccess(user, request, 'read', 'Заявка не найдена в выбранном филиале.');
    if (request.type !== ClientRequestType.OUTBOUND) {
      throw new BadRequestException('Файлы WB доступны только для заявок на отгрузку.');
    }
    if (!marketplaceReadyStatuses.has(request.status)) {
      throw new BadRequestException('Файлы WB доступны после упаковки заявки.');
    }
    if (request.packages.length === 0) {
      throw new BadRequestException('Сначала зафиксируйте упаковочные места по заявке.');
    }

    return request;
  }
}

type CellValue = string | number;

const skuForMarketplaceSelect = {
  id: true,
  internalSku: true,
  clientSku: true,
  article: true,
  name: true,
  shelfLifeUntil: true,
  barcodes: {
    select: {
      value: true,
      isPrimary: true,
    },
  },
} satisfies Prisma.SkuSelect;

const marketplaceRequestArgs = {
  include: {
    packages: {
      include: {
        items: {
          include: {
            sku: { select: skuForMarketplaceSelect },
            requestItem: {
              select: {
                id: true,
                barcode: true,
                name: true,
                quantity: true,
                sku: { select: skuForMarketplaceSelect },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    },
  },
} satisfies Prisma.ClientRequestDefaultArgs;

function buildWorkbook(sheetName: string, rows: CellValue[][], widths: number[]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((width) => ({ wch: width }));
  for (const address of Object.keys(sheet)) {
    if (!address.startsWith('!')) {
      const cell = sheet[address];
      if (typeof cell?.v === 'string') {
        cell.t = 's';
        cell.z = '@';
      }
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function resolveItemBarcode(item: MarketplacePackageItem) {
  return (
    normalizeText(item.barcode) ??
    normalizeText(item.requestItem.barcode) ??
    primaryBarcode(item.sku?.barcodes ?? []) ??
    primaryBarcode(item.requestItem.sku?.barcodes ?? []) ??
    null
  );
}

function primaryBarcode(barcodes: Array<{ value: string; isPrimary: boolean }>) {
  return normalizeText(barcodes.find((barcode) => barcode.isPrimary)?.value) ?? normalizeText(barcodes[0]?.value);
}

function formatDate(value: Date | null) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(value);
}

function normalizeText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'wb-template';
}
