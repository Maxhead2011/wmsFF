import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { PickInstructionService } from '../stock/pick-instruction.service';
import type { PickInstructionDocument } from '../stock/pick-instruction.types';
import { PrismaService } from '../../common/prisma/prisma.service';

const activeAssemblyStatuses = [
  ClientRequestStatus.SUBMITTED,
  ClientRequestStatus.IN_REVIEW,
  ClientRequestStatus.APPROVED,
  ClientRequestStatus.IN_WORK,
  ClientRequestStatus.PACKED,
];

@Injectable()
export class TsdAssemblyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly pickInstructions: PickInstructionService,
  ) {}

  async listActiveRequests(user: AuthUser) {
    const clientFilter = this.clientScopes.resolveClientFilter(user);
    const requests = await this.prisma.clientRequest.findMany({
      where: {
        clientId: clientFilter,
        type: ClientRequestType.OUTBOUND,
        status: { in: activeAssemblyStatuses },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        destinationCity: true,
        desiredDate: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, name: true, code: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        _count: { select: { items: true } },
      },
    });

    return requests.map((request) => ({
      id: request.id,
      title: request.title,
      status: request.status,
      city: request.destinationCity,
      desiredDate: request.desiredDate?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      client: request.client,
      rowsCount: request._count.items,
      inWorkBy: request.assignedTo
        ? {
            id: request.assignedTo.id,
            name: request.assignedTo.name,
            email: request.assignedTo.email,
          }
        : null,
    }));
  }

  async getRequestPlan(requestId: string, user: AuthUser) {
    const exists = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clientId: true },
    });
    if (!exists) {
      throw new NotFoundException('Заявка для ТСД не найдена.');
    }

    this.clientScopes.requireClientAccess(user, exists.clientId, 'read');
    const document = await this.pickInstructions.getRequestInstruction(requestId, user);
    return this.toTsdPlan(document);
  }

  async findSkuByBarcode(query: { clientId?: string; barcode?: string }, user: AuthUser) {
    const clientId = query.clientId?.trim();
    const barcode = query.barcode?.trim();

    if (!clientId) {
      throw new BadRequestException('Не указан клиент для поиска товара.');
    }
    if (!barcode) {
      throw new BadRequestException('Не указан штрихкод товара.');
    }

    this.clientScopes.requireClientAccess(user, clientId, 'read');

    const matches = await this.prisma.barcode.findMany({
      where: {
        value: barcode,
        sku: { clientId },
      },
      include: {
        sku: {
          include: {
            barcodes: true,
            balances: {
              where: { quantity: { gt: 0 } },
              select: { quantity: true, status: true },
            },
            client: { select: { id: true, code: true, name: true } },
          },
        },
      },
      take: 20,
    });

    const found =
      matches.find((match) => !match.sku.isDraft && match.sku.balances.some((balance) => balance.quantity > 0)) ??
      matches.find((match) => !match.sku.isDraft) ??
      matches[0];

    if (!found) {
      throw new NotFoundException('Товар по штрихкоду не найден.');
    }

    const sku = found.sku;
    const marketplacePhotos = extractMarketplacePhotos(sku.marketplacePayload);

    return {
      id: sku.id,
      skuId: sku.id,
      clientId: sku.clientId,
      client: sku.client,
      internalSku: sku.internalSku,
      clientSku: sku.clientSku,
      article: sku.article,
      name: sku.name,
      brand: sku.brand,
      category: sku.category,
      color: sku.color,
      size: sku.size,
      weightGrams: sku.weightGrams,
      lengthCm: decimalToNumber(sku.lengthCm),
      widthCm: decimalToNumber(sku.widthCm),
      heightCm: decimalToNumber(sku.heightCm),
      volumeLiters: decimalToNumber(sku.volumeLiters),
      shelfLifeUntil: sku.shelfLifeUntil?.toISOString() ?? null,
      barcode: found.value,
      barcodes: sku.barcodes.map((item) => ({ value: item.value, isPrimary: item.isPrimary })),
      availableQuantity: sku.balances.reduce((sum, balance) => sum + balance.quantity, 0),
      marketplace: sku.marketplace,
      marketplaceProductId: sku.marketplaceProductId,
      marketplaceOfferId: sku.marketplaceOfferId,
      marketplacePhotos,
      imageUrl: marketplacePhotos[0] ?? null,
      photoUrl: marketplacePhotos[0] ?? null,
    };
  }

  private toTsdPlan(document: PickInstructionDocument & { html?: string }) {
    const searchBoxes = uniqueSorted([
      ...document.warehouseRows.map((row) => row.sourceBox),
      ...document.warehouseBalanceMoves.map((row) => row.sourceBox),
      ...document.warehouseWholeBoxes.map((row) => row.box),
    ]).map((boxCode) => ({ boxCode }));

    const relabelTasks = collapseRows(
      document.warehouseRows
        .filter((row) => row.sourceBox && row.quantity > 0 && row.rebrandNote)
        .map((row) => {
          const parsed = parseRelabelNote(row.rebrandNote);
          return {
            sourceBox: row.sourceBox,
            oldBarcode: parsed.oldBarcode || row.barcodeOnBox,
            newBarcode: parsed.newBarcode || row.barcodeOnBox,
            barcode: parsed.newBarcode || row.barcodeOnBox,
            name: row.artOnBox,
            size: row.size,
            quantity: row.quantity,
            note: row.rebrandNote,
          };
        }),
      (row) => `${row.sourceBox}|${row.oldBarcode}|${row.newBarcode}|${row.size}`,
    );

    const movementTasks = collapseRows(
      document.warehouseBalanceMoves
        .filter((row) => row.sourceBox && row.newBox && row.quantity > 0)
        .map((row) => ({
          sourceBox: row.sourceBox,
          targetBox: row.newBox,
          barcode: row.barcodeOnBox,
          name: row.artOnBox,
          size: row.size,
          quantity: row.quantity,
          note: row.note,
        })),
      (row) => `${row.sourceBox}|${row.targetBox}|${row.barcode}|${row.size}`,
    );

    const totalRelabel = relabelTasks.reduce((sum, row) => sum + row.quantity, 0);
    const totalMove = movementTasks.reduce((sum, row) => sum + row.quantity, 0);

    return {
      id: document.requestId,
      title: document.requestTitle,
      status: document.requestStatus,
      statusLabel: document.requestStatusLabel,
      city: document.destinationCity,
      desiredDate: document.desiredDate,
      client: document.client,
      rowsCount: document.rowsCount,
      totalRequested: document.totalRequested,
      boxesTotal: searchBoxes.length,
      relabelTotal: totalRelabel,
      movementTotal: totalMove,
      searchBoxes,
      relabelTasks,
      movementTasks,
    };
  }
}

type CollapsibleRow = {
  sourceBox: string;
  quantity: number;
};

function collapseRows<T extends CollapsibleRow>(rows: T[], keyOf: (row: T) => string) {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = byKey.get(key);
    if (current) {
      current.quantity += row.quantity;
    } else {
      byKey.set(key, { ...row });
    }
  }

  return [...byKey.values()].sort((left, right) => left.sourceBox.localeCompare(right.sourceBox, 'ru', { numeric: true }));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, 'ru', { numeric: true }),
  );
}

function decimalToNumber(value: { toNumber?: () => number } | number | string | null | undefined) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return typeof value.toNumber === 'function' ? value.toNumber() : null;
}

function extractMarketplacePhotos(payload: unknown) {
  const photos: string[] = [];

  visitMarketplacePayload(payload, (value, key) => {
    const normalizedKey = key.toLowerCase();
    if (typeof value === 'string' && looksLikeImageUrl(value)) {
      photos.push(value);
      return;
    }

    if (!['photo', 'photos', 'image', 'images', 'picture', 'pictures', 'media', 'primary_image'].some((name) => normalizedKey.includes(name))) {
      return;
    }

    if (typeof value === 'string' && looksLikeImageUrl(value)) {
      photos.push(value);
      return;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      for (const field of ['url', 'big', 'small', 'file_name', 'link', 'c246x328', 'c516x688', 'hq', 'tm']) {
        const candidate = record[field];
        if (typeof candidate === 'string' && looksLikeImageUrl(candidate)) {
          photos.push(candidate);
        }
      }
    }
  });

  return [...new Set(photos)].slice(0, 20);
}

function visitMarketplacePayload(value: unknown, visit: (value: unknown, key: string) => void, key = '', depth = 0) {
  if (depth > 6 || value == null) {
    return;
  }

  visit(value, key);

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitMarketplacePayload(item, visit, `${key}.${index}`, depth + 1));
    return;
  }

  if (typeof value === 'object') {
    for (const [nextKey, nextValue] of Object.entries(value as Record<string, unknown>)) {
      visitMarketplacePayload(nextValue, visit, nextKey, depth + 1);
    }
  }
}

function looksLikeImageUrl(value: string) {
  return /^https?:\/\//i.test(value) && /\.(?:jpg|jpeg|png|webp)(?:\?|#|$)/i.test(value);
}

function parseRelabelNote(note: string) {
  const match = note.match(/перемаркировать\s+(.+?)\s*->\s*(.+)$/i);
  return {
    oldBarcode: match?.[1]?.trim() ?? '',
    newBarcode: match?.[2]?.trim() ?? '',
  };
}
