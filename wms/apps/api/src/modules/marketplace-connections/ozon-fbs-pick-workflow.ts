import { BadRequestException, ConflictException } from '@nestjs/common';
import { reconcileFbsRequestStatus } from '../../common/stock/fbs-request-auto-status';
import {
  OzonPickState, ozonPickLinesEnabled, ozonPostingProducts, resolveOzonLineSku,
  readOzonPickState, writeOzonPickState, ozonActiveLine, ozonPickCount, ozonPickTotal,
  recordOzonLineScan, requireOzonLineComposition,
} from './ozon-fbs-pick-lines';

const NO_BOX = 'БЕЗ КОРОБА';
const closed = ['DONE', 'CANCELLED', 'REJECTED'];
const singleProductUntil = new WeakMap<object, Map<string, number>>();
type Action = 'view' | 'code' | 'barcode' | 'box' | 'complete';

async function requireRequestCapacity(tx: any, task: any, state: OzonPickState) {
  const others = await tx.fbsTsdAssembly.findMany({ where: { requestId: task.requestId, status: 'COMPLETED', id: { not: task.id } } });
  const used = new Map<string, number>();
  for (const other of others) {
    const lines = other.marketplace === 'OZON' ? await readOzonPickState(tx, other.id) : null;
    if (lines) for (const line of lines.lines) used.set(line.requestItemId, (used.get(line.requestItemId) ?? 0) + line.picks.length);
    else used.set(other.requestItemId, (used.get(other.requestItemId) ?? 0) + other.itemCount);
  }
  for (const line of state.lines) {
    const item = await tx.clientRequestItem.findUnique({ where: { id: line.requestItemId } });
    if (!item || item.requestId !== task.requestId || item.skuId !== line.skuId ||
      (used.get(line.requestItemId) ?? 0) + line.quantity > item.quantity) {
      throw new ConflictException('Количество по позиции уже собрано или состав заявки изменился. Нужна сверка WMS.');
    }
  }
}

// FIX: serialize request/assembly changes in the same order as the existing completion path.
async function locked<T>(service: any, task: any, user: any, operation: (tx: any, fresh: any) => Promise<T>): Promise<T> {
  return service.prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${task.requestId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FbsTsdAssembly" WHERE id=${task.id} FOR UPDATE`;
    const fresh = await tx.fbsTsdAssembly.findUnique({ where: { id: task.id } });
    if (fresh?.status === 'COMPLETED') {
      if (fresh.workerUserId !== user.id || fresh.deviceCode !== service.fbsTsdDeviceCode(undefined, user)) throw new ConflictException('Задание принадлежит другому сотруднику.');
    } else service.requireCurrentFbsTsdLease(fresh, user);
    const request = await tx.clientRequest.findUnique({ where: { id: task.requestId } });
    if (!request || request.clientId !== task.clientId || closed.includes(request.status)) {
      throw new ConflictException('Заявка закрыта или изменена. Обновите очередь.');
    }
    if (!['IN_PROGRESS', 'COMPLETED'].includes(fresh.status)) throw new ConflictException('Задание отложено или требует решения менеджера.');
    if (fresh.requestId !== task.requestId || fresh.connectionId !== task.connectionId || fresh.clientId !== task.clientId || fresh.orderId !== task.orderId) {
      throw new ConflictException('Задание изменилось. Обновите очередь.');
    }
    return operation(tx, fresh);
  });
}

async function initialize(service: any, task: any, user: any): Promise<OzonPickState | null> {
  const saved = await readOzonPickState(service.prisma, task.id);
  if (saved) return saved;
  const cache = singleProductUntil.get(service) ?? new Map<string, number>();
  singleProductUntil.set(service, cache);
  if (task.itemCount < 2 || (cache.get(task.id) ?? 0) > Date.now()) return null;
  if (task.status === 'COMPLETED') return null; // Historical owner confirmations must not be reinterpreted as new scans.
  const posting = await service.readOzonFbsPickPosting(task);
  const products = ozonPostingProducts(posting);
  if (products.length < 2) {
    if (cache.size >= 1000) cache.clear();
    cache.set(task.id, Date.now() + 60_000);
    return null;
  }
  if (posting.status !== 'awaiting_packaging' || task.marketplaceSubmittedAt || task.kiz || task.relabelRequired || task.requiresKiz) {
    throw new BadRequestException('Многотоварный заказ уже передан или требует маркировки/переклейки. Нужна проверка администратора.');
  }
  if (posting.requirements?.products_requiring_mandatory_mark?.length) throw new BadRequestException('Ozon требует КИЗ: нужна отдельная проверка многотоварного заказа.');
  const catalog = await service.prisma.sku.findMany({ where: { clientId: task.clientId }, include: { barcodes: true } });
  const resolved = products.map(product => ({ product, sku: resolveOzonLineSku(product, catalog) }));
  if (resolved[0].sku.id !== task.skuId || products.reduce((n, p) => n + p.quantity, 0) !== task.itemCount) {
    throw new ConflictException('Состав заказа отличается от заявки WMS. Сначала обновите заявку.');
  }
  if (new Set(resolved.map(row => row.sku.id)).size !== resolved.length) throw new ConflictException('Разные строки Ozon сопоставлены одному товару WMS. Проверьте соответствия.');
  return locked(service, task, user, async (tx, fresh) => {
    const existing = await readOzonPickState(tx, task.id);
    if (existing) return existing;
    if (fresh.status !== 'IN_PROGRESS' || fresh.marketplaceSubmittedAt || fresh.kiz || fresh.relabelRequired || fresh.completedAt) throw new ConflictException('Задание изменилось. Обновите очередь.');
    const firstItem = await tx.clientRequestItem.findUnique({ where: { id: fresh.requestItemId } });
    const delta = fresh.itemCount - products[0].quantity;
    if (!firstItem || firstItem.requestId !== fresh.requestId || firstItem.skuId !== resolved[0].sku.id || firstItem.quantity < fresh.itemCount) {
      throw new ConflictException('Количество первой позиции уже изменено. Нужна сверка заявки.');
    }
    // Replace this order's old first-product contribution, preserving other orders sharing the item.
    await tx.clientRequestItem.update({ where: { id: firstItem.id }, data: { quantity: { decrement: delta } } });
    const state: OzonPickState = {
      version: 1, lines: [], source: null, submission: 'PICKING',
      legacyScansDiscarded: Boolean(fresh.barcode || fresh.scannedItemCount),
    };
    for (const [index, { product, sku }] of resolved.entries()) {
      const existingItem = index === 0 ? firstItem : await tx.clientRequestItem.findFirst({ where: { requestId: fresh.requestId, skuId: sku.id } });
      const item = index === 0 ? firstItem : existingItem ? await tx.clientRequestItem.update({ where: { id: existingItem.id }, data: { quantity: { increment: product.quantity } } }) : await tx.clientRequestItem.create({ data: {
        requestId: fresh.requestId, skuId: sku.id, barcode: sku.barcodes[0].value,
        name: sku.name, quantity: product.quantity, comment: `Ozon ${fresh.orderId}; строка ${product.productId}`,
      } });
      state.lines.push({ ...product, skuId: sku.id, requestItemId: item.id, name: sku.name,
        article: sku.article || sku.clientSku || sku.internalSku, barcodes: sku.barcodes.map((b: any) => b.value), picks: [] });
    }
    await writeOzonPickState(tx, task.id, state);
    await tx.clientRequestEvent.create({ data: {
      requestId: fresh.requestId, clientId: fresh.clientId, eventType: 'COMMENT', createdByUserId: user.id,
      title: 'Ozon: включён отбор по товарным строкам',
      body: JSON.stringify({ orderId: task.orderId, previousBarcode: fresh.barcode, previousScannedCount: fresh.scannedItemCount ?? null,
        reason: 'Общий старый счётчик не подтверждает состав. Необходимо повторить сканы каждого артикула.',
        lines: state.lines.map(l => ({ skuId: l.skuId, quantity: l.quantity, requestItemId: l.requestItemId })) }),
    } });
    await tx.fbsTsdAssembly.update({ where: { id: task.id }, data: {
      barcode: null, boxId: null, boxCode: null, sourceBoxPending: true, errorMessage: null,
    } });
    // Preserve the old header as order identity; only the per-line ledger proves physical picks.
    return state;
  });
}

async function locations(service: any, task: any, state: OzonPickState) {
  const line = ozonActiveLine(state);
  if (!line) return [];
  const warehouseId = await service.resolveFbsTsdExpectedWarehouseId(task);
  if (!warehouseId) throw new ConflictException('Не определён склад исполнения заявки.');
  const rows = await service.prisma.stockBalance.findMany({ where: {
    clientId: task.clientId, warehouseId, skuId: line.skuId, status: 'AVAILABLE', quantity: { gt: 0 },
    boxId: { not: null }, box: { status: { notIn: ['archived', 'deleted'] } },
  }, select: { boxId: true, quantity: true, box: { select: { code: true, storagePlacement: { include: { pallet: { include: { zone: true } } } } } } } });
  const boxes = new Map<string, any>();
  for (const row of rows) {
    const previous = boxes.get(row.boxId);
    boxes.set(row.boxId, { id: row.boxId, code: row.box.code, quantity: (previous?.quantity ?? 0) + row.quantity,
      placement: row.box.storagePlacement });
  }
  const reservations = await service.fbsTsdReservationRowsBySku({ clientId: task.clientId, skuIds: [line.skuId], excludeTaskId: task.id });
  for (const box of boxes.values()) {
    box.quantity -= line.picks.filter(p => p.boxId === box.id).length;
    box.quantity -= (reservations.get(line.skuId) ?? []).filter((r: any) => (r.boxId ?? r.reservedBoxId) === box.id).reduce((n: number, r: any) => n + r.itemCount, 0);
  }
  return [...boxes.values()].filter(box => box.quantity > 0).sort((a, b) => a.code.localeCompare(b.code));
}

async function render(service: any, task: any, state: OzonPickState, message: string) {
  const active = ozonActiveLine(state), line = active ?? state.lines[state.lines.length - 1];
  const [client, request, totals, completed, boxes] = await Promise.all([
    service.prisma.client.findUnique({ where: { id: task.clientId }, select: { id: true, code: true, name: true } }),
    service.prisma.clientRequest.findUnique({ where: { id: task.requestId }, select: { number: true } }),
    service.prisma.clientRequestItem.aggregate({ where: { requestId: task.requestId }, _sum: { quantity: true } }),
    service.prisma.fbsTsdAssembly.aggregate({ where: { requestId: task.requestId, status: 'COMPLETED' }, _sum: { itemCount: true } }),
    locations(service, task, state),
  ]);
  const placement = boxes[0]?.placement;
  return {
    state: task.status === 'COMPLETED' ? 'COMPLETED' : !active ? 'READY_TO_COMPLETE' : state.source ? 'SCAN_BARCODE' : 'SCAN_BOX',
    message: message || (state.legacyScansDiscarded && !ozonPickCount(state) ? 'Повторите сканы: прежний общий счётчик не подтверждает разные товары заказа.' : ''),
    task: {
      id: task.id, marketplace: 'OZON', orderId: task.orderId, supplyId: task.supplyId, requestId: task.requestId, client,
      product: { id: line.skuId, name: line.name, article: line.article, barcodes: line.barcodes },
      itemCount: ozonPickTotal(state), scannedItemCount: ozonPickCount(state), perUnitScanning: true,
      ozonLines: state.lines.map(l => ({ article: l.article, quantity: l.quantity, scanned: l.picks.length })),
      activeLineNumber: active ? state.lines.indexOf(active) + 1 : state.lines.length,
      physicalPickConfirmation: true, requiresKiz: false, relabeling: null, orderSticker: null,
      scannedBoxCode: state.source?.boxCode ?? null, sourceWithoutBox: false, sourceBoxPending: state.source?.boxCode === NO_BOX,
      scannedBarcode: !active ? line.picks[line.picks.length - 1]?.barcode : null,
      recommendedBoxCode: boxes[0]?.code ?? null,
      recommendedLocation: placement ? { palletId: placement.palletId, palletCode: placement.pallet.code,
        zoneId: placement.pallet.zoneId, zoneCode: placement.pallet.zone?.code, zoneName: placement.pallet.zone?.name, source: placement.source } : null,
      storageBoxes: boxes.map(b => ({ code: b.code, quantity: b.quantity, status: 'AVAILABLE' })),
      samePalletBoxCodes: [], samePalletRemainingBoxes: 0,
      status: task.status, marketplaceSubmittedAt: task.marketplaceSubmittedAt?.toISOString() ?? null,
      errorMessage: ['UNKNOWN', 'SUBMITTING'].includes(state.submission) ? 'Результат передачи Ozon проверяется. Повторного списания не будет.' : null,
    },
    progress: { requestNumber: request?.number, requestTotalItems: totals._sum.quantity ?? 0,
      requestCompletedItems: completed._sum.itemCount ?? 0,
      requestRemainingItems: Math.max(0, (totals._sum.quantity ?? 0) - (completed._sum.itemCount ?? 0)), recentStickers: [] },
  };
}

async function complete(service: any, task: any, user: any) {
  const prepared = await locked(service, task, user, async (tx, fresh) => {
    const state = (await readOzonPickState(tx, task.id))!;
    if (fresh.status === 'COMPLETED') return { state, alreadyCompleted: true, maySubmit: false };
    if (ozonActiveLine(state)) throw new BadRequestException('Отсканируйте все товарные строки Ozon.');
    await requireRequestCapacity(tx, fresh, state);
    const maySubmit = state.submission === 'PICKING';
    if (maySubmit) {
      state.submission = 'SUBMITTING';
      await writeOzonPickState(tx, task.id, state);
    }
    return { state, alreadyCompleted: false, maySubmit };
  });
  if (prepared.alreadyCompleted) return prepared.state;
  try {
    const posting = await service.readOzonFbsPickPosting(task);
    requireOzonLineComposition(prepared.state, posting);
    if (posting.status === 'awaiting_packaging' && !prepared.maySubmit) {
      throw new ConflictException('Предыдущая отправка Ozon ещё не подтверждена. Обновите позже; повторная отправка остановлена до сверки.');
    }
    if (!['awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered'].includes(posting.status)) {
      throw new ConflictException(`Заказ Ozon изменил статус: ${posting.status}. Нужна сверка уже взятого товара.`);
    }
    // Existing posting/ship transport reads the posting again and validates the durable line ledger.
    if (prepared.maySubmit) await service.submitOzonFbsTask(task);
    else await locked(service, task, user, async (tx, fresh) => {
      await tx.fbsTsdAssembly.update({ where: { id: task.id }, data: { marketplaceSubmittedAt: fresh.marketplaceSubmittedAt ?? new Date(), marketplaceSubmitError: null } });
    });
  } catch (error) {
    // Unknown external result is not a licence to submit again after a timeout/restart.
    await locked(service, task, user, async (tx) => {
      const state = (await readOzonPickState(tx, task.id))!;
      if (state.submission === 'SUBMITTING') { state.submission = 'UNKNOWN'; await writeOzonPickState(tx, task.id, state); }
    });
    throw error;
  }
  const changes: any[] = [];
  const result = await locked(service, task, user, async (tx, fresh) => {
    const state = (await readOzonPickState(tx, task.id))!;
    if (fresh.status === 'COMPLETED') return state;
    await requireRequestCapacity(tx, fresh, state);
    for (const line of state.lines) {
      const item = await tx.clientRequestItem.findUnique({ where: { id: line.requestItemId } });
      if (!item || item.requestId !== fresh.requestId || item.skuId !== line.skuId || item.quantity < line.quantity) {
        throw new ConflictException('Состав заявки изменился. Передача Ozon сохранена; нужна сверка WMS.');
      }
      const boxes = new Map<string, number>();
      for (const pick of line.picks) if (pick.boxId) boxes.set(pick.boxId, (boxes.get(pick.boxId) ?? 0) + 1);
      for (const [boxId, quantity] of boxes) await tx.clientRequestBoxSelection.upsert({
        where: { requestItemId_boxId: { requestItemId: line.requestItemId, boxId } },
        create: { requestItemId: line.requestItemId, skuId: line.skuId, boxId, quantity }, update: { quantity: { increment: quantity } },
      });
    }
    const completedAt = new Date();
    await tx.fbsTsdAssembly.update({ where: { id: task.id }, data: { status: 'COMPLETED', completedAt, errorMessage: null,
      barcode: state.lines[0].picks[0].barcode, sourceBoxPending: state.lines.some(l => l.picks.some(p => !p.boxId)) } });
    state.submission = 'COMPLETED';
    await writeOzonPickState(tx, task.id, state);
    await tx.clientRequestEvent.create({ data: {
      requestId: task.requestId, clientId: task.clientId, eventType: 'COMMENT', createdByUserId: user.id,
      title: 'FBS Ozon: все товарные строки отобраны', body: JSON.stringify({ orderId: task.orderId, lines: state.lines }),
    } });
    // Ozon retains its existing accounting boundary: source selections, no new WB stock-debit path.
    await reconcileFbsRequestStatus(tx, task.requestId, { stage: 'PICK', occurredAt: completedAt, actorId: user.id }, changes);
    return state;
  });
  service.fbsOrdersCache.delete(task.clientId);
  await service.notifyFbsAutoStatusChanges(changes);
  return result;
}

// FIX: called after normal client/device authorization; WB and single-product orders fall through unchanged.
export async function handleOzonPickLines(service: any, task: any, user: any, action: Action, payload: Record<string, unknown> = {}, message = ''): Promise<any> {
  if (!ozonPickLinesEnabled() || task.marketplace !== 'OZON') return null;
  let state = await initialize(service, task, user);
  if (!state) return null;
  if (action === 'complete') state = await complete(service, task, user);
  else if (action !== 'view') {
    state = await locked(service, task, user, async (tx, fresh) => {
      let current = (await readOzonPickState(tx, task.id))!;
      if (fresh.status === 'COMPLETED') return current;
      const code = String(payload.barcode ?? payload.boxCode ?? payload.code ?? '').trim();
      const line = ozonActiveLine(current);
      if (action === 'barcode' || (action === 'code' && /^\d{8,13}$/.test(code))) {
        current = recordOzonLineScan(current, code, payload.scannedItemCount, user.id);
      } else {
        if (!Number.isSafeInteger(payload.scannedItemCount) || Number(payload.scannedItemCount) > ozonPickCount(current)) throw new ConflictException('Обновите задание перед выбором короба.');
        if (Number(payload.scannedItemCount) < ozonPickCount(current)) return current;
        if (!line || current.submission !== 'PICKING') throw new ConflictException('Все товары отобраны или заказ передаётся.');
        if (code.toUpperCase() === NO_BOX) current.source = { boxId: null, boxCode: NO_BOX };
        else {
          const boxes = await locations(service, fresh, current);
          const box = boxes.find(b => b.code.toUpperCase() === code.toUpperCase());
          if (!box) throw new BadRequestException(`В этом коробе нет доступного товара ${line.article}. Отсканируйте короб из маршрута.`);
          current.source = { boxId: box.id, boxCode: box.code };
        }
      }
      await writeOzonPickState(tx, task.id, current);
      // Mark physical activity for the existing stale-lease/offline safeguards.
      await tx.fbsTsdAssembly.update({ where: { id: task.id }, data: { sourceBoxPending: true, errorMessage: null } });
      return current;
    });
  }
  const fresh = await service.prisma.fbsTsdAssembly.findUnique({ where: { id: task.id } });
  return render(service, fresh, state, message);
}
