import {useEffect, useRef, useState} from 'react';
import {ozonSync, type OzonSyncPreview} from '../../lib/api';
import './ozon-composition-sync.css';

type Props = {
  requestId: string;
  accessToken: string;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => void;
};

// FIX: this window only reads Ozon and applies the reviewed composition to WMS.
// Existing backend tokens revalidate both composition and physical progress at apply time.
export function OzonCompositionSync({requestId, accessToken, onBusyChange, onChanged}: Props) {
  const [preview, setPreview] = useState<OzonSyncPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [revision, reload] = useState(0);
  const generation = useRef(0);
  const submitting = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    setPreview(null); setConfirmed(false); setError(''); setLoading(true);
    void ozonSync(accessToken, requestId, 'sync-preview').then(data => {
      if (generation.current === current) setPreview(data);
    }).catch(e => {
      if (generation.current === current) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (generation.current === current) setLoading(false);
    });
    return () => { generation.current++; };
  }, [accessToken, requestId, revision]);

  async function apply() {
    if (!preview || !confirmed || loading || submitting.current) return;
    submitting.current = true;
    const current = generation.current;
    setApplying(true); setError(''); onBusyChange(true);
    try {
      await ozonSync(accessToken, requestId, 'sync-apply', {token: preview.token, confirm: true});
      if (generation.current === current) { setPreview(null); setConfirmed(false); onChanged(); }
    } catch (e) {
      if (generation.current === current) {
        setError(e instanceof Error ? e.message : String(e));
        // A failed or uncertain write requires a fresh comparison, never a blind repeat.
        setPreview(null); setConfirmed(false);
      }
    } finally {
      submitting.current = false;
      if (generation.current === current) setApplying(false);
      onBusyChange(false);
    }
  }

  const changed = preview?.rows.filter(row => row.before !== row.after) ?? [];
  return <section className="ozfbo-composition-sync" aria-label="Обновление состава из Ozon" aria-busy={loading || applying}>
    <p>Загрузим актуальный состав привязанной поставки Ozon в эту заявку ВМС. Состав в Ozon не изменяется.</p>
    <p>Уже отобранный товар и упакованные короба сохраняются. Если новый состав им противоречит, обновление будет остановлено.</p>
    {loading && <p role="status">Сверяю состав с Ozon…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <>
      <div className="ozfbo-sync-summary"><span>В ВМС <strong>{preview.needed} шт.</strong></span><span>В Ozon <strong>{preview.after} шт.</strong></span><span>Изменений количества: <strong>{changed.length}</strong></span></div>
      {!changed.length && <p role="status">Количества совпадают с Ozon. Можно обновить данные привязанной поставки без изменения количества.</p>}
        <div className="ozfbo-sync-table-wrap"><table>
          <thead><tr><th>Направление / товар / ШК</th><th>В ВМС</th><th>В Ozon</th><th>Упаковано</th></tr></thead>
          <tbody>{(changed.length ? changed : preview.rows).map(row => <tr key={`${row.direction}:${row.skuId}`}>
            <td><strong>{row.direction}</strong><br/>{row.name || row.barcode || 'Товар'}{row.name && <><br/>{row.barcode}</>}</td>
            <td>{row.before}</td><td>{row.after}</td><td>{row.packed}</td>
          </tr>)}</tbody>
        </table></div>
        <label className="ozfbo-sync-confirm"><input type="checkbox" checked={confirmed} disabled={applying} onChange={e => setConfirmed(e.target.checked)}/>Подтверждаю обновление состава заявки ВМС по Ozon</label>
    </>}
    <div className="ozfbo-sync-actions">
      <button type="button" disabled={loading || applying} onClick={() => reload(n => n + 1)}>Повторить сверку</button>
      {preview && <button type="button" className="ozfbo-sync-apply" disabled={!confirmed || loading || applying} onClick={() => void apply()}>{applying ? 'Обновляю заявку…' : 'Применить состав в ВМС'}</button>}
    </div>
  </section>;
}
