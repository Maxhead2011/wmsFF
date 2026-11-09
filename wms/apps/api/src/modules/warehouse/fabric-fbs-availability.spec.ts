import { describe, expect, it } from 'vitest';
import { identifyFabricSku, fabricMaterialAvailability } from './fabric-fbs-availability';

const sku = { id: 'sku', name: 'Ткань сатин', internalSku: 'white_3' };
const ledger = { rolls: [{ id: 'r', warehouseId: 'w', material: 'SATIN', color: 'white', remainingMm: 10000, cutMm: 0, createdAt: '2026-11-05' }] };
describe('fabric source availability', () => {
  // TEST: new colors use the same continuous-roll and branch guards as legacy articles.
  it('reserves exact metres for a custom color bound to a marketplace SKU', () => {
    const custom = { ...sku, internalSku: 'marketplace-offer', marketplacePayload: { fabricRollBinding: { version: 1, material: 'SATIN', color: 'custom-pink', colorName: 'Пудровый', lengthMm: 5000 } } };
    const customLedger = { rolls: [{ ...ledger.rolls[0], color: 'custom-pink', remainingMm: 10000 }] };
    expect(fabricMaterialAvailability(customLedger, custom, 'w', 2)).toMatchObject({ available: true, totalMm: 10000 });
    expect(fabricMaterialAvailability(customLedger, custom, 'w', 3)).toMatchObject({ available: false });
    expect(fabricMaterialAvailability(customLedger, custom, 'other', 1)).toMatchObject({ available: false });
  });
  // TEST: raw material supplies ready-to-cut orders without an AVAILABLE finished balance.
  it('finds exact continuous cuts in raw rolls', () => {
    expect(fabricMaterialAvailability(ledger, sku, 'w', 3)).toMatchObject({ available: true, totalMm: 9000 });
    expect(fabricMaterialAvailability(ledger, sku, 'w', 4)).toMatchObject({ available: false, reason: 'INSUFFICIENT_MATERIAL' });
  });
  it('uses the existing gabardine and legacy suffix mapping', () => {
    expect(identifyFabricSku({ ...sku, internalSku: 'gab_ivory_50-0' })).toEqual({ skuId: 'sku', material: 'GABARDINE', color: 'ivory', lengthMm: 50000 });
  });
  it.each(['white_2', 'white_30_extra', 'black_3-01', null])('does not guess unknown article %s', internalSku => {
    expect(identifyFabricSku({ ...sku, internalSku })).toBeNull();
  });
  it('does not classify an unrelated product as fabric', () => expect(identifyFabricSku({ ...sku, name: 'Платье' })).toBeNull());
  it('blocks only the pool with unresolved shipment consumption', () => {
    const pending = { warehouseId: 'w', material: 'SATIN', color: 'white', meters: 3 };
    expect(fabricMaterialAvailability({ ...ledger, shipmentPending: [pending] }, sku, 'w', 1)).toMatchObject({ reason: 'RECONCILIATION_REQUIRED' });
    expect(fabricMaterialAvailability({ ...ledger, shipmentPending: [{ ...pending, color: 'red' }] }, sku, 'w', 1)).toMatchObject({ available: true });
  });
  it('does not fall back to another branch', () => expect(fabricMaterialAvailability(ledger, sku, 'other', 1)).toMatchObject({ available: false }));
});
