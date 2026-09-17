import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, X } from 'lucide-react';
import type { AuthSession } from '../../lib/api';
import { claimAdminPopup, fetchAdminNotifications, readAdminNotification, type AdminNotification } from '../../lib/adminNotifications';
import './admin-notifications.css';

// FIX: authoritative popup claims deduplicate across tabs, browsers and machines.
export function useAdminNotifications(session: AuthSession | null) {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [toasts, setToasts] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [beforeId, setBeforeId] = useState<number>();
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const activeToasts = useRef(new Set<number>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const scope = JSON.stringify(session?.user);
  function dismiss(id: number) {
    activeToasts.current.delete(id);
    clearTimeout(timers.current.get(id)); timers.current.delete(id);
    setToasts(current => current.filter(item => item.id !== id));
  }
  useEffect(() => {
    setItems([]); setToasts([]); setUnreadCount(0); setEnabled(false); setBeforeId(undefined); setError('');
    activeToasts.current.clear();
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, [session?.accessToken, scope]);
  useEffect(() => {
    if (!session?.user.roleCodes.includes('ADMIN')) return;
    let live = true; let busy = false; let disabled = false;
    const token = session.accessToken;
    async function refresh() {
      if (busy || disabled) return;
      busy = true;
      try {
        const first = await fetchAdminNotifications(token);
        const page = beforeId && first.enabled ? await fetchAdminNotifications(token, beforeId) : first;
        if (!live) return;
        setEnabled(first.enabled); setItems(page.items); setNextBeforeId(page.nextBeforeId);
        setUnreadCount(first.unreadCount); setError('');
        if (!first.enabled) { disabled = true; return; }
        for (const item of first.popupCandidates) {
          if (!live || document.visibilityState !== 'visible' || !document.hasFocus() || activeToasts.current.size >= 3) break;
          const result = await claimAdminPopup(token, item.id);
          if (!live) return;
          if (result.claimed) {
            activeToasts.current.add(item.id);
            setToasts(current => [...current, item]);
            timers.current.set(item.id, setTimeout(() => dismiss(item.id), 10000));
          }
        }
      } catch {
        if (live) setError('Уведомления временно недоступны. Подключение восстановится автоматически.');
      } finally { busy = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus); window.addEventListener('online', onFocus);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); };
  }, [session?.accessToken, scope, beforeId]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  async function markRead(item: AdminNotification) {
    if (!session) return;
    try {
      await readAdminNotification(session.accessToken, item.id);
      setItems(current => current.map(row => row.id === item.id ? { ...row, isRead: true } : row));
      if (!item.isRead) setUnreadCount(count => Math.max(0, count - 1));
      dismiss(item.id); setError('');
    } catch { setError('Не удалось отметить уведомление прочитанным. Повторите действие.'); }
  }
  return { items, toasts, unreadCount, enabled, error, beforeId, nextBeforeId, dismiss, markRead,
    older: () => { if (nextBeforeId) setBeforeId(nextBeforeId); }, latest: () => setBeforeId(undefined), setError };
}
export type AdminNotificationsState = ReturnType<typeof useAdminNotifications>;
function time(value: string) { return new Date(value).toLocaleString('ru-RU'); }
export function AdminNotificationList({ state, onOpen }: { state: AdminNotificationsState; onOpen: (item: AdminNotification) => Promise<void> }) {
  if (!state.enabled && !state.error) return null;
  return <section className="admin-notification-history" aria-label="Сигналы администраторам">
    <strong>Сигналы администраторам</strong>
    {state.error && <p role="status" className="admin-notification-error">{state.error}</p>}
    {state.items.map(item => <article key={item.id} className={`admin-notification-row ${item.isRead ? '' : 'is-unread'}`}>
      <button className="header-notification-item" type="button" onClick={() => void onOpen(item)}>
        <span className="header-notification-item__body"><strong>{item.title}</strong><span>{item.body}</span><small>{time(item.createdAt)}</small></span>
      </button>
      {!item.isRead && <button className="admin-notification-read" type="button" onClick={() => void state.markRead(item)}>Прочитано</button>}
    </article>)}
    {!state.items.length && state.enabled && <p>Сигналов пока нет</p>}
    <div className="admin-notification-paging">
      {state.beforeId && <button type="button" onClick={state.latest}>К новым</button>}
      {state.nextBeforeId && <button type="button" onClick={state.older}>Более ранние</button>}
    </div>
  </section>;
}
export function AdminNotificationToasts({ state, onOpen }: { state: AdminNotificationsState; onOpen: (item: AdminNotification) => Promise<void> }) {
  return <aside className="admin-notification-toasts" aria-live="polite" aria-label="Новые сигналы администраторам">
    {state.toasts.map(item => <article className={`admin-notification-toast ${item.type === 'PRODUCT_PROBLEM' || item.type === 'MISSING_PALLET_BOX' ? 'is-warning' : ''}`} key={item.id}>
      <button className="admin-notification-dismiss" type="button" aria-label="Закрыть уведомление" onClick={() => state.dismiss(item.id)}><X size={18}/></button>
      {item.type === 'PRODUCT_PROBLEM' || item.type === 'MISSING_PALLET_BOX' ? <AlertTriangle size={22}/> : <Bell size={22}/>}
      <strong>{item.title}</strong><p>{item.body}</p><small>{time(item.createdAt)}</small>
      <button className="primary-button" type="button" onClick={() => void onOpen(item)}>Открыть</button>
    </article>)}
  </aside>;
}
