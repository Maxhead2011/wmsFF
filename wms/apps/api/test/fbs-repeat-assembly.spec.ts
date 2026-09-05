import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRepeatAssemblyEnabled,
  assertRepeatCandidate,
  createRepeatAttemptData,
  repeatSelectionFingerprint,
} from '../src/modules/marketplace-connections/fbs-repeat-assembly';

// TEST: a second physical pick must never inherit the first attempt's identity
// or its completed/reserved/KIZ/worker state.
describe('independent FBS repeat assembly', () => {
  afterEach(() => vi.unstubAllEnvs());
  const candidate = {
    id: 'old-attempt', clientId: 'client', requestId: 'old-request',
    status: 'COMPLETED', barcode: '4601', kiz: 'old-kiz', requiresKiz: true,
    wbMetaStatus: 'ACCEPTED', itemCount: 1, completedAt: new Date(),
  };
  it('does not enable repeat assembly in the sold/default installation', () => {
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', '');
    expect(assertRepeatAssemblyEnabled).toThrow();
    vi.stubEnv('WMS_FBS_REPEAT_ASSEMBLY_ENABLED', 'true');
    expect(assertRepeatAssemblyEnabled).not.toThrow();
  });
  it('blocks cancelled, missing and unconfirmed marketplace states', () => {
    for (const status of [null, { supplierStatus: 'cancel', wbStatus: 'canceled' },
      { supplierStatus: 'complete', wbStatus: 'sold' }]) {
      expect(() => assertRepeatCandidate(candidate, status)).toThrow();
    }
    expect(() => assertRepeatCandidate(candidate, { supplierStatus: 'complete', wbStatus: 'waiting' })).not.toThrow();
  });
  it('does not take an order away from an active picker or reuse an unfinished attempt', () => {
    expect(() => assertRepeatCandidate({ ...candidate, status: 'IN_PROGRESS' },
      { supplierStatus: 'complete', wbStatus: 'waiting' })).toThrow();
  });
  it('does not silently unpack a previously recorded cargo place', () => {
    expect(() => assertRepeatCandidate({ ...candidate, cargoPackingId: 'closed-cargo' },
      { supplierStatus: 'complete', wbStatus: 'waiting' })).toThrow('грузокороб');
  });
  it('creates a new stock idempotency key and clears every physical fact', () => {
    const before = structuredClone(candidate);
    const data = createRepeatAttemptData(candidate, 'new-attempt', 'new-request', 'new-item', new Date());
    expect(data).toMatchObject({ id: 'new-attempt', requestId: 'new-request', requestItemId: 'new-item',
      status: 'WAITING_STOCK', deviceCode: 'AUTO', workerUserId: null, workerName: null,
      barcode: null, sourceBarcode: null, kiz: null, completedAt: null, startedAt: null,
      reservedAt: null, reservedBoxId: null, boxId: null, boxCode: null,
      cargoPackingId: null, cargoPackedAt: null, wbMetaStatus: 'PENDING',
      stickerBarcode: null, marketplaceSubmittedAt: null });
    expect(`fbs-sticker-pick:${data.id}`).not.toBe(`fbs-sticker-pick:${candidate.id}`);
    expect(candidate).toEqual(before);
  });
  it('rejects an unchanged attempt identity', () => {
    expect(() => createRepeatAttemptData(candidate, candidate.id, 'new-request', 'item', new Date())).toThrow();
  });
  it('deduplicates repeated clicks without confusing different selections or clients', () => {
    const a = { connectionId: 'connection', id: '1', assemblyId: 'attempt-1' };
    const b = { connectionId: 'connection', id: '2', assemblyId: 'attempt-2' };
    expect(repeatSelectionFingerprint('client', 'warehouse', [a, b]))
      .toBe(repeatSelectionFingerprint('client', 'warehouse', [b, a, a]));
    expect(repeatSelectionFingerprint('other-client', 'warehouse', [a, b]))
      .not.toBe(repeatSelectionFingerprint('client', 'warehouse', [a, b]));
    expect(repeatSelectionFingerprint('client', 'warehouse', [{ ...a, assemblyId: 'later-attempt' }, b]))
      .not.toBe(repeatSelectionFingerprint('client', 'warehouse', [a, b]));
  });
});
