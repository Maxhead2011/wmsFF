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
    const [clients, appVersion] = await Promise.all([
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
      this.appVersion(),
    ]);

    return {
      user,
      mode: isClientOnly(user) ? 'CLIENT' : 'ADMIN',
      clients,
      dashboard: null,
      appVersion,
      features: {
        requestCreate: user.permissionCodes.includes('client-requests:write'),
        requestStatus:
          user.permissionCodes.includes('client-requests:status') ||
          user.permissionCodes.includes('system:admin'),
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
    const estimateClientId = clientId && clientIds.length === 1 ? clientIds[0] : null;
    const monthStart = moscowMonthStart();
    const [requestGroups, stockRows, invoiceGroups, unreadNotifications, openBoxes, estimateClient, goodsArrivals, pprPrices] = await Promise.all([
      this.prisma.clientRequest.groupBy({
        by: ['status'],
        where: requestWhere,
        _count: { _all: true },
      }),
      this.prisma.stockBalance.findMany({
        where: {
          clientId: { in: clientIds },
          status: { in: [StockStatus.AVAILABLE, StockStatus.PACKING, StockStatus.SHIPPING] },
          quantity: { gt: 0 },
        },
        select: {
          quantity: true,
          status: true,
          sku: { select: { volumeLiters: true } },
        },
      }),
      this.prisma.billingInvoice.groupBy({
        by: ['status'],
        where: invoiceWhere,
        _count: { _all: true },
        _sum: { totalRub: true, paidRub: true },
      }),
      this.prisma.clientNotification.count({ where: { clientId: { in: clientIds }, isRead: false } }),
      this.prisma.box.count({ where: { clientId: { in: clientIds }, status: 'receiving' } }),
      estimateClientId
        ? this.prisma.client.findUnique({
            where: { id: estimateClientId },
            select: { storageAccountingEnabled: true, storagePriceRubPerLiterDay: true },
          })
        : Promise.resolve(null),
      estimateClientId
        ? this.prisma.auditLog.findMany({
            where: {
              entity: 'goods-arrival',
              entityId: estimateClientId,
              action: 'warehouse.goods-arrival',
              createdAt: { gte: monthStart },
            },
            select: { payload: true },
            orderBy: { createdAt: 'desc' },
            take: 500,
          })
        : Promise.resolve([]),
      estimateClientId
        ? this.prisma.clientBillingService.findMany({
            where: {
              clientId: estimateClientId,
              isActive: true,
              service: { code: { in: ['PPR_BAGS', 'PPR_BOXES'] } },
            },
            select: {
              priceRub: true,
              taxMode: true,
              service: { select: { code: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const availableStockRows = stockRows.filter((row) => row.status === StockStatus.AVAILABLE);
    const storageLiters = stockRows.reduce(
      (sum, row) => sum + row.quantity * decimal(row.sku.volumeLiters),
      0,
    );
    const storageTariff = estimateClient?.storageAccountingEnabled
      ? decimal(estimateClient.storagePriceRubPerLiterDay)
      : 0;
    const storageRub = roundMobileMoney(storageLiters * storageTariff * moscowDayOfMonth());
    const arrivalTotals = goodsArrivals.reduce(
      (totals, row) => {
        const payload = asRecord(row.payload);
        if (payload.status === 'CANCELLED' || typeof payload.billingInvoiceId === 'string') return totals;
        totals.bags += mobileInteger(payload.bagCount);
        totals.boxes += mobileInteger(payload.boxCount);
        return totals;
      },
      { bags: 0, boxes: 0 },
    );
    const pprPriceByCode = new Map(
      pprPrices.map((price) => [
        price.service.code,
        price.taxMode === 'ADD_6_PERCENT'
          ? roundMobileMoney((decimal(price.priceRub) / 94) * 100)
          : decimal(price.priceRub),
      ]),
    );
    const pprRub = roundMobileMoney(
      arrivalTotals.bags * (pprPriceByCode.get('PPR_BAGS') ?? 0) +
        arrivalTotals.boxes * (pprPriceByCode.get('PPR_BOXES') ?? 0),
    );

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
      stock: {
        units: availableStockRows.reduce((sum, row) => sum + row.quantity, 0),
        skuRows: availableStockRows.length,
      },
      invoices: { ...invoices, debtRub: Math.max(0, invoices.totalRub - invoices.paidRub) },
      unreadNotifications,
      receivingBoxes: openBoxes,
      estimates: {
        storageAmountRub: storageRub,
        storageRub,
        storageLiters: roundMobileQuantity(storageLiters),
        storageTariffRubPerLiterDay: storageTariff,
        pprRub,
        pprBags: arrivalTotals.bags,
        pprBoxes: arrivalTotals.boxes,
        periodFrom: monthStart.toISOString(),
        periodTo: new Date().toISOString(),
      },
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

  async markAllNotificationsRead(user: AuthUser, clientId?: string) {
    const clientIds = await this.resolveClientIds(user, clientId);
    const readAt = new Date();
    const result = await this.prisma.clientNotification.updateMany({
      where: { clientId: { in: clientIds }, isRead: false },
      data: { isRead: true, readAt },
    });
    return { updated: result.count, readAt };
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

  async nativeModule(user: AuthUser, module: string, query: MobileListDto) {
    const supported = new Set([
      'stock',
      'catalog',
      'warehouse',
      'inventory',
      'turnover',
      'clients',
      'access',
      'logistics',
      'services',
      'imports',
      'print',
      'service',
      'own-companies',
      'profile',
    ]);
    if (!supported.has(module)) throw new NotFoundException('Раздел мобильного приложения не найден.');

    const adminOnly = new Set(['clients', 'access', 'imports', 'print', 'service', 'own-companies']);
    if (adminOnly.has(module) && isClientOnly(user)) {
      throw new ForbiddenException('Раздел доступен только сотрудникам WMS.');
    }
    const requiredPermissions: Record<string, string[]> = {
      stock: ['stock:read'],
      catalog: ['skus:read'],
      warehouse: ['warehouse:read', 'stock:read'],
      inventory: ['stock:read'],
      turnover: ['stock:read'],
      clients: ['clients:read'],
      access: ['users:read'],
      logistics: ['logistics:read'],
      services: ['billing:read'],
      imports: ['imports:write'],
      print: ['print:write'],
      service: ['system:admin'],
      'own-companies': ['billing:read'],
      profile: ['clients:read'],
    };
    if (!hasAnyPermission(user, requiredPermissions[module])) {
      throw new ForbiddenException('Недостаточно прав для просмотра раздела.');
    }

    const clientIds = await this.resolveClientIds(user, query.clientId);
    const search = clean(query.search);
    const contains = search ? { contains: search, mode: Prisma.QueryMode.insensitive } : undefined;
    const take = query.limit;

    if (module === 'profile') {
      const rows = await this.prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: {
          id: true,
          code: true,
          name: true,
          legalName: true,
          inn: true,
          phone: true,
          email: true,
          status: true,
          storageAccountingEnabled: true,
          storesWithoutBoxes: true,
          onlineReceiptVisibleToClient: true,
        },
        orderBy: { name: 'asc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.name,
            [row.code, row.legalName, row.inn ? `ИНН ${row.inn}` : null, row.phone, row.email].filter(Boolean).join('\n'),
            row.status,
            row,
          ),
        ),
      );
    }

    if (module === 'stock') {
      const rows = await this.prisma.stockBalance.findMany({
        where: {
          clientId: { in: clientIds },
          quantity: { gt: 0 },
          OR: contains
            ? [
                { sku: { name: contains } },
                { sku: { internalSku: contains } },
                { sku: { article: contains } },
                { sku: { barcodes: { some: { value: { contains: search } } } } },
                { box: { code: contains } },
              ]
            : undefined,
        },
        include: {
          sku: { include: { barcodes: { select: { value: true, isPrimary: true } } } },
          box: { select: { code: true } },
          pallet: { select: { code: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.sku.name,
            [
              row.sku.article || row.sku.internalSku,
              primaryMobileBarcode(row.sku.barcodes),
              row.box?.code ? `Короб ${row.box.code}` : row.pallet?.code ? `Паллета ${row.pallet.code}` : 'Без короба',
              `${row.quantity} шт.`,
            ].filter(Boolean).join(' · '),
            row.status,
            row,
          ),
        ),
      );
    }

    if (module === 'catalog') {
      const rows = await this.prisma.sku.findMany({
        where: {
          clientId: { in: clientIds },
          OR: contains
            ? [
                { name: contains },
                { internalSku: contains },
                { article: contains },
                { clientSku: contains },
                { barcodes: { some: { value: { contains: search } } } },
              ]
            : undefined,
        },
        include: {
          client: { select: { name: true } },
          barcodes: { select: { value: true, isPrimary: true } },
          balances: {
            where: { quantity: { gt: 0 } },
            select: {
              quantity: true,
              status: true,
              box: { select: { code: true } },
              pallet: { select: { code: true } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) => {
          const quantity = row.balances.reduce((sum, balance) => sum + balance.quantity, 0);
          return mobileRow(
            row.id,
            row.name,
            [
              row.client.name,
              row.article || row.internalSku,
              primaryMobileBarcode(row.barcodes),
              `Остаток ${quantity} шт.`,
            ].filter(Boolean).join(' · '),
            row.isDraft ? 'Черновик' : row.needsRelabel ? 'Нужна перемаркировка' : 'Активен',
            { ...row, quantity },
          );
        }),
      );
    }

    if (module === 'warehouse') {
      const rows = await this.prisma.box.findMany({
        where: {
          clientId: { in: clientIds },
          balances: { some: { quantity: { gt: 0 } } },
          OR: contains ? [{ code: contains }, { client: { name: contains } }] : undefined,
        },
        include: {
          client: { select: { name: true } },
          zone: { select: { code: true, name: true } },
          pallet: { select: { code: true } },
          balances: {
            where: { quantity: { gt: 0 } },
            select: {
              id: true,
              quantity: true,
              status: true,
              sku: {
                select: {
                  id: true,
                  name: true,
                  article: true,
                  internalSku: true,
                  color: true,
                  size: true,
                  barcodes: { select: { value: true, isPrimary: true } },
                },
              },
            },
          },
          _count: { select: { productMarks: { where: { status: StockStatus.AVAILABLE } } } },
        },
        orderBy: { code: 'asc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) => {
          const quantity = row.balances.reduce((sum, balance) => sum + balance.quantity, 0);
          return mobileRow(
            row.id,
            row.code,
            [
              row.client.name,
              `${quantity} шт.`,
              `КИЗ ${row._count.productMarks}`,
              row.zone?.name || row.zone?.code,
              row.pallet?.code ? `Паллета ${row.pallet.code}` : null,
            ].filter(Boolean).join(' · '),
            row.status,
            {
              ...row,
              quantity,
              contents: row.balances.map((balance) => ({
                id: balance.id,
                skuId: balance.sku.id,
                name: balance.sku.name,
                article: balance.sku.article || balance.sku.internalSku,
                barcode: primaryMobileBarcode(balance.sku.barcodes),
                color: balance.sku.color,
                size: balance.sku.size,
                quantity: balance.quantity,
                status: balance.status,
              })),
            },
          );
        }),
      );
    }

    if (module === 'inventory') {
      const rows = await this.prisma.inventorySession.findMany({
        where: {
          clientId: { in: clientIds },
          OR: contains ? [{ title: contains }, { comment: contains }, { boxes: { some: { boxCode: contains } } }] : undefined,
        },
        include: {
          _count: { select: { boxes: true } },
          boxes: { select: { status: true } },
        },
        orderBy: { startedAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) => {
          const mismatches = row.boxes.filter((box) => box.status === 'MISMATCH').length;
          return mobileRow(
            row.id,
            row.title,
            [
              inventoryTypeLabel(row.type),
              `${row._count.boxes} коробов`,
              mismatches ? `Расхождений ${mismatches}` : 'Без расхождений',
              row.createdByName,
            ].join(' · '),
            row.status,
            { ...row, mismatchBoxes: mismatches },
          );
        }),
      );
    }

    if (module === 'turnover') {
      const rows = await this.prisma.stockMovement.findMany({
        where: {
          clientId: { in: clientIds },
          OR: contains
            ? [
                { sourceDocument: contains },
                { comment: contains },
                { box: { code: contains } },
                { sku: { name: contains } },
                { sku: { internalSku: contains } },
                { sku: { article: contains } },
                { sku: { barcodes: { some: { value: { contains: search } } } } },
              ]
            : undefined,
        },
        include: {
          client: { select: { name: true } },
          sku: { select: { name: true, article: true, internalSku: true } },
          box: { select: { code: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.sku.name,
            [
              movementTypeLabel(row.type),
              `${row.quantity} шт.`,
              row.box?.code,
              row.sourceDocument,
              row.client.name,
            ].filter(Boolean).join(' · '),
            row.status,
            row,
          ),
        ),
      );
    }

    if (module === 'clients') {
      const rows = await this.prisma.client.findMany({
        where: {
          id: { in: clientIds },
          isDemo: false,
          OR: contains ? [{ name: contains }, { code: contains }, { legalName: contains }, { inn: contains }] : undefined,
        },
        include: {
          _count: { select: { skus: true, boxes: true, requests: true, billingInvoices: true, userScopes: true } },
        },
        orderBy: { name: 'asc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.name,
            [
              row.code,
              row.inn ? `ИНН ${row.inn}` : null,
              `SKU ${row._count.skus}`,
              `Коробов ${row._count.boxes}`,
              `Заявок ${row._count.requests}`,
              `Пользователей ${row._count.userScopes}`,
            ].filter(Boolean).join(' · '),
            row.status,
            row,
          ),
        ),
      );
    }

    if (module === 'access') {
      const rows = await this.prisma.user.findMany({
        where: {
          isDemo: false,
          OR: contains ? [{ name: contains }, { email: contains }] : undefined,
        },
        include: {
          roles: { include: { role: { select: { code: true, name: true } } } },
          clientScopes: { include: { client: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { name: 'asc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.name,
            [
              row.email,
              row.roles.map((role) => role.role.name).join(', ') || 'Без роли',
              row.clientScopes.length ? `Клиентов ${row.clientScopes.length}` : 'Все доступные клиенты',
            ].join(' · '),
            row.status,
            row,
          ),
        ),
      );
    }

    if (module === 'logistics') {
      const rows = await this.prisma.logisticsDeliveryRequest.findMany({
        where: {
          clientId: { in: clientIds },
          OR: contains
            ? [
                { origin: contains },
                { destination: contains },
                { comment: contains },
                { client: { name: contains } },
                { trip: { code: contains } },
              ]
            : undefined,
        },
        include: {
          client: { select: { name: true } },
          trip: { select: { code: true, plannedDate: true, status: true, vehicleNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            `${row.origin} → ${row.destination}`,
            [
              row.client.name,
              row.boxes != null ? `${row.boxes} коробов` : null,
              row.pallets != null ? `${row.pallets} паллет` : null,
              row.estimatedTotalRub != null ? `${decimal(row.estimatedTotalRub).toFixed(2)} ₽` : null,
              row.trip?.code,
              row.requiresManualReview ? 'Нужна проверка' : null,
            ].filter(Boolean).join(' · '),
            row.status,
            row,
          ),
        ),
      );
    }

    if (module === 'services') {
      const rows = await this.prisma.clientBillingService.findMany({
        where: {
          clientId: { in: clientIds },
          OR: contains ? [{ service: { name: contains } }, { service: { code: contains } }, { client: { name: contains } }] : undefined,
        },
        include: {
          client: { select: { name: true } },
          service: { select: { code: true, name: true, unit: true } },
        },
        orderBy: [{ client: { name: 'asc' } }, { service: { name: 'asc' } }],
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.service.name,
            `${row.client.name} · ${decimal(row.priceRub).toFixed(2)} ₽ · ${billingUnitLabel(row.service.unit)}`,
            row.isActive ? 'Активна' : 'Отключена',
            row,
          ),
        ),
      );
    }

    if (module === 'imports') {
      const rows = await this.prisma.stockTransferBatch.findMany({
        where: {
          clientId: { in: clientIds },
          OR: contains ? [{ fileName: contains }, { uploadedByName: contains }] : undefined,
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.fileName,
            `Строк ${row.rowCount} · Выполнено ${row.appliedRowCount} · Ошибок ${row.rejectedRowCount} · ${row.quantity} шт.`,
            row.status,
            { ...row, content: undefined },
          ),
        ),
      );
    }

    if (module === 'print') {
      const rows = await this.prisma.printJob.findMany({
        where: {
          OR: contains ? [{ printerCode: contains }, { labelType: contains }, { status: contains }] : undefined,
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            `${row.labelType} · ${row.printerCode}`,
            `Попыток ${row.attempts} · ${row.processedAt ? 'обработано' : 'ожидает обработки'}`,
            row.status,
            { ...row, tspl: undefined },
          ),
        ),
      );
    }

    if (module === 'service') {
      const rows = await this.prisma.tsdOperation.findMany({
        where: {
          OR: contains
            ? [
                { operationType: contains },
                { operationKey: contains },
                { serverMessage: contains },
                { resolutionMessage: contains },
              ]
            : undefined,
        },
        include: {
          reviewedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return mobilePage(
        module,
        rows.map((row) =>
          mobileRow(
            row.id,
            row.operationType,
            [
              row.deviceId,
              row.reviewReason,
              row.serverMessage,
              row.resolutionMessage,
              row.reviewedBy?.name,
            ].filter(Boolean).join(' · '),
            row.status,
            { ...row, payload: undefined },
          ),
        ),
      );
    }

    const rows = await this.prisma.ownCompany.findMany({
      where: {
        OR: contains ? [{ shortName: contains }, { fullName: contains }, { inn: contains }] : undefined,
      },
      include: { bankAccounts: true },
      orderBy: [{ isDefault: 'desc' }, { shortName: 'asc' }],
      take,
    });
    return mobilePage(
      module,
      rows.map((row) =>
        mobileRow(
          row.id,
          row.shortName,
          [row.fullName, `ИНН ${row.inn}`, row.bankName, row.bankAccount].filter(Boolean).join(' · '),
          row.isActive ? (row.isDefault ? 'Основная' : 'Активна') : 'Отключена',
          row,
        ),
      ),
    );
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
      data: {
        ...(dto.fcmToken !== undefined ? { fcmToken: token } : {}),
        ...(dto.name !== undefined ? { name: clean(dto.name) } : {}),
        ...(dto.appVersion !== undefined ? { appVersion: clean(dto.appVersion) } : {}),
        isActive: true,
        lastSeenAt: new Date(),
      },
      select: { id: true, name: true, appVersion: true, isActive: true, lastSeenAt: true },
    });
  }

  async appVersion() {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'mobile.android.version' } });
    const value = asRecord(setting?.value);
    return {
      currentVersion: stringValue(value.currentVersion, '0.3.3'),
      minimumVersion: stringValue(value.minimumVersion, '0.1.0'),
      mandatory: value.mandatory === true,
      apkUrl: stringValue(value.apkUrl, '/downloads/logoff-wms-mobile.apk'),
      releaseNotes: stringValue(
        value.releaseNotes,
        'Добавлен нативный модуль FBS: заказы, стоимость обработки, архив и настройка тарифов по выбранному клиенту.',
      ),
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
  return {
    requests: {},
    activeRequests: 0,
    stock: { units: 0, skuRows: 0 },
    invoices: { count: 0, drafts: 0, issued: 0, totalRub: 0, paidRub: 0, debtRub: 0 },
    unreadNotifications: 0,
    receivingBoxes: 0,
    estimates: {
      storageAmountRub: 0,
      storageRub: 0,
      storageLiters: 0,
      storageTariffRubPerLiterDay: 0,
      pprRub: 0,
      pprBags: 0,
      pprBoxes: 0,
      periodFrom: null,
      periodTo: null,
    },
    adminQueue: null,
    updatedAt: new Date(),
  };
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

function mobilePage(module: string, data: Array<Record<string, unknown>>) {
  return {
    module,
    data,
    count: data.length,
    updatedAt: new Date(),
  };
}

function mobileRow(
  id: string,
  title: string,
  subtitle: string,
  status: string,
  details: unknown,
): Record<string, unknown> {
  return { id, title, subtitle, status, details };
}

function primaryMobileBarcode(barcodes: Array<{ value: string; isPrimary: boolean }>) {
  return barcodes.find((barcode) => barcode.isPrimary)?.value ?? barcodes[0]?.value ?? '';
}

function inventoryTypeLabel(value: string) {
  const labels: Record<string, string> = {
    FULL: 'Полная',
    PARTIAL: 'Частичная',
    BOX_CHECK: 'Проверка короба',
  };
  return labels[value] ?? value;
}

function movementTypeLabel(value: string) {
  const labels: Record<string, string> = {
    INITIAL_IMPORT: 'Начальный остаток',
    RECEIPT: 'Приемка',
    MOVE: 'Перемещение',
    RESERVE: 'Резерв',
    PICK: 'Отбор',
    PACK: 'Упаковка',
    SHIP: 'Отгрузка',
    RETURN: 'Возврат',
    INVENTORY_ADJUSTMENT: 'Инвентаризация',
  };
  return labels[value] ?? value;
}

function billingUnitLabel(value: string) {
  const labels: Record<string, string> = {
    SERVICE: 'услуга',
    PIECE: 'штука',
    BOX: 'короб',
    PALLET: 'паллета',
    LITER: 'литр',
    LITER_DAY: 'литро-день',
    DAY: 'день',
    HOUR: 'час',
  };
  return labels[value] ?? value;
}

function hasAnyPermission(user: AuthUser, permissions: string[]) {
  return user.permissionCodes.includes('system:admin') || permissions.some((permission) => user.permissionCodes.includes(permission));
}

function moscowDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

function moscowMonthStart() {
  const parts = moscowDateParts();
  return new Date(`${parts.year}-${parts.month}-01T00:00:00+03:00`);
}

function moscowDayOfMonth() {
  return Number(moscowDateParts().day) || 1;
}

function mobileInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function roundMobileMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundMobileQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
