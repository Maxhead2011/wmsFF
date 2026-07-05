import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestType, Prisma, StockStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import {
  renderPickInstructionHtml,
  requestPriorityLabel,
  requestStatusLabel,
  rowStatusLabel,
  safeFileName,
} from './pick-instruction-renderer';
import type {
  PickInstructionAllocation,
  WarehouseBalanceLabelRow,
  WarehouseBalanceMoveRow,
  PickInstructionBoxSummary,
  PickInstructionDocument,
  PickInstructionRow,
  PickInstructionRowStatus,
  WarehouseInstructionRow,
  WarehouseMarkRow,
  WarehouseWholeBoxRow,
} from './pick-instruction.types';
import { buildPickInstructionWorkbook, pickInstructionXlsxMimeType } from './pick-instruction-xlsx';

type RequestForInstruction = Prisma.ClientRequestGetPayload<typeof pickInstructionRequestArgs>;
type RequestItemForInstruction = RequestForInstruction['items'][number];
type SkuForInstruction = NonNullable<RequestItemForInstruction['sku']>;
type SkuCatalogForInstruction = Prisma.SkuGetPayload<typeof skuCatalogArgs>;
type BalanceForInstruction = Prisma.StockBalanceGetPayload<typeof stockBalanceArgs>;

@Injectable()
export class PickInstructionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async getRequestInstruction(requestId: string, user: AuthUser) {
    const request = await this.prisma.clientRequest.findUnique({
      where: { id: requestId },
      ...pickInstructionRequestArgs,
    });

    if (!request) {
      throw new NotFoundException('Клиентская заявка не найдена.');
    }

    this.clientScopes.requireClientAccess(user, request.clientId, 'read');

    if (request.type !== ClientRequestType.OUTBOUND) {
      throw new BadRequestException('Складская инструкция доступна только для заявок на отгрузку.');
    }

    const skuByBarcode = await this.resolveMissingSkusByBarcode(request);
    const rows = this.prepareRows(request, skuByBarcode);
    const auxiliary = await this.loadWarehouseAuxiliaryData(request.clientId, request.files);
    const balances = await this.loadAvailableBalances(request.clientId, rows, auxiliary.mapping.size > 0);
    const { instructionRows, boxAllocations } = this.allocateRows(rows, balances);
    const boxes = await this.buildBoxSummaries(request.clientId, boxAllocations);
    const warehousePlan = await this.buildWarehousePlan(request, rows, balances, auxiliary);

    const document: PickInstructionDocument = {
      requestId: request.id,
      title: `Инструкция сборки ${request.title}`,
      fileName: `${safeFileName(`pick-instruction-${request.title}-${request.id.slice(0, 8)}`)}.html`,
      requestTitle: request.title,
      requestStatus: request.status,
      requestStatusLabel: requestStatusLabel(request.status),
      priority: request.priority,
      priorityLabel: requestPriorityLabel(request.priority),
      client: request.client,
      generatedAt: new Date().toISOString(),
      desiredDate: request.desiredDate?.toISOString() ?? null,
      destinationCity: request.destinationCity,
      deliveryAddress: request.deliveryAddress,
      totalRequested: instructionRows.reduce((sum, row) => sum + row.requestedQuantity, 0),
      totalAllocated: instructionRows.reduce((sum, row) => sum + row.allocatedQuantity, 0),
      totalShortage: instructionRows.reduce((sum, row) => sum + row.shortageQuantity, 0),
      rowsCount: instructionRows.length,
      readyRowsCount: instructionRows.filter((row) => row.status === 'READY').length,
      shortageRowsCount: instructionRows.filter((row) => row.status !== 'READY').length,
      boxesCount: boxes.length,
      fullBoxesCount: boxes.filter((box) => box.isFullBox).length,
      rows: instructionRows,
      boxes,
      warehouseRows: warehousePlan.rows,
      warehouseWholeBoxes: warehousePlan.wholeBoxes,
      warehouseBalanceMoves: warehousePlan.balanceMoves,
      warehouseBalanceLabels: warehousePlan.balanceLabels,
      warehouseMarkRows: warehousePlan.markRows,
    };

    return {
      ...document,
      html: renderPickInstructionHtml(document),
    };
  }

  async getRequestInstructionXlsx(requestId: string, user: AuthUser) {
    const document = await this.getRequestInstruction(requestId, user);

    return {
      fileName: document.fileName.replace(/\.html$/i, '.xlsx'),
      mimeType: pickInstructionXlsxMimeType(),
      content: buildPickInstructionWorkbook(document),
    };
  }

  private async resolveMissingSkusByBarcode(request: RequestForInstruction) {
    const barcodes = [
      ...new Set(
        request.items
          .filter((item) => !item.skuId && item.barcode)
          .map((item) => item.barcode)
          .filter((barcode): barcode is string => Boolean(barcode)),
      ),
    ];

    if (barcodes.length === 0) {
      return new Map<string, SkuForInstruction | 'duplicate'>();
    }

    const barcodeRows = await this.prisma.barcode.findMany({
      where: {
        value: { in: barcodes },
        sku: { clientId: request.clientId },
      },
      include: {
        sku: {
          include: {
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
    const result = new Map<string, SkuForInstruction | 'duplicate'>();

    for (const barcode of barcodes) {
      const matches = barcodeRows.filter((row) => row.value === barcode);
      if (matches.length === 1) {
        result.set(barcode, matches[0].sku);
      } else if (matches.length > 1) {
        result.set(barcode, 'duplicate');
      }
    }

    return result;
  }

  private prepareRows(request: RequestForInstruction, skuByBarcode: Map<string, SkuForInstruction | 'duplicate'>) {
    return request.items.map((item, index) => {
      const resolvedSku = item.sku ?? (item.barcode ? skuByBarcode.get(item.barcode) : null) ?? null;
      const status: PickInstructionRowStatus =
        resolvedSku && resolvedSku !== 'duplicate' ? 'SHORTAGE' : 'SKU_NOT_FOUND';
      const primaryBarcode = resolvedSku && resolvedSku !== 'duplicate' ? primaryBarcodeValue(resolvedSku) : null;

      return {
        position: index + 1,
        item,
        sku: resolvedSku === 'duplicate' ? null : resolvedSku,
        duplicateBarcode: resolvedSku === 'duplicate',
        skuId: resolvedSku && resolvedSku !== 'duplicate' ? resolvedSku.id : null,
        internalSku: resolvedSku && resolvedSku !== 'duplicate' ? resolvedSku.internalSku : null,
        name: item.name ?? (resolvedSku && resolvedSku !== 'duplicate' ? resolvedSku.name : null),
        barcode: item.barcode ?? primaryBarcode,
        requestedQuantity: item.quantity,
        status,
      };
    });
  }

  private async loadAvailableBalances(clientId: string, rows: Array<{ skuId: string | null }>, includeAllClientBalances = false) {
    const skuIds = [...new Set(rows.map((row) => row.skuId).filter((skuId): skuId is string => Boolean(skuId)))];
    if (!includeAllClientBalances && skuIds.length === 0) {
      return [];
    }

    return this.prisma.stockBalance.findMany({
      where: {
        clientId,
        skuId: includeAllClientBalances ? undefined : { in: skuIds },
        status: StockStatus.AVAILABLE,
        quantity: { gt: 0 },
        boxId: { not: null },
      },
      ...stockBalanceArgs,
      orderBy: [{ updatedAt: 'asc' }],
    });
  }

  private async loadWarehouseAuxiliaryData(clientId: string, files: RequestForInstruction['files'] = []): Promise<WarehouseAuxiliaryData> {
    const legacyWorkbookData = this.readAuxiliaryWorkbook(files);
    const [articleMappings, skus] = await Promise.all([
      this.prisma.clientArticleMapping.findMany({
        where: { clientId },
        orderBy: [{ targetArticle: 'asc' }, { sourceArticle: 'asc' }],
      }),
      this.prisma.sku.findMany({
        where: { clientId },
        ...skuCatalogArgs,
      }),
    ]);

    const mapping = new Map<string, Set<string>>();
    articleMappings.forEach((row) => {
      addArticleMapping(mapping, row.targetArticle, row.sourceArticle);
    });

    const shk = buildShkCatalogFromSkus(skus);
    mergeMissingShkRecords(shk, legacyWorkbookData.shk);

    return {
      mapping: mapping.size > 0 ? mapping : legacyWorkbookData.mapping,
      boxToPallet: new Map(),
      shk,
    };
  }

  private readAuxiliaryWorkbook(files: RequestForInstruction['files'] = []): WarehouseAuxiliaryData {
    const empty = emptyWarehouseAuxiliaryData();
    const sourceFile = files.find((file) => /\.xlsx?$/i.test(file.fileName) || file.mimeType.includes('spreadsheet'));
    if (!sourceFile) {
      return empty;
    }

    try {
      const workbook = XLSX.read(Buffer.from(sourceFile.content), { type: 'buffer' });
      const sheet = (name: string) => {
        const sheetName = workbook.SheetNames.find((candidate) => candidate.trim().toLowerCase() === name.toLowerCase());
        return sheetName ? XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, blankrows: false }) : [];
      };

      return {
        mapping: parseMappingSheet(sheet('Соответствие')),
        boxToPallet: parsePalletSheet(sheet('палет сорт')),
        shk: parseShkSheet(sheet('ШК')),
      };
    } catch {
      return empty;
    }
  }

  private allocateRows(
    rows: ReturnType<PickInstructionService['prepareRows']>,
    balances: BalanceForInstruction[],
  ) {
    const balancesBySkuId = groupBalancesBySkuId(balances);
    const remainingByBalance = new Map(balances.map((balance) => [balance.id, balance.quantity]));
    const boxAllocations = new Map<string, { box: BalanceForInstruction; allocatedQuantity: number; lineIds: Set<string> }>();
    const instructionRows: PickInstructionRow[] = [];

    for (const row of rows) {
      const allocations: PickInstructionAllocation[] = [];
      let remaining = row.requestedQuantity;

      if (row.skuId) {
        for (const balance of balancesBySkuId.get(row.skuId) ?? []) {
          if (remaining <= 0) {
            break;
          }

          const available = remainingByBalance.get(balance.id) ?? 0;
          if (available <= 0 || !balance.boxId || !balance.box) {
            continue;
          }

          const quantity = Math.min(available, remaining);
          remainingByBalance.set(balance.id, available - quantity);
          remaining -= quantity;
          allocations.push({
            balanceId: balance.id,
            boxId: balance.boxId,
            boxCode: balance.box.code,
            palletId: balance.palletId,
            palletCode: balance.pallet?.code ?? null,
            quantity,
          });
          const boxAllocation = boxAllocations.get(balance.boxId) ?? {
            box: balance,
            allocatedQuantity: 0,
            lineIds: new Set<string>(),
          };
          boxAllocation.allocatedQuantity += quantity;
          boxAllocation.lineIds.add(row.item.id);
          boxAllocations.set(balance.boxId, boxAllocation);
        }
      }

      const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      const shortageQuantity = Math.max(0, row.requestedQuantity - allocatedQuantity);
      const status = this.rowStatus(row, shortageQuantity);

      instructionRows.push({
        position: row.position,
        itemId: row.item.id,
        skuId: row.skuId,
        internalSku: row.internalSku,
        name: row.name,
        barcode: row.barcode,
        requestedQuantity: row.requestedQuantity,
        allocatedQuantity,
        shortageQuantity,
        status,
        statusLabel: rowStatusLabel(status),
        comment: this.rowComment(row, shortageQuantity),
        allocations,
      });
    }

    return { instructionRows, boxAllocations };
  }

  private async buildWarehousePlan(
    request: RequestForInstruction,
    rows: ReturnType<PickInstructionService['prepareRows']>,
    balances: BalanceForInstruction[],
    auxiliary: WarehouseAuxiliaryData,
  ) {
    const demands = rows.map((row) => {
      const meta = parseRequestItemComment(row.item.comment);
      return {
        orderId: row.item.id,
        skuId: row.skuId,
        artSeller: meta.artSeller || row.internalSku || row.name || '',
        barcode: row.barcode ?? '',
        size: normalizeSize(meta.size || row.sku?.size || ''),
        name: normalizeName(row.name || row.item.name || row.sku?.name || ''),
        city: meta.city || request.destinationCity || '',
        needsRelabel: meta.needsRelabel || Boolean(row.sku?.needsRelabel),
        relabelSourceBarcode: meta.relabelSourceBarcode,
        relabelTargetBarcode: meta.relabelTargetBarcode,
        required: row.requestedQuantity,
        remaining: row.requestedQuantity,
      };
    });
    const demandById = new Map(demands.map((demand) => [demand.orderId, demand]));
    const inventoryByBox = new Map<string, WarehouseInventoryItem[]>();

    balances.forEach((balance, index) => {
      if (!balance.box?.code || balance.quantity <= 0) {
        return;
      }
      const sku = balance.sku ?? fallbackBalanceSku(balance.skuId);

      const item: WarehouseInventoryItem = {
        id: balance.id || String(index),
        box: balance.box.code,
        pallet: balance.pallet?.code ?? auxiliary.boxToPallet.get(balance.box.code) ?? '',
        skuId: balance.skuId,
        barcode: primaryBarcodeValue(sku),
        artWarehouse: sku.internalSku || sku.article || sku.clientSku || sku.name,
        name: normalizeName(sku.name),
        size: normalizeSize(sku.size || ''),
        quantity: balance.quantity,
        originalQuantity: balance.quantity,
        suitableDemands: [],
      };
      inventoryByBox.set(item.box, [...(inventoryByBox.get(item.box) ?? []), item]);
    });

    for (const items of inventoryByBox.values()) {
      for (const item of items) {
        item.suitableDemands = demands
          .filter((demand) => isSuitableForDemand(item, demand, auxiliary.mapping))
          .map((demand) => demand.orderId);
      }
    }

    const actions: WarehouseAction[] = [];
    const shipmentBoxes = new Set<string>();
    const tolerance = 5;
    const remainingOf = (orderId: string) => demandById.get(orderId)?.remaining ?? 0;
    const decreaseRemaining = (orderId: string, amount: number) => {
      const demand = demandById.get(orderId);
      if (demand) {
        demand.remaining -= amount;
      }
    };

    for (const [box, items] of inventoryByBox.entries()) {
      const totalItems = items.reduce((sum, item) => sum + item.originalQuantity, 0);
      if (totalItems === 0) {
        continue;
      }

      const tempRemaining = new Map(demands.map((demand) => [demand.orderId, demand.remaining]));
      const tempAssign: Array<{ item: WarehouseInventoryItem; orderId: string; quantity: number }> = [];

      for (const item of items) {
        let remainingInItem = item.quantity;
        const suitable = item.suitableDemands
          .filter((orderId) => (tempRemaining.get(orderId) ?? 0) > -tolerance)
          .sort((left, right) => (tempRemaining.get(right) ?? 0) - (tempRemaining.get(left) ?? 0));

        for (const orderId of suitable) {
          const take = Math.min(remainingInItem, (tempRemaining.get(orderId) ?? 0) + tolerance);
          if (take > 0) {
            tempRemaining.set(orderId, (tempRemaining.get(orderId) ?? 0) - take);
            remainingInItem -= take;
            tempAssign.push({ item, orderId, quantity: take });
          }
          if (remainingInItem === 0) {
            break;
          }
        }
      }

      const useful = tempAssign.reduce((sum, row) => sum + row.quantity, 0);
      if (Math.abs(totalItems - useful) <= tolerance) {
        shipmentBoxes.add(box);
        for (const assignment of tempAssign) {
          const demand = demandById.get(assignment.orderId)!;
          decreaseRemaining(assignment.orderId, assignment.quantity);
          assignment.item.quantity -= assignment.quantity;
          const rebrandNote = relabelNote(assignment.item, demand);
          const targetBox =
            useful === totalItems ? (rebrandNote ? 'МАРК ЦЕЛЫЙ' : 'ЦЕЛЫЙ') : rebrandNote ? 'МАРК ПОСТАВКА' : 'ПОСТАВКА';
          actions.push(actionFromAssignment(assignment.item, demand, assignment.quantity, targetBox, rebrandNote, ''));
        }

        if (useful < totalItems) {
          for (const item of items) {
            if (item.quantity > 0) {
              actions.push(balanceAction(item));
              item.quantity = 0;
            }
          }
        }
      }
    }

    if (demands.some((demand) => demand.remaining > -tolerance)) {
      for (const [box, items] of inventoryByBox.entries()) {
        if (shipmentBoxes.has(box)) {
          continue;
        }
        for (const item of items) {
          if (item.quantity === 0) {
            continue;
          }
          const suitable = item.suitableDemands
            .filter((orderId) => remainingOf(orderId) > -tolerance)
            .sort((left, right) => remainingOf(right) - remainingOf(left));
          for (const orderId of suitable) {
            const demand = demandById.get(orderId)!;
            const take = Math.min(item.quantity, remainingOf(orderId) + tolerance);
            if (take > 0) {
              decreaseRemaining(orderId, take);
              item.quantity -= take;
              const rebrandNote = relabelNote(item, demand);
              actions.push(actionFromAssignment(item, demand, take, rebrandNote ? 'МАРК ПОСТАВКА' : 'ПОСТАВКА', rebrandNote, ''));
            }
          }
        }
      }
    }

    const usedBoxes = new Set(actions.filter((action) => action.sourceBox && action.targetBox !== 'БАЛАНС').map((action) => action.sourceBox));
    for (const [box, items] of inventoryByBox.entries()) {
      if (!usedBoxes.has(box)) {
        continue;
      }
      for (const item of items) {
        if (item.quantity > 0) {
          actions.push(balanceAction(item));
        }
      }
    }

    for (const demand of demands) {
      if (demand.remaining > 0) {
        actions.push({
          city: demand.city,
          sourceBox: '',
          pallet: '',
          artOnBox: demand.artSeller,
          barcodeOnBox: demand.barcode,
          targetArt: demand.artSeller,
          targetBarcode: demand.barcode,
          size: demand.size,
          quantity: demand.remaining,
          targetBox: '',
          rebrandNote: '',
          note: 'нет на складе',
        });
      }
    }

    const generatedAt = new Date();
    const usedShipmentBoxes = new Set(actions.filter((action) => action.sourceBox && action.targetBox !== 'БАЛАНС').map((action) => action.sourceBox));
    const existingBalanceBoxCodes = await this.loadExistingBalanceBoxCodes(generatedAt);
    const balanceBoxBySourceBox = assignBalanceBoxCodes(actions, existingBalanceBoxCodes, generatedAt);
    const wholeBoxCities = new Map<string, Set<string>>();
    actions.forEach((action) => {
      if (['ЦЕЛЫЙ', 'МАРК ЦЕЛЫЙ'].includes(action.targetBox)) {
        wholeBoxCities.set(action.sourceBox, new Set([...(wholeBoxCities.get(action.sourceBox) ?? []), action.city]));
      }
    });

    const warehouseRows: WarehouseInstructionRow[] = actions.map((action) => ({
      city: action.city,
      sourceBox: action.sourceBox,
      targetBox: balanceBoxBySourceBox.get(action.sourceBox) ?? '',
      pallet: action.pallet || auxiliary.boxToPallet.get(action.sourceBox) || '',
      artOnBox: action.targetArt || action.artOnBox,
      barcodeOnBox: action.targetBarcode || action.barcodeOnBox,
      size: action.size,
      quantity: action.quantity,
      comment: warehouseActionComment(action, usedShipmentBoxes, balanceBoxBySourceBox, wholeBoxCities),
      rebrandNote: action.rebrandNote,
      note:
        action.targetBox === 'БАЛАНС' && balanceBoxBySourceBox.has(action.sourceBox)
          ? `${action.note}; новый короб ${balanceBoxBySourceBox.get(action.sourceBox)}`
          : action.note,
    }));
    const balanceMoves = buildBalanceMoves(actions, balanceBoxBySourceBox, auxiliary.boxToPallet);
    const balanceLabels = buildBalanceLabels(balanceMoves, request.client.name);

    return {
      rows: warehouseRows,
      wholeBoxes: buildWholeBoxes(actions, auxiliary.boxToPallet, balanceBoxBySourceBox),
      balanceMoves,
      balanceLabels,
      markRows: buildMarkRows(actions, auxiliary.shk),
    };
  }

  private async loadExistingBalanceBoxCodes(date: Date) {
    const prefix = balanceBoxPrefix(date);
    const boxes = await this.prisma.box.findMany({
      where: {
        code: { startsWith: prefix },
      },
      select: { code: true },
    });

    return new Set(boxes.map((box) => box.code));
  }

  private rowStatus(row: { skuId: string | null }, shortageQuantity: number): PickInstructionRowStatus {
    if (!row.skuId) {
      return 'SKU_NOT_FOUND';
    }

    return shortageQuantity > 0 ? 'SHORTAGE' : 'READY';
  }

  private rowComment(row: { skuId: string | null; duplicateBarcode: boolean }, shortageQuantity: number) {
    if (row.duplicateBarcode) {
      return 'Баркод привязан к нескольким SKU клиента.';
    }

    if (!row.skuId) {
      return 'Не найден SKU по строке заявки.';
    }

    return shortageQuantity > 0 ? `Не хватает ${shortageQuantity} шт. в AVAILABLE.` : null;
  }

  private async buildBoxSummaries(
    clientId: string,
    boxAllocations: Map<string, { box: BalanceForInstruction; allocatedQuantity: number; lineIds: Set<string> }>,
  ): Promise<PickInstructionBoxSummary[]> {
    const boxIds = [...boxAllocations.keys()];
    if (boxIds.length === 0) {
      return [];
    }

    const totals = await this.prisma.stockBalance.groupBy({
      by: ['boxId'],
      where: {
        clientId,
        status: StockStatus.AVAILABLE,
        boxId: { in: boxIds },
        quantity: { gt: 0 },
      },
      _sum: { quantity: true },
    });
    const availableByBoxId = new Map(totals.map((total) => [total.boxId, total._sum.quantity ?? 0]));

    return boxIds
      .map((boxId) => {
        const allocation = boxAllocations.get(boxId)!;
        const availableQuantity = availableByBoxId.get(boxId) ?? allocation.allocatedQuantity;
        const isFullBox = allocation.allocatedQuantity >= availableQuantity;

        return {
          boxId,
          boxCode: allocation.box.box?.code ?? boxId,
          palletId: allocation.box.palletId,
          palletCode: allocation.box.pallet?.code ?? null,
          allocatedQuantity: allocation.allocatedQuantity,
          availableQuantity,
          linesCount: allocation.lineIds.size,
          isFullBox,
          comment: isFullBox ? 'ЦЕЛЫЙ короб в сборку' : 'Частичный отбор из короба',
        };
      })
      .sort((left, right) => left.boxCode.localeCompare(right.boxCode, 'ru'));
  }
}

const pickInstructionRequestArgs = {
  include: {
    client: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    items: {
      include: {
        sku: {
          include: {
            barcodes: {
              select: {
                value: true,
                isPrimary: true,
              },
            },
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
    },
    files: {
      select: {
        fileName: true,
        mimeType: true,
        content: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    },
  },
} satisfies Prisma.ClientRequestDefaultArgs;

const stockBalanceArgs = {
  include: {
    sku: {
      include: {
        barcodes: {
          select: {
            value: true,
            isPrimary: true,
          },
        },
      },
    },
    box: {
      select: {
        id: true,
        code: true,
      },
    },
    pallet: {
      select: {
        id: true,
        code: true,
      },
    },
  },
} satisfies Prisma.StockBalanceDefaultArgs;

const skuCatalogArgs = {
  include: {
    barcodes: {
      select: {
        value: true,
        isPrimary: true,
      },
    },
  },
} satisfies Prisma.SkuDefaultArgs;

function groupBalancesBySkuId(balances: BalanceForInstruction[]) {
  const result = new Map<string, BalanceForInstruction[]>();
  balances.forEach((balance) => {
    result.set(balance.skuId, [...(result.get(balance.skuId) ?? []), balance]);
  });
  return result;
}

function primaryBarcodeValue(sku: { barcodes: Array<{ value: string; isPrimary: boolean }> }) {
  return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? null;
}

function fallbackBalanceSku(skuId: string): SkuForInstruction {
  return {
    id: skuId,
    clientId: '',
    internalSku: skuId,
    clientSku: null,
    article: null,
    name: skuId,
    brand: null,
    category: null,
    color: null,
    size: null,
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    volumeLiters: null,
    volumeSource: 'MANUAL',
    shelfLifeUntil: null,
    needsChestnyZnak: false,
    isUnmarked: false,
    needsLabel: false,
    needsRelabel: false,
    isDraft: false,
    draftSource: null,
    marketplace: null,
    marketplaceProductId: null,
    marketplaceOfferId: null,
    marketplacePayload: null,
    marketplaceSyncedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    barcodes: [],
  };
}

type WarehouseAuxiliaryData = {
  mapping: Map<string, Set<string>>;
  boxToPallet: Map<string, string>;
  shk: Map<string, WarehouseShkRecord>;
};

type WarehouseShkRecord = {
  brand: string;
  ip: string;
  name: string;
  article: string;
  wbArticle: string;
  color: string;
  size: string;
  barcode: string;
};

type WarehouseDemand = {
  orderId: string;
  skuId: string | null;
  artSeller: string;
  barcode: string;
  size: string;
  name: string;
  city: string;
  needsRelabel: boolean;
  relabelSourceBarcode: string;
  relabelTargetBarcode: string;
  required: number;
  remaining: number;
};

type WarehouseInventoryItem = {
  id: string;
  box: string;
  pallet: string;
  skuId: string;
  barcode: string;
  artWarehouse: string;
  name: string;
  size: string;
  quantity: number;
  originalQuantity: number;
  suitableDemands: string[];
};

type WarehouseAction = {
  city: string;
  sourceBox: string;
  pallet: string;
  artOnBox: string;
  barcodeOnBox: string;
  targetArt: string;
  targetBarcode: string;
  size: string;
  quantity: number;
  targetBox: string;
  rebrandNote: string;
  note: string;
};

function emptyWarehouseAuxiliaryData(): WarehouseAuxiliaryData {
  return {
    mapping: new Map(),
    boxToPallet: new Map(),
    shk: new Map(),
  };
}

function parseMappingSheet(rows: unknown[][]) {
  const mapping = new Map<string, Set<string>>();
  rows.slice(1).forEach((row) => {
    const target = textCell(row[0]);
    const source = textCell(row[1]);
    if (!target || !source) {
      return;
    }
    addArticleMapping(mapping, target, source);
  });
  return mapping;
}

function addArticleMapping(mapping: Map<string, Set<string>>, targetArticle: string, sourceArticle: string) {
  const target = textCell(targetArticle);
  const source = textCell(sourceArticle);
  if (!target || !source) {
    return;
  }
  mapping.set(target, new Set([...(mapping.get(target) ?? []), source]));
}

function parsePalletSheet(rows: unknown[][]) {
  const result = new Map<string, string>();
  let currentPallet = '';
  rows.forEach((row) => {
    const value = textCell(row[0]);
    if (!value) {
      return;
    }
    if (value.toUpperCase().startsWith('PALLET_SORT')) {
      currentPallet = value;
      return;
    }
    if (currentPallet) {
      result.set(value, currentPallet);
    }
  });
  return result;
}

function parseShkSheet(rows: unknown[][]) {
  const result = new Map<string, WarehouseShkRecord>();
  rows.slice(1).forEach((row) => {
    const record = {
      brand: textCell(row[0]),
      ip: textCell(row[1]),
      name: textCell(row[2]),
      article: textCell(row[3]),
      wbArticle: textCell(row[4]),
      color: textCell(row[5]),
      size: normalizeSize(textCell(row[6])),
      barcode: textCell(row[7]),
    };
    if (record.article) {
      result.set(record.article, record);
    }
    if (record.barcode) {
      result.set(record.barcode, record);
    }
  });
  return result;
}

function buildShkCatalogFromSkus(skus: SkuCatalogForInstruction[]) {
  const result = new Map<string, WarehouseShkRecord>();
  skus.forEach((sku) => {
    const payload = recordFromJson(sku.marketplacePayload);
    const barcode = primaryBarcodeValue(sku) ?? textFromPayload(payload, ['barcode', 'barCode', 'sku', 'offerBarcode']);
    const article = sku.internalSku || sku.article || sku.clientSku || '';
    const wbArticle =
      sku.marketplaceProductId ||
      sku.marketplaceOfferId ||
      textFromPayload(payload, ['nmID', 'nmId', 'imtID', 'imtId', 'vendorCode', 'offerId']) ||
      sku.clientSku ||
      '';
    const record: WarehouseShkRecord = {
      brand: sku.brand || textFromPayload(payload, ['brand', 'brandName']),
      ip: textFromPayload(payload, ['ip', 'seller', 'sellerName', 'supplierName']),
      name: sku.name,
      article,
      wbArticle,
      color: sku.color || textFromPayload(payload, ['color', 'colour', 'colorName']),
      size: normalizeSize(sku.size || textFromPayload(payload, ['size', 'techSize', 'russianSize'])),
      barcode: barcode ?? '',
    };

    [sku.internalSku, sku.article, sku.clientSku, barcode].forEach((key) => {
      const cleaned = textCell(key);
      if (cleaned) {
        result.set(cleaned, record);
      }
    });
  });
  return result;
}

function mergeMissingShkRecords(target: Map<string, WarehouseShkRecord>, fallback: Map<string, WarehouseShkRecord>) {
  fallback.forEach((record, key) => {
    if (!target.has(key)) {
      target.set(key, record);
    }
  });
}

function parseRequestItemComment(comment: string | null) {
  const result = {
    city: '',
    artSeller: '',
    size: '',
    needsRelabel: false,
    relabelSourceBarcode: '',
    relabelTargetBarcode: '',
  };
  if (!comment) {
    return result;
  }

  comment.split(';').forEach((part) => {
    const [rawKey, ...rawValue] = part.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(':').trim();
    if (key === 'город') {
      result.city = value;
    } else if (key === 'артикул продавца') {
      result.artSeller = value;
    } else if (key === 'размер') {
      result.size = value;
    } else if (key === 'перемаркировка') {
      result.needsRelabel = ['да', 'true', '1', 'yes'].includes(value.toLowerCase());
    } else if (key === 'перемаркировка из') {
      result.relabelSourceBarcode = value;
      result.needsRelabel = true;
    } else if (key === 'перемаркировка в') {
      result.relabelTargetBarcode = value;
      result.needsRelabel = true;
    }
  });
  return result;
}

function isSuitableForDemand(item: WarehouseInventoryItem, demand: WarehouseDemand, mapping: Map<string, Set<string>>) {
  if (item.skuId === demand.skuId) {
    return true;
  }
  if (isExactBarcodeMatch(item, demand)) {
    return true;
  }
  if (isExactNameMatch(item, demand)) {
    return true;
  }
  const baseArts = mapping.get(demand.artSeller) ?? new Set([demand.artSeller]);
  return baseArts.has(item.artWarehouse) && sizesMatch(item.size, demand.size);
}

function actionFromAssignment(
  item: WarehouseInventoryItem,
  demand: WarehouseDemand,
  quantity: number,
  targetBox: string,
  rebrandNote: string,
  note: string,
): WarehouseAction {
  return {
    city: demand.city,
    sourceBox: item.box,
    pallet: item.pallet,
    artOnBox: item.artWarehouse,
    barcodeOnBox: item.barcode,
    targetArt: demand.artSeller,
    targetBarcode: demand.relabelTargetBarcode || demand.barcode,
    size: item.size || demand.size,
    quantity,
    targetBox,
    rebrandNote,
    note,
  };
}

function balanceAction(item: WarehouseInventoryItem): WarehouseAction {
  return {
    city: '',
    sourceBox: item.box,
    pallet: item.pallet,
    artOnBox: item.artWarehouse,
    barcodeOnBox: item.barcode,
    targetArt: '',
    targetBarcode: '',
    size: item.size,
    quantity: item.quantity,
    targetBox: 'БАЛАНС',
    rebrandNote: '',
    note: 'остаток на складе',
  };
}

function buildWholeBoxes(
  actions: WarehouseAction[],
  boxToPallet: Map<string, string>,
  balanceBoxBySourceBox: Map<string, string>,
): WarehouseWholeBoxRow[] {
  const boxCities = new Map<string, Set<string>>();
  const boxHasMark = new Map<string, boolean>();
  actions.forEach((action) => {
    if (!['ЦЕЛЫЙ', 'МАРК ЦЕЛЫЙ'].includes(action.targetBox) && !balanceBoxBySourceBox.has(action.sourceBox)) {
      return;
    }
    const cities = boxCities.get(action.sourceBox) ?? new Set<string>();
    if (action.city) {
      cities.add(action.city);
    }
    boxCities.set(action.sourceBox, cities);
    if (action.targetBox === 'МАРК ЦЕЛЫЙ') {
      boxHasMark.set(action.sourceBox, true);
    }
  });

  return [...boxCities.entries()]
    .map(([box, cities]) => ({
      box,
      status: balanceBoxBySourceBox.has(box)
        ? 'КОРОБ УЕЗЖАЕТ, ОСТАТОК ПЕРЕЛОЖИТЬ'
        : cities.size === 1
          ? boxHasMark.get(box)
            ? 'МАРК ЦЕЛЫЙ'
            : 'ЦЕЛЫЙ'
          : 'НЕСКОЛЬКО',
      city: cities.size === 1 ? [...cities][0] : cities.size > 1 ? 'РАЗНЫЕ ГОРОДА' : '',
      pallet: actions.find((action) => action.sourceBox === box)?.pallet || boxToPallet.get(box) || '',
      balanceBox: balanceBoxBySourceBox.get(box) ?? '',
    }))
    .sort((left, right) => left.box.localeCompare(right.box, 'ru'));
}

function buildBalanceMoves(
  actions: WarehouseAction[],
  balanceBoxBySourceBox: Map<string, string>,
  boxToPallet: Map<string, string>,
): WarehouseBalanceMoveRow[] {
  return actions
    .filter((action) => action.targetBox === 'БАЛАНС' && balanceBoxBySourceBox.has(action.sourceBox))
    .map((action) => ({
      sourceBox: action.sourceBox,
      newBox: balanceBoxBySourceBox.get(action.sourceBox)!,
      pallet: action.pallet || boxToPallet.get(action.sourceBox) || '',
      artOnBox: action.artOnBox,
      barcodeOnBox: action.barcodeOnBox,
      size: action.size,
      quantity: action.quantity,
      note: 'Остаток переложить в новый короб, исходный короб уезжает.',
    }));
}

function buildBalanceLabels(balanceMoves: WarehouseBalanceMoveRow[], clientName: string): WarehouseBalanceLabelRow[] {
  const sourceByNewBox = new Map<string, string>();
  balanceMoves.forEach((move) => {
    sourceByNewBox.set(move.newBox, move.sourceBox);
  });

  return [...sourceByNewBox.entries()]
    .map(([newBox, sourceBox]) => ({
      newBox,
      sourceBox,
      tspl: balanceBoxTspl(newBox, clientName),
    }))
    .sort((left, right) => left.newBox.localeCompare(right.newBox, 'ru'));
}

function assignBalanceBoxCodes(actions: WarehouseAction[], existingCodes: Set<string>, date: Date) {
  const usedCodes = new Set(existingCodes);
  const result = new Map<string, string>();
  const sourceBoxes = [
    ...new Set(
      actions
        .filter((action) => action.targetBox === 'БАЛАНС' && action.sourceBox)
        .map((action) => action.sourceBox)
        .sort((left, right) => left.localeCompare(right, 'ru')),
    ),
  ];

  let sequence = 1;
  for (const sourceBox of sourceBoxes) {
    let candidate = balanceBoxCode(date, sequence);
    while (usedCodes.has(candidate)) {
      sequence += 1;
      candidate = balanceBoxCode(date, sequence);
    }
    usedCodes.add(candidate);
    result.set(sourceBox, candidate);
    sequence += 1;
  }

  return result;
}

function balanceBoxPrefix(date: Date) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value ?? String(date.getDate()).padStart(2, '0');
  const month = parts.find((part) => part.type === 'month')?.value ?? String(date.getMonth() + 1).padStart(2, '0');
  return `FFL_BAL${day}${month}_`;
}

function balanceBoxCode(date: Date, sequence: number) {
  return `${balanceBoxPrefix(date)}${String(sequence).padStart(2, '0')}`;
}

function warehouseActionComment(
  action: WarehouseAction,
  usedShipmentBoxes: Set<string>,
  balanceBoxBySourceBox: Map<string, string>,
  wholeBoxCities: Map<string, Set<string>>,
) {
  if (action.targetBox === 'БАЛАНС') {
    return 'ПЕРЕЛОЖИТЬ ОСТАТОК';
  }

  if (usedShipmentBoxes.has(action.sourceBox) && balanceBoxBySourceBox.has(action.sourceBox)) {
    return `${action.targetBox}; КОРОБ УЕЗЖАЕТ`;
  }

  if (['ЦЕЛЫЙ', 'МАРК ЦЕЛЫЙ'].includes(action.targetBox) && (wholeBoxCities.get(action.sourceBox)?.size ?? 0) > 1) {
    return 'НЕСКОЛЬКО';
  }

  return action.targetBox;
}

function needsWarehouseRelabel(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  if (demand.needsRelabel) {
    return true;
  }
  if (item.skuId === demand.skuId || isExactBarcodeMatch(item, demand) || isExactNameMatch(item, demand)) {
    return false;
  }
  return demand.needsRelabel || Boolean(demand.artSeller && item.artWarehouse !== demand.artSeller);
}

function relabelNote(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  if (!needsWarehouseRelabel(item, demand)) {
    return '';
  }

  const target = demand.artSeller || demand.barcode || item.artWarehouse;
  const targetBarcode = demand.relabelTargetBarcode || target;
  return `перемаркировать ${demand.relabelSourceBarcode || item.barcode || demand.barcode} -> ${targetBarcode}`;
}

function isExactBarcodeMatch(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  return Boolean(item.barcode && demand.barcode && item.barcode === demand.barcode && sizesMatch(item.size, demand.size));
}

function isExactNameMatch(item: WarehouseInventoryItem, demand: WarehouseDemand) {
  return Boolean(item.name && demand.name && item.name === demand.name && sizesMatch(item.size, demand.size));
}

function balanceBoxTspl(boxCode: string, clientName: string) {
  const safeClient = sanitizeTsplText(clientName);
  const safeBox = sanitizeTsplText(boxCode);

  return [
    'SIZE 80 mm,50 mm',
    'GAP 2 mm,0',
    'CLS',
    `TEXT 40,25,"3",0,1,1,"${safeClient}"`,
    `QRCODE 170,80,L,7,A,0,"${safeBox}"`,
    `TEXT 80,310,"3",0,1,1,"${safeBox}"`,
    'PRINT 1',
  ].join('\n');
}

function sanitizeTsplText(value: string) {
  return value.replace(/"/g, '').trim();
}

function buildMarkRows(actions: WarehouseAction[], shk: Map<string, WarehouseShkRecord>): WarehouseMarkRow[] {
  return actions
    .filter((action) => ['МАРК ЦЕЛЫЙ', 'МАРК ПОСТАВКА'].includes(action.targetBox))
    .map((action) => {
      const record = shk.get(action.targetArt) ?? shk.get(action.targetBarcode);
      return {
        comment: action.targetBox,
        city: action.city,
        sourceBox: action.sourceBox,
        brand: record?.brand ?? '',
        ip: record?.ip ?? '',
        name: record?.name ?? '',
        article: action.targetArt,
        wbArticle: record?.wbArticle ?? '',
        color: record?.color ?? '',
        size: action.size,
        barcode: action.targetBarcode,
        quantity: action.quantity,
      };
    });
}

function normalizeSize(value: string | null | undefined) {
  const raw = textCell(value).toUpperCase().replace(/М/g, 'M').replace(/Х/g, 'X');
  const match = raw.match(/\(([^)]+)\)/);
  return (match?.[1] ?? raw).replace(/\s+/g, '');
}

function normalizeName(value: string | null | undefined) {
  return textCell(value).toUpperCase().replace(/\s+/g, ' ');
}

function sizesMatch(left: string, right: string) {
  return !left || !right || left === right;
}

function textCell(value: unknown) {
  return value == null ? '' : String(value).replace(/\.0$/, '').trim();
}

function recordFromJson(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textFromPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = textCell(value);
      if (text) {
        return text;
      }
    }
  }
  return '';
}
