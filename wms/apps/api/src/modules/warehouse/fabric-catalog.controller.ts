import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { addFabricColor, BASE_FABRIC_COLORS, createFabricBinding, FabricColor, readFabricBinding } from './fabric-catalog';
import { identifyFabricSku } from './fabric-fbs-availability';

@Controller('warehouse/fabric-catalog/:clientId')
@RequirePermissions('stock:read')
export class FabricCatalogController {
  constructor(private readonly db: PrismaService, private readonly scopes: ClientScopeService) {}
  private key(id: string) { return 'fabric.catalog.v1:' + id; }
  private async check(id: string, user: AuthUser, write = false) {
    if (process.env.WMS_FBS_FABRIC_CUT_ENABLED !== 'true' || user.isDemo) throw new NotFoundException();
    this.scopes.requireClientAccess(user, id, write ? 'write' : 'read');
    if (write && (user.roleCodes.includes('CLIENT') || !user.permissionCodes.some(p => ['stock:write', 'system:admin'].includes(p)))) throw new ForbiddenException();
    if (!user.activeWarehouseId) throw new BadRequestException('Выберите филиал.');
    const member = await this.db.warehouseClient.findFirst({ where: { clientId: id, warehouseId: user.activeWarehouseId } });
    if (!member) throw new ForbiddenException('Клиент не подключён к выбранному филиалу.');
  }
  @Get()
  async get(@Param('clientId') id: string, @CurrentUser() user: AuthUser) {
    await this.check(id, user);
    const saved = await this.db.systemSetting.findUnique({ where: { key: this.key(id) } });
    const colors = ((saved?.value as { colors?: FabricColor[] } | null)?.colors ?? []);
    const skus = await this.db.sku.findMany({ where: { clientId: id, isDraft: false }, select: { id: true, name: true, internalSku: true, marketplace: true, marketplaceProductId: true, marketplaceOfferId: true, marketplacePayload: true, barcodes: { select: { value: true } } } });
    return { colors, baseColors: BASE_FABRIC_COLORS, version: saved?.updatedAt.toISOString() ?? null, skus: skus.map(s => ({ id: s.id, name: s.name, internalSku: s.internalSku, marketplace: s.marketplace, productId: s.marketplaceProductId, offerId: s.marketplaceOfferId, barcodes: s.barcodes.map(b => b.value), binding: readFabricBinding(s.marketplacePayload) })) };
  }
  @Post()
  @RequirePermissions('stock:write')
  async save(@Param('clientId') id: string, @Body() body: { action: string; name?: string; material: string; colorId?: string; lengthMm?: number; skuId?: string; version: string | null }, @CurrentUser() user: AuthUser) {
    await this.check(id, user, true);
    if (!body || typeof body !== 'object' || !['CREATE_COLOR', 'BIND_SKU'].includes(body.action) || !Object.prototype.hasOwnProperty.call(body, 'version')) throw new BadRequestException('Укажите действие и текущую версию каталога.');
    const result = await this.db.$transaction(async tx => {
      // FIX: serialize color creation and SKU binding with receipt and FBS metre accounting.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'fabric.rolls.v1:' + id);
      const saved = await tx.systemSetting.findUnique({ where: { key: this.key(id) } });
      if ((saved?.updatedAt.toISOString() ?? null) !== body.version) throw new ConflictException('Каталог изменился. Обновите данные.');
      let colors = ((saved?.value as { colors?: FabricColor[] } | null)?.colors ?? []);
      let outcome: unknown;
      try {
        if (body.action === 'CREATE_COLOR') {
          const added = addFabricColor(colors, body.material, body.name!); colors = added.colors; outcome = added;
        } else if (body.action === 'BIND_SKU') {
          const binding = createFabricBinding(colors, body.material, body.colorId!, body.lengthMm!);
          const sku = await tx.sku.findFirst({ where: { id: body.skuId, clientId: id, isDraft: false } });
          if (!body.skuId || !sku) throw new Error('Товар выбранного клиента не найден.');
          if (!sku.marketplaceProductId && !sku.marketplaceOfferId && !(await tx.marketplaceProductLink.findFirst({ where: { clientId: id, skuId: sku.id } }))) throw new Error('Сначала свяжите карточку товара WMS с маркетплейсом.');
          const old = identifyFabricSku(sku);
          if (old && (old.material !== binding.material || old.color !== binding.color || old.lengthMm !== binding.lengthMm)) throw new Error('Существующую привязку ткани менять нельзя: она используется в истории и резервах.');
          if (!old && await tx.stockBalance.findFirst({ where: { clientId: id, skuId: sku.id, quantity: { gt: 0 } } })) throw new Error('У товара уже есть складской остаток. Требуется проверка перед привязкой к рулонам.');
          const payload = sku.marketplacePayload && typeof sku.marketplacePayload === 'object' && !Array.isArray(sku.marketplacePayload) ? sku.marketplacePayload : {};
          await tx.sku.update({ where: { id: sku.id }, data: { marketplacePayload: { ...payload, fabricRollBinding: binding } as Prisma.InputJsonValue } });
          outcome = { skuId: sku.id, binding };
        } else throw new Error('Неизвестное действие.');
      } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Не удалось сохранить.'); }
      await tx.systemSetting.upsert({ where: { key: this.key(id) }, create: { key: this.key(id), value: { colors }, updatedByUserId: user.id }, update: { value: { colors }, updatedByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'FABRIC_CATALOG_' + body.action, entity: 'FabricRolls', entityId: id, payload: { warehouseId: user.activeWarehouseId, result: outcome } as Prisma.InputJsonValue } });
      return outcome;
    });
    return { result, catalog: await this.get(id, user) };
  }
}
