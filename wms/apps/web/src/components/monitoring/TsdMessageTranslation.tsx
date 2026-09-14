import { useEffect, useId, useRef, useState } from 'react';
import { translateTsdMessage, type TranslationLanguage } from './tsdTranslationClient';

// FIX: catch changed warehouse codes and numbers; this is not a semantic quality guarantee.
export function translationIssue(source: string, translated: string): string {
  if (!translated.trim()) return 'Сначала получите перевод.';
  if (translated.trim().length > 2000) return 'Перевод длиннее 2000 символов. Сократите его перед применением.';
  const tokens = (text: string) => (text.match(/[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+|\d+(?:[.,:]\d+)*/g) || [])
    .filter(token => /[\d_]/.test(token)).sort();
  if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(translated))) {
    return 'В переводе изменились коды или числа. Верните коды коробов, количество и время точно как в исходном тексте.';
  }
  return '';
}

export function TsdMessageTranslation({ text, disabled, onApply, onBusyChange }: { text: string; disabled: boolean; onApply: (text: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<TranslationLanguage>('uz');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [translated, setTranslated] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; onBusyChange?.(false); }, [onBusyChange]);
  useEffect(() => {
    // FIX: a successfully sent/cleared draft must not retain an old translation to restore.
    if (!text) { setSource(null); setTranslated(''); setOriginal(null); setOpen(false); }
  }, [text]);
  const stale = source !== null && source !== text;
  const issue = translationIssue(source ?? text, translated);
  const reset = () => { setSource(null); setTranslated(''); setError(''); };
  const cancel = () => { request.current?.abort(); request.current = null; setPending(false); onBusyChange?.(false); };
  // FIX: only an explicit click sends text; cancelled/obsolete replies cannot overwrite the draft.
  const translate = async () => {
    if (disabled || request.current || !text.trim()) return;
    const controller = new AbortController(); request.current = controller;
    reset(); setPending(true); onBusyChange?.(true);
    try {
      const result = await translateTsdMessage(text, language, controller.signal);
      if (request.current !== controller) return;
      setSource(text); setTranslated(result);
    } catch (caught) {
      if (request.current === controller) setError(caught instanceof Error ? caught.message : 'Не удалось перевести сообщение.');
    } finally {
      if (request.current === controller) { request.current = null; setPending(false); onBusyChange?.(false); }
    }
  };
  return <section className="tsd-translation" aria-label="Перевод сообщения">
    <button type="button" disabled={disabled || !text.trim()} aria-expanded={open} aria-controls={id}
      onClick={() => { if (open) cancel(); setOpen(value => !value); }}>Перевести на</button>
    {original !== null ? <button type="button" disabled={disabled || pending} onClick={() => {
      onApply(original); setOriginal(null); reset(); setOpen(false);
    }}>Вернуть исходный текст</button> : null}
    {open ? <fieldset id={id} disabled={disabled}>
      <legend>Перевод прямо в WMS</legend>
      <p>Выберите язык и нажмите «Перевести». Результат появится ниже — его можно исправить перед отправкой.</p>
      <p>По нажатию текст передаётся публичному сервису MyMemory и может сохраняться у него. Не передавайте пароли и конфиденциальные данные. Бесплатный лимит — около 5 000 символов в день на внешний IP.</p>
      <div className="tsd-translation__options">
        <div><label htmlFor={`${id}-language`}>Язык перевода</label><select id={`${id}-language`} value={language} disabled={pending} onChange={event => { setLanguage(event.target.value as TranslationLanguage); reset(); }}>
          <option value="uz">Узбекский</option><option value="en">Английский</option><option value="ky">Киргизский</option>
        </select></div>
      </div>
      <p><button type="button" disabled={pending || !text.trim()} onClick={() => void translate()}>{pending ? 'Перевожу…' : 'Перевести'}</button></p>
      {pending ? <p role="status">Получаем перевод. Сообщение на ТСД не отправляется.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <label>Перевод для проверки<textarea rows={4} value={translated} disabled={pending || source === null || stale}
        onChange={event => setTranslated(event.target.value)} /></label>
      {stale ? <p role="alert">Исходное сообщение изменилось. Нажмите «Перевести» заново для актуального текста.</p> : null}
      {translated.trim() && issue ? <p role="alert">{issue}</p> : null}
      <p>Машинный перевод может ошибаться. Проверьте смысл, коды и количество. Применение заменит черновик, но не отправит сообщение.</p>
      <button type="button" disabled={pending || source === null || stale || !!issue} onClick={() => {
        if (disabled || pending || source === null || stale || issue) return;
        setOriginal(source); onApply(translated.trim()); reset(); setOpen(false);
      }}>Применить перевод</button>
    </fieldset> : null}
  </section>;
}
