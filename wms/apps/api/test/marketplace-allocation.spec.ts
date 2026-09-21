import { describe, expect, it } from 'vitest';
import { allocationEligibility, splitMarketplaceStock, validateAllocationDraft } from '../src/modules/marketplace-connections/marketplace-allocation';

const connection = (id: string, marketplace: string, isActive = true) => ({ id, marketplace, isActive });
describe('WB/Ozon allocation', () => {
  // TEST: two cabinets are insufficient unless they belong to different supported marketplaces.
  it('requires active WB and Ozon, without client-name allowlists', () => {
    expect(allocationEligibility([connection('w', 'WILDBERRIES')]).message).toBe('Подключён только 1 кабинет');
    expect(allocationEligibility([connection('w', 'WILDBERRIES'), connection('w2', 'WILDBERRIES')]).available).toBe(false);
    expect(allocationEligibility([connection('w', 'WILDBERRIES'), connection('o', 'OZON', false)]).available).toBe(false);
    expect(allocationEligibility([connection('w', 'WILDBERRIES'), connection('o', 'OZON')]).available).toBe(true);
    expect(allocationEligibility([]).message).toBe('Нет подключённых кабинетов');
  });
  // TEST: rounding must preserve each barcode's available units, including tiny balances.
  it('conserves stock for every integer percentage and small quantity', () => {
    for (let available = 0; available <= 150; available++) for (let percent = 0; percent <= 100; percent++) {
      const result = splitMarketplaceStock(available, percent);
      expect(result.wb + result.ozon).toBe(available);
      expect(result.wb).toBeGreaterThanOrEqual(0);
      expect(result.ozon).toBeGreaterThanOrEqual(0);
    }
    expect(splitMarketplaceStock(3, 50)).toEqual({ wb: 2, ozon: 1 });
    expect(splitMarketplaceStock(1, 30)).toEqual({ wb: 0, ozon: 1 });
  });
  // TEST: a hostile body cannot select the wrong marketplace or submit invalid percentages.
  it('rejects invalid drafts and quantities', () => {
    const connections = [connection('w', 'WILDBERRIES'), connection('o', 'OZON')];
    expect(() => validateAllocationDraft({ wbConnectionId: 'o', ozonConnectionId: 'w', wbPercent: 50 }, connections)).toThrow();
    for (const wbPercent of [-1, 101, 0.5, '50', null]) {
      expect(() => validateAllocationDraft({ wbConnectionId: 'w', ozonConnectionId: 'o', wbPercent }, connections)).toThrow();
    }
    expect(() => splitMarketplaceStock(-1, 50)).toThrow();
    expect(() => splitMarketplaceStock(1.5, 50)).toThrow();
    expect(validateAllocationDraft({ wbConnectionId: 'w', ozonConnectionId: 'o', wbPercent: 70 }, connections)).toEqual({ wbConnectionId: 'w', ozonConnectionId: 'o', wbPercent: 70 });
  });
});
