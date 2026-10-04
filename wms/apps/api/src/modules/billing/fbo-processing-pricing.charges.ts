import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { fboProcessingPricingEnabled, normalizeFboTariff, priceFboUnits } from './fbo-processing-pricing.policy';
import type { FboSavedTariff } from './fbo-processing-pricing.service';
// FIX: opt-in compositions replace only processing lines; packaging and relabeling remain separate.
export async function createFboCompositionCharges(tx: Prisma.TransactionClient, input: {
    request: {
        id: string;
        clientId: string;
        title?: string | null;
    };
    packages: Array<{
        items?: Array<{
            skuId: string | null;
            quantity: number;
            requestItem?: {
                sku?: {
                    id: string;
                } | null;
            };
        }>;
    }>;
    processedUnits: number;
    user: {
        id: string;
    };
    serviceDate: Date;
}) {
    if (!fboProcessingPricingEnabled())
        return false;
    const rows = await tx.$queryRaw<FboSavedTariff[]> `SELECT * FROM "ClientFboProcessingTariff" WHERE "clientId"=${input.request.clientId}`;
    const tariff = rows[0];
    if (!tariff || input.serviceDate < new Date(tariff.createdAt))
        return false;
    // Request-local lock prevents two independent closing/packing retries creating duplicate snapshots.
    await tx.$queryRaw `SELECT 1 FROM pg_advisory_xact_lock(1179209295, hashtext(${input.request.id}))`;
    const prefix = `fulfillment-fbo-composition:${input.request.id}:`;
    const existing = await tx.billingCharge.findFirst({ where: { requestId: input.request.id, OR: [{ sourceKey: { startsWith: prefix } }, { sourceKey: { startsWith: `fulfillment-processing:${input.request.id}:` } }, { sourceKey: { startsWith: `fulfillment-clothing-processing:${input.request.id}:` } }] }, select: { sourceKey: true } });
    if (existing)
        return Boolean(existing.sourceKey?.startsWith(prefix));
    if (!input.processedUnits)
        return true;
    const catalog = await tx.billingService.findMany({ where: { id: { in: [...tariff.definition.common, ...tariff.definition.variants.flatMap(v => v.services)].map(part => part.serviceId) } } });
    const definition = normalizeFboTariff(tariff.definition, catalog);
    let units = input.packages.flatMap(pack => pack.items ?? []).map(item => ({ skuId: item.skuId ?? item.requestItem?.sku?.id ?? '', quantity: item.quantity }));
    if (!units.length && !definition.variants.length)
        units = [{ skuId: '__default__', quantity: input.processedUnits }];
    if (units.some(item => !item.skuId) || units.reduce((sum, item) => sum + item.quantity, 0) !== input.processedUnits)
        throw new BadRequestException('Для расчёта первоначальной обработки не хватает фактического состава упаковок.');
    const lines = priceFboUnits(definition, units);
    for (const line of lines) {
        const service = catalog.find(s => s.id === line.serviceId)!;
        await tx.billingCharge.create({ data: { clientId: input.request.clientId, requestId: input.request.id, serviceId: service.id, description: `${service.name}${line.variantName ? ' · ' + line.variantName : ''} по заявке ${input.request.title ?? input.request.id}`, unit: 'PIECE', quantity: line.quantity, unitPriceRub: line.unitPriceRub, totalRub: line.totalRub, status: 'APPROVED', source: 'MANUAL', serviceDate: input.serviceDate, sourceKey: prefix + tariff.id + ':' + line.variantKey + ':' + service.id, metadata: { packageBilling: true, fboProcessingComposition: true, tariffId: tariff.id, definitionHash: tariff.definitionHash, variantName: line.variantName, multiplier: line.multiplier, taxMode: line.taxMode, priceBeforeTaxRub: line.priceBeforeTaxRub, processedUnits: input.processedUnits }, comment: 'Первоначальная обработка FBO: сохранённый состав услуг', createdByUserId: input.user.id, approvedByUserId: input.user.id, approvedAt: new Date() } });
    }
    return true;
}
