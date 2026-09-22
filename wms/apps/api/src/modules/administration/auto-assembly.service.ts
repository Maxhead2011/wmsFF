import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { ClientScopeService } from '../auth/client-scope.service';
import { MarketplaceConnectionsService } from '../marketplace-connections/marketplace-connections.service';
import { emptyAutoAssembly, nextAutoAssembly, parseAutoAssembly, type AutoAssemblyConfig } from './auto-assembly-policy';
const PREFIX = 'fbs.autoAssembly.config.';
const RUN = 'fbs.autoAssembly.run.';
type Stored = AutoAssemblyConfig & { nextAt: string; ownerId: string };
@Injectable()
export class AutoAssemblyService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly logger = new Logger(AutoAssemblyService.name);
  constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService, private readonly marketplace: MarketplaceConnectionsService) {}
  onModuleInit() { if (process.env.WMS_AUTO_ASSEMBLY_ENABLED === 'true') this.schedule(); }
  onModuleDestroy() { this.stopped = true; clearTimeout(this.timer); }
  private schedule() { if (!this.stopped) this.timer = setTimeout(() => { void this.tick().catch(e => this.logger.error(e.message)).finally(() => this.schedule()); }, 30000); }
  private admin(user: AuthUser) {
    if (user.isDemo || user.roleCodes.includes('CLIENT') || !user.permissionCodes.includes('system:admin')) throw new ForbiddenException('Автосборка доступна администратору.');
  }
  private async connection(id: string, user: AuthUser) {
    this.admin(user);
    const c = await this.prisma.clientMarketplaceConnection.findUnique({ where: { id }, include: { client: { select: { isDemo: true } } } });
    if (!c || c.client.isDemo || !c.isActive || !['WILDBERRIES', 'OZON'].includes(c.marketplace)) throw new BadRequestException('Кабинет недоступен.');
    this.scopes.requireClientAccess(user, c.clientId, 'write');
    return c;
  }
  async list(clientId: string, user: AuthUser) {
    this.admin(user); this.scopes.requireClientAccess(user, clientId, 'read');
    const connections = await this.prisma.clientMarketplaceConnection.findMany({ where: { clientId, isActive: true, marketplace: { in: ['WILDBERRIES', 'OZON'] } }, select: { id: true, marketplace: true, accountName: true, fbsExecutionWarehouseId: true } });
    const items = await Promise.all(connections.map(async c => {
      const saved = await this.prisma.systemSetting.findUnique({ where: { key: PREFIX + c.id } });
      const config = saved?.value as Stored | undefined;
      const routes = c.marketplace === 'WILDBERRIES' ? (await this.marketplace.listFbsWarehouseRoutes(c.id, user)).warehouses.filter(r => r.effectiveExecutionWarehouseId).map(r => ({ id: r.marketplaceWarehouseId, name: r.marketplaceWarehouseName })) : await this.marketplace.listAutoAssemblyOzonRoutes(c.id, user);
      const history = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: RUN + c.id + '.' } }, orderBy: { createdAt: 'desc' }, take: 20 });
      return { ...c, config: config ?? emptyAutoAssembly, nextAt: config?.enabled ? config.nextAt : null, version: saved?.updatedAt.toISOString() ?? null, routes, history: history.map(row => row.value) };
    }));
    return { available: process.env.WMS_AUTO_ASSEMBLY_ENABLED === 'true', items };
  }
  async save(id: string, body: { config: unknown; version?: string | null }, user: AuthUser) {
    await this.connection(id, user);
    if (process.env.WMS_AUTO_ASSEMBLY_ENABLED !== 'true') throw new BadRequestException('Автосборка отключена на сервере.');
    const config = parseAutoAssembly(body.config);
    const value = { ...config, ownerId: user.id, nextAt: nextAutoAssembly(config.times, new Date()).toISOString() };
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PREFIX + id}))`;
      const old = await tx.systemSetting.findUnique({ where: { key: PREFIX + id } });
      if ((old?.updatedAt.toISOString() ?? null) !== (body.version ?? null)) throw new BadRequestException('Настройки изменились. Обновите страницу.');
      const saved = await tx.systemSetting.upsert({ where: { key: PREFIX + id }, create: { key: PREFIX + id, value, updatedByUserId: user.id }, update: { value, updatedByUserId: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'AUTO_ASSEMBLY_SETTINGS', entity: 'ClientMarketplaceConnection', entityId: id, payload: value } });
      return { saved: true, version: saved.updatedAt.toISOString(), nextAt: value.nextAt };
    });
  }
  async preview(id: string, config: unknown, user: AuthUser) { await this.connection(id, user); return this.marketplace.runAutoAssembly(id, parseAutoAssembly(config), user, true); }
  async run(id: string, user: AuthUser, slot = 'manual') {
    await this.connection(id, user);
    if (process.env.WMS_AUTO_ASSEMBLY_ENABLED !== 'true') throw new BadRequestException('Автосборка отключена.');
    const saved = await this.prisma.systemSetting.findUnique({ where: { key: PREFIX + id } });
    if (!saved) throw new BadRequestException('Сначала сохраните настройки.');
    const config = parseAutoAssembly(saved.value);
    if (slot !== 'manual' && !config.enabled) return;
    const key = RUN + id + '.' + (slot === 'manual' ? randomUUID() : slot);
    const startedAt = new Date().toISOString();
    try { await this.prisma.systemSetting.create({ data: { key, value: { startedAt, status: 'RUNNING', slot }, updatedByUserId: user.id } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return; throw error; }
    let result: unknown;
    try {
      const report = await this.marketplace.runAutoAssembly(id, config, user);
      result = { startedAt, completedAt: new Date().toISOString(), status: report.groups.some(g => g.error) ? 'PARTIAL' : 'DONE', slot, ...report };
    } catch (error) { result = { startedAt, completedAt: new Date().toISOString(), status: 'ERROR', slot, error: error instanceof Error ? error.message : 'Ошибка запуска' }; }
    await this.prisma.systemSetting.update({ where: { key }, data: { value: result as Prisma.InputJsonValue } });
    return result;
  }
  // FIX: claim the scheduled occurrence in PostgreSQL; multiple API instances cannot replay it.
  async tick() {
    const settings = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    for (const row of settings) {
      const value = row.value as unknown as Stored;
      if (!value.enabled || !value.nextAt || Date.parse(value.nextAt) > Date.now()) continue;
      try {
        const config = parseAutoAssembly(value);
        const claimed = await this.prisma.systemSetting.updateMany({ where: { key: row.key, updatedAt: row.updatedAt }, data: { value: { ...config, ownerId: value.ownerId, nextAt: nextAutoAssembly(config.times, new Date()).toISOString() } } });
        if (!claimed.count) continue;
        const owner = await this.prisma.user.findUnique({ where: { id: value.ownerId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
        if (!owner || owner.isDemo || owner.status !== 'ACTIVE') throw new ForbiddenException('Администратор расписания недоступен.');
        const user: AuthUser = { id: owner.id, name: owner.name, email: owner.email, roleCodes: owner.roles.map(r => r.role.code), permissionCodes: owner.roles.flatMap(r => r.role.permissions.map(p => p.permission.code)), clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
        await this.run(row.key.slice(PREFIX.length), user, value.nextAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ошибка автосборки';
        this.logger.error(message);
        await this.prisma.systemSetting.upsert({ where: { key: RUN + row.key.slice(PREFIX.length) + '.' + value.nextAt }, create: { key: RUN + row.key.slice(PREFIX.length) + '.' + value.nextAt, value: { startedAt: new Date().toISOString(), status: 'ERROR', error: message } }, update: {} });
      }
    }
  }
}
