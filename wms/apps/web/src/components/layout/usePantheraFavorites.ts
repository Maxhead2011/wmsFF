import { useEffect, useRef, useState } from 'react';
import { createFavoritesSync, type FavoriteState } from '../../lib/pantheraFavorites';

export function usePantheraFavorites(userId: string, accessToken: string) {
  const [state, setState] = useState<FavoriteState>({ ids: [], busy: true, ready: false, message: '' });
  const sync = useRef<ReturnType<typeof createFavoritesSync>>();
  useEffect(() => {
    const controller = createFavoritesSync({
      key: `wms.panthera.favorites.${userId}`,
      storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
      changed: setState,
      request: async body => {
        const response = await fetch('/api/v1/auth/me/panthera-favorites', {
          method: body ? 'POST' : 'GET', cache: 'no-store',
          headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw Object.assign(new Error('Favorites request failed'), { status: response.status });
        return response.json();
      },
    });
    sync.current = controller; setState({ ...controller.initial }); void controller.load();
    const refresh = () => { if (document.visibilityState === 'visible') void controller.load(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.stop(); clearInterval(interval);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, accessToken]);
  return { ...state, save: (ids: string[]) => void sync.current?.save(ids), reload: () => void sync.current?.load() };
}
