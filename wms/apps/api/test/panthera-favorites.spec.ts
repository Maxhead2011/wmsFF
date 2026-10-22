import { expect, it, vi } from 'vitest';
import { readPantheraFavorites, savePantheraFavorites } from '../src/modules/auth/panthera-favorites';
function database() {
  const rows = new Map<string, any>();
  const tx = { $executeRaw: vi.fn(async () => []), systemSetting: {
    findUnique: vi.fn(async ({ where }) => rows.get(where.key) ?? null),
    upsert: vi.fn(async ({ where, create, update }) => { rows.set(where.key, rows.has(where.key) ? update : create); }),
  } };
  return { ...tx, $transaction: async (fn: any) => fn(tx) } as any;
}
// TEST: identity is supplied by authentication, not by the request body.
it('isolates accounts and ignores a forged user id', async () => {
  const db = database();
  await savePantheraFavorites(db, 'alice', { ids: ['fbs', 'fbs'], revision: 0, userId: 'bob' });
  expect(await readPantheraFavorites(db, 'alice')).toEqual({ ids: ['fbs'], revision: 1 });
  expect(await readPantheraFavorites(db, 'bob')).toEqual({ ids: null, revision: 0 });
  expect(db.$executeRaw).toHaveBeenCalledOnce();
});
it('checks revision under the transaction lock and permits explicit empty lists', async () => {
  const db = database();
  await savePantheraFavorites(db, 'u', { ids: ['warehouse'], revision: 0 });
  await expect(savePantheraFavorites(db, 'u', { ids: ['fbs'], revision: 0 })).rejects.toThrow('другом устройстве');
  await savePantheraFavorites(db, 'u', { ids: [], revision: 1 });
  expect(await readPantheraFavorites(db, 'u')).toEqual({ ids: [], revision: 2 });
});
it('rejects oversized or malformed preference payloads before any database access', async () => {
  const db = database();
  for (const body of [null, {}, { ids: ['<script>'], revision: 0 }, { ids: Array(101).fill('x'), revision: 0 }, { ids: [], revision: -1 }]) {
    await expect(savePantheraFavorites(db, 'u', body)).rejects.toThrow();
  }
  expect(db.$executeRaw).not.toHaveBeenCalled();
});
