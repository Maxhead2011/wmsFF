import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FboProcessingPricingService, legacyFboConditions } from './fbo-processing-pricing.service';
import { ClientScopeService } from '../auth/client-scope.service';
const user: any = { id: 'owner', permissionCodes: ['billing:read', 'billing:write'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };
const catalog = [{ id: 'svc', code: 'ITEM_PROCESSING', name: 'Обработка', unit: 'PIECE', isActive: true }];
const dto: any = { operationKey: '6cc238ae-b83f-467e-b6a9-d2820e049e8c', definition: { common: [{ serviceId: 'svc', priceRub: '12,50', multiplier: '1', taxMode: 'INCLUDED' }], variants: [] } };
function fixture() { const client = { id: 'client', name: 'Клиент', code: 'CL1', billingServicePrices: [], fbsBillingSettings: null }; const tx: any = { $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn(), client: { findFirst: vi.fn().mockResolvedValue(client), findMany: vi.fn().mockResolvedValue([client]) }, billingService: { findMany: vi.fn().mockResolvedValue(catalog) }, sku: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) }, auditLog: { create: vi.fn() } }; const db: any = { ...tx, $transaction: vi.fn((fn: any) => fn(tx)) }; return { tx, client, service: new FboProcessingPricingService(db, new ClientScopeService()) }; }
beforeEach(() => vi.stubEnv('WMS_FBO_PROCESSING_PRICING_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());
// TEST: existing clients, including cut compositions, must never be rewritten by the new editor.
it('protects legacy cut conditions and retains each distinct price', () => { const client: any = { billingServicePrices: catalog.map(s => ({ serviceId: s.id, service: s, priceRub: '30', isActive: true, taxMode: 'ADD_6_PERCENT' })), fbsBillingSettings: { additionalServices: [{ serviceId: 'svc', service: catalog[0], quantityMultiplier: '1', matchKeywords: '2049267654685' }] } }; const result = legacyFboConditions(client); expect(result.protected).toBe(true); expect(result.services[0]).toMatchObject({ priceRub: '30', matchKeywords: '2049267654685' }); });
it('FBS collection price alone is not initial FBO configuration', () => { expect(legacyFboConditions({ billingServicePrices: [{ serviceId: 'fbs', priceRub: '45', isActive: true, service: { code: 'FBS_PROCESSING' } }] }).protected).toBe(false); });
it('rejects changing existing conditions without any financial or setting write', async () => { const { service, client, tx } = fixture(); (client as any).billingServicePrices = [{ serviceId: 'svc', service: catalog[0], priceRub: '12', isActive: true }]; await expect(service.create('client', dto, user)).rejects.toThrow('уже есть'); expect(tx.auditLog.create).not.toHaveBeenCalled(); expect(tx.$queryRaw.mock.calls.some((c: any) => c[0].join('').includes('INSERT'))).toBe(false); });
it('registry is read-only and respects client visibility', async () => { const { service, tx } = fixture(); const result = await service.list({ ...user, hiddenClientIds: ['hidden'] }); expect(result.enabled).toBe(true); expect(tx.$executeRaw.mock.calls[0][0].join('')).toBe('SET TRANSACTION READ ONLY'); expect(tx.client.findMany.mock.calls[0][0].where).toEqual({ id: { notIn: ['hidden'] }, isDemo: false }); expect(tx.auditLog.create).not.toHaveBeenCalled(); });
it('default-off performs no query and cannot save', async () => { vi.stubEnv('WMS_FBO_PROCESSING_PRICING_ENABLED', 'false'); const { service, tx } = fixture(); expect(await service.list(user)).toEqual({ enabled: false }); await expect(service.create('client', dto, user)).rejects.toThrow('не включена'); expect(tx.client.findFirst).not.toHaveBeenCalled(); });
it('blocks cross-client write before starting a transaction', async () => { const { service, tx } = fixture(); await expect(service.create('client', dto, { ...user, clientScopeMode: 'LIMITED' })).rejects.toThrow('Нет доступа'); expect(tx.client.findFirst).not.toHaveBeenCalled(); });
it('rejects foreign SKU in a variant before INSERT', async () => { const { service, tx } = fixture(); const body = { ...dto, definition: { common: [], variants: [{ name: 'Отрез', skuIds: ['foreign'], services: dto.definition.common }] } }; await expect(service.create('client', body, user)).rejects.toThrow('товары выбранного'); expect(tx.auditLog.create).not.toHaveBeenCalled(); });
// TEST: a lost response followed by retry cannot create or overwrite another tariff snapshot.
it('saves once, replays the same operation and refuses changed conditions', async () => {
    const { service, tx } = fixture();
    let saved: any = null;
    let inserts = 0;
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join('');
        if (sql.includes('pg_advisory')) return [];
        if (sql.startsWith('SELECT')) return saved ? [saved] : [];
        if (sql.startsWith('INSERT')) {
            inserts++;
            saved = { id: values[0], clientId: values[1], operationKey: values[2], definition: JSON.parse(values[3]), definitionHash: values[4], createdAt: new Date() };
            return [saved];
        }
        throw new Error('Unexpected query');
    });
    const first = await service.create('client', dto, user);
    expect(first.definition.common[0].priceRub).toBe('12.50');
    expect(await service.create('client', dto, user)).toEqual(first);
    expect(inserts).toBe(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    await expect(service.create('client', { ...dto, definition: { common: [{ ...dto.definition.common[0], priceRub: '99' }], variants: [] } }, user)).rejects.toThrow('уже сохранены');
    expect(inserts).toBe(1);
});
