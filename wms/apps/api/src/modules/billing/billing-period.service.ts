import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { BillingService } from './billing.service';
import { buildPeriodPlan, parseBillingPeriod } from './billing-period-policy';
import { GenerateBillingPeriodDto, PreviewBillingPeriodDto } from './dto/generate-billing-period.dto';
import { runBillingMutation, withBillingDb } from './billing-mutation';
import { buildDoneRequestsPlan } from './billing-done-requests.policy';

// ADDED: period orchestration uses existing invoice snapshots/merge rules, not new tariffs.
@Injectable()
export class BillingPeriodService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService, private readonly billing: BillingService) {}

  // FIX: separate rollout prevents activating request-based drafts in sold WMS.
  doneRequestsCapabilities() { return { enabled: process.env.WMS_BILLING_DONE_REQUESTS_ENABLED === 'true' }; }

  async previewPeriod(dto: PreviewBillingPeriodDto, user: AuthUser) {
    const warehouseId = this.requireScope(dto, user);
    return this.prisma.$transaction(async tx => {
      // FIX: enforce the new preview's read-only contract at the database boundary.
      if (dto.doneRequests) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return (await this.load(tx, dto, user, warehouseId)).plan;
    },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  async generatePeriod(dto: GenerateBillingPeriodDto, user: AuthUser) {
    const warehouseId = this.requireScope(dto, user);
    // FIX: replay key is bound to user, branch, parameters and confirmed fingerprint.
    const operationId = createHash('sha256').update(JSON.stringify({ userId: user.id, warehouseId, ...this.input(dto), hash: dto.previewHash })).digest('hex');
    return runBillingMutation(this.prisma, async tx => {
      const previous = await tx.auditLog.findFirst({ where: { action: 'billing.period.generate', entityId: operationId, userId: user.id } });
      if (previous) {
        const payload = previous.payload as { invoices: Array<{ id: string; number: string; disposition?: 'CREATED' | 'EXISTING' }> };
        // FIX: replay uses current access, never the permissions saved at creation time.
        const savedInvoices = await tx.billingInvoice.findMany({ where: { id: { in: payload.invoices.map(invoice => invoice.id) } },
          select: { id: true, clientId: true, warehouseId: true, request: { select: { warehouseId: true } } } });
        if (savedInvoices.length !== payload.invoices.length) throw new ConflictException('Один из ранее сформированных счетов больше недоступен. Обновите реестр.');
        for (const invoice of savedInvoices) {
          this.scopes.requireClientAccess(user, invoice.clientId, 'write');
          if ((invoice.warehouseId ?? invoice.request?.warehouseId) !== warehouseId) throw new ForbiddenException('Нет доступа к филиалу ранее сформированного счёта.');
        }
        return { invoices: payload.invoices, replayed: true };
      }
      const initial = await this.load(tx, dto, user, warehouseId);
      // FIX: close surrender/reopening race before confirming a financial snapshot.
      if (dto.doneRequests && 'requests' in initial.plan && initial.plan.requests.length) {
        const requestIds = initial.plan.requests.map(r => r.id).sort();
        await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id IN (${Prisma.join(requestIds)}) ORDER BY id FOR UPDATE`;
      }
      const chargeIds = initial.plan.groups.flatMap(g => g.chargeIds).sort();
      const invoiceIds = initial.plan.groups.flatMap(g => g.invoiceIds).sort();
      if (chargeIds.length) await tx.$queryRaw`SELECT id FROM "BillingCharge" WHERE id IN (${Prisma.join(chargeIds)}) ORDER BY id FOR UPDATE`;
      if (invoiceIds.length) await tx.$queryRaw`SELECT id FROM "BillingInvoice" WHERE id IN (${Prisma.join(invoiceIds)}) ORDER BY id FOR UPDATE`;
      const current = await this.load(tx, dto, user, warehouseId);
      if (current.plan.previewHash !== dto.previewHash) throw new ConflictException('Данные изменились после расчёта. Обновите предварительный расчёт и подтвердите новые суммы.');
      if (!current.plan.groups.length) throw new BadRequestException('Нет проверенных ненулевых начислений или черновиков для формирования.');
      const invoices: Array<{ id: string; number: string; disposition: 'CREATED' | 'EXISTING' }> = [];
      for (const group of current.plan.groups) {
        this.scopes.requireClientAccess(user, group.clientId, 'write');
        const invoice = await withBillingDb(this.billing, tx).writePeriodDraft(tx, {
          clientId: group.clientId, warehouseId, category: group.category,
          periodFrom: dto.periodFrom, periodTo: dto.periodTo,
          sourceKey: dto.doneRequests ? `billing-done-requests:${operationId}:${group.clientId}` : `billing-period:${operationId}:${group.category}:${group.clientId}`,
          ...(dto.doneRequests && 'requests' in current.plan && 'requestIds' in group ? {
            requestNumbers: current.plan.requests.filter(r => group.requestIds.includes(r.id)).map(r => r.number).sort((a, b) => a - b),
          } : {}),
          charges: current.charges.filter(c => group.chargeIds.includes(c.id)),
          invoices: current.invoices.filter(i => group.invoiceIds.includes(i.id)),
        }, user);
        invoices.push({ id: invoice.id, number: invoice.number, disposition: group.action === 'EXISTING' ? 'EXISTING' : 'CREATED' });
      }
      await tx.auditLog.create({ data: { userId: user.id, action: 'billing.period.generate', entity: 'billing-period', entityId: operationId,
        payload: { ...this.input(dto), warehouseId, previewHash: dto.previewHash, invoices, skippedIssues: current.plan.issues.length } } });
      return { invoices, replayed: false };
    });
  }

  private input(dto: PreviewBillingPeriodDto) {
    return { clientId: dto.clientId, periodFrom: dto.periodFrom, periodTo: dto.periodTo, categories: [...dto.categories].sort(), excludeLukin: dto.excludeLukin === true,
      ...(dto.doneRequests ? { doneRequests: true } : {}) };
  }
  private requireScope(dto: PreviewBillingPeriodDto, user: AuthUser) {
    if (dto.doneRequests && !this.doneRequestsCapabilities().enabled) throw new ForbiddenException('Формирование по сданным заявкам ещё не включено.');
    if (!user.permissionCodes.some(p => p === 'system:admin' || p === 'billing:write')) throw new ForbiddenException('Нет права формирования счетов.');
    if (!user.activeWarehouseId) throw new BadRequestException('Выберите филиал для формирования счетов.');
    if (!user.permissionCodes.includes('system:admin') && !user.writableWarehouseIds?.includes(user.activeWarehouseId)) throw new ForbiddenException('Нет права записи в выбранном филиале.');
    if (dto.clientId) this.scopes.requireClientAccess(user, dto.clientId, 'write');
    parseBillingPeriod(dto.periodFrom, dto.periodTo);
    return user.activeWarehouseId;
  }
  private async load(tx: Prisma.TransactionClient, dto: PreviewBillingPeriodDto, user: AuthUser, warehouseId: string) {
    if (dto.doneRequests) return this.loadDoneRequests(tx, dto, user, warehouseId);
    const { from, to } = parseBillingPeriod(dto.periodFrom, dto.periodTo);
    const clientId = this.scopes.resolveClientFilter(user, dto.clientId);
    const client = user.isDemo ? { isDemo: true } : { isDemo: false };
    const [charges, invoices] = await Promise.all([
      tx.billingCharge.findMany({ where: { clientId, client, status: { not: 'CANCELLED' }, serviceDate: { gte: from, lte: to },
        OR: [{ request: { warehouseId } }, { requestId: null }] },
        include: { client: { select: { id: true, code: true, name: true, legalName: true } }, service: { select: { code: true } },
          request: { select: { warehouseId: true } }, invoiceItems: { select: { invoice: { select: { id: true, status: true } } } } },
        orderBy: { id: 'asc' } }),
      tx.billingInvoice.findMany({ where: { clientId, client, status: { not: 'CANCELLED' },
        OR: [{ warehouseId }, { warehouseId: null, request: { warehouseId } }],
        AND: [{ OR: [{ periodFrom: { lte: to }, periodTo: { gte: from } }, { items: { some: { serviceDate: { gte: from, lte: to } } } }] }] },
        include: { client: { select: { id: true, code: true, name: true, legalName: true } }, request: { select: { warehouseId: true } },
          payments: true, items: { include: { charge: { include: { service: { select: { code: true } } } } }, orderBy: { id: 'asc' } } },
        orderBy: { id: 'asc' } }),
    ]);
    // FIX: read-only client access must not become mass write access in preview.
    const writable = (id: string) => {
      try { this.scopes.requireClientAccess(user, id, 'write'); return true; } catch { return false; }
    };
    const visibleCharges = charges.filter(c => writable(c.clientId));
    const visibleInvoices = invoices.filter(i => writable(i.clientId));
    return { charges: visibleCharges, invoices: visibleInvoices, requests: undefined, plan: buildPeriodPlan(this.input(dto), visibleCharges, visibleInvoices, warehouseId) };
  }

  private async loadDoneRequests(tx: Prisma.TransactionClient, dto: PreviewBillingPeriodDto, user: AuthUser, warehouseId: string) {
    const calendar = parseBillingPeriod(dto.periodFrom, dto.periodTo);
    const clientId = this.scopes.resolveClientFilter(user, dto.clientId);
    const client = { isDemo: user.isDemo === true };
    const writable = (id: string) => { try { this.scopes.requireClientAccess(user, id, 'write'); return true; } catch { return false; } };
    // Latest DONE event, including reopened requests: never use updatedAt as surrender date.
    const rows = await tx.clientRequest.findMany({ where: { clientId, client, warehouseId, status: 'DONE' }, take: 10001,
      select: { id: true, number: true, clientId: true, warehouseId: true, status: true, updatedAt: true,
        client: { select: { id: true, code: true, name: true } },
        events: { where: { eventType: 'STATUS_CHANGED', statusTo: 'DONE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
          select: { id: true, createdAt: true } } }, orderBy: { id: 'asc' } });
    if (rows.length > 10000) throw new BadRequestException('Слишком много сданных заявок. Выберите одного клиента.');
    const candidates = rows.filter(r => writable(r.clientId));
    const selected = buildDoneRequestsPlan(dto, candidates, [], [], warehouseId).requests;
    const ids = selected.map(r => r.id);
    const [charges, invoices] = await Promise.all([
      tx.billingCharge.findMany({ where: { requestId: { in: ids }, status: { not: 'CANCELLED' }, clientId, client }, take: 100001, orderBy: { id: 'asc' },
        include: { client: { select: { id: true, code: true, name: true } }, request: { select: { warehouseId: true } },
          service: { select: { code: true } }, invoiceItems: { select: { invoice: { select: { id: true, status: true } } } } } }),
      // Read whole snapshots, including mixed drafts, to reject splitting or duplicate billing.
      tx.billingInvoice.findMany({ where: { clientId, client, status: { not: 'CANCELLED' },
        OR: [{ requestId: { in: ids } }, { items: { some: { charge: { requestId: { in: ids } } } } },
          { AND: [{ periodFrom: { lte: calendar.to }, periodTo: { gte: calendar.from } },
            { OR: [{ warehouseId }, { warehouseId: null, request: { warehouseId } }, { warehouseId: null, requestId: null }] }] }] },
        take: 20001, orderBy: { id: 'asc' }, include: { client: { select: { id: true, code: true, name: true } },
          request: { select: { warehouseId: true } }, payments: true,
          items: { include: { charge: { include: { service: { select: { code: true } } } } }, orderBy: { id: 'asc' } } } }),
    ]);
    if (charges.length > 100000 || invoices.length > 20000) throw new BadRequestException('Объём превышает лимит. Выберите клиента или меньший период.');
    const visibleCharges = charges.filter(c => writable(c.clientId)), visibleInvoices = invoices.filter(i => writable(i.clientId));
    return { charges: visibleCharges, invoices: visibleInvoices, requests: candidates,
      plan: buildDoneRequestsPlan({ clientId: dto.clientId, periodFrom: dto.periodFrom, periodTo: dto.periodTo }, candidates, visibleCharges, visibleInvoices, warehouseId) };
  }
}
