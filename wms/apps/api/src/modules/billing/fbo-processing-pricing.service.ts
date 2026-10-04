import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import type { AuthUser } from '../auth/auth.types';
import { runBillingMutation } from './billing-mutation';
import { fboProcessingPricingEnabled, normalizeFboTariff, selectableFboService, type FboTariffDefinition } from './fbo-processing-pricing.policy';
import type { CreateFboProcessingTariffDto } from './dto/fbo-processing-pricing.dto';
export type FboSavedTariff = {
    id: string;
    clientId: string;
    operationKey: string;
    definition: FboTariffDefinition;
    definitionHash: string;
    createdAt: Date;
};
const clientInclude = { billingServicePrices: { include: { service: true } }, fbsBillingSettings: { include: { additionalServices: { include: { service: true } } } } } as const;
// FIX: inspect existing conditions without running the legacy GET that creates defaults.
export function legacyFboConditions(client: any) {
    const prices = client.billingServicePrices ?? [];
    const selected = client.fbsBillingSettings?.additionalServices ?? [];
    const ids = new Set(selected.map((part: any) => part.serviceId));
    const existing = prices.filter((part: any) => ids.has(part.serviceId) || (part.isActive && Number(part.priceRub) > 0 && (['ITEM_PROCESSING', 'NOM_ОБРАБОТКА_ОДЕЖДЫ'].includes(part.service.code) || part.service.code.startsWith('NOM_ОТРЕЗ_'))));
    return {
        protected: selected.length > 0 || existing.length > 0 || Boolean(client.fbsBillingSettings?.primaryProcessingEnabled && ['primaryWhiteUnitPriceRub', 'primaryGrayUnitPriceRub', 'primaryReturnUnitPriceRub'].some(key => Number(client.fbsBillingSettings[key]) > 0)),
        services: [...new Set([...existing.map((p: any) => p.serviceId), ...ids])].map(id => {
            const price = prices.find((p: any) => p.serviceId === id), selection = selected.find((p: any) => p.serviceId === id), service = price?.service ?? selection?.service;
            return { serviceId: id, name: service.name, priceRub: price?.priceRub.toString() ?? null, taxMode: price?.taxMode ?? null, isActive: price?.isActive ?? false, multiplier: selection?.quantityMultiplier.toString() ?? '1', matchKeywords: selection?.matchKeywords ?? null };
        }),
        primaryFbs: client.fbsBillingSettings?.primaryProcessingEnabled ? { white: client.fbsBillingSettings.primaryWhiteUnitPriceRub.toString(), gray: client.fbsBillingSettings.primaryGrayUnitPriceRub.toString(), returned: client.fbsBillingSettings.primaryReturnUnitPriceRub.toString() } : null,
    };
}
@Injectable()
export class FboProcessingPricingService {
    constructor(private readonly prisma: PrismaService, private readonly scopes: ClientScopeService) { }
    private requireEnabled() { if (!fboProcessingPricingEnabled())
        throw new NotFoundException('Настройка первоначальной обработки не включена.'); }
    private requirePermission(user: AuthUser, permission: string) { if (!user.permissionCodes.includes(permission) && !user.permissionCodes.includes('system:admin'))
        throw new ForbiddenException('Нет доступа к первоначальной обработке.'); }
    async list(user: AuthUser) {
        this.requirePermission(user, 'billing:read');
        if (!fboProcessingPricingEnabled())
            return { enabled: false as const };
        const filter = this.scopes.resolveClientFilter(user);
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SET TRANSACTION READ ONLY`;
            const clients = await tx.client.findMany({ where: { id: filter, isDemo: Boolean(user.isDemo) }, include: clientInclude, orderBy: { name: 'asc' } });
            const ids = clients.map(client => client.id);
            const tariffs = ids.length ? await tx.$queryRaw<FboSavedTariff[]> `SELECT * FROM "ClientFboProcessingTariff" WHERE "clientId" IN (${Prisma.join(ids)})` : [];
            const services = (await tx.billingService.findMany({ where: { isActive: true, unit: 'PIECE' }, orderBy: { name: 'asc' } })).filter(selectableFboService).map(service => ({ id: service.id, code: service.code, name: service.name, defaultPriceRub: service.defaultPriceRub?.toString() ?? null }));
            return { enabled: true as const, services, clients: clients.map(client => ({ id: client.id, code: client.code, name: client.name, status: client.status, legacy: legacyFboConditions(client), tariff: tariffs.find(t => t.clientId === client.id) ?? null })) };
        });
    }
    async products(clientId: string, search: string, user: AuthUser) {
        this.requireEnabled();
        this.requirePermission(user, 'billing:read');
        this.scopes.requireClientAccess(user, clientId, 'read');
        if (search.length > 120)
            throw new BadRequestException('Слишком длинный поисковый запрос.');
        const client = await this.prisma.client.findFirst({ where: { id: clientId, isDemo: Boolean(user.isDemo) }, select: { id: true } });
        if (!client)
            throw new NotFoundException('Клиент не найден.');
        const query = search.trim();
        return this.prisma.sku.findMany({ where: { clientId, ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { article: { contains: query, mode: 'insensitive' as const } }, { barcodes: { some: { value: { contains: query } } } }] } : {}) }, select: { id: true, name: true, article: true, size: true, barcodes: { select: { value: true } } }, orderBy: { name: 'asc' }, take: 30 });
    }
    async create(clientId: string, dto: CreateFboProcessingTariffDto, user: AuthUser) {
        this.requireEnabled();
        this.requirePermission(user, 'billing:write');
        this.scopes.requireClientAccess(user, clientId, 'write');
        return runBillingMutation(this.prisma, async (tx) => {
            const client = await tx.client.findFirst({ where: { id: clientId, isDemo: Boolean(user.isDemo) }, include: clientInclude });
            if (!client)
                throw new NotFoundException('Клиент не найден.');
            const catalog = await tx.billingService.findMany({ where: { isActive: true, unit: 'PIECE' } });
            const definition = normalizeFboTariff(dto.definition, catalog);
            const hash = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
            const saved = await tx.$queryRaw<FboSavedTariff[]> `SELECT * FROM "ClientFboProcessingTariff" WHERE "clientId"=${clientId} OR "operationKey"=${dto.operationKey}`;
            if (saved.length) {
                if (saved.length === 1 && saved[0].clientId === clientId && saved[0].operationKey === dto.operationKey && saved[0].definitionHash === hash)
                    return saved[0];
                throw new ConflictException('Условия уже сохранены. Повторное сохранение не изменит действующие цены.');
            }
            if (legacyFboConditions(client).protected)
                throw new ConflictException('У клиента уже есть индивидуальные условия. Они доступны только для просмотра.');
            const skuIds = definition.variants.flatMap(variant => variant.skuIds);
            if (skuIds.length && await tx.sku.count({ where: { clientId, id: { in: skuIds } } }) !== skuIds.length)
                throw new BadRequestException('Варианты должны содержать только товары выбранного клиента.');
            const id = randomUUID();
            const rows = await tx.$queryRaw<FboSavedTariff[]> `INSERT INTO "ClientFboProcessingTariff" ("id","clientId","operationKey","definition","definitionHash","createdByUserId") VALUES (${id},${clientId},${dto.operationKey},${JSON.stringify(definition)}::jsonb,${hash},${user.id}) RETURNING *`;
            await tx.auditLog.create({ data: { userId: user.id, action: 'FBO_PROCESSING_TARIFF_CREATED', entity: 'ClientFboProcessingTariff', entityId: id, payload: { clientId, definition, definitionHash: hash } } });
            return rows[0];
        });
    }
}
