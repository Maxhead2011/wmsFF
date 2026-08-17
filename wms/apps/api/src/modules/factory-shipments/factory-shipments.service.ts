import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FactoryShipmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { CreateFactoryShipmentDto, ReconcileFactoryShipmentDto, ScanFactoryShipmentDto } from './dto/factory-shipments.dto';

const shipmentInclude = {
  client: { select: { id: true, code: true, name: true, factoryName: true, factoryCode: true } },
  items: { orderBy: [{ name: 'asc' as const }, { size: 'asc' as const }] },
  scans: { orderBy: { scannedAt: 'desc' as const }, take: 50 },
};

@Injectable()
export class FactoryShipmentsService {
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) {}

  list(user: AuthUser, clientId?: string) {
    const filter = this.scopes.resolveClientFilter(user, clientId);
    return this.prisma.factoryShipment.findMany({
      where: filter === undefined ? {} : { clientId: filter }, include: shipmentInclude,
      orderBy: { createdAt: 'desc' }, take: 250,
    });
  }

  async bootstrap(user: AuthUser) {
    const filter = this.scopes.resolveClientFilter(user);
    const clients = await this.prisma.client.findMany({
      where: { ...(filter === undefined ? {} : { id: filter }), factoryEnabled: true, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, factoryName: true, factoryCode: true }, orderBy: { name: 'asc' },
    });
    const shipments = await this.prisma.factoryShipment.findMany({
      where: { clientId: { in: clients.map((item) => item.id) }, status: { in: [FactoryShipmentStatus.DRAFT, FactoryShipmentStatus.PICKING] } },
      include: shipmentInclude, orderBy: { createdAt: 'asc' },
    });
    return { clients, shipments };
  }

  async get(id: string, user: AuthUser) {
    const shipment = await this.prisma.factoryShipment.findUnique({ where: { id }, include: shipmentInclude });
    if (!shipment) throw new NotFoundException('Отправка с фабрики не найдена.');
    this.scopes.requireClientAccess(user, shipment.clientId, 'read');
    return shipment;
  }

  async create(dto: CreateFactoryShipmentDto, user: AuthUser) {
    this.scopes.requireClientAccess(user, dto.clientId, 'write');
    if (!dto.items.length) throw new BadRequestException('Добавьте хотя бы один товар.');
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client?.factoryEnabled) throw new BadRequestException('В настройках клиента не включён доступ к фабрике.');
    const grouped = new Map<string, number>();
    for (const row of dto.items) grouped.set(row.skuId, (grouped.get(row.skuId) ?? 0) + row.plannedQty);
    const skus = await this.prisma.sku.findMany({
      where: { clientId: dto.clientId, id: { in: [...grouped.keys()] } },
      include: { barcodes: { orderBy: [{ isPrimary: 'desc' }, { value: 'asc' }], take: 1 } },
    });
    if (skus.length !== grouped.size) throw new BadRequestException('Один или несколько товаров не принадлежат выбранному клиенту.');
    return this.prisma.factoryShipment.create({
      data: {
        clientId: dto.clientId, title: dto.title.trim(), comment: dto.comment?.trim() || null,
        factoryName: client.factoryName?.trim() || 'Бишкек', createdByUserId: user.id,
        items: { create: skus.map((sku) => ({
          skuId: sku.id, barcode: sku.barcodes[0]?.value ?? null, name: sku.name,
          article: sku.article ?? sku.internalSku, size: sku.size, plannedQty: grouped.get(sku.id)!,
        })) },
      }, include: shipmentInclude,
    });
  }

  async scan(id: string, dto: ScanFactoryShipmentDto, user: AuthUser) {
    const shipment = await this.get(id, user);
    this.scopes.requireClientAccess(user, shipment.clientId, 'write');
    if (shipment.status !== FactoryShipmentStatus.DRAFT && shipment.status !== FactoryShipmentStatus.PICKING) {
      throw new BadRequestException('Эта отправка уже закрыта для сканирования.');
    }
    const barcode = dto.barcode.trim();
    const item = await this.prisma.factoryShipmentItem.findFirst({
      where: { shipmentId: id, OR: [{ barcode }, { sku: { barcodes: { some: { value: barcode } } } }] },
    });
    if (!item) throw new BadRequestException('Этот товар не входит в выбранную отправку.');
    const quantity = dto.quantity ?? 1;
    if (item.scannedQty + quantity > item.plannedQty) throw new BadRequestException('Плановое количество этого товара уже отсканировано.');
    await this.prisma.$transaction([
      this.prisma.factoryShipment.update({ where: { id }, data: { status: FactoryShipmentStatus.PICKING, startedAt: shipment.startedAt ?? new Date() } }),
      this.prisma.factoryShipmentItem.update({ where: { id: item.id }, data: { scannedQty: { increment: quantity } } }),
      this.prisma.factoryShipmentScan.create({ data: { shipmentId: id, itemId: item.id, barcode, quantity, deviceId: dto.deviceId, scannedById: user.id, scannedBy: user.name } }),
    ]);
    return this.get(id, user);
  }

  async ship(id: string, user: AuthUser) {
    const shipment = await this.get(id, user); this.scopes.requireClientAccess(user, shipment.clientId, 'write');
    if (shipment.items.every((item) => item.scannedQty === 0)) throw new BadRequestException('В отправке ещё нет отсканированных товаров.');
    return this.prisma.factoryShipment.update({ where: { id }, data: { status: FactoryShipmentStatus.SHIPPED, shippedAt: new Date() }, include: shipmentInclude });
  }

  async reconcile(id: string, dto: ReconcileFactoryShipmentDto, user: AuthUser) {
    const shipment = await this.get(id, user); this.scopes.requireClientAccess(user, shipment.clientId, 'write');
    const request = await this.prisma.clientRequest.findFirst({
      where: { id: dto.requestId, clientId: shipment.clientId, type: 'INBOUND' }, include: { items: true },
    });
    if (!request) throw new BadRequestException('Приёмка этого клиента не найдена.');
    const received = new Map(request.items.map((item) => [item.skuId, item.quantity]));
    await this.prisma.$transaction([
      ...shipment.items.map((item) => this.prisma.factoryShipmentItem.update({ where: { id: item.id }, data: { receivedQty: received.get(item.skuId) ?? 0 } })),
      this.prisma.factoryShipment.update({ where: { id }, data: { receiptRequestId: request.id, receivedAt: new Date(), status: FactoryShipmentStatus.RECONCILED } }),
    ]);
    return this.get(id, user);
  }
}
