import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRequestStatus, ClientRequestType, MovementType } from '@prisma/client';
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

type TsdRequestStage = 'box-search' | 'relabel' | 'moves' | 'boxless-packing';

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
      requestId: request.id,
      title: request.title,
      name: request.title,
      status: request.status,
      city: request.destinationCity,
      destinationCity: request.destinationCity,
      deliveryCity: request.destinationCity,
      cityName: request.destinationCity,
      destination: request.destinationCity,
      deliveryDestination: request.destinationCity,
      desiredDate: request.desiredDate?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      client: request.client,
      rowsCount: request._count.items,
      itemsCount: request._count.items,
      itemCount: request._count.items,
      linesCount: request._count.items,
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

  async getRequestStage(requestId: string, stage: TsdRequestStage, user: AuthUser) {
    const plan = await this.getRequestPlan(requestId, user);
    return stagePayload(plan, stage);
  }

  async handleStageAction(
    requestId: string,
    stage: TsdRequestStage,
    action: string,
    body: Record<string, unknown> | string | undefined,
    user: AuthUser,
  ) {
    const plan = await this.getRequestPlan(requestId, user);
    const scannedCode = scannedValue(body);
    const result = validateStageAction(plan, stage, action, scannedCode);
    const stageData = stagePayload(plan, stage);

    return {
      ...stageData,
      ...result,
      requestId,
      stage,
      action,
      scannedCode,
      deviceCode: isRecord(body) ? textValue(body, 'deviceCode') : undefined,
      serverTime: new Date().toISOString(),
      plan: stageData,
    };
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

  private async toTsdPlan(document: PickInstructionDocument & { html?: string }) {
    const completedTsdStatuses: ClientRequestStatus[] = [ClientRequestStatus.PACKED, ClientRequestStatus.DONE];
    const isCompletedForTsd = completedTsdStatuses.includes(document.requestStatus);
    const rawSearchBoxCodes = uniqueSorted([
      ...document.warehouseRows.map((row) => row.sourceBox),
      ...document.warehouseBalanceMoves.map((row) => row.sourceBox),
      ...document.warehouseWholeBoxes.map((row) => row.box),
    ]);
    const movementTargetBoxes = new Set(document.warehouseBalanceMoves.map((row) => normalizeBoxCode(row.newBox)).filter(Boolean));
    const completedMoveTargetBoxes = await this.loadCompletedMoveTargetBoxes(document, rawSearchBoxCodes);
    completedMoveTargetBoxes.forEach((boxCode) => movementTargetBoxes.add(boxCode));
    const searchBoxes = isCompletedForTsd
      ? []
      : rawSearchBoxCodes
          .filter((boxCode) => shouldShowInTsdBoxSearch(boxCode, movementTargetBoxes))
          .map((boxCode) => boxEntry(boxCode));

    const relabelTasks = isCompletedForTsd
      ? []
      : collapseRows(
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

    const movementTasks = isCompletedForTsd
      ? []
      : collapseRows(
          document.warehouseBalanceMoves
            .filter(
              (row) =>
                row.sourceBox &&
                row.newBox &&
                row.quantity > 0 &&
                !completedMoveTargetBoxes.has(normalizeBoxCode(row.sourceBox)),
            )
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
    const searchBoxCodes = searchBoxes.map((box) => box.boxCode);

    const requestRows = document.rows.map((row) => ({
      id: row.itemId,
      itemId: row.itemId,
      skuId: row.skuId,
      internalSku: row.internalSku,
      name: row.name,
      barcode: row.barcode,
      quantity: row.requestedQuantity,
      requestedQuantity: row.requestedQuantity,
      allocatedQuantity: row.allocatedQuantity,
      shortageQuantity: row.shortageQuantity,
      status: row.status,
      statusLabel: row.statusLabel,
      comment: row.comment,
      allocations: row.allocations,
    }));

    return {
      id: document.requestId,
      requestId: document.requestId,
      title: document.requestTitle,
      name: document.requestTitle,
      status: document.requestStatus,
      statusLabel: document.requestStatusLabel,
      city: document.destinationCity,
      destinationCity: document.destinationCity,
      deliveryCity: document.destinationCity,
      cityName: document.destinationCity,
      destination: document.destinationCity,
      deliveryDestination: document.destinationCity,
      desiredDate: document.desiredDate,
      client: document.client,
      rowsCount: document.rowsCount,
      itemsCount: document.rowsCount,
      itemCount: document.rowsCount,
      linesCount: document.rowsCount,
      totalRequested: document.totalRequested,
      totalQuantity: document.totalRequested,
      requestedQuantity: document.totalRequested,
      boxesTotal: searchBoxes.length,
      boxesCount: searchBoxes.length,
      relabelTotal: totalRelabel,
      relabelCount: totalRelabel,
      movementTotal: totalMove,
      movementCount: totalMove,
      rows: requestRows,
      items: requestRows,
      requestRows,
      searchBoxes,
      boxesToSearch: searchBoxes,
      boxesToFind: searchBoxes,
      searchTasks: searchBoxes,
      boxTasks: searchBoxes,
      boxCodes: searchBoxCodes,
      searchBoxCodes,
      boxesToSearchCodes: searchBoxCodes,
      boxesToFindCodes: searchBoxCodes,
      remainingBoxCodes: searchBoxCodes,
      remainingBoxes: searchBoxes,
      remainingBoxTasks: searchBoxes,
      remainingCount: searchBoxes.length,
      remaining: searchBoxes.length,
      remainingBoxesCount: searchBoxes.length,
      foundCount: 0,
      found: 0,
      relabelTasks,
      relabelBoxes: groupTasksByBox(relabelTasks),
      movementTasks,
      moveTasks: movementTasks,
      movementBoxes: groupTasksByBox(movementTasks),
    };
  }

  private async loadCompletedMoveTargetBoxes(document: PickInstructionDocument, boxCodes: string[]) {
    const normalizedBoxCodes = boxCodes.map((boxCode) => boxCode.trim()).filter(Boolean);
    if (normalizedBoxCodes.length === 0 || !document.requestTitle.trim()) {
      return new Set<string>();
    }

    const rows = await this.prisma.stockMovement.findMany({
      where: {
        clientId: document.client.id,
        type: MovementType.MOVE,
        quantity: { gt: 0 },
        comment: { contains: document.requestTitle },
        box: { code: { in: normalizedBoxCodes } },
      },
      select: {
        box: { select: { code: true } },
      },
    });

    return new Set(
      rows
        .map((row) => normalizeBoxCode(row.box?.code))
        .filter((boxCode): boxCode is string => Boolean(boxCode)),
    );
  }
}

type CollapsibleRow = {
  sourceBox: string;
  quantity: number;
};

function stagePayload(plan: Record<string, any>, stage: TsdRequestStage) {
  const requestRows = plan.requestRows ?? plan.rows ?? [];
  const base = {
    ...plan,
    stage,
    requestId: plan.requestId ?? plan.id,
    destinationCity: plan.destinationCity ?? plan.city ?? null,
    deliveryCity: plan.deliveryCity ?? plan.destinationCity ?? plan.city ?? null,
    city: plan.city ?? plan.destinationCity ?? null,
    cityName: plan.cityName ?? plan.destinationCity ?? plan.city ?? null,
    destination: plan.destination ?? plan.destinationCity ?? plan.city ?? null,
    deliveryDestination: plan.deliveryDestination ?? plan.destinationCity ?? plan.city ?? null,
    rowsCount: plan.rowsCount ?? requestRows.length,
    itemsCount: plan.itemsCount ?? plan.rowsCount ?? requestRows.length,
    itemCount: plan.itemCount ?? plan.rowsCount ?? requestRows.length,
    linesCount: plan.linesCount ?? plan.rowsCount ?? requestRows.length,
    rows: requestRows,
    items: requestRows,
  };

  if (stage === 'box-search') {
    const tasks = normalizeBoxTasks(plan.searchBoxes ?? []);
    const boxCodes = tasks.map((box) => box.boxCode);
    return {
      ...base,
      tasks,
      boxes: tasks,
      boxTasks: tasks,
      searchBoxes: tasks,
      boxesToSearch: tasks,
      boxesToFind: tasks,
      boxCodes,
      searchBoxCodes: boxCodes,
      boxesToSearchCodes: boxCodes,
      boxesToFindCodes: boxCodes,
      remainingBoxCodes: boxCodes,
      total: tasks.length,
      totalCount: tasks.length,
      foundCount: 0,
      found: 0,
      remainingCount: tasks.length,
      remaining: tasks.length,
      remainingBoxesCount: tasks.length,
      foundBoxes: [],
      remainingBoxes: tasks,
      remainingBoxTasks: tasks,
    };
  }

  if (stage === 'relabel') {
    const tasks = plan.relabelTasks ?? [];
    return {
      ...base,
      tasks,
      relabelTasks: tasks,
      boxes: groupTasksByBox(tasks),
      relabelBoxes: groupTasksByBox(tasks),
      total: tasks.reduce((sum: number, row: { quantity?: number }) => sum + (row.quantity ?? 0), 0),
      totalCount: tasks.length,
      doneCount: 0,
      remainingCount: tasks.length,
    };
  }

  if (stage === 'moves') {
    const tasks = plan.movementTasks ?? [];
    return {
      ...base,
      tasks,
      movementTasks: tasks,
      moveTasks: tasks,
      boxes: groupTasksByBox(tasks),
      movementBoxes: groupTasksByBox(tasks),
      total: tasks.reduce((sum: number, row: { quantity?: number }) => sum + (row.quantity ?? 0), 0),
      totalCount: tasks.length,
      doneCount: 0,
      remainingCount: tasks.length,
    };
  }

  return {
    ...base,
    tasks: requestRows,
    total: plan.totalRequested ?? plan.totalQuantity ?? 0,
    totalCount: requestRows.length,
    packedCount: 0,
    closedBoxes: [],
  };
}

function normalizeBoxTasks(values: Array<{ boxCode?: string; code?: string } | string>) {
  return values
    .map((value) => (typeof value === 'string' ? boxEntry(value) : boxEntry(value.boxCode ?? value.code ?? '')))
    .filter((box) => box.boxCode);
}

function normalizeBoxCode(value?: string | null) {
  return safeDecode(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .toLocaleLowerCase('ru-RU');
}

function shouldShowInTsdBoxSearch(boxCode: string, movementTargetBoxes: Set<string>) {
  const normalized = normalizeBoxCode(boxCode);
  if (!normalized) {
    return false;
  }

  if (movementTargetBoxes.has(normalized)) {
    return false;
  }

  return true;
}

function boxEntry(boxCode: string) {
  const code = boxCode.trim();
  return {
    boxCode: code,
    code,
    number: code,
    name: code,
    title: code,
    label: code,
    value: code,
    found: false,
    isFound: false,
  };
}

function validateStageAction(plan: Record<string, any>, stage: TsdRequestStage, action: string, scannedCode?: string) {
  const code = normalizeScanCode(scannedCode);

  if (stage === 'box-search' && action === 'scan') {
    if (!code) {
      return actionResult('REJECTED', false, 'Не прочитан номер короба.');
    }
    const found = (plan.searchBoxes ?? []).some((box: { boxCode?: string }) => sameCode(box.boxCode, code));
    return actionResult(found ? 'FOUND' : 'NOT_REQUIRED', found, found ? 'Короб найден.' : 'Короб не участвует в этой заявке.');
  }

  if (stage === 'relabel' && action === 'scan-source') {
    const found = (plan.relabelTasks ?? []).some((task: { oldBarcode?: string; barcode?: string }) =>
      sameCode(task.oldBarcode ?? task.barcode, code),
    );
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Старый штрихкод принят.' : 'Неверный старый штрихкод для перемаркировки.');
  }

  if (stage === 'relabel' && action === 'scan-target') {
    const found = (plan.relabelTasks ?? []).some((task: { newBarcode?: string; barcode?: string }) =>
      sameCode(task.newBarcode ?? task.barcode, code),
    );
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Новый штрихкод принят.' : 'Неверный новый штрихкод для перемаркировки.');
  }

  if (stage === 'moves' && action === 'scan-item') {
    const found = (plan.movementTasks ?? []).some((task: { barcode?: string }) => sameCode(task.barcode, code));
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Товар для перемещения принят.' : 'Товар не найден в списке перемещений.');
  }

  if (stage === 'boxless-packing' && action === 'scan-item') {
    const rows = plan.requestRows ?? plan.rows ?? [];
    const found = rows.some((row: { barcode?: string }) => sameCode(row.barcode, code));
    return actionResult(found ? 'ACCEPTED' : 'REJECTED', found, found ? 'Товар принят в короб.' : 'Товар не найден в заявке.');
  }

  return actionResult('ACCEPTED', true, 'Операция принята.');
}

function actionResult(status: string, accepted: boolean, message: string) {
  return {
    status,
    result: status,
    accepted,
    ok: accepted,
    success: accepted,
    valid: accepted,
    isValid: accepted,
    matched: accepted,
    match: accepted,
    isMatched: accepted,
    found: accepted,
    isFound: accepted,
    needed: accepted,
    required: accepted,
    notRequired: !accepted,
    rejected: !accepted,
    error: !accepted,
    isError: !accepted,
    message,
  };
}

function groupTasksByBox<T extends { sourceBox?: string; quantity?: number }>(tasks: T[]) {
  const byBox = new Map<string, { boxCode: string; sourceBox: string; remaining: number; quantity: number; tasks: T[] }>();
  for (const task of tasks) {
    const sourceBox = task.sourceBox?.trim();
    if (!sourceBox) {
      continue;
    }
    const current = byBox.get(sourceBox) ?? { boxCode: sourceBox, sourceBox, remaining: 0, quantity: 0, tasks: [] };
    current.remaining += task.quantity ?? 0;
    current.quantity += task.quantity ?? 0;
    current.tasks.push(task);
    byBox.set(sourceBox, current);
  }
  return [...byBox.values()].sort((left, right) => left.sourceBox.localeCompare(right.sourceBox, 'ru', { numeric: true }));
}

function scannedValue(body: Record<string, unknown> | string | undefined) {
  if (typeof body === 'string') {
    return body.trim() || undefined;
  }
  if (!body) {
    return undefined;
  }

  for (const key of [
    'boxCode',
    'box_code',
    'box-code',
    'box',
    'boxNo',
    'boxNum',
    'boxId',
    'boxNumber',
    'boxBarcode',
    'boxQr',
    'boxQrCode',
    'boxQRCode',
    'packageCode',
    'package',
    'targetBoxCode',
    'targetBox',
    'sourceBox',
    'barcode',
    'barCode',
    'barcodeText',
    'oldBarcode',
    'newBarcode',
    'sourceBarcode',
    'targetBarcode',
    'itemBarcode',
    'code',
    'value',
    'scan',
    'scanCode',
    'scanData',
    'scanText',
    'scanValue',
    'scanResult',
    'scannedCode',
    'scannedValue',
    'qr',
    'qrCode',
    'qrText',
    'raw',
    'rawValue',
    'rawText',
    'text',
    'serial',
  ]) {
    const value = textValue(body, key);
    if (value) {
      return value;
    }
  }

  const payload = body?.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return scannedValue(payload as Record<string, unknown>);
  }

  for (const [key, value] of Object.entries(body)) {
    if (looksLikeScannedKey(key, value)) {
      return key.trim();
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textValue(body: Record<string, unknown> | undefined, key: string) {
  const value = body?.[key];
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value).trim();
  }
  return undefined;
}

function normalizeScanCode(value?: string) {
  return safeDecode(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .toLocaleLowerCase('ru-RU');
}

function sameCode(left?: string | null, right?: string) {
  const leftCode = normalizeScanCode(left ?? undefined);
  const rightCode = normalizeScanCode(right);
  const leftCompact = compactScanCode(leftCode);
  const rightCompact = compactScanCode(rightCode);
  return Boolean(
    leftCode &&
      rightCode &&
      (leftCode === rightCode ||
        rightCode.includes(leftCode) ||
        leftCode.includes(rightCode) ||
        (leftCompact && rightCompact && (leftCompact === rightCompact || rightCompact.includes(leftCompact) || leftCompact.includes(rightCompact)))),
  );
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function compactScanCode(value: string) {
  return value.replace(/[^0-9a-zа-я]+/giu, '');
}

function looksLikeScannedKey(key: string, value: unknown) {
  const normalizedKey = key.trim();
  if (!normalizedKey || normalizedKey.length < 3) {
    return false;
  }
  if (['deviceCode', 'device', 'token', 'stage', 'action'].includes(normalizedKey)) {
    return false;
  }
  return value === '' || value == null || value === true || typeof value === 'number';
}

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
