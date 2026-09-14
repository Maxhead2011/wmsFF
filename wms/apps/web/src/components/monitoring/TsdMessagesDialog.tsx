import { useEffect, useRef, useState } from 'react';
import { fetchTsdMessages, sendTsdMessage, type TsdMonitorMessage } from '../../lib/api';
import { TsdMessageTranslation } from './TsdMessageTranslation';

// ADDED: bounded, polling history; only server readAt counts as read.
export function TsdMessageHistory({ messages }: { messages: TsdMonitorMessage[] }) {
  return <div className="tsd-messages__history">{messages.length ? messages.map(message => <article key={message.id}>
    <p>{message.text}</p>
    <small>{message.senderName} · {new Date(message.createdAt).toLocaleString('ru-RU')}</small>
    <strong>{message.readAt ? `Прочитано · ${new Date(message.readAt).toLocaleString('ru-RU')}` : 'Ожидает прочтения'}</strong>
  </article>) : <p>Сообщений пока нет.</p>}</div>;
}

export function TsdMessagesDialog({ token, deviceCode, name, onClose }: { token: string; deviceCode: string; name: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<TsdMonitorMessage[]>([]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false); // FIX: never send an unfinished translation.
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const attempt = useRef<{ text: string; id: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    const load = async () => {
      try {
        const result = await fetchTsdMessages(token, deviceCode);
        if (active) { setMessages(result.messages); setSupported(result.supported); }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить сообщения.'); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token, deviceCode]);
  const send = async () => {
    if (sending.current || translationBusy || !text.trim() || !supported) return;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    // FIX: uncertain HTTP retries reuse the same UUID; never duplicate a message.
    if (!attempt.current || attempt.current.text !== text.trim()) attempt.current = { text: text.trim(), id: crypto.randomUUID() };
    try {
      const result = await sendTsdMessage(token, deviceCode, attempt.current.text, attempt.current.id);
      setMessages(previous => [result, ...previous.filter(item => item.id !== result.id)].slice(0, 50));
      setText(''); attempt.current = null;
      setNotice('Сообщение сохранено. ТСД покажет его при подключении; ждём нажатия «ОК — прочитано».');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось отправить. Повторите попытку.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="tsd-messages" aria-labelledby="tsd-message-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="tsd-message-title">Сообщение сотруднику</h2>
    <p>{name} · {deviceCode}</p>
    <p>Окно откроется поверх задания на ТСД, без сброса сборки. История: последние 50 сообщений.</p>
    {supported === false ? <p role="alert">Обновите приложение на этом ТСД — текущая версия не поддерживает сообщения.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <label>Текст сообщения<textarea autoFocus maxLength={2000} rows={5} value={text} disabled={busy || translationBusy} onChange={event => setText(event.target.value)} /></label>
    {/* FIX: translation edits only the draft; the existing send/ack flow is unchanged. */}
    <TsdMessageTranslation key={deviceCode} text={text} disabled={busy} onApply={setText} onBusyChange={setTranslationBusy} />
    <div className="tsd-messages__buttons">
      <button type="button" disabled={busy || translationBusy || !supported || !text.trim()} onClick={() => void send()}>{busy ? 'Отправляю…' : 'Отправить на ТСД'}</button>
      <button type="button" disabled={busy} onClick={onClose}>Закрыть</button>
    </div>
    <h3>История сообщений</h3><TsdMessageHistory messages={messages} />
  </dialog>;
}
