import { afterEach, expect, it, vi } from 'vitest';
import { physicalKizIdentity, findPhysicalKizId } from '../src/common/kiz-physical-identity';
afterEach(() => vi.unstubAllEnvs());
const full = '0104680992598455215rYJoe1STv"l%\u001d91EE12\u001d92proof';
it('recognizes box 181 legacy code without separators without changing its serial case or full value', async () => {
  // TEST: the same scanned unit must not require registration as an unknown KIZ.
  expect(physicalKizIdentity(full)).toBe(physicalKizIdentity(full.replaceAll('\u001d', '')));
  expect(physicalKizIdentity(full.toLowerCase())).not.toBe(physicalKizIdentity(full));
  vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED', 'true');
  const db: any = { productMark: { findMany: vi.fn(async () => [{ id: 'legacy', value: full.replaceAll('\u001d', '') }]) } };
  await expect(findPhysicalKizId(db, full)).resolves.toBe('legacy');
});
it('refuses duplicate identities instead of choosing an arbitrary unit', async () => {
  // TEST: a legacy alias and full alias must be reviewed, even if one is blocked.
  vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED', 'true');
  const db: any = { productMark: { findMany: vi.fn(async () => [{ id: 'a', value: full }, { id: 'b', value: full.replaceAll('\u001d', '') }]) } };
  await expect(findPhysicalKizId(db, full)).rejects.toThrow('несколько');
});
it('keeps the sold VM on its existing lookup and rejects malformed suffixes', async () => {
  // TEST: opt-in isolation and no arbitrary truncation of longer serials.
  vi.stubEnv('WMS_KIZ_IDENTITY_TRANSFER_ENABLED', 'false');
  const db: any = { productMark: { findMany: vi.fn() } };
  await expect(findPhysicalKizId(db, full)).resolves.toBeUndefined();
  expect(db.productMark.findMany).not.toHaveBeenCalled();
  expect(physicalKizIdentity(full.slice(0, 31) + 'extra')).toBe('');
});
