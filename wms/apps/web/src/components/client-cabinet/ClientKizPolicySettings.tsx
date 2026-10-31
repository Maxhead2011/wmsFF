import { useEffect, useState } from 'react';
import { fetchClientKizPolicy, saveClientKizPolicy } from '../../lib/api';

// FIX: explicit client setting; loading/failure must not look like a disabled rule.
export function ClientKizPolicySettings({ accessToken, clientId }: { accessToken: string; clientId: string }) {
  const [required, setRequired] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setReady(false); setError(''); setMessage('');
    fetchClientKizPolicy(accessToken, clientId).then(result => {
      if (active) { setRequired(result.required); setReady(true); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить настройку.'); });
    return () => { active = false; };
  }, [accessToken, clientId]);
  async function save() {
    setBusy(true); setMessage(''); setError('');
    try {
      const saved = await saveClientKizPolicy(accessToken, clientId, required);
      setRequired(saved.required); setMessage('Сохранено. Обновите данные на ТСД перед продолжением работы.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить настройку.'); }
    finally { setBusy(false); }
  }
  if (error.includes('Настройка обязательных КИЗ не включена')) return null;
  return <section aria-label="Обязательные КИЗ" style={{ padding: 20, margin: '16px 0', border: '1px solid var(--line)', borderRadius: 12 }}>
    <h3>Маркировка при приёмке и инвентаризации</h3>
    <label><input type="checkbox" role="switch" checked={required} disabled={!ready || busy}
      onChange={e => setRequired(e.target.checked)} /> Все товары с КИЗ</label>
    <p>Для каждой единицы обязателен КИЗ, включая новые товары. Ручной ввод количества при инвентаризации недоступен.</p>
    <p>При выключении сохраняются требования маркировки, установленные в карточках товаров.</p>
    {!ready && !error && <p role="status">Загружаю настройку…</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? 'Сохранение…' : 'Сохранить правило КИЗ'}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
