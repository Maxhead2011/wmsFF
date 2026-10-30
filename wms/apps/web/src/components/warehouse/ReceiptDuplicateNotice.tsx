export type ReceiptDuplicate = {
  identity?: string; firstReceivedAt?: string | null; firstBoxCode?: string | null;
  productName?: string | null; barcode?: string | null; currentStatus?: string | null;
  currentBoxCode?: string | null; reviewId?: string | null;
};

// FIX: only the server's structured conflict is a duplicate; network failures are not evidence.
export function receiptDuplicateFromError(value: unknown): ReceiptDuplicate | null {
  if (!value || typeof value !== 'object' || !('code' in value) || value.code !== 'KIZ_DUPLICATE') return null;
  const info = 'duplicateInfo' in value ? value.duplicateInfo : null;
  return info && typeof info === 'object' ? info as ReceiptDuplicate : {};
}

export function ReceiptDuplicateNotice({ info, onContinue, onReview, busy = false, message = '' }: {
  info: ReceiptDuplicate; onContinue: () => void; onReview?: () => void; busy?: boolean; message?: string;
}) {
  const time = info.firstReceivedAt ? new Date(info.firstReceivedAt) : null;
  const status: Record<string, string> = { AVAILABLE: 'на складе', RESERVED: 'зарезервирован', PACKING: 'в сборке / упаковке', SHIPPING: 'подготовлен к отгрузке', SHIPPED: 'отгружен', BLOCKED: 'заблокирован', QUARANTINE: 'карантин' };
  return <div role="alert" style={{ background: '#fecaca', color: '#5a0000', border: '2px solid #b91c1c', borderRadius: 12, padding: 20 }}>
    <strong style={{ display: 'block', fontSize: 26 }}>ОТЛОЖИТЕ ТОВАР</strong>
    <b>ДУБЛЬ КИЗ — ТОВАР НЕ ПРИНЯТ</b>
    <p>Ранее принят: {time && !Number.isNaN(time.getTime()) ? time.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК' : 'первоначальная приёмка не установлена'}</p>
    <p>Короб при приёмке: {info.firstBoxCode || 'не установлен'}</p>
    <p>Товар: {info.productName || 'не установлен'}{info.barcode ? ` · ШК ${info.barcode}` : ''}</p>
    <p>Сейчас: {status[info.currentStatus ?? ''] || info.currentStatus || 'требуется проверка'}{info.currentBoxCode ? ` · короб ${info.currentBoxCode}` : ''}</p>
    {info.identity ? <p>КИЗ: {info.identity}</p> : null}
    <p>Количество не увеличено. Решение — в «КИЗ → Проверки КИЗ».</p>
    {message ? <p>{message}</p> : null}
    {info.reviewId ? <p>Передано на проверку.</p> : onReview ? <button type="button" disabled={busy} onClick={onReview}>{busy ? 'Передаю…' : 'Передать на проверку'}</button> : null}
    <button type="button" disabled={busy} onClick={onContinue}>Сканировать другой товар</button>
  </div>;
}
