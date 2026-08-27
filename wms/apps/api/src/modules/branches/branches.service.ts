import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MovementType, Prisma, StockStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { parseBranchTransferBoxWorkbook } from './branch-transfer-xlsx';

type TransferItem = { skuId: string; quantity: number };
type TransferSourceAllocation = {
  boxId: string;
  boxCode: string;
  quantity: number;
  markIds: string[];
};
type TransferManifestItem = {
  skuId: string;
  internalSku: string;
  name: string;
  quantity: number;
  sourceAllocations: TransferSourceAllocation[];
};
type TransferManifestBox = {
  boxId: string;
  code: string;
  generated: boolean;
  quantity: number;
  items: TransferManifestItem[];
};
type TransferManifest = { boxes: TransferManifestBox[] };

@Injectable()
export class BranchesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScopes: ClientScopeService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultBranches();
  }

  async ensureDefaultBranches() {
    const [moscow, krasnodar] = await Promise.all([
      this.prisma.warehouse.upsert({
        where: { code: 'MSK' },
        update: { name: 'ФФ Москва', city: 'Москва', isActive: true, sortOrder: 10 },
        create: { code: 'MSK', name: 'ФФ Москва', city: 'Москва', isActive: true, sortOrder: 10 },
      }),
      this.prisma.warehouse.upsert({
        where: { code: 'KRD' },
        update: { name: 'ФФ Краснодар', city: 'Краснодар', isActive: true, sortOrder: 20 },
        create: { code: 'KRD', name: 'ФФ Краснодар', city: 'Краснодар', isActive: true, sortOrder: 20 },
      }),
    ]);

    await this.prisma.$transaction([
      this.prisma.box.updateMany({ where: { warehouseId: null }, data: { warehouseId: moscow.id } }),
      this.prisma.clientRequest.updateMany({ where: { warehouseId: null }, data: { warehouseId: moscow.id } }),
    ]);

    // Backfill only truly legacy clients. A client created in a regional branch
    // must never be attached to Moscow merely because the API restarted.
    const clientIds = await this.prisma.client.findMany({
      where: { warehouseLinks: { none: {} } },
      select: { id: true },
    });
    if (clientIds.length) {
      await this.prisma.warehouseClient.createMany({
        data: clientIds.map((client) => ({ warehouseId: moscow.id, clientId: client.id })),
        skipDuplicates: true,
      });
    }

    return { moscow, krasnodar };
  }

  async list(user: AuthUser) {
    const where: Prisma.WarehouseWhereInput = this.isNetworkAdmin(user)
      ? {}
      : this.isClient(user)
        ? {
            clients: {
              some: {
                clientId: { in: user.clientIds },
                status: 'ACTIVE',
              },
            },
          }
        : { userScopes: { some: { userId: user.id, canRead: true } } };

    const warehouses = await this.prisma.warehouse.findMany({
      where,
      include: {
        ownCompany: {
          select: { id: true, shortName: true, fullName: true, inn: true, isActive: true },
        },
        userScopes: {
          include: { user: { select: { id: true, name: true, email: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { clients: true, boxes: true, requests: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { city: 'asc' }],
    });

    if (!warehouses.length) return warehouses;

    const warehouseIds = new Set(warehouses.map((warehouse) => warehouse.id));
    const primaryWarehouseId = warehouses.find((warehouse) => warehouse.code === 'MSK')?.id ?? null;
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        status: { not: StockStatus.IN_TRANSIT },
        ...(this.isClient(user) ? { clientId: { in: user.clientIds } } : {}),
      },
      select: {
        skuId: true,
        quantity: true,
        status: true,
        box: { select: { warehouseId: true } },
        pallet: { select: { zone: { select: { warehouseId: true } } } },
      },
    });
    const stockByWarehouse = new Map<
      string,
      { totalQuantity: number; availableQuantity: number; skuIds: Set<string>; balanceRows: number }
    >();

    for (const balance of balances) {
      const warehouseId =
        balance.box?.warehouseId ??
        balance.pallet?.zone?.warehouseId ??
        primaryWarehouseId;
      if (!warehouseId || !warehouseIds.has(warehouseId)) continue;
      const stock = stockByWarehouse.get(warehouseId) ?? {
        totalQuantity: 0,
        availableQuantity: 0,
        skuIds: new Set<string>(),
        balanceRows: 0,
      };
      stock.totalQuantity += balance.quantity;
      if (balance.status === StockStatus.AVAILABLE) stock.availableQuantity += balance.quantity;
      stock.skuIds.add(balance.skuId);
      stock.balanceRows += 1;
      stockByWarehouse.set(warehouseId, stock);
    }

    return warehouses.map((warehouse) => {
      const stock = stockByWarehouse.get(warehouse.id);
      return {
        ...warehouse,
        _stock: {
          totalQuantity: stock?.totalQuantity ?? 0,
          availableQuantity: stock?.availableQuantity ?? 0,
          skuCount: stock?.skuIds.size ?? 0,
          balanceRows: stock?.balanceRows ?? 0,
        },
      };
    });
  }

  async create(body: Record<string, unknown>, user: AuthUser) {
    this.requireAdmin(user);
    const code = requiredText(body.code, 'Укажите код филиала.').toUpperCase();
    const city = requiredText(body.city, 'Укажите город филиала.');
    const name = text(body.name) || `ФФ ${city}`;
    const ownCompanyId = text(body.ownCompanyId) || null;
    if (ownCompanyId) await this.requireOwnCompany(ownCompanyId);

    return this.prisma.warehouse.create({
      data: {
        code,
        city,
        name,
        address: text(body.address) || null,
        ownCompanyId,
        sortOrder: positiveInteger(body.sortOrder, 100),
      },
      include: { ownCompany: true },
    });
  }

  async update(id: string, body: Record<string, unknown>, user: AuthUser) {
    this.requireAdmin(user);
    await this.requireWarehouse(id);
    const ownCompanyId = body.ownCompanyId === undefined ? undefined : text(body.ownCompanyId) || null;
    if (ownCompanyId) await this.requireOwnCompany(ownCompanyId);

    return this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(body.name === undefined ? {} : { name: requiredText(body.name, 'Укажите название филиала.') }),
        ...(body.city === undefined ? {} : { city: requiredText(body.city, 'Укажите город филиала.') }),
        ...(body.address === undefined ? {} : { address: text(body.address) || null }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive === true }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: positiveInteger(body.sortOrder, 100) }),
        ...(ownCompanyId === undefined ? {} : { ownCompanyId }),
      },
      include: { ownCompany: true },
    });
  }

  async activate(id: string, user: AuthUser) {
    const warehouse = await this.requireWarehouse(id);
    if (!this.isNetworkAdmin(user) && !(user.warehouseIds ?? []).includes(id)) {
      throw new ForbiddenException('Этот филиал не назначен пользователю.');
    }
    if (!warehouse.isActive) {
      throw new BadRequestException('Филиал отключён.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { activeWarehouseId: id } });
    return warehouse;
  }

  async assignManager(id: string, body: Record<string, unknown>, user: AuthUser) {
    this.requireAdmin(user);
    const userId = text(body.userId);
    const warehouse = await this.requireWarehouse(id);
    if (!userId) {
      await this.prisma.userWarehouse.updateMany({
        where: { warehouseId: id, isResponsible: true },
        data: { isResponsible: false },
      });
      return { warehouse, manager: null };
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!target) throw new NotFoundException('Пользователь не найден.');
    const targetIsAdmin = target.roles.some((role) =>
      role.role.permissions.some((permission) => permission.permission.code === 'system:admin'),
    );
    if (targetIsAdmin) throw new BadRequestException('Администратору филиал назначать не требуется: он видит все города.');

    const branchManagerRole = await this.prisma.role.findUnique({ where: { code: 'BRANCH_MANAGER' } });
    if (!branchManagerRole) {
      throw new BadRequestException('Роль менеджера филиала ещё не инициализирована. Повторите действие через несколько секунд.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.create({ data: { userId, roleId: branchManagerRole.id } });
      await tx.userWarehouse.deleteMany({ where: { userId } });
      await tx.userWarehouse.updateMany({
        where: { warehouseId: id, isResponsible: true },
        data: { isResponsible: false },
      });
      await tx.userWarehouse.create({
        data: { userId, warehouseId: id, canRead: true, canWrite: true, isResponsible: true },
      });
      await tx.user.update({ where: { id: userId }, data: { activeWarehouseId: id } });
      await tx.userClient.deleteMany({ where: { userId } });
    });
    return { warehouse, manager: { id: target.id, name: target.name, email: target.email } };
  }

  async stockSummary(clientIdValue: string | undefined, user: AuthUser) {
    const clientId = clientIdValue || (user.clientIds.length === 1 ? user.clientIds[0] : '');
    if (!clientId) throw new BadRequestException('Выберите клиента.');
    this.clientScopes.requireClientAccess(user, clientId, 'read');

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { storesWithoutBoxes: true, stockBalanceMode: true },
    });
    if (!client) throw new NotFoundException('Клиент не найден.');

    const warehouses = await this.prisma.warehouse.findMany({
      where: this.isNetworkAdmin(user)
        ? { clients: { some: { clientId } } }
        : this.isClient(user)
          ? { clients: { some: { clientId } } }
          : { id: { in: user.warehouseIds ?? [] }, clients: { some: { clientId } } },
      orderBy: [{ sortOrder: 'asc' }, { city: 'asc' }],
      select: { id: true, code: true, name: true, city: true, address: true },
    });
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        clientId,
        quantity: { gt: 0 },
        ...(client.storesWithoutBoxes
          ? { boxId: null }
          : {
              boxId: { not: null },
              box: {
                status: { notIn: ['deleted', 'archived'] },
                ...(client.stockBalanceMode === 'BOXES'
                  ? {}
                  : { storagePlacement: { isNot: null } }),
              },
            }),
      },
      select: {
        skuId: true,
        quantity: true,
        status: true,
        box: { select: { warehouseId: true } },
        pallet: { select: { zone: { select: { warehouseId: true } } } },
      },
    });
    const openTransfers = await this.prisma.interWarehouseTransfer.findMany({
      where: {
        clientId,
        status: { in: ['PENDING_RECEIPT', 'PARTIALLY_RECEIVED'] },
      },
      select: {
        fromWarehouseId: true,
        toWarehouseId: true,
        totalQuantity: true,
        receivedQuantity: true,
      },
    });

    const primaryWarehouseId = warehouses.find((warehouse) => warehouse.code === 'MSK')?.id;
    const balanceWarehouseId = (balance: (typeof balances)[number]) =>
      balance.box?.warehouseId || balance.pallet?.zone?.warehouseId || primaryWarehouseId;

    return warehouses.map((warehouse) => {
      const rows = balances.filter((balance) => balanceWarehouseId(balance) === warehouse.id);
      const localRows = rows.filter((row) => row.status !== StockStatus.IN_TRANSIT);
      const outgoingInTransitQuantity = openTransfers
        .filter((transfer) => transfer.fromWarehouseId === warehouse.id)
        .reduce(
          (sum, transfer) => sum + Math.max(0, transfer.totalQuantity - transfer.receivedQuantity),
          0,
        );
      const incomingInTransitQuantity = openTransfers
        .filter((transfer) => transfer.toWarehouseId === warehouse.id)
        .reduce(
          (sum, transfer) => sum + Math.max(0, transfer.totalQuantity - transfer.receivedQuantity),
          0,
        );
      return {
        warehouse,
        totalQuantity: localRows.reduce((sum, row) => sum + row.quantity, 0),
        availableQuantity: localRows
          .filter((row) => row.status === StockStatus.AVAILABLE)
          .reduce((sum, row) => sum + row.quantity, 0),
        skuCount: new Set(localRows.map((row) => row.skuId)).size,
        balanceRows: localRows.length,
        outgoingInTransitQuantity,
        incomingInTransitQuantity,
      };
    });
  }

  async listTransfers(clientId: string | undefined, user: AuthUser) {
    const visibleWarehouseIds = user.activeWarehouseId
      ? [user.activeWarehouseId]
      : this.isNetworkAdmin(user)
        ? []
        : user.warehouseIds ?? [];
    const warehouseFilter = visibleWarehouseIds.length
      ? { OR: [{ fromWarehouseId: { in: visibleWarehouseIds } }, { toWarehouseId: { in: visibleWarehouseIds } }] }
      : undefined;
    const scopedClientFilter = clientId
      ? { clientId }
      : { clientId: this.clientScopes.resolveClientFilter(user) };
    // The first transfer is what introduces a client into a branch. Until its
    // first box is accepted the WarehouseClient link is PENDING_RECEIPT and is
    // intentionally absent from the manager's normal client scope. Incoming
    // transfers to the manager's own branch must therefore remain visible.
    const clientOrIncomingFilter = user.activeWarehouseId &&
      (this.isNetworkAdmin(user) || (user.writableWarehouseIds ?? []).includes(user.activeWarehouseId))
      ? {
          OR: [
            scopedClientFilter,
            {
              ...(clientId ? { clientId } : {}),
              toWarehouseId: user.activeWarehouseId,
            },
          ],
        }
      : scopedClientFilter;
    return this.prisma.interWarehouseTransfer.findMany({
      where: {
        AND: [clientOrIncomingFilter, ...(warehouseFilter ? [warehouseFilter] : [])],
      },
      include: {
        client: { select: { id: true, code: true, name: true } },
        fromWarehouse: { select: { id: true, code: true, name: true, city: true } },
        toWarehouse: { select: { id: true, code: true, name: true, city: true } },
        issues: { where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async previewTransferBoxesFile(
    file: Express.Multer.File | undefined,
    clientIdValue: string | undefined,
    fromWarehouseIdValue: string | undefined,
    user: AuthUser,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Выберите Excel-файл со списком коробов.');
    }
    const clientId = requiredText(clientIdValue, 'Выберите клиента.');
    const fromWarehouseId = requiredText(
      fromWarehouseIdValue || user.activeWarehouseId,
      'Выберите филиал отправления.',
    );
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    if (
      user.activeWarehouseId !== fromWarehouseId ||
      (!this.isNetworkAdmin(user) &&
        !(user.writableWarehouseIds ?? []).includes(fromWarehouseId))
    ) {
      throw new ForbiddenException(
        'Проверять короба можно только в выбранном активном филиале.',
      );
    }

    const [warehouse, parsed] = await Promise.all([
      this.requireWarehouse(fromWarehouseId),
      Promise.resolve(parseBranchTransferBoxWorkbook(file.buffer)),
    ]);
    const boxes = await this.prisma.box.findMany({
      where: {
        clientId,
        warehouseId: fromWarehouseId,
        code: {
          in: parsed.boxes.map((box) => box.code),
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        code: true,
        status: true,
        balances: {
          where: { quantity: { gt: 0 } },
          select: {
            skuId: true,
            status: true,
            quantity: true,
            sku: {
              select: {
                internalSku: true,
                needsChestnyZnak: true,
              },
            },
          },
        },
      },
    });
    const boxesByCode = new Map(
      boxes.map((box) => [normalizeBoxCode(box.code), box]),
    );
    const markedBoxIds = boxes
      .filter((box) =>
        box.balances.some((balance) => balance.sku.needsChestnyZnak),
      )
      .map((box) => box.id);
    const markCounts = markedBoxIds.length
      ? await this.prisma.productMark.groupBy({
          by: ['boxId', 'skuId'],
          where: {
            clientId,
            boxId: { in: markedBoxIds },
            status: StockStatus.AVAILABLE,
          },
          _count: { _all: true },
        })
      : [];
    const markCountByBoxSku = new Map(
      markCounts.map((row) => [
        `${row.boxId}:${row.skuId}`,
        row._count._all,
      ]),
    );

    const rows = parsed.boxes.map((parsedBox) => {
      const box = boxesByCode.get(normalizeBoxCode(parsedBox.code));
      if (!box) {
        return invalidPreviewRow(
          parsedBox,
          `Короб не найден у выбранного клиента в филиале ${warehouse.city}.`,
        );
      }
      if (['deleted', 'archived'].includes(box.status)) {
        return invalidPreviewRow(parsedBox, 'Короб удалён или находится в архиве.');
      }
      if (box.status === 'in_transit') {
        return invalidPreviewRow(parsedBox, 'Короб уже находится в пути.');
      }
      if (!box.balances.length) {
        return invalidPreviewRow(parsedBox, 'В коробе нет положительного остатка.');
      }
      if (
        box.balances.some(
          (balance) => balance.status !== StockStatus.AVAILABLE,
        )
      ) {
        return invalidPreviewRow(
          parsedBox,
          'В коробе есть зарезервированный или заблокированный товар.',
        );
      }

      for (const balance of box.balances) {
        if (!balance.sku.needsChestnyZnak) continue;
        const availableMarks =
          markCountByBoxSku.get(`${box.id}:${balance.skuId}`) ?? 0;
        if (availableMarks < balance.quantity) {
          return invalidPreviewRow(
            parsedBox,
            `Не хватает КИЗ для ${balance.sku.internalSku}: ${availableMarks} из ${balance.quantity}.`,
          );
        }
      }

      return {
        row: parsedBox.row,
        code: box.code,
        status: 'READY' as const,
        quantity: box.balances.reduce(
          (sum, balance) => sum + balance.quantity,
          0,
        ),
        skuCount: new Set(box.balances.map((balance) => balance.skuId)).size,
        reason: null,
      };
    });
    const readyRows = rows.filter((row) => row.status === 'READY');

    return {
      fileName: normalizeUploadedFileName(file.originalname),
      sheetName: parsed.sheetName,
      warehouse: {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        city: warehouse.city,
      },
      validCodes: readyRows.map((row) => row.code),
      duplicateCodes: parsed.duplicateCodes,
      rows,
      summary: {
        sourceRows: parsed.rows,
        uniqueCodes: parsed.boxes.length,
        readyBoxes: readyRows.length,
        errorBoxes: rows.length - readyRows.length,
        duplicateBoxes: parsed.duplicateCodes.length,
        totalQuantity: readyRows.reduce(
          (sum, row) => sum + row.quantity,
          0,
        ),
      },
    };
  }

  async transfer(body: Record<string, unknown>, user: AuthUser) {
    const clientId = requiredText(body.clientId, 'Выберите клиента.');
    const fromWarehouseId = requiredText(
      body.fromWarehouseId || user.activeWarehouseId,
      'Выберите филиал отправления.',
    );
    const toWarehouseId = requiredText(body.toWarehouseId, 'Выберите филиал назначения.');
    const requestedBoxCodes = transferBoxCodes(body.sourceBoxCodes);
    const items = requestedBoxCodes.length ? [] : transferItems(body.items);
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException('Филиалы отправления и назначения совпадают.');
    }
    if (
      user.activeWarehouseId !== fromWarehouseId ||
      (!this.isNetworkAdmin(user) && !(user.writableWarehouseIds ?? []).includes(fromWarehouseId))
    ) {
      throw new ForbiddenException(
        'Отправлять товар можно только из выбранного активного филиала.',
      );
    }

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.requireWarehouse(fromWarehouseId),
      this.requireWarehouse(toWarehouseId),
    ]);
    const comment = text(body.comment) || null;

    return this.prisma.$transaction(async (tx) => {
      const dispatch = requestedBoxCodes.length
        ? await this.dispatchWholeBoxes(tx, {
            clientId,
            requestedBoxCodes,
            fromWarehouse,
            toWarehouse,
            comment,
          })
        : await this.dispatchItems(tx, {
            clientId,
            items,
            fromWarehouse,
            toWarehouse,
            comment,
          });

      const transfer = await tx.interWarehouseTransfer.create({
        data: {
          clientId,
          fromWarehouseId,
          toWarehouseId,
          status: 'PENDING_RECEIPT',
          transferMode: requestedBoxCodes.length ? 'BOXES' : 'ITEMS',
          items: dispatch.savedItems,
          manifest: dispatch.manifest as unknown as Prisma.InputJsonValue,
          totalQuantity: dispatch.totalQuantity,
          sourceBoxCodes: dispatch.sourceBoxCodes,
          receivedBoxCodes: [],
          destinationBoxCode: dispatch.destinationBoxCode,
          comment,
          createdByUserId: user.id,
          createdByName: user.name,
          dispatchedAt: new Date(),
        },
        include: {
          client: { select: { id: true, code: true, name: true } },
          fromWarehouse: { select: { id: true, code: true, name: true, city: true } },
          toWarehouse: { select: { id: true, code: true, name: true, city: true } },
          issues: true,
        },
      });

      await tx.warehouseClient.upsert({
        where: { warehouseId_clientId: { warehouseId: toWarehouseId, clientId } },
        update: {},
        create: {
          warehouseId: toWarehouseId,
          clientId,
          activatedByTransferId: transfer.id,
          status: 'PENDING_RECEIPT',
          source: 'TRANSFER',
        },
      });
      const destinationEmployees = await tx.userWarehouse.findMany({
        where: { warehouseId: toWarehouseId, canRead: true },
        select: { userId: true, canWrite: true },
      });
      if (destinationEmployees.length) {
        await Promise.all(
          destinationEmployees.map((employee) =>
            tx.userClient.upsert({
              where: { userId_clientId: { userId: employee.userId, clientId } },
              update: { canRead: true, canWrite: employee.canWrite },
              create: {
                userId: employee.userId,
                clientId,
                canRead: true,
                canWrite: employee.canWrite,
              },
            }),
          ),
        );
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'branches.transfer.dispatched',
          entity: 'inter-warehouse-transfer',
          entityId: transfer.id,
          payload: {
            fromWarehouseId,
            toWarehouseId,
            clientId,
            totalQuantity: dispatch.totalQuantity,
            boxCodes: dispatch.manifest.boxes.map((box) => box.code),
          },
        },
      });
      return transfer;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async receiveBox(id: string, body: Record<string, unknown>, user: AuthUser) {
    const boxCode = requiredText(
      body.boxCode,
      'Отсканируйте код приехавшего короба.',
    );
    const transfer = await this.prisma.interWarehouseTransfer.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, code: true, name: true } },
        fromWarehouse: { select: { id: true, code: true, name: true, city: true } },
        toWarehouse: { select: { id: true, code: true, name: true, city: true } },
      },
    });
    if (!transfer) {
      throw new NotFoundException('Межфилиальное перемещение не найдено.');
    }
    if (
      user.activeWarehouseId !== transfer.toWarehouseId ||
      (!this.isNetworkAdmin(user) &&
        !(user.writableWarehouseIds ?? []).includes(transfer.toWarehouseId))
    ) {
      throw new ForbiddenException(
        'Принимать короб можно только в выбранном филиале-получателе.',
      );
    }
    if (transfer.status === 'RECEIVED') {
      return this.transferResult(id, true);
    }
    if (['CANCELLED', 'REJECTED'].includes(transfer.status)) {
      throw new BadRequestException('Это перемещение закрыто без приёмки.');
    }

    const manifest = transferManifest(transfer.manifest);
    const normalizedCode = normalizeBoxCode(boxCode);
    const manifestBox = manifest.boxes.find(
      (box) => normalizeBoxCode(box.code) === normalizedCode,
    );
    if (!manifestBox) {
      await this.recordIssue(
        transfer.id,
        boxCode,
        'UNEXPECTED_BOX',
        `Короб ${boxCode} не входит в перемещение №${transfer.number}.`,
        user,
      );
      throw new BadRequestException(
        `Короб ${boxCode} не входит в перемещение №${transfer.number}. Проблема зарегистрирована.`,
      );
    }
    const receivedCodes = transferBoxCodes(transfer.receivedBoxCodes);
    if (receivedCodes.includes(normalizeBoxCode(manifestBox.code))) {
      return this.transferResult(id, true);
    }

    const physicalBox = await this.prisma.box.findUnique({
      where: { id: manifestBox.boxId },
      select: { id: true, code: true, clientId: true, warehouseId: true, status: true },
    });
    if (
      !physicalBox ||
      physicalBox.clientId !== transfer.clientId ||
      physicalBox.warehouseId !== transfer.fromWarehouseId ||
      physicalBox.status !== 'in_transit'
    ) {
      await this.recordIssue(
        transfer.id,
        boxCode,
        'BOX_STATE_MISMATCH',
        `Состояние короба ${boxCode} не совпадает с манифестом перемещения.`,
        user,
      );
      throw new BadRequestException(
        `Короб ${boxCode} не готов к приёмке. Проблема зарегистрирована.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const balances = await tx.stockBalance.findMany({
        where: {
          boxId: physicalBox.id,
          status: StockStatus.IN_TRANSIT,
          quantity: { gt: 0 },
        },
      });
      const acceptedQuantity = balances.reduce((sum, balance) => sum + balance.quantity, 0);
      if (acceptedQuantity !== manifestBox.quantity) {
        throw new BadRequestException(
          `Количество в коробе ${boxCode} не совпадает с манифестом перемещения.`,
        );
      }
      for (const balance of balances) {
        await tx.stockBalance.update({
          where: { id: balance.id },
          data: {
            warehouseId: transfer.toWarehouseId,
            status: StockStatus.AVAILABLE,
            balanceKey: stockBalanceKey(
              balance.clientId,
              balance.skuId,
              balance.boxId,
              balance.palletId,
              StockStatus.AVAILABLE,
            ),
          },
        });
        await tx.stockMovement.createMany({
          data: [
            {
              warehouseId: transfer.fromWarehouseId,
              clientId: balance.clientId,
              skuId: balance.skuId,
              boxId: physicalBox.id,
              type: MovementType.MOVE,
              status: StockStatus.IN_TRANSIT,
              quantity: -balance.quantity,
              sourceDocument: transferDocument(
                transfer.fromWarehouse.code,
                transfer.toWarehouse.code,
                'Приёмка',
              ),
              comment: transfer.comment,
            },
            {
              warehouseId: transfer.toWarehouseId,
              clientId: balance.clientId,
              skuId: balance.skuId,
              boxId: physicalBox.id,
              type: MovementType.RECEIPT,
              status: StockStatus.AVAILABLE,
              quantity: balance.quantity,
              sourceDocument: transferDocument(
                transfer.fromWarehouse.code,
                transfer.toWarehouse.code,
                'Приёмка',
              ),
              comment: transfer.comment,
            },
          ],
        });
      }
      await tx.productMark.updateMany({
        where: { boxId: physicalBox.id, status: StockStatus.IN_TRANSIT },
        data: { status: StockStatus.AVAILABLE },
      });
      await tx.box.update({
        where: { id: physicalBox.id },
        data: {
          warehouseId: transfer.toWarehouseId,
          status: 'active',
          zoneId: null,
          palletId: null,
        },
      });

      const nextReceivedCodes = [...receivedCodes, normalizeBoxCode(manifestBox.code)];
      const receivedAll = nextReceivedCodes.length === manifest.boxes.length;
      await tx.interWarehouseTransfer.update({
        where: { id: transfer.id },
        data: {
          receivedBoxCodes: nextReceivedCodes,
          receivedQuantity: { increment: acceptedQuantity },
          status: receivedAll ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          receivedByUserId: user.id,
          receivedByName: user.name,
          receivedAt: receivedAll ? new Date() : null,
        },
      });
      await tx.warehouseClient.upsert({
        where: {
          warehouseId_clientId: {
            warehouseId: transfer.toWarehouseId,
            clientId: transfer.clientId,
          },
        },
        update: { status: 'ACTIVE', activatedAt: new Date() },
        create: {
          warehouseId: transfer.toWarehouseId,
          clientId: transfer.clientId,
          activatedByTransferId: transfer.id,
          status: 'ACTIVE',
          source: 'TRANSFER',
          activatedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'branches.transfer.receive-box',
          entity: 'inter-warehouse-transfer',
          entityId: transfer.id,
          payload: {
            boxCode: manifestBox.code,
            acceptedQuantity,
            fromWarehouseId: transfer.fromWarehouseId,
            toWarehouseId: transfer.toWarehouseId,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.transferResult(id, false);
  }

  private async legacyImmediateTransfer(body: Record<string, unknown>, user: AuthUser) {
    const clientId = requiredText(body.clientId, 'Выберите клиента.');
    const fromWarehouseId = requiredText(body.fromWarehouseId || user.activeWarehouseId, 'Выберите филиал отправления.');
    const toWarehouseId = requiredText(body.toWarehouseId, 'Выберите филиал назначения.');
    const items = transferItems(body.items);
    this.clientScopes.requireClientAccess(user, clientId, 'write');
    if (fromWarehouseId === toWarehouseId) throw new BadRequestException('Филиалы отправления и назначения совпадают.');
    if (!this.isNetworkAdmin(user) && (!(user.writableWarehouseIds ?? []).includes(fromWarehouseId) || user.activeWarehouseId !== fromWarehouseId)) {
      throw new ForbiddenException('Менеджер может отправлять товар только из своего активного филиала.');
    }

    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.requireWarehouse(fromWarehouseId),
      this.requireWarehouse(toWarehouseId),
    ]);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const destinationBoxCode = `МП-${toWarehouse.code}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      const destinationBox = await tx.box.create({
        data: { clientId, warehouseId: toWarehouseId, code: destinationBoxCode, status: 'active' },
      });
      const sourceBoxCodes = new Set<string>();
      const savedItems: Array<{ skuId: string; quantity: number; internalSku: string; name: string }> = [];

      for (const item of items) {
        const sku = await tx.sku.findFirst({
          where: { id: item.skuId, clientId },
          select: { id: true, internalSku: true, name: true, needsChestnyZnak: true },
        });
        if (!sku) throw new BadRequestException('Один из товаров не принадлежит выбранному клиенту.');
        const balances = await tx.stockBalance.findMany({
          where: {
            clientId,
            skuId: item.skuId,
            status: StockStatus.AVAILABLE,
            quantity: { gt: 0 },
            box: { warehouseId: fromWarehouseId, status: { notIn: ['deleted', 'archived'] } },
          },
          include: { box: { select: { id: true, code: true } } },
          orderBy: { updatedAt: 'asc' },
        });
        const available = balances.reduce((sum, balance) => sum + balance.quantity, 0);
        if (available < item.quantity) {
          throw new BadRequestException(`В филиале ${fromWarehouse.city} недостаточно товара ${sku.internalSku}: доступно ${available}, нужно ${item.quantity}.`);
        }

        let remaining = item.quantity;
        for (const balance of balances) {
          if (remaining <= 0) break;
          const moved = Math.min(balance.quantity, remaining);
          sourceBoxCodes.add(balance.box?.code || '');
          if (sku.needsChestnyZnak && balance.boxId) {
            const marks = await tx.productMark.findMany({
              where: { clientId, skuId: sku.id, boxId: balance.boxId, status: StockStatus.AVAILABLE },
              select: { id: true },
              take: moved,
            });
            if (marks.length < moved) {
              throw new BadRequestException(`Для маркированного товара ${sku.internalSku} не хватает КИЗ в исходном коробе.`);
            }
            await tx.productMark.updateMany({
              where: { id: { in: marks.map((mark) => mark.id) } },
              data: { boxId: destinationBox.id },
            });
          }
          if (moved === balance.quantity) await tx.stockBalance.delete({ where: { id: balance.id } });
          else await tx.stockBalance.update({ where: { id: balance.id }, data: { quantity: { decrement: moved } } });
          await tx.stockMovement.create({
            data: {
              clientId,
              skuId: sku.id,
              boxId: balance.boxId,
              type: MovementType.MOVE,
              status: StockStatus.AVAILABLE,
              quantity: -moved,
              sourceDocument: `Межфилиальное перемещение ${fromWarehouse.code} → ${toWarehouse.code}`,
              comment: text(body.comment) || null,
            },
          });
          remaining -= moved;
        }

        const balanceKey = [clientId, sku.id, destinationBox.id, 'no-pallet', StockStatus.AVAILABLE].join(':');
        await tx.stockBalance.create({
          data: {
            balanceKey,
            clientId,
            skuId: sku.id,
            boxId: destinationBox.id,
            status: StockStatus.AVAILABLE,
            quantity: item.quantity,
          },
        });
        await tx.stockMovement.create({
          data: {
            clientId,
            skuId: sku.id,
            boxId: destinationBox.id,
            type: MovementType.MOVE,
            status: StockStatus.AVAILABLE,
            quantity: item.quantity,
            sourceDocument: `Межфилиальное перемещение ${fromWarehouse.code} → ${toWarehouse.code}`,
            comment: text(body.comment) || null,
          },
        });
        savedItems.push({ skuId: sku.id, quantity: item.quantity, internalSku: sku.internalSku, name: sku.name });
      }

      const transfer = await tx.interWarehouseTransfer.create({
        data: {
          clientId,
          fromWarehouseId,
          toWarehouseId,
          items: savedItems,
          totalQuantity,
          sourceBoxCodes: [...sourceBoxCodes].filter(Boolean),
          destinationBoxCode,
          comment: text(body.comment) || null,
          createdByUserId: user.id,
          createdByName: user.name,
          receivedAt: new Date(),
        },
        include: {
          client: { select: { id: true, code: true, name: true } },
          fromWarehouse: { select: { id: true, code: true, name: true, city: true } },
          toWarehouse: { select: { id: true, code: true, name: true, city: true } },
        },
      });
      await tx.warehouseClient.upsert({
        where: { warehouseId_clientId: { warehouseId: toWarehouseId, clientId } },
        update: {},
        create: { warehouseId: toWarehouseId, clientId, activatedByTransferId: transfer.id },
      });
      const managers = await tx.userWarehouse.findMany({
        where: { warehouseId: toWarehouseId, canRead: true },
        select: { userId: true, canWrite: true },
      });
      if (managers.length) {
        await Promise.all(managers.map((manager) =>
          tx.userClient.upsert({
            where: { userId_clientId: { userId: manager.userId, clientId } },
            update: { canRead: true, canWrite: manager.canWrite },
            create: { userId: manager.userId, clientId, canRead: true, canWrite: manager.canWrite },
          }),
        ));
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'branches.transfer',
          entity: 'inter-warehouse-transfer',
          entityId: transfer.id,
          payload: { fromWarehouseId, toWarehouseId, clientId, totalQuantity, destinationBoxCode },
        },
      });
      return transfer;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async dispatchWholeBoxes(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      requestedBoxCodes: string[];
      fromWarehouse: { id: string; code: string; city: string };
      toWarehouse: { id: string; code: string; city: string };
      comment: string | null;
    },
  ) {
    const boxes = await tx.box.findMany({
      where: {
        clientId: input.clientId,
        warehouseId: input.fromWarehouse.id,
        code: { in: input.requestedBoxCodes, mode: 'insensitive' },
        status: { notIn: ['deleted', 'archived', 'in_transit'] },
      },
      include: {
        balances: {
          where: { quantity: { gt: 0 } },
          include: {
            sku: {
              select: {
                id: true,
                internalSku: true,
                name: true,
                needsChestnyZnak: true,
              },
            },
          },
        },
      },
    });
    const foundCodes = new Set(boxes.map((box) => normalizeBoxCode(box.code)));
    const missingCodes = input.requestedBoxCodes.filter((code) => !foundCodes.has(code));
    if (missingCodes.length) {
      throw new BadRequestException(
        `Короба не найдены в филиале ${input.fromWarehouse.city}: ${missingCodes.join(', ')}.`,
      );
    }

    const manifest: TransferManifest = { boxes: [] };
    const savedItems: Array<{
      skuId: string;
      quantity: number;
      internalSku: string;
      name: string;
    }> = [];
    for (const box of boxes) {
      if (!box.balances.length) {
        throw new BadRequestException(`В коробе ${box.code} нет положительного остатка.`);
      }
      if (box.balances.some((balance) => balance.status !== StockStatus.AVAILABLE)) {
        throw new BadRequestException(
          `Короб ${box.code} содержит зарезервированный или заблокированный товар.`,
        );
      }
      const grouped = new Map<
        string,
        {
          skuId: string;
          internalSku: string;
          name: string;
          needsChestnyZnak: boolean;
          quantity: number;
          balanceIds: string[];
        }
      >();
      for (const balance of box.balances) {
        const row = grouped.get(balance.skuId) ?? {
          skuId: balance.skuId,
          internalSku: balance.sku.internalSku,
          name: balance.sku.name,
          needsChestnyZnak: balance.sku.needsChestnyZnak,
          quantity: 0,
          balanceIds: [],
        };
        row.quantity += balance.quantity;
        row.balanceIds.push(balance.id);
        grouped.set(balance.skuId, row);
      }

      const manifestItems: TransferManifestItem[] = [];
      for (const row of grouped.values()) {
        const marks = row.needsChestnyZnak
          ? await tx.productMark.findMany({
              where: {
                clientId: input.clientId,
                skuId: row.skuId,
                boxId: box.id,
                status: StockStatus.AVAILABLE,
              },
              select: { id: true },
              take: row.quantity,
            })
          : [];
        if (row.needsChestnyZnak && marks.length < row.quantity) {
          throw new BadRequestException(
            `В коробе ${box.code} не хватает КИЗ для ${row.internalSku}.`,
          );
        }
        const markIds = marks.map((mark) => mark.id);
        await tx.stockBalance.deleteMany({ where: { id: { in: row.balanceIds } } });
        await tx.stockBalance.create({
          data: {
            balanceKey: stockBalanceKey(
              input.clientId,
              row.skuId,
              box.id,
              null,
              StockStatus.IN_TRANSIT,
            ),
            clientId: input.clientId,
            skuId: row.skuId,
            boxId: box.id,
            status: StockStatus.IN_TRANSIT,
            quantity: row.quantity,
          },
        });
        if (markIds.length) {
          await tx.productMark.updateMany({
            where: { id: { in: markIds } },
            data: { status: StockStatus.IN_TRANSIT },
          });
        }
        await this.recordTransferMovement(tx, {
          clientId: input.clientId,
          skuId: row.skuId,
          boxId: box.id,
          quantity: row.quantity,
          fromWarehouseCode: input.fromWarehouse.code,
          toWarehouseCode: input.toWarehouse.code,
          comment: input.comment,
        });
        manifestItems.push({
          skuId: row.skuId,
          internalSku: row.internalSku,
          name: row.name,
          quantity: row.quantity,
          sourceAllocations: [
            {
              boxId: box.id,
              boxCode: box.code,
              quantity: row.quantity,
              markIds,
            },
          ],
        });
        mergeSavedItem(savedItems, row);
      }
      await tx.storagePalletBox.deleteMany({ where: { boxId: box.id } });
      await tx.box.update({
        where: { id: box.id },
        data: { status: 'in_transit', zoneId: null, palletId: null },
      });
      manifest.boxes.push({
        boxId: box.id,
        code: box.code,
        generated: false,
        quantity: manifestItems.reduce((sum, item) => sum + item.quantity, 0),
        items: manifestItems,
      });
    }

    return {
      manifest,
      savedItems,
      sourceBoxCodes: boxes.map((box) => box.code),
      destinationBoxCode: null,
      totalQuantity: manifest.boxes.reduce((sum, box) => sum + box.quantity, 0),
    };
  }

  private async dispatchItems(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      items: TransferItem[];
      fromWarehouse: { id: string; code: string; city: string };
      toWarehouse: { id: string; code: string; city: string };
      comment: string | null;
    },
  ) {
    const transitBoxCode = `MOVE-${input.fromWarehouse.code}-${input.toWarehouse.code}-${Date.now()
      .toString(36)
      .toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const transitBox = await tx.box.create({
      data: {
        clientId: input.clientId,
        warehouseId: input.fromWarehouse.id,
        code: transitBoxCode,
        status: 'in_transit',
      },
    });
    const sourceBoxCodes = new Set<string>();
    const savedItems: Array<{
      skuId: string;
      quantity: number;
      internalSku: string;
      name: string;
    }> = [];
    const manifestItems: TransferManifestItem[] = [];
    for (const item of input.items) {
      const sku = await tx.sku.findFirst({
        where: { id: item.skuId, clientId: input.clientId },
        select: { id: true, internalSku: true, name: true, needsChestnyZnak: true },
      });
      if (!sku) {
        throw new BadRequestException(
          'Один из товаров не принадлежит выбранному клиенту.',
        );
      }
      const balances = await tx.stockBalance.findMany({
        where: {
          clientId: input.clientId,
          skuId: item.skuId,
          boxId: { not: null },
          status: StockStatus.AVAILABLE,
          quantity: { gt: 0 },
          box: {
            warehouseId: input.fromWarehouse.id,
            status: { notIn: ['deleted', 'archived', 'in_transit'] },
          },
        },
        include: { box: { select: { id: true, code: true } } },
        orderBy: { updatedAt: 'asc' },
      });
      const available = balances.reduce((sum, balance) => sum + balance.quantity, 0);
      if (available < item.quantity) {
        throw new BadRequestException(
          `В филиале ${input.fromWarehouse.city} недостаточно товара ${sku.internalSku}: доступно ${available}, нужно ${item.quantity}.`,
        );
      }

      let remaining = item.quantity;
      const sourceAllocations: TransferSourceAllocation[] = [];
      for (const balance of balances) {
        if (remaining <= 0) break;
        if (!balance.boxId || !balance.box) continue;
        const moved = Math.min(balance.quantity, remaining);
        const marks = sku.needsChestnyZnak
          ? await tx.productMark.findMany({
              where: {
                clientId: input.clientId,
                skuId: sku.id,
                boxId: balance.boxId,
                status: StockStatus.AVAILABLE,
              },
              select: { id: true },
              take: moved,
            })
          : [];
        if (sku.needsChestnyZnak && marks.length < moved) {
          throw new BadRequestException(
            `Для маркированного товара ${sku.internalSku} не хватает КИЗ в исходном коробе ${balance.box.code}.`,
          );
        }
        const markIds = marks.map((mark) => mark.id);
        if (markIds.length) {
          await tx.productMark.updateMany({
            where: { id: { in: markIds } },
            data: { boxId: transitBox.id, status: StockStatus.IN_TRANSIT },
          });
        }
        if (moved === balance.quantity) {
          await tx.stockBalance.delete({ where: { id: balance.id } });
        } else {
          await tx.stockBalance.update({
            where: { id: balance.id },
            data: { quantity: { decrement: moved } },
          });
        }
        await tx.stockMovement.create({
          data: {
            clientId: input.clientId,
            skuId: sku.id,
            boxId: balance.boxId,
            type: MovementType.MOVE,
            status: StockStatus.AVAILABLE,
            quantity: -moved,
            sourceDocument: transferDocument(
              input.fromWarehouse.code,
              input.toWarehouse.code,
              'Отправка',
            ),
            comment: input.comment,
          },
        });
        sourceBoxCodes.add(balance.box.code);
        sourceAllocations.push({
          boxId: balance.boxId,
          boxCode: balance.box.code,
          quantity: moved,
          markIds,
        });
        remaining -= moved;
      }
      await tx.stockBalance.create({
        data: {
          balanceKey: stockBalanceKey(
            input.clientId,
            sku.id,
            transitBox.id,
            null,
            StockStatus.IN_TRANSIT,
          ),
          clientId: input.clientId,
          skuId: sku.id,
          boxId: transitBox.id,
          status: StockStatus.IN_TRANSIT,
          quantity: item.quantity,
        },
      });
      await tx.stockMovement.create({
        data: {
          clientId: input.clientId,
          skuId: sku.id,
          boxId: transitBox.id,
          type: MovementType.MOVE,
          status: StockStatus.IN_TRANSIT,
          quantity: item.quantity,
          sourceDocument: transferDocument(
            input.fromWarehouse.code,
            input.toWarehouse.code,
            'Отправка',
          ),
          comment: input.comment,
        },
      });
      const savedItem = {
        skuId: sku.id,
        quantity: item.quantity,
        internalSku: sku.internalSku,
        name: sku.name,
      };
      mergeSavedItem(savedItems, savedItem);
      manifestItems.push({ ...savedItem, sourceAllocations });
    }
    const manifest: TransferManifest = {
      boxes: [
        {
          boxId: transitBox.id,
          code: transitBox.code,
          generated: true,
          quantity: manifestItems.reduce((sum, item) => sum + item.quantity, 0),
          items: manifestItems,
        },
      ],
    };
    return {
      manifest,
      savedItems,
      sourceBoxCodes: [...sourceBoxCodes],
      destinationBoxCode: transitBox.code,
      totalQuantity: manifest.boxes[0].quantity,
    };
  }

  private async recordTransferMovement(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      skuId: string;
      boxId: string;
      quantity: number;
      fromWarehouseCode: string;
      toWarehouseCode: string;
      comment: string | null;
    },
  ) {
    await tx.stockMovement.createMany({
      data: [
        {
          clientId: input.clientId,
          skuId: input.skuId,
          boxId: input.boxId,
          type: MovementType.MOVE,
          status: StockStatus.AVAILABLE,
          quantity: -input.quantity,
          sourceDocument: transferDocument(
            input.fromWarehouseCode,
            input.toWarehouseCode,
            'Отправка',
          ),
          comment: input.comment,
        },
        {
          clientId: input.clientId,
          skuId: input.skuId,
          boxId: input.boxId,
          type: MovementType.MOVE,
          status: StockStatus.IN_TRANSIT,
          quantity: input.quantity,
          sourceDocument: transferDocument(
            input.fromWarehouseCode,
            input.toWarehouseCode,
            'Отправка',
          ),
          comment: input.comment,
        },
      ],
    });
  }

  private async transferResult(id: string, alreadyReceived: boolean) {
    const row = await this.prisma.interWarehouseTransfer.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, code: true, name: true } },
        fromWarehouse: { select: { id: true, code: true, name: true, city: true } },
        toWarehouse: { select: { id: true, code: true, name: true, city: true } },
        issues: { where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) {
      throw new NotFoundException('Межфилиальное перемещение не найдено.');
    }
    return { ...row, alreadyReceived };
  }

  private recordIssue(
    transferId: string,
    boxCode: string,
    type: string,
    message: string,
    user: AuthUser,
  ) {
    return this.prisma.interWarehouseTransferIssue.create({
      data: {
        transferId,
        boxCode,
        type,
        message,
        createdByUserId: user.id,
        createdByName: user.name,
      },
    });
  }

  private async requireWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Филиал не найден.');
    return warehouse;
  }

  private async requireOwnCompany(id: string) {
    const company = await this.prisma.ownCompany.findUnique({ where: { id }, select: { id: true } });
    if (!company) throw new NotFoundException('ИП или организация филиала не найдены.');
  }

  private requireAdmin(user: AuthUser) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Операция доступна только администратору всех филиалов.');
  }

  private isAdmin(user: AuthUser) {
    return user.permissionCodes.includes('system:admin');
  }

  private isNetworkAdmin(user: AuthUser) {
    return this.isAdmin(user) || Boolean(user.isDemo && user.roleCodes.includes('DEMO_PLUS'));
  }

  private isClient(user: AuthUser) {
    return user.roleCodes.includes('CLIENT');
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(value: unknown, message: string) {
  const valueText = text(value);
  if (!valueText) throw new BadRequestException(message);
  return valueText;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function transferItems(value: unknown): TransferItem[] {
  if (!Array.isArray(value)) throw new BadRequestException('Добавьте товары для перемещения.');
  const rows = value.map((row) => {
    const record = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {};
    return { skuId: text(record.skuId), quantity: positiveInteger(record.quantity, 0) };
  }).filter((row) => row.skuId && row.quantity > 0);
  const grouped = new Map<string, number>();
  for (const row of rows) {
    grouped.set(row.skuId, (grouped.get(row.skuId) ?? 0) + row.quantity);
  }
  const items = [...grouped].map(([skuId, quantity]) => ({ skuId, quantity }));
  if (!items.length) throw new BadRequestException('Добавьте хотя бы один товар с количеством больше нуля.');
  return items;
}

function transferBoxCodes(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,;]+/)
      : [];
  return [...new Set(source.map((item) => normalizeBoxCode(String(item))).filter(Boolean))];
}

function normalizeBoxCode(value: string) {
  return value.trim().toUpperCase();
}

function invalidPreviewRow(
  box: { code: string; row: number },
  reason: string,
) {
  return {
    row: box.row,
    code: box.code,
    status: 'ERROR' as const,
    quantity: 0,
    skuCount: 0,
    reason,
  };
}

function normalizeUploadedFileName(value: unknown) {
  return (
    text(value)
      .replace(/^.*[\\/]/, '')
      .replace(/[\u0000-\u001f<>:"|?*]+/g, '_')
      .slice(0, 255) || 'короба.xlsx'
  );
}

function transferManifest(value: unknown): TransferManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('В перемещении отсутствует манифест коробов.');
  }
  const boxes = (value as { boxes?: unknown }).boxes;
  if (!Array.isArray(boxes)) {
    throw new BadRequestException('В перемещении отсутствует манифест коробов.');
  }
  return {
    boxes: boxes.map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      return {
        boxId: text(row.boxId),
        code: text(row.code),
        generated: row.generated === true,
        quantity: positiveInteger(row.quantity, 0),
        items: Array.isArray(row.items) ? row.items as TransferManifestItem[] : [],
      };
    }).filter((box) => box.boxId && box.code && box.quantity > 0),
  };
}

function mergeSavedItem(
  target: Array<{ skuId: string; quantity: number; internalSku: string; name: string }>,
  item: { skuId: string; quantity: number; internalSku: string; name: string },
) {
  const existing = target.find((row) => row.skuId === item.skuId);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    target.push({
      skuId: item.skuId,
      quantity: item.quantity,
      internalSku: item.internalSku,
      name: item.name,
    });
  }
}

function stockBalanceKey(
  clientId: string,
  skuId: string,
  boxId: string | null,
  palletId: string | null,
  status: StockStatus,
) {
  return [
    clientId,
    skuId,
    boxId ?? 'no-box',
    palletId ?? 'no-pallet',
    status,
  ].join(':');
}

function transferDocument(fromWarehouseCode: string, toWarehouseCode: string, action: string) {
  return `${action}: межфилиальное перемещение ${fromWarehouseCode} → ${toWarehouseCode}`;
}
