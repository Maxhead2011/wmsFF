import { useEffect, useState } from 'react';
import type { LamodaPreview, LamodaQuantity } from '../../lib/api';

type Line = NonNullable<LamodaPreview['availability']>['lines'][number];
// FIX: editing a proposal never creates a request; explicit creation follows a valid review.
export function reviewLamodaQuantities(lines: Line[], values: Record<string, string>) {
  const quantities = lines.map(l => ({ skuId: l.skuId, quantity: values[l.skuId]?.trim() ? Number(values[l.skuId]) : NaN }));
  const valid = lines.length > 0 && quantities.every((q, i) => Number.isSafeInteger(q.quantity) && q.quantity >= 0
    && q.quantity <= lines[i].requestedQuantity && q.quantity <= lines[i].availableQuantity);
  const total = quantities.reduce((n, q) => n + (Number.isSafeInteger(q.quantity) ? q.quantity : 0), 0);
  return { quantities, total, valid: valid && total > 0 };
}

export function LamodaStockReview({ preview, title, disabled, onCreate, onOpen }: {
  preview: LamodaPreview; title: string; disabled: boolean; onCreate: (quantities: LamodaQuantity[]) => void;
  onOpen?: (requestId: string) => void;
}) {
  const lines = preview.availability?.lines ?? [];
  const original = () => Object.fromEntries(lines.map(l => [l.skuId, String(l.requestedQuantity)]));
  const [values, setValues] = useState<Record<string, string>>(original);
  useEffect(() => setValues(original()), [preview]);
  const review = reviewLamodaQuantities(lines, values);
  const planned = lines.reduce((n, l) => n + l.requestedQuantity, 0);
  const shortage = lines.reduce((n, l) => n + l.shortageQuantity, 0);
  const locked = disabled || !preview.canAdjust || preview.unresolvedRows.length > 0;
  // FIX: original import quantities and free stock are not the composition of an existing request.
  if (preview.existingRequest) return <section className="lamoda-card lamoda-stock-review" aria-label="Проверка остатков Lamoda">
    <h3>Сборка уже создана · №{preview.existingRequest.number}</h3>
    <p>Корректировка исходного плана доступна до создания заявки. Актуальный состав и ход отбора показаны в сборке. Исходный файл сохраняется отдельно.</p>
    {onOpen && <button type="button" disabled={disabled} onClick={() => onOpen(preview.existingRequest!.id)}>Открыть сборку №{preview.existingRequest.number}</button>}
  </section>;
  return <section className="lamoda-card lamoda-stock-review" aria-label="Проверка остатков Lamoda">
    <h3>Проверка: {title}</h3><p>{preview.message}</p>
    {preview.unresolvedRows.length > 0 && <p role="alert">Сначала сопоставьте товары в строках: {preview.unresolvedRows.join(', ')}</p>}
    {shortage > 0 && <p className="lamoda-stock-warning" role="status">В исходном плане не хватает {shortage} шт. Заявка не создаётся, пока количество к сборке превышает свободный остаток.</p>}
    <div className="lamoda-scroll"><table><thead><tr><th>Товар / артикул</th><th>Размер</th><th>ШК WMS</th><th>В плане</th><th>В резервах</th><th>Свободно</th><th>Дефицит плана</th><th>К сборке</th></tr></thead>
      <tbody>{lines.map(l => <tr key={l.skuId} data-shortage={l.shortageQuantity > 0}>
        <td>{l.name ?? l.barcode}<small>{l.article ?? '—'}</small></td><td>{l.size ?? '—'}</td><td>{l.barcode}</td>
        <td>{l.requestedQuantity}</td><td>{l.reservedQuantity}</td><td>{l.availableQuantity}</td><td>{l.shortageQuantity || '—'}</td>
        <td><input type="number" min={0} max={Math.min(l.requestedQuantity, l.availableQuantity)} step={1} aria-label={`К сборке: ${l.barcode}`} disabled={locked}
          value={values[l.skuId] ?? ''} onChange={e => setValues(v => ({ ...v, [l.skuId]: e.target.value }))}/>
          {values[l.skuId] === '0' && <small>Исключён из сборки</small>}</td>
      </tr>)}</tbody></table></div>
    <div className="lamoda-stock-actions">
      <button disabled={locked || !shortage} onClick={() => setValues(Object.fromEntries(lines.map(l => [l.skuId, String(Math.min(l.requestedQuantity, l.availableQuantity))])))}>Скорректировать по доступному остатку</button>
      <button disabled={locked} onClick={() => setValues(original())}>Восстановить исходные количества</button>
    </div>
    <p aria-live="polite">Исходный план: {planned} шт. · К сборке: {review.total} шт.</p>
    <p>Нулевые позиции исключаются. При нескольких направлениях товар распределяется в порядке исходного плана. Исходный файл сохраняется.</p>
    {preview.remoteShipmentId && <p>Для поставки {preview.remoteShipmentId} исправьте состав также в кабинете Lamoda. Создание разрешено только при совпадении составов; поставка Lamoda здесь не изменяется.</p>}
    {!review.valid && lines.length > 0 && <p>Укажите целые количества в пределах свободного остатка. В сборке должна остаться хотя бы одна единица.</p>}
    <button className="lamoda-stock-create" disabled={locked || !review.valid} onClick={() => { if (!locked && review.valid) onCreate(review.quantities); }}>Создать сборку и резерв · {review.total} шт.</button>
  </section>;
}
