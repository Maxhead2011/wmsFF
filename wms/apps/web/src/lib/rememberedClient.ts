import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

const STORAGE_PREFIX = 'logoff-wms:last-client';
const CHANGE_EVENT = 'logoff-wms:last-client-change';

type RememberedClientOptions = {
  initialClientId?: string;
  fixedClientId?: string;
  preferInitialClientId?: boolean;
};

export function useRememberedClientId(
  userId: string,
  options: RememberedClientOptions = {},
): [string, Dispatch<SetStateAction<string>>] {
  const storageKey = useMemo(() => `${STORAGE_PREFIX}:${userId}`, [userId]);
  const fixedClientId = options.fixedClientId?.trim() ?? '';
  const initialClientId = options.initialClientId?.trim() ?? '';
  const [clientId, setClientIdState] = useState(() =>
    fixedClientId ||
    (options.preferInitialClientId ? initialClientId : '') ||
    readRememberedClientId(storageKey) ||
    initialClientId,
  );

  useEffect(() => {
    if (fixedClientId) {
      setClientIdState(fixedClientId);
    }
  }, [fixedClientId]);

  useEffect(() => {
    if (fixedClientId || typeof window === 'undefined') return undefined;

    const handleChange = (event: Event) => {
      const nextClientId = rememberedClientIdFromSameTabEvent(event, storageKey);
      if (nextClientId) {
        setClientIdState(nextClientId);
      }
    };

    // FIX: do not consume the browser `storage` event. Two WMS tabs can have
    // different branch-scoped client lists and otherwise keep forcing their
    // fallback client into each other, remounting the cabinet in a tight loop.
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
    };
  }, [fixedClientId, storageKey]);

  const setClientId = useCallback<Dispatch<SetStateAction<string>>>((nextValue) => {
    setClientIdState((current) => {
      const next = typeof nextValue === 'function' ? nextValue(current) : nextValue;
      if (!fixedClientId && next && typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next);
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
          detail: { storageKey, clientId: next },
        }));
      }
      return next;
    });
  }, [fixedClientId, storageKey]);

  return [clientId, setClientId];
}

export function validRememberedClientId(
  currentClientId: string,
  clients: Array<{ id: string }>,
  fallbackClientId = '',
) {
  return clients.some((client) => client.id === currentClientId)
    ? currentClientId
    : fallbackClientId || clients[0]?.id || '';
}

export function rememberedClientIdFromSameTabEvent(event: Event, storageKey: string) {
  // FIX: only the explicit same-tab event may update mounted client selectors.
  // Native cross-tab StorageEvent objects intentionally have no `detail`.
  const detail = (event as CustomEvent<{ storageKey?: string; clientId?: string }>).detail;
  if (event.type !== CHANGE_EVENT || detail?.storageKey !== storageKey) return '';
  return detail.clientId?.trim() ?? '';
}

function readRememberedClientId(storageKey: string) {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(storageKey)?.trim() ?? '';
}
