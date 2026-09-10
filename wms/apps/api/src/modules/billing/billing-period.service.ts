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

// ADDED: period orchestration uses existing invoice snapshots/merge rules, not new tariffs.
@Injectable()
export class BillingPeriodService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService, private readonly billing: BillingService) {}

  async previewPeriod(dto: PreviewBillingPeriodDto, user: AuthUser) {
    const warehouseId = this.requireScope(dto, user);
    return this.prisma.$transaction(async tx => (await this.load(tx, dto, user, warehouseId)).plan,
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
          sourceKey: `billing-period:${operationId}:${group.category}:${group.clientId}`,
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
    return { clientId: dto.clientId, periodFrom: dto.periodFrom, periodTo: dto.periodTo, categories: [...dto.categories].sort(), excludeLukin: dto.excludeLukin === true };
  }
  private requireScope(dto: PreviewBillingPeriodDto, user: AuthUser) {
    if (!user.permissionCodes.some(p => p === 'system:admin' || p === 'billing:write')) throw new ForbiddenException('Нет права формирования счетов.');
    if (!user.activeWarehouseId) throw new BadRequestException('Выберите филиал для формирования счетов.');
    if (!user.permissionCodes.includes('system:admin') && !user.writableWarehouseIds?.includes(user.activeWarehouseId)) throw new ForbiddenException('Нет права записи в выбранном филиале.');
    if (dto.clientId) this.scopes.requireClientAccess(user, dto.clientId, 'write');
    parseBillingPeriod(dto.periodFrom, dto.periodTo);
    return user.activeWarehouseId;
  }
  private async load(tx: Prisma.TransactionClient, dto: PreviewBillingPeriodDto, user: AuthUser, warehouseId: string) {
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
    return { charges: visibleCharges, invoices: visibleInvoices, plan: buildPeriodPlan(this.input(dto), visibleCharges, visibleInvoices, warehouseId) };
  }
}
