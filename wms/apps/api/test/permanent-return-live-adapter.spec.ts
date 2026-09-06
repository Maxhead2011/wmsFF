import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { functionText, adaptDesired, reserveName, returnName } = createRequire(import.meta.url)('../../../infra/scripts/permanent-return-live-adapter.cjs');
const source = readFileSync('src/modules/marketplace-connections/marketplace-connections.service.ts', 'utf8').replace(/\r\n/g, '\n');
describe('our-VM release adaptation', () => {
  // TEST: disabling the new lifecycle must not remove pre-existing production safeguards.
  it('preserves unconditional deferred-source, detached KIZ and boxless outbound stock', () => {
    const adapted = adaptDesired(functionText(source, reserveName), reserveName);
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
    const adapted = adaptDesired(functionText(source, returnName), returnName);
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
