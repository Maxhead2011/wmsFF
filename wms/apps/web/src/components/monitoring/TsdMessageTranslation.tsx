import { useEffect, useId, useState } from 'react';

type Language = 'uz' | 'en' | 'ky';
type Provider = 'google' | 'yandex';

// FIX: use public human-facing pages, not undocumented endpoints or automated scraping.
export function publicTranslationUrl(text: string, language: Language, provider: Provider): string {
  const url = new URL(provider === 'google' ? 'https://translate.google.com/' : 'https://translate.yandex.com/');
  if (provider === 'google') {
    url.searchParams.set('sl', 'ru'); url.searchParams.set('tl', language); url.searchParams.set('op', 'translate');
  } else {
    url.searchParams.set('source_lang', 'ru'); url.searchParams.set('target_lang', language);
  }
  url.searchParams.set('text', text);
  return url.toString();
}

// FIX: catch changed warehouse codes and numbers; this is not a semantic quality guarantee.
export function translationIssue(source: string, translated: string): string {
  if (!translated.trim()) return 'Вставьте перевод из открытой вкладки.';
  if (translated.trim().length > 2000) return 'Перевод длиннее 2000 символов. Сократите его перед применением.';
  const tokens = (text: string) => (text.match(/[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+|\d+(?:[.,:]\d+)*/g) || [])
    .filter(token => /[\d_]/.test(token)).sort();
  if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(translated))) {
    return 'В переводе изменились коды или числа. Верните коды коробов, количество и время точно как в исходном тексте.';
  }
  return '';
}

export function TsdMessageTranslation({ text, disabled, onApply }: { text: string; disabled: boolean; onApply: (text: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<Language>('uz');
  const [provider, setProvider] = useState<Provider>('google');
  const [source, setSource] = useState<string | null>(null);
  const [translated, setTranslated] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  useEffect(() => {
    // FIX: a successfully sent/cleared draft must not retain an old translation to restore.
    if (!text) { setSource(null); setTranslated(''); setOriginal(null); setOpen(false); }
  }, [text]);
  const stale = source !== null && source !== text;
  const issue = translationIssue(source ?? text, translated);
  const reset = () => { setSource(null); setTranslated(''); };
  return <section className="tsd-translation" aria-label="Перевод сообщения">
    <button type="button" disabled={disabled || !text.trim()} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>Перевести на</button>
    {original !== null ? <button type="button" disabled={disabled} onClick={() => {
      onApply(original); setOriginal(null); reset(); setOpen(false);
    }}>Вернуть исходный текст</button> : null}
    {open ? <fieldset id={id} disabled={disabled}>
      <legend>Публичный переводчик — без API-ключа</legend>
      <p>Откройте переводчик, затем скопируйте результат из новой вкладки и вставьте ниже.</p>
      <p>Текст получит внешний сервис; он может сохраниться у него и в истории браузера. Не передавайте пароли и конфиденциальные данные.</p>
      <div className="tsd-translation__options">
        <div><label htmlFor={`${id}-language`}>Язык перевода</label><select id={`${id}-language`} value={language} onChange={event => { setLanguage(event.target.value as Language); reset(); }}>
          <option value="uz">Узбекский</option><option value="en">Английский</option><option value="ky">Киргизский</option>
        </select></div>
        <div><label htmlFor={`${id}-provider`}>Переводчик</label><select id={`${id}-provider`} value={provider} onChange={event => { setProvider(event.target.value as Provider); reset(); }}>
          <option value="google">Google Переводчик</option><option value="yandex">Яндекс Переводчик</option>
        </select></div>
      </div>
      {!disabled && text.trim() ? <a href={publicTranslationUrl(text, language, provider)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
        onClick={() => { setSource(text); setTranslated(''); }}>Открыть переводчик ↗</a> : null}
      <p>Результат нужно скопировать вручную. Если сервис недоступен, выберите другой.</p>
      <label>Перевод для проверки<textarea rows={4} value={translated} disabled={source === null || stale}
        onChange={event => setTranslated(event.target.value)} /></label>
      {stale ? <p role="alert">Исходное сообщение изменилось. Откройте переводчик заново для актуального текста.</p> : null}
      {translated.trim() && issue ? <p role="alert">{issue}</p> : null}
      <p>Проверьте смысл, коды и количество. Применение заменит черновик, но не отправит сообщение.</p>
      <button type="button" disabled={source === null || stale || !!issue} onClick={() => {
        if (disabled || source === null || stale || issue) return;
        setOriginal(source); onApply(translated.trim()); reset(); setOpen(false);
      }}>Применить перевод</button>
    </fieldset> : null}
  </section>;
}
