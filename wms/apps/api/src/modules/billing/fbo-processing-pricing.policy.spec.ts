import { describe, expect, it } from 'vitest';
import { normalizeFboTariff, priceFboUnits } from './fbo-processing-pricing.policy';
const services = [{ id: 'process', code: 'ITEM_PROCESSING', name: 'Обработка', unit: 'PIECE', isActive: true }, { id: 'label', code: 'LABEL', name: 'Этикетка', unit: 'PIECE', isActive: true }, { id: 'cut', code: 'NOM_ОТРЕЗ_3М', name: 'Отрез', unit: 'PIECE', isActive: true }];
const part = (serviceId: string, priceRub: string, taxMode = 'INCLUDED') => ({ serviceId, priceRub, taxMode, multiplier: '1' });
describe('FBO per-unit service composition', () => {
    // TEST: currency entered with a comma must be composed rather than silently replaced with zero.
    it('adds selected services and prices actual units without changing component prices', () => {
        const definition = normalizeFboTariff({ common: [part('process', '10,64'), part('label', '4.26')], variants: [] }, services);
        expect(definition.common.map(x => x.priceRub)).toEqual(['10.64', '4.26']);
        const lines = priceFboUnits(definition, [{ skuId: 'sku', quantity: 12 }]);
        expect(lines.reduce((sum, x) => sum + Number(x.totalRub), 0)).toBe(178.8);
    });
    // TEST: different cuts are alternatives; the seven saved Bushkova rates cannot be summed together.
    it('selects the exact cut and grosses up the line before rounding', () => {
        const definition = normalizeFboTariff({ common: [], variants: [{ name: '3 м', skuIds: ['3m'], services: [part('cut', '30', 'ADD_6_PERCENT')] }, { name: '10 м', skuIds: ['10m'], services: [part('cut', '60', 'ADD_6_PERCENT')] }] }, services);
        expect(priceFboUnits(definition, [{ skuId: '3m', quantity: 2 }, { skuId: '10m', quantity: 1 }]).map(x => x.totalRub)).toEqual(['63.83', '63.83']);
        expect(() => priceFboUnits(definition, [{ skuId: '30m', quantity: 1 }])).toThrow(/не задан/);
    });
    // TEST: overlapping variants, repeated services and packaging fees would create ambiguous/double charges.
    it('rejects ambiguous SKU assignment and duplicate or separately billed services', () => {
        expect(() => normalizeFboTariff({ common: [], variants: [{ name: 'A', skuIds: ['sku'], services: [part('cut', '30')] }, { name: 'B', skuIds: ['sku'], services: [part('cut', '60')] }] }, services)).toThrow(/нескольк/);
        expect(() => normalizeFboTariff({ common: [part('process', '10')], variants: [{ name: 'A', skuIds: ['sku'], services: [part('process', '20')] }] }, services)).toThrow(/повтор/);
        expect(() => normalizeFboTariff({ common: [part('box', '100')], variants: [] }, [...services, { id: 'box', code: 'BOX_ASSEMBLY', name: 'Короб', unit: 'PIECE', isActive: true }])).toThrow(/отдельно/);
    });
    // TEST: invalid money/quantities must fail before a tariff or charge can be written.
    it.each(['', '-10', 'NaN', 'Infinity', '1.234', '1e3'])('rejects malformed price %s', price => expect(() => normalizeFboTariff({ common: [part('process', price)], variants: [] }, services)).toThrow());
    it('rejects zero total and malformed actual quantities', () => {
        expect(() => normalizeFboTariff({ common: [part('process', '0')], variants: [] }, services)).toThrow(/больше нуля/);
        const definition = normalizeFboTariff({ common: [part('process', '10')], variants: [] }, services);
        expect(() => priceFboUnits(definition, [{ skuId: 'sku', quantity: -1 }])).toThrow(/количество/);
    });
});
