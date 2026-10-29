import { afterEach, expect, it, vi } from 'vitest';
import { assertNewReceiptKiz, clientKizIdentity, clientKizPrefixes, ClientKizDuplicateError, lookupClientKiz, recordClientKizReceipt, withReceiptErrorKizGuard } from '../src/common/kiz-client-registry';
const { evidenceCollector } = require('../../../scripts/releases/kiz-client-guard-20261029/receipt-backfill.cjs');
const identity = '010460000000000121AbCdEfGhIjKlM';
const full = identity + '\u001d91EE12\u001d92proof';
afterEach(() => vi.unstubAllEnvs());
function db(saved: any[] = [], marks: any[] = [], ships: any[] = []) {
  return { $queryRaw: vi.fn(async (q: any) => q.strings?.join('').includes('FROM "KizClientRegistry"') ? saved : []),
    $executeRaw: vi.fn(), productMark: { findMany: vi.fn().mockResolvedValue(marks) },
    shippedKizHistory: { findMany: vi.fn().mockResolvedValue(ships) }, fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) } };
}
it('recognizes equivalent scanner forms while preserving case and literal punctuation', () => {
  // TEST: case-distinct serials must not become a false duplicate on the server or scanner.
  for (const value of [identity, full, ']d2' + full, full.replaceAll('\u001d', '<GS>'), full.replaceAll('\u001d', ''),
    '(01)' + identity.slice(2,16) + '(21)' + identity.slice(18), identity.slice(0,16) + '\u001d' + identity.slice(16)]) {
    expect(clientKizIdentity(value)).toBe(identity);
  }
  expect(clientKizIdentity(full.toLowerCase())).not.toBe(identity);
  expect(clientKizIdentity(identity + 'untrusted')).toBe('');
});
it('matches only the requested client and escapes SQL LIKE wildcards in the serial', async () => {
  const p = db(); const code = identity.slice(0,-2) + '_%';
  await expect(lookupClientKiz(p, 'client-A', code)).resolves.toBeNull();
  const where = p.productMark.findMany.mock.calls[0][0].where;
  expect(where.clientId).toBe('client-A');
  expect(where.OR[0].value.startsWith).toContain('\\_\\%');
  expect(p.shippedKizHistory.findMany.mock.calls[0][0].where.clientId).toBe('client-A');
});
it('includes indexed legacy prefixes for combined scanner and GS or parenthesized forms', () => {
  // TEST: canonical parsing and indexed lookup must recognize the same historical variants.
  const separated = identity.slice(0,16) + '<GS>' + identity.slice(16);
  const parenthesized = '(01)' + identity.slice(2,16) + '(21)' + identity.slice(18);
  for (const value of [']d2' + separated, ']D2' + separated.replace('<GS>','<Gs>'), ']d2' + parenthesized]) {
    expect(clientKizIdentity(value)).toBe(identity);
    expect(clientKizPrefixes(identity)).toContain(value);
  }
});
it('retains unknown original provenance and blocks existing marks regardless of status', async () => {
  for (const status of ['AVAILABLE','PACKING','SHIPPING','BLOCKED']) {
    const p = db([], [{ value: full, status, createdAt: new Date('2026-01-01'), box: { code: 'CURRENT', warehouseId:'wh' } }]);
    expect(await lookupClientKiz(p, 'client', identity)).toMatchObject({ firstReceivedAt: null, firstBoxCode: null,
      currentBoxCode: 'CURRENT', currentStatus: status });
  }
});
it('preserves immutable first receipt after the current mark was removed', async () => {
  const p = db([{ identity, firstReceivedAt:new Date('2026-01-01T00:00:00Z'), firstBoxCode:'OLD', firstWarehouseId:'wh', source:'RECEIPT' }]);
  expect(await lookupClientKiz(p,'client',full)).toMatchObject({ firstBoxCode:'OLD', firstReceivedAt:'2026-01-01T00:00:00.000Z' });
  expect(p.$executeRaw).not.toHaveBeenCalled();
});
it('does not disclose another branch original box, product or current box', async () => {
  const p = db([{ identity, firstReceivedAt:new Date(), firstBoxCode:'HIDDEN', firstWarehouseId:'other', productName:'PRIVATE',source:'RECEIPT' }],
    [{value:full,status:'AVAILABLE',box:{code:'HIDDEN_NOW',warehouseId:'other'}}]);
  const result = await lookupClientKiz(p,'client',full,'own');
  expect(result).toMatchObject({firstBoxCode:null,productName:null,currentBoxCode:null,detailsRestricted:true});
  expect(new ClientKizDuplicateError(result!).message).not.toMatch(/HIDDEN|PRIVATE/);
});
it('locks the identity and refuses a second receipt before recording history', async () => {
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');
  const p = db([{identity,source:'LEGACY_UNKNOWN'}]);
  await expect(assertNewReceiptKiz(p,{clientId:'c',kiz:full,operationKey:'op'})).rejects.toBeInstanceOf(ClientKizDuplicateError);
  expect(p.$queryRaw.mock.calls[0][0].strings.join('')).toContain('pg_advisory_xact_lock');
  expect(p.$executeRaw).not.toHaveBeenCalled();
});
it('does not run the new database path for the sold WMS', async () => {
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','false'); const p=db();
  await assertNewReceiptKiz(p,{clientId:'c',kiz:full,operationKey:'op'});
  await recordClientKizReceipt(p,{clientId:'c',kiz:full,operationKey:'op'});
  expect(p.$queryRaw).not.toHaveBeenCalled(); expect(p.$executeRaw).not.toHaveBeenCalled();
});
it('keeps error acceptance and identity history in the same transaction after taking the lock', async () => {
  // TEST: a concurrent regular receipt cannot pass while an error receipt adds an unmarked unit.
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED','true');const tx=db();
  const p={$transaction:async(action:any)=>action(tx)};
  await withReceiptErrorKizGuard(p,{clientId:'c',kiz:full,operationKey:'error-receipt'},async actual=>{
    expect(actual).toBe(tx);
    expect(tx.$queryRaw.mock.calls[0][0].strings.join('')).toContain('pg_advisory_xact_lock');
    expect(tx.$executeRaw).not.toHaveBeenCalled();return 'APPLIED';
  });
  expect(tx.$executeRaw).toHaveBeenCalledOnce();
  expect(tx.$executeRaw.mock.calls[0][0].values).toContain('CORRECTION');
});
it('backfill chooses only the earliest proven receipt and does not invent dates for current marks', () => {
  const c=evidenceCollector(clientKizIdentity);
  c.add({clientId:'c',kiz:full,receivedAt:new Date('2020-01-01'),boxCode:'WRONG',proven:false});
  c.add({clientId:'c',kiz:identity,receivedAt:new Date('2026-02-01'),boxCode:'SECOND',proven:true});
  c.add({clientId:'c',kiz:full,receivedAt:new Date('2026-01-01'),boxCode:'FIRST',proven:true});
  c.add({clientId:'other',kiz:full,receivedAt:new Date('2020-01-01'),boxCode:'UNKNOWN',proven:false});
  expect(c.entries.size).toBe(2);
  expect(c.entries.get(JSON.stringify(['c',identity])).firstBoxCode).toBe('FIRST');
  expect(c.entries.get(JSON.stringify(['other',identity])).firstReceivedAt).toBeNull();
});
