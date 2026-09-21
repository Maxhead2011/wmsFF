import { useEffect, useRef, useState } from 'react';
import { fetchDuplicateCatalog } from '../../lib/api';
import { duplicateArticleOptions } from '../../lib/duplicateStockGroups';

export function DuplicateArticlePicker({ title, accessToken, clientId, value, onChange, disabled }: {
  title: string; accessToken: string; clientId: string; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const [query, setQuery] = useState(''), [options, setOptions] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setQuery(''); setOptions([]); setError(''); setBusy(false); return () => { generation.current++; }; }, [clientId, accessToken]);
  async function search() {
    const id = ++generation.current; setBusy(true); setError('');
    try {
      const result = await fetchDuplicateCatalog(accessToken, clientId, { search: query.trim(), page: 1 });
      if (id !== generation.current) return;
      setOptions(duplicateArticleOptions(result.rows));
      if (result.hasMore) setError('Показаны первые совпадения. Уточните артикул или ШК.');
      else if (!result.rows.length) setError('Карточки не найдены. Проверьте поиск и синхронизацию.');
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : 'Не удалось найти карточки.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  return <fieldset disabled={disabled}><legend>{title}</legend>
    <div className="duplicate-stock__search"><input aria-label={`Поиск: ${title}`} placeholder="Артикул, название или штрихкод" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && query.trim() && !busy) { e.preventDefault(); void search(); } }} />
      <button type="button" disabled={!query.trim() || busy} onClick={() => void search()}>{busy ? 'Поиск…' : 'Найти'}</button></div>
    <select aria-label={title} value={value} onChange={e => onChange(e.target.value)}><option value="">Выберите артикул</option>{[...new Set([...(value ? [value] : []), ...options])].map(a => <option key={a} value={a}>{a}</option>)}</select>
    {error && <small role="status">{error}</small>}
  </fieldset>;
}
