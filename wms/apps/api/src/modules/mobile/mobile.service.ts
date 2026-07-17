import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingInvoiceStatus, ClientRequestStatus, Prisma, StockStatus, TsdOperationStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { MobileDeviceDto } from './dto/mobile-device.dto';
import { MobileEventListDto, MobileListDto } from './dto/mobile-list.dto';

@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
    private readonly warehouse: WarehouseService,
  ) {}

  async bootstrap(user: AuthUser) {
    const clientIds = await this.resolveClientIds(user);
    const [clients, dashboard, appVersion] = await Promise.all([
      this.prisma.client.findMany({
        where: { id: { in: clientIds }, status: { not: 'ARCHIVED' } },
        select: {
          id: true,
          code: true,
          name: true,
          legalName: true,
          status: true,
          onlineReceiptVisibleToClient: true,
          storageAccountingEnabled: true,
          storesWithoutBoxes: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.dashboard(user),
      this.appVersion(),
    ]);

    return {
      user,
      mode: isClientOnly(user) ? 'CLIENT' : 'ADMIN',
      clients,
      dashboard,
      appVersion,
      features: {
        requestCreate: user.permissionCodes.includes('client-requests:write'),
        requestStatus: user.permissionCodes.includes('client-requests:status'),
        onlineReceipts: user.permissionCodes.includes('warehouse:read') || user.permissionCodes.includes('stock:read'),
        billingWrite: user.permissionCodes.includes('billing:write') || user.permissionCodes.includes('system:admin'),
        dangerousActions: user.permissionCodes.includes('system:admin'),
      },
      serverTime: new Date(),
    };
  }

  async dashboard(user: AuthUser, clientId?: string) {
    const clientIds = await this.resolveClientIds(user, clientId);
    if (clientIds.length === 0) {
      return emptyDashboard();
    }

    const requestWhere: Prisma.ClientRequestWhereInput = { clientId: { in: clientIds } };
    const invoiceWhere: Prisma.BillingInvoiceWhereInput = {
      clientId: { in: clientIds },
      status: isClientOnly(user)
        ? { in: [BillingInvoiceStatus.ISSUED, BillingInvoiceStatus.PAID] }
        : undefined,
    };
    const [requestGroups, stock, invoiceGroups, unreadNotifications, openBoxes, recentRequests, recentInvoices] = await Promise.all([
      this.prisma.clientRequest.groupBy({
        by: ['status'],
        where: requestWhere,
        _count: { _all: true },
      }),
      this.prisma.stockBalance.aggregate({
        where: { clientId: { in: clientIds }, status: StockStatus.AVAILABLE, quantity: { gt: 0 } },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      this.prisma.billingInvoice.groupBy({
        by: ['status'],
        where: invoiceWhere,
        _count: { _all: true },
        _sum: { totalRub: true, paidRub: true },
      }),
      this.prisma.clientNotification.count({ where: { clientId: { in: clientIds }, isRead: false } }),
      this.prisma.box.count({ where: { clientId: { in: clientIds }, status: 'receiving' } }),
      this.prisma.clientRequest.findMany({
        where: requestWhere,
        select: { id: true, title: true, status: true, destinationCity: true, updatedAt: true, client: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      this.prisma.billingInvoice.findMany({
        where: invoiceWhere,
        select: { id: true, number: true, status: true, totalRub: true, paidRub: true, updatedAt: true, client: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);

    const invoices = invoiceGroups.reduce(
      (result, group) => {
        result.count += group._count._all;
        result.totalRub += decimal(group._sum.totalRub);
        result.paidRub += decimal(group._sum.paidRub);
        if (group.status === BillingInvoiceStatus.DRAFT) result.drafts += group._count._all;
        if (group.status === BillingInvoiceStatus.ISSUED) result.issued += group._count._all;
        return result;
      },
      { count: 0, drafts: 0, issued: 0, totalRub: 0, paidRub: 0 },
    );

    return {
      requests: Object.fromEntries(requestGroups.map((group) => [group.status, group._count._all])),
      activeRequests: requestGroups
        .filter((group) => !terminalRequestStatuses.has(group.status))
        .reduce((sum, group) => sum + group._count._all, 0),
      stock: { units: stock._sum.quantity ?? 0, skuRows: stock._count._all },
      invoices: { ...invoices, debtRub: Math.max(0, invoices.totalRub - invoices.paidRub) },
      unreadNotifications,
      receivingBoxes: openBoxes,
      recentRequests,
      recentInvoices: recentInvoices.map((invoice) => ({ ...invoice, totalRub: decimal(invoice.totalRub), paidRub: decimal(invoice.paidRub) })),
      adminQueue: isClientOnly(user) ? null : await this.adminQueue(user, clientIds),
      updatedAt: new Date(),
    };
  }

  async listRequests(user: AuthUser, query: MobileListDto) {
    const clientIds = await this.resolveClientIds(user, query.clientId);
    const status = validRequestStatus(query.status);
    const where: Prisma.ClientRequestWhereInput = {
      clientId: { in: clientIds },
      status,
      OR: query.search
        ? [
            { title: { contains: query.search, mode: 'insensitive' } },
            { destinationCity: { contains: query.search, mode: 'insensitive' } },
            { client: { name: { contains: query.search, mode: 'insensitive' } } },
            { items: { some: { OR: [
              { barcode: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ] } } },
          ]
        : undefined,
    };
    const rows = await this.prisma.clientRequest.findMany({
      where,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
      include: {
        client: { select: { id: true, code: true, name: true } },
        _count: { select: { items: true, files: true, comments: true, packages: true } },
        items: { select: { quantity: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit).map((row) => ({
      ...row,
      totalQuantity: row.items.reduce((sum, item) => sum + item.quantity, 0),
      items: undefined,
    }));
    return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
  }

  async listInvoices(user: AuthUser, query: MobileListDto) {
    const clientIds = await this.resolveClientIds(user, query.clientId);
    const where: Prisma.BillingInvoiceWhereInput = {
      clientId: { in: clientIds },
      status: query.status && Object.values(BillingInvoiceStatus).includes(query.status as BillingInvoiceStatus)
        ? (query.status as BillingInvoiceStatus)
        : isClientOnly(user)
          ? { in: [BillingInvoiceStatus.ISSUED, BillingInvoiceStatus.PAID] }
          : undefined,
      OR: query.search
        ? [
            { number: { contains: query.search, mode: 'insensitive' } },
            { client: { name: { contains: query.search, mode: 'insensitive' } } },
            { items: { some: { description: { contains: query.search, mode: 'insensitive' } } } },
          ]
        : undefined,
    };
    const rows = await this.prisma.billingInvoice.findMany({
      where,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
      include: {
        client: { select: { id: true, code: true, name: true } },
        items: true,
        _count: { select: { payments: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit).map((row) => ({
      ...row,
      totalRub: decimal(row.totalRub),
      paidRub: decimal(row.paidRub),
      debtRub: Math.max(0, decimal(row.totalRub) - decimal(row.paidRub)),
      items: row.items.map((item) => ({ ...item, quantity: decimal(item.quantity), unitPriceRub: decimal(item.unitPriceRub), totalRub: decimal(item.totalRub) })),
      actAvailable: row.status === BillingInvoiceStatus.PAID,
    }));
    return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
  }

  async listNotifications(user: AuthUser, query: MobileListDto) {
    const clientIds = await this.resolveClientIds(user, query.clientId);
    const rows = await this.prisma.clientNotification.findMany({
      where: { clientId: { in: clientIds }, isRead: query.unreadOnly ? false : undefined },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
      include: { client: { select: { id: true, code: true, name: true } }, request: { select: { id: true, title: true, status: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit);
    return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
  }

  async markNotificationRead(user: AuthUser, id: string) {
    const notification = await this.prisma.clientNotification.findUnique({ where: { id }, select: { id: true, clientId: true } });
    if (!notification) throw new NotFoundException('Уведомление не найдено.');
    this.clientScopes.requireClientAccess(user, notification.clientId, 'read');
    return this.prisma.clientNotification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
  }

  async events(user: AuthUser, query: MobileEventListDto) {
    const since = parseCursorDate(query.cursor);
    if (isClientOnly(user)) {
      const clientIds = await this.resolveClientIds(user);
      const data = await this.prisma.clientNotification.findMany({
        where: { clientId: { in: clientIds }, createdAt: since ? { gt: since } : undefined },
        orderBy: { createdAt: 'asc' },
        take: query.limit,
      });
      return { data: data.map((item) => ({ ...item, category: notificationCategory(item.title) })), nextCursor: cursorFrom(data) };
    }
    const data = await this.prisma.auditLog.findMany({
      where: { createdAt: since ? { gt: since } : undefined, action: categoryActionFilter(query.category) },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: query.limit,
    });
    return { data, nextCursor: cursorFrom(data) };
  }

  async onlineReceipts(user: AuthUser, clientId: string) {
    return this.warehouse.listOnlineReceipts({ clientId }, user);
  }

  async registerDevice(user: AuthUser, dto: MobileDeviceDto) {
    if (!user.deviceId) throw new ForbiddenException('Запрос выполнен не из мобильной сессии.');
    const token = clean(dto.fcmToken);
    if (token) {
      await this.prisma.mobileDevice.updateMany({
        where: { fcmToken: token, id: { not: user.deviceId } },
        data: { fcmToken: null },
      });
    }
    return this.prisma.mobileDevice.update({
      where: { id: user.deviceId },
      data: { fcmToken: token, name: clean(dto.name), appVersion: clean(dto.appVersion), isActive: true, lastSeenAt: new Date() },
      select: { id: true, name: true, appVersion: true, isActive: true, lastSeenAt: true },
    });
  }

  async appVersion() {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'mobile.android.version' } });
    const value = asRecord(setting?.value);
    return {
      currentVersion: stringValue(value.currentVersion, '0.1.1'),
      minimumVersion: stringValue(value.minimumVersion, '0.1.0'),
      mandatory: value.mandatory === true,
      apkUrl: stringValue(value.apkUrl, '/downloads/logoff-wms-mobile.apk'),
      releaseNotes: stringValue(value.releaseNotes, 'Первый мобильный релиз LOGOff WMS.'),
      updatedAt: setting?.updatedAt ?? null,
    };
  }

  private async adminQueue(user: AuthUser, clientIds?: string[]) {
    if (isClientOnly(user)) throw new ForbiddenException('Административная очередь недоступна.');
    const filter = clientIds?.length ? { in: clientIds } : undefined;
    const [newRequests, receivingBoxes, tsdReview, skuDrafts, invoiceDrafts, logisticsReview] = await Promise.all([
      this.prisma.clientRequest.count({ where: { clientId: filter, status: { in: [ClientRequestStatus.SUBMITTED, ClientRequestStatus.IN_REVIEW] } } }),
      this.prisma.box.count({ where: { clientId: filter, status: 'receiving' } }),
      this.prisma.tsdOperation.count({ where: { status: TsdOperationStatus.NEEDS_REVIEW } }),
      this.prisma.sku.count({ where: { clientId: filter, isDraft: true } }),
      this.prisma.billingInvoice.count({ where: { clientId: filter, status: BillingInvoiceStatus.DRAFT } }),
      this.prisma.logisticsDeliveryRequest.count({ where: { clientId: filter, requiresManualReview: true } }),
    ]);
    return { newRequests, receivingBoxes, tsdReview, skuDrafts, invoiceDrafts, logisticsReview, total: newRequests + receivingBoxes + tsdReview + skuDrafts + invoiceDrafts + logisticsReview };
  }

  private async resolveClientIds(user: AuthUser, clientId?: string) {
    if (clientId) {
      this.clientScopes.requireClientAccess(user, clientId, 'read');
      return [clientId];
    }
    if (user.clientScopeMode === 'LIMITED') return user.clientIds;
    const clients = await this.prisma.client.findMany({ where: { status: { not: 'ARCHIVED' }, isDemo: false }, select: { id: true } });
    return clients.map((client) => client.id);
  }
}

function isClientOnly(user: AuthUser) {
  return user.roleCodes.includes('CLIENT') && !user.roleCodes.some((role) => ['ADMIN', 'OWNER', 'MANAGER', 'OPERATOR'].includes(role));
}

function validRequestStatus(value?: string) {
  return value && Object.values(ClientRequestStatus).includes(value as ClientRequestStatus) ? (value as ClientRequestStatus) : undefined;
}

const terminalRequestStatuses = new Set<ClientRequestStatus>([
  ClientRequestStatus.DONE,
  ClientRequestStatus.CANCELLED,
  ClientRequestStatus.REJECTED,
]);

function decimal(value: { toNumber(): number } | number | null | undefined) {
  if (value == null) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

function emptyDashboard() {
  return { requests: {}, activeRequests: 0, stock: { units: 0, skuRows: 0 }, invoices: { count: 0, drafts: 0, issued: 0, totalRub: 0, paidRub: 0, debtRub: 0 }, unreadNotifications: 0, receivingBoxes: 0, recentRequests: [], recentInvoices: [], adminQueue: null, updatedAt: new Date() };
}

function parseCursorDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function cursorFrom(rows: Array<{ createdAt: Date }>) {
  return rows.at(-1)?.createdAt.toISOString() ?? null;
}

function categoryActionFilter(category?: string): Prisma.StringFilter | undefined {
  if (!category || category === 'all') return undefined;
  const prefixes: Record<string, string> = { requests: 'client-request', billing: 'billing', warehouse: 'warehouse', system: 'service' };
  return { startsWith: prefixes[category] ?? category };
}

function notificationCategory(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes('счет') || normalized.includes('оплат')) return 'billing';
  if (normalized.includes('прием') || normalized.includes('короб')) return 'warehouse';
  return 'requests';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function clean(value?: string) {
  const result = value?.trim();
  return result || undefined;
}
