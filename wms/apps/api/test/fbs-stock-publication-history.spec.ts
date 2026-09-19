import { expect, it, vi } from 'vitest';
import { publishFbsStocksWithHistory } from '../src/modules/marketplace-connections/fbs-stock-publication-history';

function fixture() {
  const events: Array<{ phase: string; payload: any }> = [];
  const io = {
    record: vi.fn(async (phase: string, payload: any) => { events.push({ phase, payload }); }),
    read: vi.fn().mockResolvedValueOnce(new Map([[123, 1]])).mockResolvedValueOnce(new Map([[123, 0]])),
    send: vi.fn().mockResolvedValue({}),
  };
  return { io, events, run: () => publishFbsStocksWithHistory([{ chrtId: 123, amount: 0 }], io) };
}
it('retains before, sent and observed amounts under one unique operation id', async () => {
  // TEST: mutable latest-publication fields previously erased evidence of prior sends.
  const f = fixture(); await f.run();
  expect(f.events.map(e => e.phase)).toEqual(['PLANNED', 'BEFORE', 'SENDING', 'ACKNOWLEDGED', 'CONFIRMED']);
  expect(new Set(f.events.map(e => e.payload.operationId)).size).toBe(1);
  expect(f.events[1].payload.observed).toEqual([{ chrtId: 123, amount: 1 }]);
  expect(f.events[4].payload.observed).toEqual([{ chrtId: 123, amount: 0 }]);
  expect(f.io.send).toHaveBeenCalledOnce();
  f.io.read.mockResolvedValue(new Map([[123, 0]])); await f.run();
  expect(new Set(f.events.map(e => e.payload.operationId)).size).toBe(2);
});
it('never mutates WB if the intent cannot be recorded', async () => {
  // TEST: absence of audit must not leave a successful untraceable publication.
  const f = fixture(); f.io.record.mockRejectedValueOnce(new Error('DB unavailable'));
  await expect(f.run()).rejects.toThrow(); expect(f.io.send).not.toHaveBeenCalled();
});
it.each([new Map(), new Map([[123, -1]]), new Map([[123, 0.5]])])('does not treat absent/invalid WB stock as zero', async before => {
  // TEST: failed lookup must not enable a blind stock overwrite.
  const f = fixture(); f.io.read.mockReset().mockResolvedValue(before);
  await expect(f.run()).rejects.toThrow(); expect(f.io.send).not.toHaveBeenCalled();
  expect(f.events.at(-1)?.phase).toBe('UNCONFIRMED');
});
it('does not mark a successful PUT as confirmed if WB still exposes one unit', async () => {
  // TEST: the request 1118 mismatch must be an error, not a saved successful zero.
  const f = fixture(); f.io.read.mockReset().mockResolvedValue(new Map([[123, 1]]));
  await expect(f.run()).rejects.toThrow('отличается'); expect(f.events.at(-1)?.phase).toBe('MISMATCH');
});
it('records timeout uncertainty and does not automatically repeat PUT', async () => {
  // TEST: retrying an uncertain positive amount could replenish a sold unit.
  const f = fixture(); f.io.send.mockRejectedValueOnce(new Error('timeout'));
  await expect(f.run()).rejects.toThrow('не подтверждена'); expect(f.io.send).toHaveBeenCalledOnce();
  expect(f.events.at(-1)?.phase).toBe('SEND_UNCONFIRMED');
});
it('retains acknowledged intent when the verification read fails', async () => {
  // TEST: successful response and failed verification remain distinct facts.
  const f = fixture(); f.io.read.mockReset().mockResolvedValueOnce(new Map([[123, 1]])).mockRejectedValueOnce(new Error('timeout'));
  await expect(f.run()).rejects.toThrow('проверка'); expect(f.events.at(-1)?.phase).toBe('VERIFY_FAILED');
  expect(f.events.some(e => e.phase === 'ACKNOWLEDGED')).toBe(true);
});
