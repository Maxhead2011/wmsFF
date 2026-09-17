import { describe, expect, it } from 'vitest';
import { fbsRequestSyncTitle } from '../src/modules/marketplace-connections/fbs-request-title';
describe('FBS request sync title', () => {
  // TEST: a background refresh after consolidation must retain the display group label.
  it('retains the shortage label when composition changes', () => {
    expect(fbsRequestSyncTitle('logoff нет на складе', 41, false, false, true)).toBe('logoff нет на складе');
  });
  it('retains existing standard, repeat and reshipment behavior', () => {
    expect(fbsRequestSyncTitle('old', 3, false, false, true)).toBe('FBS — 3 заказ(а/ов)');
    expect(fbsRequestSyncTitle('old', 3, false, true, true)).toBe('Повторная сборка WB — 3 заказов');
    expect(fbsRequestSyncTitle('custom', 3, true, false, true)).toBe('custom');
    expect(fbsRequestSyncTitle('logoff нет на складе', 3, false, false, false)).toBe('FBS — 3 заказ(а/ов)');
  });
});
