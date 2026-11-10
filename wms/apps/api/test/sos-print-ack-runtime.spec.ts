import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const { restorePrintAckBinding } = createRequire(import.meta.url)('../../../scripts/releases/sos-print-ack-20261110/repair-runtime.cjs');
const binding = 'const fbs_request_auto_status_1 = require("../../common/stock/fbs-request-auto-status");';
const broken = `"use strict";
exports.finish = async function(tx, requestId) {
  if (fbs_request_auto_status_1.fbsRequestAutoStatusEnabled()) {
    await fbs_request_auto_status_1.reconcileFbsRequestStatus(tx, requestId, 'SOS_PRINT');
  }
  return { acknowledged: true };
};`;

function execute(source: string) {
  const reconcile = vi.fn(async () => undefined);
  const exports: any = {};
  const require = vi.fn((name: string) => {
    expect(name).toBe('../../common/stock/fbs-request-auto-status');
    return { fbsRequestAutoStatusEnabled: () => true, reconcileFbsRequestStatus: reconcile };
  });
  runInNewContext(source, { exports, require });
  return { exports, reconcile, require };
}

describe('SOS print acknowledgement runtime binding', () => {
  // TEST: reproduce the deployed ReferenceError, then execute the same acknowledgement after repair.
  it('restores acknowledgement without changing the stock/status calls', async () => {
    const before = execute(broken);
    await expect(before.exports.finish({}, 'request')).rejects.toThrow('fbs_request_auto_status_1 is not defined');
    const after = execute(restorePrintAckBinding(broken));
    await expect(after.exports.finish({}, 'request')).resolves.toEqual({ acknowledged: true });
    expect(after.reconcile).toHaveBeenCalledWith({}, 'request', 'SOS_PRINT');
    expect(after.require).toHaveBeenCalledTimes(1);
  });

  // TEST: replaying an ACK does not require reinserting the import or rebuilding a print job.
  it('is idempotent when preparing an already repaired release', () => {
    const fixed = restorePrintAckBinding(broken);
    expect(fixed).toContain(binding);
    expect(restorePrintAckBinding(fixed)).toBe(fixed);
    expect(fixed.replace(binding + '\n', '')).toBe(broken);
  });

  // TEST: an existing binding and unrelated runtime bytes remain untouched.
  it('preserves a correctly compiled module', () => {
    const correct = broken.replace('"use strict";', '"use strict";\n' + binding);
    expect(restorePrintAckBinding(correct)).toBe(correct);
    expect(restorePrintAckBinding('"use strict"; exports.other = 1;')).toBe('"use strict"; exports.other = 1;');
  });

  // TEST: own-WMS deployment overlays have module-level requires before the compiled prologue.
  it('preserves the existing import-only deployment preamble byte for byte', () => {
    const prefix = 'const { oldFeature } = require("./existing-feature");\r\n';
    expect(restorePrintAckBinding(prefix + broken).replace(binding + '\n', '')).toBe(prefix + broken);
  });

  // TEST: refuse an unexpected wrapper instead of placing an import in an unsafe scope.
  it('rejects an unreviewed module wrapper', () => {
    expect(() => restorePrintAckBinding(broken.replace('"use strict";\n', ''))).toThrow('CommonJS');
  });
});
