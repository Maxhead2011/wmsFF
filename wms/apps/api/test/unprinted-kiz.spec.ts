import { afterEach, describe, expect, it, vi } from 'vitest';
import { kizIdentity, scanPeriod, withoutConfirmedPrint } from '../src/modules/service/unprinted-kiz.policy';

afterEach(() => vi.unstubAllEnvs());
// TEST: a downloaded label, failed job, another attempt or another KIZ is not a successful print.
describe('unprinted KIZ selection', () => {
  const kiz = '0104680992592323215t>rsrOYP,IXp';
  const scan = { assemblyId: 'a', requestId: 'r', orderId: '1', kiz, at: new Date('2026-09-15T10:00:00Z') };
  const job = { assemblyId: 'a', requestId: 'r', orderId: '1', kiz, status: 'PRINTED', printedAt: new Date('2026-09-16T10:00:00Z') };
  it('compares physical codes without changing serial case or punctuation', () => {
    expect(kizIdentity(']d2' + kiz + '<GS>91EE12<GS>92signature')).toBe(kiz);
    expect(kizIdentity(kiz.toUpperCase())).not.toBe(kiz);
    expect(kizIdentity('broken')).toBeNull();
    expect(kizIdentity('(01)04680992592323(21)5t>rsrOYP,IXp')).toBe(kiz);
  });
  it('excludes only acknowledged matching prints, including after the selected period', () => {
    expect(withoutConfirmedPrint(scan, [job])).toBe(false);
    for (const change of [{status:'FAILED'}, {status:'QUEUED'}, {printedAt:null}, {assemblyId:'other'}, {requestId:'other'}, {orderId:'2'}, {kiz:kiz.toUpperCase()}, {printedAt:new Date('2026-09-14')}]) {
      expect(withoutConfirmedPrint(scan, [{...job,...change}])).toBe(true);
    }
    expect(withoutConfirmedPrint(scan, [])).toBe(true);
  });
  it('uses inclusive Moscow calendar dates and rejects invalid or excessive ranges', () => {
    const p=scanPeriod('2026-09-14','2026-09-15');
    expect(p.from.toISOString()).toBe('2026-09-13T21:00:00.000Z');
    expect(p.until.toISOString()).toBe('2026-09-15T21:00:00.000Z');
    for (const args of [['2026-02-30','2026-03-01'],['2026-09-16','2026-09-15'],['2026-01-01','2026-03-01']]) expect(()=>scanPeriod(...args as [string,string])).toThrow();
  });
});
