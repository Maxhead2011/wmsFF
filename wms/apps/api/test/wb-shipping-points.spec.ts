import { describe, expect, it, vi } from 'vitest';
import { availableShippingPoint, saveShippingMethod, shippingPoints } from '../src/modules/marketplace-connections/wb-shipping-points';

// TEST: a destination warehouse is not a shipping point; WB availability is authoritative.
describe('WB shipping point contract', () => {
  it('requests points for the exact supply, city and shipping date', async () => {
    const request = vi.fn().mockResolvedValue({ shippingPoints: [{ id: 42, name: 'ПВЗ', address: 'Адрес', city: 'Москва', officeType: 'pp', available: true }] });
    expect(await shippingPoints(request, 'WB-GI-1', 'Москва', '2099-11-09')).toHaveLength(1);
    expect(request.mock.calls[0][0]).toContain('/supplies/WB-GI-1/shipping-points?');
    expect(request.mock.calls[0][0]).toContain('shippingDt=2099-11-09');
  });
  it('rejects unavailable and unlisted points', () => {
    expect(() => availableShippingPoint([{ id: '42', available: false }], '42')).toThrow();
    expect(() => availableShippingPoint([{ id: '42', available: true }], '43')).toThrow();
  });
  it('does not treat HTTP 200 with a per-supply error as success', async () => {
    const request = vi.fn().mockResolvedValue({ results: [{ supplyId: 'WB-GI-1', error: { code: 409, detail: 'SupplyAlreadyScanned' } }] });
    await expect(saveShippingMethod(request, 'WB-GI-1', '42', '2099-11-09')).rejects.toThrow('SupplyAlreadyScanned');
  });
  it('requires the exact supply success and a confirming fresh GET', async () => {
    const request = vi.fn().mockResolvedValueOnce({ results: [{ supplyId: 'WB-GI-1', success: true }] })
      .mockResolvedValueOnce({ shippingPointId: 43, shippingDt: '2099-11-09', shippingType: 'selfShipping' });
    await expect(saveShippingMethod(request, 'WB-GI-1', '42', '2099-11-09')).rejects.toThrow('не подтвердил');
  });
  it('saves the point and date through shipping-method, without delivering or touching stock', async () => {
    const request = vi.fn().mockResolvedValueOnce({ results: [{ supplyId: 'WB-GI-1', success: true }] })
      .mockResolvedValueOnce({ shippingPointId: 42, shippingDt: '2099-11-09', shippingType: 'selfShipping' });
    await saveShippingMethod(request, 'WB-GI-1', '42', '2099-11-09');
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ data: [{ supplyId: 'WB-GI-1', shippingPointId: 42, shippingDt: '2099-11-09', shippingType: 'selfShipping' }] });
  });
});
