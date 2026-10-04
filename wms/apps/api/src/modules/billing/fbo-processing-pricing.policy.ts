import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
export type FboComponent = {
    serviceId: string;
    priceRub: string;
    taxMode: 'INCLUDED' | 'ADD_6_PERCENT';
    multiplier: string;
};
export type FboVariant = {
    name: string;
    skuIds: string[];
    services: FboComponent[];
};
export type FboTariffDefinition = {
    common: FboComponent[];
    variants: FboVariant[];
};
export type FboService = {
    id: string;
    code: string;
    name: string;
    unit: string;
    isActive: boolean;
};
export type FboPricedLine = {
    serviceId: string;
    variantName: string | null;
    variantKey: string;
    quantity: string;
    priceBeforeTaxRub: string;
    taxMode: FboComponent['taxMode'];
    unitPriceRub: string;
    totalRub: string;
    multiplier: string;
};
const separatelyBilled = new Set(['FBS_PROCESSING', 'RELABELING', 'BOX_60_40_40', 'BOX_ASSEMBLY', 'PALLET', 'PALLET_ASSEMBLY']);
export function fboProcessingPricingEnabled() { return process.env.WMS_FBO_PROCESSING_PRICING_ENABLED === 'true'; }
export function selectableFboService(service: FboService) { return service.isActive && service.unit === 'PIECE' && !separatelyBilled.has(service.code); }
function decimal(value: unknown, precision: number, maximum: string, label: string) {
    const text = typeof value === 'string' ? value.trim().replace(',', '.') : '';
    if (!new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`).test(text))
        throw new BadRequestException(`Проверьте ${label}.`);
    const parsed = new Prisma.Decimal(text);
    if (parsed.gt(maximum))
        throw new BadRequestException(`Слишком большое значение: ${label}.`);
    return parsed;
}
function components(value: unknown, services: FboService[]): FboComponent[] {
    if (!Array.isArray(value) || value.length > 50)
        throw new BadRequestException('Выберите не более 50 услуг для одного состава.');
    const used = new Set<string>();
    return value.map(part => {
        const service = services.find(s => s.id === part?.serviceId);
        if (!service || !service.isActive || service.unit !== 'PIECE')
            throw new BadRequestException('Выберите действующую услугу с ценой за штуку.');
        if (separatelyBilled.has(service.code))
            throw new BadRequestException('Короба, паллеты, перемаркировка и обработка FBS начисляются отдельно.');
        if (used.has(service.id))
            throw new BadRequestException('Услуга повторяется в одном составе.');
        used.add(service.id);
        const price = decimal(part.priceRub, 2, '9999999999.99', 'стоимость услуги');
        const multiplier = decimal(part.multiplier, 3, '1000', 'количество услуги на единицу');
        if (multiplier.lt('0.001'))
            throw new BadRequestException('Количество услуги должно быть не меньше 0,001.');
        if (!['INCLUDED', 'ADD_6_PERCENT'].includes(part.taxMode))
            throw new BadRequestException('Выберите порядок учёта налога.');
        return { serviceId: service.id, priceRub: price.toFixed(2), multiplier: multiplier.toFixed(3), taxMode: part.taxMode };
    });
}
function positive(parts: FboComponent[]) { return parts.some(part => new Prisma.Decimal(part.priceRub).gt(0)); }
// FIX: retain separate alternatives instead of summing all cut tariffs into one universal price.
export function normalizeFboTariff(value: unknown, services: FboService[]): FboTariffDefinition {
    const raw = value as FboTariffDefinition;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.variants) || raw.variants.length > 50)
        throw new BadRequestException('Проверьте варианты первоначальной обработки.');
    const common = components(raw.common, services), commonIds = new Set(common.map(part => part.serviceId));
    const usedSkus = new Set<string>(), names = new Set<string>();
    const variants = raw.variants.map(variant => {
        const name = typeof variant?.name === 'string' ? variant.name.trim() : '';
        if (!name || name.length > 120 || names.has(name.toLocaleLowerCase('ru-RU')))
            throw new BadRequestException('Укажите разные названия вариантов, например «Отрез 3 м».');
        names.add(name.toLocaleLowerCase('ru-RU'));
        if (!Array.isArray(variant.skuIds) || !variant.skuIds.length || variant.skuIds.length > 1000)
            throw new BadRequestException('Выберите товары для каждого варианта.');
        const skuIds = variant.skuIds.map(id => {
            if (typeof id !== 'string' || !id || id.length > 100)
                throw new BadRequestException('Проверьте выбранные товары.');
            if (usedSkus.has(id))
                throw new BadRequestException('Один товар выбран для нескольких вариантов.');
            usedSkus.add(id);
            return id;
        });
        const parts = components(variant.services, services);
        if (!parts.length || parts.some(part => commonIds.has(part.serviceId)))
            throw new BadRequestException('Выберите услуги варианта без повторения общих услуг.');
        if (!positive([...common, ...parts]))
            throw new BadRequestException('Стоимость варианта должна быть больше нуля.');
        return { name, skuIds, services: parts };
    });
    if (!positive(common) && !variants.length)
        throw new BadRequestException('Стоимость обработки должна быть больше нуля.');
    return { common, variants };
}
function taxed(value: Prisma.Decimal, mode: FboComponent['taxMode']) { return mode === 'ADD_6_PERCENT' ? value.mul(100).div(94) : value; }
// FIX: aggregate actual unit quantities first, then round each line using the existing tax convention.
export function priceFboUnits(definition: FboTariffDefinition, units: Array<{
    skuId: string;
    quantity: number;
}>): FboPricedLine[] {
    const groups = new Map<string, {
        part: FboComponent;
        variantName: string | null;
        variantKey: string;
        quantity: Prisma.Decimal;
    }>();
    for (const unit of units) {
        if (!Number.isSafeInteger(unit.quantity) || unit.quantity <= 0)
            throw new BadRequestException('Проверьте фактическое количество обработанных товаров.');
        const matching = definition.variants.map((v, index) => ({ v, index })).filter(({ v }) => v.skuIds.includes(unit.skuId));
        if (matching.length > 1)
            throw new BadRequestException('Для товара задано несколько вариантов обработки.');
        const variant = matching[0];
        if (!variant && !positive(definition.common))
            throw new BadRequestException('Для обработанного товара не задан тариф. Уточните состав услуг.');
        for (const [parts, variantKey, variantName] of [[definition.common, 'common', null], ...(variant ? [[variant.v.services, 'variant-' + variant.index, variant.v.name]] : [])] as Array<[
            FboComponent[],
            string,
            string | null
        ]>) {
            for (const part of parts) {
                const key = variantKey + ':' + part.serviceId, previous = groups.get(key), quantity = new Prisma.Decimal(unit.quantity).mul(part.multiplier);
                groups.set(key, { part, variantKey, variantName, quantity: (previous?.quantity ?? new Prisma.Decimal(0)).plus(quantity) });
            }
        }
    }
    return [...groups.values()].map(({ part, variantName, variantKey, quantity }) => ({ serviceId: part.serviceId, variantName, variantKey, quantity: quantity.toFixed(3), priceBeforeTaxRub: part.priceRub, taxMode: part.taxMode, multiplier: part.multiplier, unitPriceRub: taxed(new Prisma.Decimal(part.priceRub), part.taxMode).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2), totalRub: taxed(new Prisma.Decimal(part.priceRub).mul(quantity), part.taxMode).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) }));
}
export function fboUnitAmount(definition: FboTariffDefinition, variantIndex?: number) {
    const index = variantIndex === undefined ? undefined : definition.variants[variantIndex];
    const skuId = index?.skuIds[0] ?? '__default__';
    return priceFboUnits(definition, [{ skuId, quantity: 1 }]).reduce((sum, line) => sum.plus(line.totalRub), new Prisma.Decimal(0)).toFixed(2);
}
