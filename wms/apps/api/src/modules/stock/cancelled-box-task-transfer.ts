import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { CancelledWbTransferInput } from './cancelled-wb-transfer';

type Db = Pick<Prisma.TransactionClient, 'fbsTsdAssembly' | 'productMark' | 'clientMarketplaceConnection'>;
type Parse = (code: string) => { gtin: string; serial: string } | null;
export type CancelledBoxTaskProof = {
  input: CancelledWbTransferInput; fingerprint: string; checkedAt: number;
  taskIds: string[]; connectionId: string;
  orders: Array<{ id: string; supplierStatus: string; wbStatus: string }>;
};
export const cancelledBoxTaskTransferEnabled = () => process.env.WMS_TSD_CANCELLED_BOX_TASK_TRANSFER_ENABLED === 'true';
const STOP = 'Не удалось подтвердить отмену старой сборки этого товара. Перемещение не выполнено.';

async function context(db: Db, input: CancelledWbTransferInput, parse: Parse) {
  const identity = parse(input.scanCode);
  if (!identity || input.availableQuantity < 1 || !input.source.warehouseId) return null;
  const { gtin, serial } = identity;
  const prefixes = [`01${gtin}21${serial}`, `]d201${gtin}21${serial}`, `(01)${gtin}(21)${serial}`,
    `01${gtin}\u001d21${serial}`, `]d201${gtin}\u001d21${serial}`, `01${gtin}<GS>21${serial}`];
  // FIX: only a genuinely unregistered KIZ; existing marks retain all their own restrictions.
  const known = await db.productMark.findFirst({ where: { OR: prefixes.map(prefix => ({ value: { startsWith: prefix } })) }, select: { id: true } });
  if (known) return null;
  const tasks = await db.fbsTsdAssembly.findMany({ where: {
    clientId: input.source.clientId, status: { in: ['IN_PROGRESS', 'RETURN_REQUIRED'] },
    AND: [{ OR: [{ skuId: input.skuId }, { sourceSkuId: input.skuId }] },
      { OR: [{ boxId: input.source.id }, { reservedBoxId: input.source.id }] }],
  }, take: 11, orderBy: { id: 'asc' }, select: { id: true, clientId: true, marketplace: true,
    connectionId: true, orderId: true, status: true, kiz: true, updatedAt: true,
    boxId: true, reservedBoxId: true, skuId: true, sourceSkuId: true } });
  if (!tasks.length) return null;
  if (tasks.length > 10 || tasks.some(task => {
    const previous = parse(task.kiz ?? '');
    return task.status !== 'RETURN_REQUIRED' || task.clientId !== input.source.clientId ||
      task.marketplace !== 'WILDBERRIES' || task.connectionId !== tasks[0].connectionId ||
      !previous || (previous.gtin === gtin && previous.serial === serial);
  })) throw new BadRequestException(STOP);
  return { tasks, fingerprint: createHash('sha256').update(JSON.stringify(tasks)).digest('hex') };
}

export async function prepareCancelledBoxTaskTransfer(db: Db, input: CancelledWbTransferInput, parse: Parse): Promise<CancelledBoxTaskProof | undefined> {
  if (!cancelledBoxTaskTransferEnabled()) return undefined;
  const local = await context(db, input, parse);
  if (!local) return undefined;
  const connectionId = local.tasks[0].connectionId;
  const connection = await db.clientMarketplaceConnection.findUnique({ where: { id: connectionId },
    select: { clientId: true, marketplace: true, isActive: true, apiKey: true } });
  if (!connection?.apiKey || !connection.isActive || connection.clientId !== input.source.clientId || connection.marketplace !== 'WILDBERRIES') throw new BadRequestException(STOP);
  const ids = [...new Set(local.tasks.map(task => task.orderId))];
  if (ids.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw new BadRequestException(STOP);
  let orders: CancelledBoxTaskProof['orders'];
  try {
    // FIX: one bounded read-only WB request, outside the stock transaction; no order/history writes.
    const response = await fetch('https://marketplace-api.wildberries.ru/api/v3/orders/status', {
      method: 'POST', headers: { Authorization: connection.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: ids.map(Number) }), signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('WB unavailable');
    const data = await response.json() as { orders?: Array<{ id?: unknown; supplierStatus?: unknown; wbStatus?: unknown }> };
    orders = ids.map(id => {
      const matches = Array.isArray(data.orders) ? data.orders.filter(row => String(row.id) === id) : [];
      if (matches.length !== 1) throw new Error('Missing WB status');
      const row = matches[0];
      if (typeof row.supplierStatus !== 'string' || typeof row.wbStatus !== 'string') throw new Error('Invalid WB status');
      return { id, supplierStatus: row.supplierStatus, wbStatus: row.wbStatus };
    });
  } catch {
    throw new BadRequestException('Не удалось проверить старую сборку в WB. Повторите сканирование позже; остатки не изменены.');
  }
  if (orders.some(row => !['cancel', 'complete'].includes(row.supplierStatus) ||
      !['canceled', 'canceled_by_client', 'declined_by_client'].includes(row.wbStatus))) throw new BadRequestException(STOP);
  return { input, fingerprint: local.fingerprint, checkedAt: Date.now(),
    taskIds: local.tasks.map(task => task.id), connectionId, orders };
}

export async function validateCancelledBoxTaskTransfer(db: Db, proof: CancelledBoxTaskProof, input: CancelledWbTransferInput, parse: Parse) {
  // FIX: server-local proof only; re-read all competing tasks in the Serializable stock transaction.
  if (!cancelledBoxTaskTransferEnabled() || Date.now() - proof.checkedAt > 15_000 || Date.now() < proof.checkedAt ||
      input.source.id !== proof.input.source.id || input.source.clientId !== proof.input.source.clientId ||
      input.source.warehouseId !== proof.input.source.warehouseId || input.skuId !== proof.input.skuId ||
      JSON.stringify(parse(input.scanCode)) !== JSON.stringify(parse(proof.input.scanCode))) throw new BadRequestException(STOP);
  const local = await context(db, input, parse);
  if (!local || local.fingerprint !== proof.fingerprint) throw new BadRequestException('Сборка изменилась после проверки WB. Повторите сканирование; остатки не изменены.');
}
