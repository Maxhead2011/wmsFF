import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { buildSettlements, record, type SettlementWork } from './billing-settlements.policy';
import { invoiceCorrections } from './billing-correction-balance';

export function settlementDates(from: string, to: string) {
  const parse = (s: string, end = false) => {
    const d = new Date(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s)
      throw new BadRequestException('Укажите существующие даты.');
    return d;
  };
  const start = parse(from), end = parse(to, true);
  if (start > end || end.getTime() - start.getTime() > 366 * 86400000) throw new BadRequestException('Выберите период от одного дня до года.');
  return { from: start, to: end };
}

// FIX: independent read-only service; no calls to recovery, billing mutation or marketplace sync.
@Injectable()
export class BillingSettlementsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}
  async list(dto: { periodFrom: string; periodTo: string; clientId?: string }, user: AuthUser, transaction?: Prisma.TransactionClient) {
    if (process.env.WMS_BILLING_SETTLEMENTS_ENABLED !== 'true') return { enabled: false as const };
    if (!user.permissionCodes.some(p => p === 'billing:read' || p === 'system:admin')) throw new ForbiddenException('Нет доступа к биллингу.');
    const warehouseId = user.activeWarehouseId;
    if (!warehouseId) throw new BadRequestException('Выберите филиал.');
    if (!user.permissionCodes.includes('system:admin') && !user.warehouseIds?.includes(warehouseId)) throw new ForbiddenException('Нет доступа к филиалу.');
    const clientId = this.scopes.resolveClientFilter(user, dto.clientId);
    const { from, to } = settlementDates(dto.periodFrom, dto.periodTo);
    // FIX: coverage reads historical charges; production already exceeds 20,000.
    const take = 20001, limit = 20000, chargeLimit = 100000;
    const clientFilter = { id: clientId, isDemo: user.isDemo === true };
    // FIX: close reuses the same scoped projection inside its financial transaction.
    const load = async (tx: Prisma.TransactionClient) => {
      const clients = await tx.client.findMany({ where: clientFilter, select: { id: true, code: true, name: true }, take });
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } });
      if (!warehouse) throw new BadRequestException('Выбранный филиал не найден.');
      const ids = clients.map(c => c.id);
      const [charges, invoices, advances, shipments, current, history, coverageCharges] = await Promise.all([
        // FIX: only period charges need financial/request/invoice relations; historical coverage is loaded separately below.
        tx.billingCharge.findMany({ where: { clientId: { in: ids }, status: { not: 'CANCELLED' }, serviceDate: { gte: from, lte: to } }, take: chargeLimit + 1, orderBy: { id: 'asc' },
          select: { id: true, clientId: true, client: { select: { id: true, code: true, name: true } }, requestId: true,
            request: { select: { id: true, number: true, warehouseId: true } }, status: true, description: true,
            quantity: true, unitPriceRub: true, totalRub: true, serviceDate: true, metadata: true,
            service: { select: { code: true } }, invoiceItems: { select: { invoice: { select: { id: true, status: true } } } } } }),
        tx.billingInvoice.findMany({ where: { clientId: { in: ids }, status: { not: 'CANCELLED' },
          OR: [{ warehouseId }, { warehouseId: null, request: { warehouseId } }, { warehouseId: null, requestId: null }] },
          take, orderBy: { id: 'asc' }, select: { id: true, clientId: true, client: { select: { id: true, code: true, name: true } },
            number: true, warehouseId: true, request: { select: { warehouseId: true, number: true } }, status: true,
            totalRub: true, paidRub: true, dueDate: true,
            payments: { where: { status: 'RECORDED' }, select: { id: true, paidAt: true, amountRub: true } }, items: { select: { chargeId: true, description: true,
              quantity: true, unitPriceRub: true, totalRub: true, serviceDate: true } } } }),
        tx.billingPayment.findMany({ where: { clientId: { in: ids }, invoiceId: null, status: 'RECORDED' },
          select: { id: true, clientId: true, amountRub: true, paidAt: true }, take }),
        tx.wbOrderShipment.findMany({ where: { clientId: { in: ids }, warehouseId, source: { not: 'LEGACY_WMS_SHIPMENT' }, shippedAt: { gte: from, lte: to } },
          select: { assemblyId: true, clientId: true, requestId: true, connectionId: true, orderId: true, quantity: true,
            shippedAt: true, assemblySnapshot: true }, take }),
        tx.fbsTsdAssembly.findMany({ where: { clientId: { in: ids }, marketplace: 'OZON', completedAt: { gte: from, lte: to },
          barcode: { not: null }, boxCode: { not: null }, itemCount: { gt: 0 } },
          select: { id: true, clientId: true, requestId: true, marketplace: true, connectionId: true, orderId: true,
            itemCount: true, completedAt: true }, take }),
        tx.fbsAssemblyAttemptHistory.findMany({ where: { clientId: { in: ids }, completedAt: { gte: from, lte: to } },
          select: { id: true, clientId: true, requestId: true, orderId: true, completedAt: true, taskSnapshot: true }, take }),
        // FIX: retain historical and cross-branch coverage, without loading historical financial relations.
        tx.billingCharge.findMany({ where: { clientId: { in: ids }, status: { not: 'CANCELLED' },
          OR: [{ metadata: { path: ['kind'], equals: 'FBS' } }, { service: { code: 'FBS_PROCESSING' } }] },
          select: { id: true, clientId: true, status: true, metadata: true, service: { select: { code: true } } },
          take: chargeLimit + 1, orderBy: { id: 'asc' } }),
      ]);
      if (charges.length > chargeLimit || coverageCharges.length > chargeLimit || [clients, invoices, advances, shipments, current, history].some(a => a.length > limit))
        throw new BadRequestException('Объём превышает лимит расчёта. Выберите одного клиента или меньший период; неполные суммы не показываются.');
      const work: SettlementWork[] = current.filter(w => w.completedAt).map(w => ({ ...w, completedAt: w.completedAt! }));
      for (const fact of shipments) {
        const m = record(fact.assemblySnapshot);
        work.push({ id: fact.assemblyId, clientId: fact.clientId, requestId: fact.requestId, marketplace: 'WILDBERRIES',
          connectionId: fact.connectionId, orderId: fact.orderId, itemCount: fact.quantity, completedAt: fact.shippedAt,
          ...(typeof m.billingAttemptId === 'string' ? { billingAttemptId: m.billingAttemptId } : {}) });
      }
      for (const fact of history) {
        const m = record(fact.taskSnapshot);
        if (typeof m.marketplace !== 'string' || typeof m.connectionId !== 'string' ||
          typeof m.barcode !== 'string' || !m.barcode || typeof m.boxCode !== 'string' || !m.boxCode ||
          !Number.isSafeInteger(Number(m.itemCount)) || Number(m.itemCount) < 1) continue;
        work.push({ id: fact.id, clientId: fact.clientId, requestId: fact.requestId, marketplace: m.marketplace,
          connectionId: m.connectionId, orderId: fact.orderId, itemCount: Number(m.itemCount), completedAt: fact.completedAt,
          ...(typeof m.billingAttemptId === 'string' ? { billingAttemptId: m.billingAttemptId } : {}) });
      }
      const requestIds = [...new Set(work.map(w => w.requestId))];
      const requests = await tx.clientRequest.findMany({ where: { id: { in: requestIds }, clientId: { in: ids }, warehouseId },
        select: { id: true, number: true, warehouseId: true } });
      return buildSettlements({ warehouseId, warehouseName: warehouse.name, from, to,
        now: new Date(), clients, charges, coverageCharges, invoices, advances, work, requests,
        corrections: await invoiceCorrections(tx, invoices.map(i => i.id)) });
    };
    if (transaction) return load(transaction);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return load(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }
}
