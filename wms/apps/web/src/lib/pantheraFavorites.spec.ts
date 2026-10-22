import { expect, it, vi } from 'vitest';
import { createFavoritesSync, type Favorites } from './pantheraFavorites';

function device(server: { value: Favorites }, local: string[] | null = null) {
  let state: any, writes = 0;
  const controller = createFavoritesSync({
    key: 'user', storage: { getItem: () => JSON.stringify(local), setItem: () => {} },
    changed: next => { state = next; },
    request: async body => {
      if (!body) return structuredClone(server.value);
      writes++;
      if (body.revision !== server.value.revision) throw { status: 409 };
      server.value = { ids: body.ids, revision: body.revision + 1 };
      return structuredClone(server.value);
    },
  });
  return { ...controller, get state() { return state; }, get writes() { return writes; } };
}
// TEST: two independent browsers share additions, order and deletions.
it('syncs a migrated list and does not resurrect entries from another device', async () => {
  const server = { value: { ids: null, revision: 0 } as Favorites };
  const a = device(server, ['fbs', 'warehouse']), b = device(server, ['old']);
  await a.load(); await b.load(); expect(b.state.ids).toEqual(['fbs', 'warehouse']); expect(b.writes).toBe(0);
  await a.save(['warehouse', 'fbs']); await b.load(); expect(b.state.ids).toEqual(['warehouse', 'fbs']);
  await a.save([]); await b.load(); expect(b.state.ids).toEqual([]);
});
it('rejects a stale device edit instead of overwriting a newer list', async () => {
  const server = { value: { ids: ['fbs'], revision: 1 } as Favorites };
  const a = device(server), b = device(server); await a.load(); await b.load();
  await a.save(['fbs', 'warehouse']); await b.save(['fbo']);
  expect(server.value.ids).toEqual(['fbs', 'warehouse']);
  expect(b.state.ids).toEqual(server.value.ids); expect(b.state.message).toContain('другом устройстве');
});
it('does not write an empty first-use device or lose a list after network failure', async () => {
  const server = { value: { ids: null, revision: 0 } as Favorites };
  const a = device(server); await a.load(); expect(a.writes).toBe(0);
  const cache = vi.fn();
  const empty = createFavoritesSync({ key: 'new', storage: { getItem: () => null, setItem: cache },
    request: async () => ({ ids: null, revision: 0 }), changed: () => {} });
  await empty.load(); expect(cache).not.toHaveBeenCalled();
  let state: any;
  const broken = createFavoritesSync({ key: 'x', storage: { getItem: () => '["fbs"]', setItem() {} },
    request: async () => { throw Error('offline'); }, changed: next => { state = next; } });
  await broken.load(); expect(state.ids).toEqual(['fbs']); expect(state.ready).toBe(false);
  await broken.save([]); expect(state.ids).toEqual(['fbs']);
});
