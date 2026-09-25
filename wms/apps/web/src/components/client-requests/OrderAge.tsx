import { useEffect, useState } from 'react';

// FIX: calculate from WB creation, without substituting a local import timestamp.
export function orderAgeLabel(createdAt: string | null | undefined, now: number): string | null {
  if (!createdAt) return null;
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

export function OrderAge({ createdAt }: { createdAt?: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const label = orderAgeLabel(createdAt, now);
  if (!label || !createdAt) return null;
  return <span className="online-order-age">
    <span>от {new Date(createdAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>
    <small style={{ display: 'inline-block', background: '#f0f0f3', borderRadius: 4, padding: '2px 8px', fontVariantNumeric: 'tabular-nums' }}>{label}</small>
  </span>;
}
