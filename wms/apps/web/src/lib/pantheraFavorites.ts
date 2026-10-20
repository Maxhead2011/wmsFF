export type Favorites = { ids: string[] | null; revision: number };
export type FavoriteState = { ids: string[]; busy: boolean; ready: boolean; message: string };
type Options = { key: string; storage: Pick<Storage, 'getItem' | 'setItem'>; request: (body?: Favorites) => Promise<Favorites>; changed: (state: FavoriteState) => void };
export function createFavoritesSync({ key, storage, request, changed }: Options) {
  let local: string[] | null = null;
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null');
    if (Array.isArray(value)) local = [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)))].slice(0, 100);
  } catch { /* Corrupt local preferences must not block navigation. */ }
  let state: FavoriteState = { ids: local ?? [], busy: false, ready: false, message: '' };
  let revision = 0, stopped = false;
  const emit = () => { if (!stopped) changed({ ...state }); };
  function apply(result: Favorites) {
    revision = result.revision; state.ids = result.ids ?? []; state.ready = true;
    // An empty new device must not create a migration candidate before an older device imports its list.
    if (result.ids !== null) {
      try { storage.setItem(key, JSON.stringify(state.ids)); } catch { /* Server remains authoritative. */ }
    }
  }
  async function load() {
    if (stopped || state.busy) return;
    state.busy = true; emit();
    try {
      let result = await request();
      if (stopped) return;
      // FIX: import only into an uninitialised account; stale devices never merge deleted entries back.
      if (result.ids === null && local !== null) {
        try { result = await request({ ids: local, revision: 0 }); }
        catch (error) {
          if ((error as { status?: number }).status !== 409) throw error;
          result = await request();
        }
      }
      if (stopped) return;
      apply(result); local = null; state.message = '';
    } catch { if (!stopped) state.message = 'Не удалось синхронизировать быстрые ссылки. Повторите обновление.'; }
    finally { state.busy = false; emit(); }
  }
  async function save(ids: string[]) {
    if (stopped || state.busy || !state.ready) return;
    state.busy = true; state.message = ''; emit();
    try {
      const result = await request({ ids, revision });
      if (!stopped) apply(result);
    } catch (error) {
      if (stopped) return;
      state.message = 'Не удалось сохранить быстрые ссылки. Изменение не применено.';
      if ((error as { status?: number }).status === 409) {
        state.ready = false;
        try { const result = await request(); if (!stopped) apply(result); } catch { /* Retry reload before editing. */ }
        state.message = 'Список изменён на другом устройстве. Повторите своё действие.';
      }
    } finally { state.busy = false; emit(); }
  }
  return { load, save, initial: state, stop: () => { stopped = true; } };
}
