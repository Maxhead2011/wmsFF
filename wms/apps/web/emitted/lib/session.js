const STORAGE_KEY = 'logoff-wms-session';
export function loadStoredSession() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
    }
}
export function storeSession(session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}
export function clearStoredSession() {
    window.localStorage.removeItem(STORAGE_KEY);
}
