import { useCallback, useEffect, useMemo, useState } from 'react';
const STORAGE_PREFIX = 'logoff-wms:last-client';
const CHANGE_EVENT = 'logoff-wms:last-client-change';
export function useRememberedClientId(userId, options = {}) {
    const storageKey = useMemo(() => `${STORAGE_PREFIX}:${userId}`, [userId]);
    const fixedClientId = options.fixedClientId?.trim() ?? '';
    const initialClientId = options.initialClientId?.trim() ?? '';
    const [clientId, setClientIdState] = useState(() => fixedClientId ||
        (options.preferInitialClientId ? initialClientId : '') ||
        readRememberedClientId(storageKey) ||
        initialClientId);
    useEffect(() => {
        if (fixedClientId) {
            setClientIdState(fixedClientId);
        }
    }, [fixedClientId]);
    useEffect(() => {
        if (fixedClientId || typeof window === 'undefined')
            return undefined;
        const handleChange = (event) => {
            const detail = event.detail;
            if (detail?.storageKey === storageKey && detail.clientId) {
                setClientIdState(detail.clientId);
            }
        };
        const handleStorage = (event) => {
            if (event.key === storageKey && event.newValue) {
                setClientIdState(event.newValue);
            }
        };
        window.addEventListener(CHANGE_EVENT, handleChange);
        window.addEventListener('storage', handleStorage);
        return () => {
            window.removeEventListener(CHANGE_EVENT, handleChange);
            window.removeEventListener('storage', handleStorage);
        };
    }, [fixedClientId, storageKey]);
    const setClientId = useCallback((nextValue) => {
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
export function validRememberedClientId(currentClientId, clients, fallbackClientId = '') {
    return clients.some((client) => client.id === currentClientId)
        ? currentClientId
        : fallbackClientId || clients[0]?.id || '';
}
function readRememberedClientId(storageKey) {
    if (typeof window === 'undefined')
        return '';
    return window.localStorage.getItem(storageKey)?.trim() ?? '';
}
