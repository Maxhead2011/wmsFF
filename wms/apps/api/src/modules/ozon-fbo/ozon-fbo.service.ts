import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { buildOzonFboAssemblyWorkbook, parseOzonFboWorkbook } from './ozon-fbo-xlsx';

type OzonConnection = {
  id: string;
  clientId: string;
  marketplace: string;
  accountName: string | null;
  sellerId: string | null;
  apiKey: string;
  isActive: boolean;
};

type OzonCluster = {
  id: string | number;
  name: string;
  macrolocal_cluster_id: string | number;
  logistic_clusters?: Array<{
    warehouses?: Array<{ name?: string; type?: string; warehouse_id?: string | number }>;
  }>;
};

@Injectable()
export class OzonFboService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientScope: ClientScopeService,
  ) {}

  async overview(clientId: string, user: AuthUser) {
    this.requireClientId(clientId);
    this.clientScope.requireClientAccess(user, clientId, 'read');
    const [connections, plans] = await Promise.all([
      this.prisma.clientMarketplaceConnection.findMany({
        where: { clientId, marketplace: 'OZON', isActive: true },
        select: { id: true, accountName: true, sellerId: true, isActive: true, updatedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ozonFboPlan.findMany({
        where: { clientId },
        include: {
          clusters: { include: { items: true, boxes: true }, orderBy: { sourceName: 'asc' } },
          _count: { select: { boxes: true, events: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return {
      connections: connections.map((connection) => ({
        ...connection,
        configured: Boolean(connection.sellerId),
      })),
      plans: plans.map((plan) => this.planSummary(plan)),
    };
  }

  async getPlan(id: string, user: AuthUser) {
    const plan = await this.findPlan(id);
    this.clientScope.requireClientAccess(user, plan.clientId, 'read');
    return plan;
  }

  async listClusters(connectionId: string, user: AuthUser) {
    const connection = await this.connection(connectionId, user, 'read');
    const response = await this.ozonJson<{ clusters?: OzonCluster[] }>(connection, '/v1/cluster/list', {
      cluster_type: 'CLUSTER_TYPE_OZON',
      cluster_ids: [],
    });
    return (response.clusters ?? []).map((cluster) => ({
      id: String(cluster.id),
      name: cluster.name,
      macrolocalClusterId: String(cluster.macrolocal_cluster_id),
      warehouses: (cluster.logistic_clusters ?? []).flatMap((item) => item.warehouses ?? []).map((warehouse) => ({
        id: String(warehouse.warehouse_id ?? ''),
        name: warehouse.name ?? '',
        type: warehouse.type ?? '',
      })),
    }));
  }

  async listDropoffWarehouses(connectionId: string, search: string, supplyType: string, user: AuthUser) {
    const connection = await this.connection(connectionId, user, 'read');
    const normalizedType = supplyType === 'DIRECT' ? 'CREATE_TYPE_DIRECT' : 'CREATE_TYPE_CROSSDOCK';
    const response = await this.ozonJson<{ search?: unknown[] }>(connection, '/v1/warehouse/fbo/list', {
      filter_by_supply_type: [normalizedType],
      search: String(search ?? '').trim(),
    });
    return response.search ?? [];
  }

  async importPlan(
    input: { clientId?: string; connectionId?: string; title?: string },
    file: Express.Multer.File | undefined,
    user: AuthUser,
  ) {
    const clientId = String(input.clientId ?? '').trim();
    const connectionId = String(input.connectionId ?? '').trim();
    this.requireClientId(clientId);
    if (!file?.buffer?.length) throw new BadRequestException('Загрузите Excel-файл с распределением Ozon FBO.');
    if (!/\.(xlsx|xls)$/i.test(file.originalname)) throw new BadRequestException('Поддерживаются файлы XLSX и XLS.');
    this.clientScope.requireClientAccess(user, clientId, 'write');
    const connection = await this.connection(connectionId, user, 'write', clientId);
    const parsed = parseOzonFboWorkbook(file.buffer);
    const [ozonClusters, ozonProducts, localSkus] = await Promise.all([
      this.fetchClusters(connection),
      this.fetchProducts(connection, parsed.offerIds),
      this.prisma.sku.findMany({
        where: {
          clientId,
          OR: [
            { internalSku: { in: parsed.offerIds } },
            { clientSku: { in: parsed.offerIds } },
            { article: { in: parsed.offerIds } },
            { marketplaceOfferId: { in: parsed.offerIds } },
          ],
        },
        select: { id: true, internalSku: true, clientSku: true, article: true, marketplaceOfferId: true, name: true },
      }),
    ]);
    const productByOffer = new Map(ozonProducts.map((item) => [String(item.offer_id), item]));
    const skuByOffer = new Map<string, (typeof localSkus)[number]>();
    for (const sku of localSkus) {
      for (const key of [sku.internalSku, sku.clientSku, sku.article, sku.marketplaceOfferId]) {
        if (key && !skuByOffer.has(key)) skuByOffer.set(key, sku);
      }
    }

    const clusters = parsed.destinations.map((destination) => {
      const match = matchCluster(destination.sourceName, ozonClusters);
      return {
        sourceName: destination.sourceName,
        clusterId: match ? String(match.id) : null,
        macrolocalClusterId: match ? String(match.macrolocal_cluster_id) : null,
        clusterName: match?.name ?? null,
        status: match ? 'MAPPED' : 'NEEDS_MAPPING',
        validationMessage: match ? null : `Не найден кластер Ozon для «${destination.sourceName}». Выберите его вручную.`,
        items: destination.items.map((item) => {
          const product = productByOffer.get(item.offerId);
          const sku = skuByOffer.get(item.offerId);
          const errors = [
            !product ? 'Артикул не найден в кабинете Ozon' : null,
            !sku ? 'Артикул не найден в каталоге WMS' : null,
          ].filter(Boolean);
          return {
            offerId: item.offerId,
            ozonSku: product?.sku ? String(product.sku) : null,
            productName: sku?.name ?? product?.name ?? null,
            skuId: sku?.id ?? null,
            quantity: item.quantity,
            isValid: errors.length === 0,
            validationMessage: errors.length ? errors.join('; ') : null,
          };
        }),
      };
    });
    const unresolvedClusters = clusters.filter((cluster) => !cluster.macrolocalClusterId).length;
    const invalidItems = clusters.flatMap((cluster) => cluster.items).filter((item) => !item.isValid).length;
    const status = unresolvedClusters || invalidItems ? 'NEEDS_ATTENTION' : 'READY';
    const title = String(input.title ?? '').trim() || `FBO Ozon · ${new Date().toLocaleDateString('ru-RU')}`;

    const planId = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.ozonFboPlan.create({
        data: {
          clientId,
          connectionId,
          title,
          status,
          sourceFileName: file.originalname,
          sourceWorkbook: Uint8Array.from(file.buffer),
          createdByUserId: user.id,
          createdByName: user.name,
          importSummary: this.json({
            sheetName: parsed.sheetName,
            destinations: clusters.length,
            offers: parsed.offerIds.length,
            totalUnits: parsed.totalUnits,
            unresolvedClusters,
            invalidItems,
            warnings: parsed.warnings,
          }),
          events: {
            create: {
              type: 'IMPORTED',
              message: `Импортирован Excel: ${parsed.totalUnits} шт., ${clusters.length} направлений.`,
              userId: user.id,
              userName: user.name,
            },
          },
        },
      });
      for (const cluster of clusters) {
        const clusterRow = await tx.ozonFboPlanCluster.create({
          data: {
            planId: plan.id,
            sourceName: cluster.sourceName,
            clusterId: cluster.clusterId,
            macrolocalClusterId: cluster.macrolocalClusterId,
            clusterName: cluster.clusterName,
            status: cluster.status,
            validationMessage: cluster.validationMessage,
          },
        });
        await tx.ozonFboPlanItem.createMany({
          data: cluster.items.map((item) => ({
            ...item,
            productName: item.productName ? String(item.productName) : null,
            planId: plan.id,
            clusterId: clusterRow.id,
          })),
        });
      }
      return plan.id;
    });
    return this.findPlan(planId);
  }

  async mapCluster(
    planId: string,
    clusterRowId: string,
    body: { clusterId?: string; macrolocalClusterId?: string; clusterName?: string },
    user: AuthUser,
  ) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'write');
    const row = plan.clusters.find((cluster) => cluster.id === clusterRowId);
    if (!row) throw new NotFoundException('Направление в плане не найдено.');
    if (!body.clusterId || !body.macrolocalClusterId || !body.clusterName) {
      throw new BadRequestException('Выберите кластер Ozon.');
    }
    await this.prisma.ozonFboPlanCluster.update({
      where: { id: clusterRowId },
      data: {
        clusterId: String(body.clusterId),
        macrolocalClusterId: String(body.macrolocalClusterId),
        clusterName: String(body.clusterName),
        status: 'MAPPED',
        validationMessage: null,
      },
    });
    await this.recalculatePlanReadiness(planId);
    await this.event(planId, 'CLUSTER_MAPPED', `${row.sourceName} → ${body.clusterName}`, user);
    return this.findPlan(planId);
  }

  async setDropoff(
    planId: string,
    body: { warehouseId?: string; name?: string; type?: string; deliveryType?: string },
    user: AuthUser,
  ) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'write');
    if (!body.warehouseId || !body.type) throw new BadRequestException('Выберите точку отгрузки Ozon.');
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: {
        dropOffWarehouseId: String(body.warehouseId),
        dropOffWarehouseName: String(body.name ?? ''),
        dropOffWarehouseType: String(body.type),
        deliveryType: body.deliveryType === 'PICKUP' ? 'PICKUP' : 'DROPOFF',
      },
    });
    await this.event(planId, 'DROPOFF_SELECTED', `Выбрана точка отгрузки: ${body.name ?? body.warehouseId}`, user);
    return this.findPlan(planId);
  }

  async createDraft(planId: string, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'write');
    this.assertPlanReadyForOzon(plan);
    const connection = await this.connection(plan.connectionId, user, 'write', plan.clientId);
    const grouped = new Map<string, Array<{ quantity: number; sku: number }>>();
    for (const cluster of plan.clusters) {
      const key = String(cluster.macrolocalClusterId);
      const items = grouped.get(key) ?? [];
      for (const item of cluster.items) items.push({ quantity: item.quantity, sku: Number(item.ozonSku) });
      grouped.set(key, items);
    }
    const response = await this.ozonJson<any>(connection, '/v1/draft/multi-cluster/create', {
      clusters_info: Array.from(grouped.entries()).map(([macrolocalClusterId, items]) => ({
        macrolocal_cluster_id: Number(macrolocalClusterId),
        items,
      })),
      deletion_sku_mode: 'PARTIAL',
      delivery_info: {
        type: plan.deliveryType === 'PICKUP' ? 'PICKUP' : 'DROPOFF',
        drop_off_warehouse: {
          warehouse_id: Number(plan.dropOffWarehouseId),
          warehouse_type: plan.dropOffWarehouseType,
        },
      },
    });
    if (!response.draft_id) throw new BadGatewayException({ message: 'Ozon не вернул идентификатор черновика.', details: response.errors });
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: { draftId: String(response.draft_id), status: 'DRAFT_CREATED', lastError: null, lastSyncAt: new Date() },
    });
    await this.event(planId, 'DRAFT_CREATED', `Создан черновик Ozon №${response.draft_id}.`, user);
    return this.refreshDraft(planId, user);
  }

  async refreshDraft(planId: string, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'read');
    if (!plan.draftId) throw new BadRequestException('Сначала создайте черновик Ozon.');
    const connection = await this.connection(plan.connectionId, user, 'read', plan.clientId);
    const response = await this.ozonJson<any>(connection, '/v2/draft/create/info', { draft_id: Number(plan.draftId) });
    for (const cluster of response.clusters ?? []) {
      const row = plan.clusters.find((item) => String(item.macrolocalClusterId) === String(cluster.macrolocal_cluster_id));
      if (!row) continue;
      const warehouse = (cluster.warehouses ?? []).find((item: any) => String(item.availability_status ?? '').includes('AVAILABLE'))
        ?? cluster.warehouses?.[0];
      if (!warehouse?.storage_warehouse?.id) continue;
      await this.prisma.ozonFboPlanCluster.update({
        where: { id: row.id },
        data: {
          storageWarehouseId: String(warehouse.storage_warehouse.id),
          storageWarehouseName: warehouse.storage_warehouse.name ?? null,
          bundleId: warehouse.bundle_id ? String(warehouse.bundle_id) : row.bundleId,
          status: 'WAREHOUSE_SELECTED',
          validationMessage: null,
        },
      });
    }
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: {
        draftInfo: this.json(response),
        status: String(response.status ?? '').includes('SUCCESS') ? 'DRAFT_READY' : 'DRAFT_PROCESSING',
        lastSyncAt: new Date(),
        lastError: response.errors?.length ? JSON.stringify(response.errors) : null,
      },
    });
    return this.findPlan(planId);
  }

  async loadTimeslots(planId: string, body: { dateFrom?: string; dateTo?: string }, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'read');
    if (!plan.draftId) throw new BadRequestException('Сначала создайте черновик Ozon.');
    const selected = this.selectedWarehouses(plan);
    const connection = await this.connection(plan.connectionId, user, 'read', plan.clientId);
    const dateFrom = dateOnly(body.dateFrom) ?? dateOnly(new Date())!;
    const dateTo = dateOnly(body.dateTo) ?? dateOnly(new Date(Date.now() + 14 * 86_400_000))!;
    const response = await this.ozonJson<any>(connection, '/v2/draft/timeslot/info', {
      date_from: dateFrom,
      date_to: dateTo,
      draft_id: Number(plan.draftId),
      supply_type: 'MULTI_CLUSTER',
      selected_cluster_warehouses: selected,
    });
    await this.prisma.ozonFboPlan.update({ where: { id: planId }, data: { availableTimeslots: this.json(response), lastSyncAt: new Date() } });
    return response;
  }

  async bookSlot(
    planId: string,
    body: { from?: string; to?: string; confirm?: boolean },
    user: AuthUser,
  ) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'write');
    if (body.confirm !== true) throw new BadRequestException('Подтвердите создание поставки и бронирование слота.');
    if (!plan.draftId) throw new BadRequestException('Сначала создайте черновик Ozon.');
    const from = validDate(body.from, 'начала слота');
    const to = validDate(body.to, 'окончания слота');
    const connection = await this.connection(plan.connectionId, user, 'write', plan.clientId);
    const response = await this.ozonJson<any>(connection, '/v2/draft/supply/create', {
      draft_id: Number(plan.draftId),
      selected_cluster_warehouses: this.selectedWarehouses(plan),
      timeslot: { from_in_timezone: body.from, to_in_timezone: body.to },
      supply_type: 'MULTI_CLUSTER',
    });
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: {
        slotFrom: from,
        slotTo: to,
        status: 'SUPPLY_CREATING',
        lastError: response.error_reasons?.length ? JSON.stringify(response.error_reasons) : null,
        lastSyncAt: new Date(),
      },
    });
    await this.event(planId, 'SLOT_BOOKED', `Отправлен запрос на слот ${body.from} — ${body.to}.`, user);
    return this.refreshSupply(planId, user);
  }

  async refreshSupply(planId: string, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'read');
    if (!plan.draftId) throw new BadRequestException('Черновик Ozon не создан.');
    const connection = await this.connection(plan.connectionId, user, 'read', plan.clientId);
    const status = await this.ozonJson<any>(connection, '/v2/draft/supply/create/status', { draft_id: Number(plan.draftId) });
    const orderId = status.order_id ? String(status.order_id) : plan.ozonOrderId;
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: {
        ozonOrderId: orderId,
        status: orderId ? 'SUPPLY_CREATED' : 'SUPPLY_CREATING',
        lastError: status.error_reasons?.length ? JSON.stringify(status.error_reasons) : null,
        lastSyncAt: new Date(),
      },
    });
    if (orderId) await this.refreshOrder(planId, user);
    return this.findPlan(planId);
  }

  async refreshOrder(planId: string, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'read');
    if (!plan.ozonOrderId) throw new BadRequestException('Заказ на поставку Ozon ещё не создан.');
    const connection = await this.connection(plan.connectionId, user, 'read', plan.clientId);
    const response = await this.ozonJson<any>(connection, '/v3/supply-order/get', { order_ids: [Number(plan.ozonOrderId)] });
    const order = response.orders?.[0];
    for (const supply of order?.supplies ?? []) {
      const row = plan.clusters.find((cluster) => String(cluster.macrolocalClusterId) === String(supply.macrolocal_cluster_id));
      if (!row) continue;
      await this.prisma.ozonFboPlanCluster.update({
        where: { id: row.id },
        data: {
          supplyId: String(supply.supply_id),
          bundleId: supply.bundle_id ? String(supply.bundle_id) : row.bundleId,
          storageWarehouseId: supply.storage_warehouse?.id ? String(supply.storage_warehouse.id) : row.storageWarehouseId,
          storageWarehouseName: supply.storage_warehouse?.name ?? row.storageWarehouseName,
          status: String(supply.state ?? 'SUPPLY_CREATED'),
        },
      });
    }
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: {
        ozonOrderNumber: order?.order_number ? String(order.order_number) : plan.ozonOrderNumber,
        ozonOrderState: order?.state ? String(order.state) : plan.ozonOrderState,
        status: 'SUPPLY_CREATED',
        lastSyncAt: new Date(),
      },
    });
    return this.findPlan(planId);
  }

  async generateBoxes(planId: string, body: { maxUnitsPerBox?: number }, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'write');
    if (plan.boxes.some((box) => box.status !== 'PLANNED')) {
      throw new BadRequestException('Нельзя перестроить короба после начала сборки.');
    }
    const maxUnits = Math.max(1, Math.min(1000, Number(body.maxUnitsPerBox) || 100));
    await this.prisma.$transaction(async (tx) => {
      await tx.ozonFboBox.deleteMany({ where: { planId } });
      let sequence = 1;
      for (const cluster of plan.clusters) {
        let current: Array<{ planItemId: string; quantity: number }> = [];
        let capacity = maxUnits;
        const flush = async () => {
          if (!current.length) return;
          const suffix = String(sequence).padStart(3, '0');
          const prefix = plan.id.replace(/-/g, '').slice(0, 6).toUpperCase();
          await tx.ozonFboBox.create({
            data: {
              planId,
              clusterId: cluster.id,
              boxCode: `FBO-OZ-${prefix}-${suffix}`,
              ozonCargoKey: `fbo-${prefix.toLowerCase()}-${suffix}`,
              items: { create: current.map((item) => ({ planItemId: item.planItemId, quantity: item.quantity })) },
            },
          });
          sequence += 1;
          current = [];
          capacity = maxUnits;
        };
        for (const item of cluster.items) {
          let remaining = item.quantity;
          while (remaining > 0) {
            const take = Math.min(capacity, remaining);
            current.push({ planItemId: item.id, quantity: take });
            capacity -= take;
            remaining -= take;
            if (capacity === 0) await flush();
          }
        }
        await flush();
      }
      await tx.ozonFboPlan.update({ where: { id: planId }, data: { status: 'BOXES_CREATED' } });
    });
    await this.event(planId, 'BOXES_CREATED', `Созданы короба WMS, вместимость до ${maxUnits} шт.`, user);
    return this.findPlan(planId);
  }

  async scanBox(boxId: string, code: string, user: AuthUser) {
    const normalized = String(code ?? '').trim();
    if (!normalized) throw new BadRequestException('Отсканируйте штрихкод товара.');
    const box = await this.prisma.ozonFboBox.findUnique({
      where: { id: boxId },
      include: {
        plan: true,
        items: { include: { planItem: { include: { sku: { include: { barcodes: true } } } } } },
      },
    });
    if (!box) throw new NotFoundException('Короб FBO не найден.');
    this.clientScope.requireClientAccess(user, box.plan.clientId, 'write');
    if (['CLOSED', 'UPLOADED'].includes(box.status)) throw new BadRequestException('Короб уже закрыт.');
    const item = box.items.find((candidate) => {
      if (candidate.assembledQuantity >= candidate.quantity) return false;
      const planItem = candidate.planItem;
      const values = [
        planItem.offerId,
        planItem.ozonSku,
        planItem.sku?.internalSku,
        planItem.sku?.clientSku,
        planItem.sku?.article,
        planItem.sku?.marketplaceOfferId,
        ...(planItem.sku?.barcodes.map((barcode) => barcode.value) ?? []),
      ];
      return values.some((value) => value && value === normalized);
    });
    if (!item) throw new BadRequestException('Этот товар не ожидается в коробе либо его количество уже собрано.');
    await this.prisma.$transaction([
      this.prisma.ozonFboBoxItem.update({ where: { id: item.id }, data: { assembledQuantity: { increment: 1 } } }),
      this.prisma.ozonFboPlanItem.update({ where: { id: item.planItemId }, data: { assembledQuantity: { increment: 1 } } }),
      this.prisma.ozonFboBox.update({ where: { id: boxId }, data: { status: 'ASSEMBLING' } }),
      this.prisma.ozonFboPlan.update({ where: { id: box.planId }, data: { status: 'ASSEMBLY' } }),
    ]);
    return this.prisma.ozonFboBox.findUnique({ where: { id: boxId }, include: { items: { include: { planItem: true } }, cluster: true } });
  }

  async closeBox(boxId: string, user: AuthUser) {
    const box = await this.prisma.ozonFboBox.findUnique({ where: { id: boxId }, include: { plan: true, items: true } });
    if (!box) throw new NotFoundException('Короб FBO не найден.');
    this.clientScope.requireClientAccess(user, box.plan.clientId, 'write');
    const missing = box.items.reduce((total, item) => total + Math.max(0, item.quantity - item.assembledQuantity), 0);
    if (missing) throw new BadRequestException(`Короб не собран: не хватает ${missing} шт.`);
    await this.prisma.ozonFboBox.update({
      where: { id: boxId },
      data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: user.id, closedByName: user.name },
    });
    const openBoxes = await this.prisma.ozonFboBox.count({ where: { planId: box.planId, status: { not: 'CLOSED' } } });
    if (openBoxes === 0) await this.prisma.ozonFboPlan.update({ where: { id: box.planId }, data: { status: 'ASSEMBLED' } });
    await this.event(box.planId, 'BOX_CLOSED', `Закрыт короб ${box.boxCode}.`, user);
    return this.findPlan(box.planId);
  }

  async uploadCargoes(planId: string, body: { confirm?: boolean }, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'write');
    if (body.confirm !== true) throw new BadRequestException('Подтвердите передачу состава коробов в Ozon.');
    if (!plan.boxes.length || plan.boxes.some((box) => box.status !== 'CLOSED')) {
      throw new BadRequestException('Перед отправкой в Ozon все короба должны быть полностью собраны и закрыты.');
    }
    if (plan.clusters.some((cluster) => !cluster.supplyId)) throw new BadRequestException('Не для всех кластеров получен Supply ID Ozon.');
    const connection = await this.connection(plan.connectionId, user, 'write', plan.clientId);
    const operations: Array<{ supplyId: string; operationId: string }> = [];
    for (const cluster of plan.clusters) {
      const boxes = plan.boxes.filter((box) => box.clusterId === cluster.id);
      const response = await this.ozonJson<any>(connection, '/v1/cargoes/create', {
        supply_id: Number(cluster.supplyId),
        delete_current_version: true,
        cargoes: boxes.map((box) => ({
          key: box.ozonCargoKey,
          value: {
            type: 'BOX',
            items: box.items.map((item) => ({ offer_id: item.planItem.offerId, quantity: item.quantity })),
          },
        })),
      });
      if (!response.operation_id) throw new BadGatewayException({ message: `Ozon не принял состав коробов для ${cluster.clusterName ?? cluster.sourceName}.`, details: response.errors });
      operations.push({ supplyId: String(cluster.supplyId), operationId: String(response.operation_id) });
    }
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: { cargoOperations: this.json(operations), status: 'CARGO_UPLOADING', lastSyncAt: new Date() },
    });
    await this.event(planId, 'CARGO_UPLOAD_STARTED', 'Состав закрытых коробов передан в Ozon.', user);
    return this.refreshCargoes(planId, user);
  }

  async refreshCargoes(planId: string, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'read');
    const operations = Array.isArray(plan.cargoOperations) ? plan.cargoOperations as Array<any> : [];
    if (!operations.length) throw new BadRequestException('Операции создания грузомест ещё не запускались.');
    const connection = await this.connection(plan.connectionId, user, 'read', plan.clientId);
    let allReady = true;
    for (const operation of operations) {
      const info = await this.ozonJson<any>(connection, '/v2/cargoes/create/info', { operation_id: operation.operationId });
      operation.status = info.status;
      operation.errors = info.errors ?? [];
      const cargoes = info.result?.cargoes ?? [];
      for (const cargo of cargoes) {
        const key = String(cargo.key ?? '');
        const cargoId = cargo.value?.cargo_id;
        if (key && cargoId) await this.prisma.ozonFboBox.updateMany({ where: { planId, ozonCargoKey: key }, data: { ozonCargoId: String(cargoId) } });
      }
      if (!String(info.status ?? '').includes('SUCCESS')) allReady = false;
    }
    if (allReady) {
      const supplyIds = plan.clusters.map((cluster) => cluster.supplyId).filter(Boolean) as string[];
      const details = await this.ozonJson<any>(connection, '/v1/cargoes/supplies/get', { supply_ids: supplyIds });
      for (const supply of details.supplies_cargoes ?? []) {
        for (const cargo of supply.cargoes_without_transport_cargoes ?? []) {
          if (!cargo.cargo_id) continue;
          await this.prisma.ozonFboBox.updateMany({
            where: { planId, ozonCargoId: String(cargo.cargo_id) },
            data: { ozonBarcode: cargo.barcode ? String(cargo.barcode) : null, status: 'UPLOADED' },
          });
        }
      }
    }
    await this.prisma.ozonFboPlan.update({
      where: { id: planId },
      data: { cargoOperations: this.json(operations), status: allReady ? 'READY_TO_SHIP' : 'CARGO_UPLOADING', lastSyncAt: new Date() },
    });
    return this.findPlan(planId);
  }

  async exportAssembly(planId: string, user: AuthUser) {
    const plan = await this.findPlan(planId);
    this.clientScope.requireClientAccess(user, plan.clientId, 'read');
    return {
      fileName: `ozon-fbo-${safeFilePart(plan.title)}.xlsx`,
      buffer: buildOzonFboAssemblyWorkbook(plan),
    };
  }

  private async fetchClusters(connection: OzonConnection) {
    const response = await this.ozonJson<{ clusters?: OzonCluster[] }>(connection, '/v1/cluster/list', {
      cluster_type: 'CLUSTER_TYPE_OZON', cluster_ids: [],
    });
    return response.clusters ?? [];
  }

  private async fetchProducts(connection: OzonConnection, offerIds: string[]) {
    const result: any[] = [];
    for (let index = 0; index < offerIds.length; index += 100) {
      const batch = offerIds.slice(index, index + 100);
      const response = await this.ozonJson<any>(connection, '/v3/product/list', {
        filter: { offer_id: batch, visibility: 'ALL' }, limit: 1000, last_id: '',
      });
      result.push(...(response.result?.items ?? []));
    }
    return result;
  }

  private async connection(
    id: string,
    user: AuthUser,
    mode: 'read' | 'write',
    expectedClientId?: string,
  ): Promise<OzonConnection> {
    if (!id) throw new BadRequestException('Выберите подключение кабинета Ozon.');
    const connection = await this.prisma.clientMarketplaceConnection.findUnique({ where: { id } });
    if (!connection || connection.marketplace !== 'OZON') throw new NotFoundException('Подключение Ozon не найдено.');
    if (expectedClientId && connection.clientId !== expectedClientId) throw new BadRequestException('Подключение относится к другому клиенту.');
    this.clientScope.requireClientAccess(user, connection.clientId, mode);
    if (!connection.isActive || !connection.sellerId || !connection.apiKey) throw new BadRequestException('Подключение Ozon не настроено или отключено.');
    return connection;
  }

  private async ozonJson<T>(connection: OzonConnection, path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api-seller.ozon.ru${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': connection.sellerId!,
          'Api-Key': connection.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new BadGatewayException(`Нет связи с Ozon: ${error instanceof Error ? error.message : 'ошибка сети'}`);
    }
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 500) }; }
    if (!response.ok) {
      throw new BadGatewayException({
        message: `Ozon API вернул ошибку ${response.status}.`,
        details: payload?.message ?? payload?.error ?? payload?.details ?? payload,
      });
    }
    return payload as T;
  }

  private async findPlan(id: string) {
    const plan = await this.prisma.ozonFboPlan.findUnique({ where: { id }, include: this.fullInclude() });
    if (!plan) throw new NotFoundException('План FBO Ozon не найден.');
    return plan;
  }

  private fullInclude() {
    return {
      client: { select: { id: true, code: true, name: true } },
      connection: { select: { id: true, accountName: true, sellerId: true, marketplace: true, isActive: true } },
      clusters: {
        include: {
          items: { include: { sku: { select: { id: true, internalSku: true, name: true } } }, orderBy: { offerId: 'asc' as const } },
          boxes: { select: { id: true, boxCode: true, status: true } },
        },
        orderBy: { sourceName: 'asc' as const },
      },
      boxes: {
        include: {
          cluster: true,
          items: { include: { planItem: true }, orderBy: { createdAt: 'asc' as const } },
        },
        orderBy: { boxCode: 'asc' as const },
      },
      events: { orderBy: { createdAt: 'desc' as const }, take: 100 },
    };
  }

  private planSummary(plan: any) {
    const items = plan.clusters.flatMap((cluster: any) => cluster.items);
    const boxes = plan.clusters.flatMap((cluster: any) => cluster.boxes);
    return {
      id: plan.id,
      title: plan.title,
      status: plan.status,
      sourceFileName: plan.sourceFileName,
      draftId: plan.draftId,
      ozonOrderId: plan.ozonOrderId,
      ozonOrderNumber: plan.ozonOrderNumber,
      slotFrom: plan.slotFrom,
      slotTo: plan.slotTo,
      dropOffWarehouseName: plan.dropOffWarehouseName,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      totalUnits: items.reduce((sum: number, item: any) => sum + item.quantity, 0),
      assembledUnits: items.reduce((sum: number, item: any) => sum + item.assembledQuantity, 0),
      clusters: plan.clusters.length,
      boxes: boxes.length,
      closedBoxes: boxes.filter((box: any) => ['CLOSED', 'UPLOADED'].includes(box.status)).length,
      errors: plan.clusters.filter((cluster: any) => cluster.validationMessage).length + items.filter((item: any) => !item.isValid).length,
    };
  }

  private assertPlanReadyForOzon(plan: Awaited<ReturnType<OzonFboService['findPlan']>>) {
    if (!plan.dropOffWarehouseId || !plan.dropOffWarehouseType) throw new BadRequestException('Выберите точку отгрузки Ozon.');
    if (plan.clusters.some((cluster) => !cluster.macrolocalClusterId)) throw new BadRequestException('Сопоставьте все направления с кластерами Ozon.');
    if (plan.clusters.some((cluster) => cluster.items.some((item) => !item.isValid || !item.ozonSku))) {
      throw new BadRequestException('Исправьте товары, не сопоставленные с Ozon или каталогом WMS.');
    }
  }

  private selectedWarehouses(plan: Awaited<ReturnType<OzonFboService['findPlan']>>) {
    const missing = plan.clusters.find((cluster) => !cluster.macrolocalClusterId || !cluster.storageWarehouseId);
    if (missing) throw new BadRequestException(`Не выбран склад Ozon для направления «${missing.sourceName}». Обновите черновик.`);
    return plan.clusters.map((cluster) => ({
      macrolocal_cluster_id: Number(cluster.macrolocalClusterId),
      storage_warehouse_id: Number(cluster.storageWarehouseId),
    }));
  }

  private async recalculatePlanReadiness(planId: string) {
    const plan = await this.findPlan(planId);
    const ready = plan.clusters.every((cluster) => cluster.macrolocalClusterId && cluster.items.every((item) => item.isValid));
    await this.prisma.ozonFboPlan.update({ where: { id: planId }, data: { status: ready ? 'READY' : 'NEEDS_ATTENTION' } });
  }

  private async event(planId: string, type: string, message: string, user: AuthUser, payload?: unknown) {
    await this.prisma.ozonFboEvent.create({
      data: { planId, type, message, userId: user.id, userName: user.name, payload: payload ? this.json(payload) : undefined },
    });
  }

  private json(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private requireClientId(clientId: string) {
    if (!clientId) throw new BadRequestException('Выберите клиента.');
  }
}

const clusterAliases: Record<string, string[]> = {
  'спб': ['санкт петербург'],
  'екат': ['екатеринбург'],
  'новосиб': ['новосибирск'],
  'невинномыск': ['невинномысск'],
  'дв': ['дальний восток', 'хабаровск', 'владивосток'],
};

function matchCluster(source: string, clusters: OzonCluster[]) {
  const normalizedSource = normalize(source);
  const variants = [normalizedSource, ...(clusterAliases[normalizedSource] ?? [])];
  const exact = clusters.find((cluster) => variants.includes(normalize(cluster.name)));
  if (exact) return exact;
  return clusters.find((cluster) => {
    const name = normalize(cluster.name);
    return variants.some((variant) => variant.length >= 3 && (name.includes(variant) || variant.includes(name)));
  });
}

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[._–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function dateOnly(value: string | Date | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function validDate(value: string | undefined, label: string) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`Некорректная дата ${label}.`);
  return date;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'plan';
}
