import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { functionText, adaptDesired, reserveName, returnName } = createRequire(import.meta.url)('../../../infra/scripts/permanent-return-live-adapter.cjs');
const source = readFileSync('src/modules/marketplace-connections/marketplace-connections.service.ts', 'utf8').replace(/\r\n/g, '\n');
function checkedAdaptation(name: string) {
  const text = functionText(source, name);
  if (process.env.WMS_TEST_OUR_LIVE_BASELINE !== 'true') return adaptDesired(text, name);
  // TEST: live code is already transformed. Require the exact output of the approved Git adapter.
  const expected: Record<string, string> = {
    // TEST: exact-source KIZ protection plus the unchanged live storage adaptations.
    reserveCompletedWildberriesStock: 'd21414a6e741a2e393321a8b62d48dfceae41d6fbf500dc791c10e85ac961ddf',
    returnCompletedWildberriesStockReservation: '92b4fb3ecc971de4a65f9035f35e3e4ab5d1f06b32a4ee4142aa4263ed94b2cb',
  };
  expect(createHash('sha256').update(text).digest('hex')).toBe(expected[name]);
  return text;
}
describe('our-VM release adaptation', () => {
  // TEST: disabling the new lifecycle must not remove pre-existing production safeguards.
  it('preserves unconditional deferred-source, detached KIZ and boxless outbound stock', () => {
    const adapted = checkedAdaptation(reserveName);
    expect(adapted).toContain('task.completedAt ||\n        task.sourceBoxPending');
    expect(adapted).toContain('status: StockStatus.PACKING,\n          // FIX: source location');
    expect(adapted).not.toContain('boxId: permanentStorageBoxesEnabled() ? null : task.boxId');
    expect(adapted).toContain('const targetBoxId = null;');
    expect(adapted).toContain('const targetPalletId = null;');
    expect(adapted).toContain('if (shiftedFromAvailable > 0 && box?.id &&');
    expect(adapted).toContain('!await preserveEmptyStorageBox(box.code, this.boxCodes)');
  });
  // TEST: an unscanned rollback may not repopulate the historical source, even with flag off.
  it('preserves boxless fallback but uses freshly scanned receipt destination', () => {
    const adapted = checkedAdaptation(returnName);
    expect(adapted).toContain('const returnBoxId = receipt ? receipt.boxId : null;');
    expect(adapted).toContain('const returnPalletId = receipt ? receipt.palletId : null;');
    expect(adapted).toContain('returnedMark.count !== 1');
  });
  // TEST: unexpected input cannot be rewritten as a best-effort merge.
  it('rejects unknown changes and unknown functions', () => {
    expect(() => adaptDesired('changed function', reserveName)).toThrow();
    expect(() => adaptDesired(functionText(source, reserveName), 'unrelated')).toThrow();
  });
});
