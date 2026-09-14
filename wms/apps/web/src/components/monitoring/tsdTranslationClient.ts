export type TranslationLanguage = 'uz' | 'en' | 'ky';

// FIX: MyMemory accepts at most 500 UTF-8 bytes per segment; never split a warehouse code.
export function translationParagraphs(text: string): string[][] {
  if (!text.trim()) throw new Error('Введите текст сообщения.');
  if (text.length > 2000) throw new Error('Сообщение длиннее 2000 символов.');
  const encoder = new TextEncoder();
  const paragraphs = text.trim().split(/\r?\n/).map(paragraph => {
    const chunks: string[] = [];
    let chunk = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (encoder.encode(word).length > 500) throw new Error('Слишком длинное слово или код для переводчика. Сократите сообщение.');
      const next = chunk ? `${chunk} ${word}` : word;
      if (encoder.encode(next).length > 500) { chunks.push(chunk); chunk = word; }
      else chunk = next;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  // FIX: prevent a short message with hundreds of separate lines from exhausting the public API.
  if (paragraphs.flat().length > 20) throw new Error('Слишком много отдельных строк для перевода. Объедините их в несколько абзацев.');
  return paragraphs;
}

// FIX: a fixed public endpoint receives only text/language, never WMS auth, cookies or referrer.
export async function translateTsdMessage(text: string, language: TranslationLanguage, signal?: AbortSignal): Promise<string> {
  if (!['uz', 'en', 'ky'].includes(language)) throw new Error('Выберите поддерживаемый язык.');
  const paragraphs = translationParagraphs(text);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw new Error('Перевод отменён.');
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  try {
    const result: string[] = [];
    for (const paragraph of paragraphs) {
      const parts: string[] = [];
      for (const part of paragraph) {
        if (controller.signal.aborted) throw new Error('Перевод отменён.');
        const url = new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q', part);
        url.searchParams.set('langpair', `ru|${language}`);
        let response: Response;
        try {
          response = await fetch(url.toString(), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
        } catch {
          throw new Error('Не удалось связаться с переводчиком. Проверьте интернет и повторите попытку.');
        }
        if (response.status === 429) throw new Error('Дневной лимит публичного переводчика исчерпан. Повторите позже.');
        if (!response.ok) throw new Error(`Переводчик временно недоступен (HTTP ${response.status}). Повторите позже.`);
        let data;
        try { data = await response.json(); }
        catch { throw new Error('Переводчик вернул некорректный ответ. Повторите позже.'); }
        if (data?.quotaFinished || Number(data?.responseStatus) === 429) throw new Error('Дневной лимит публичного переводчика исчерпан. Повторите позже.');
        if (Number(data?.responseStatus) !== 200) throw new Error('Переводчик отклонил запрос. Попробуйте позже или сократите сообщение.');
        const translated = data?.responseData?.translatedText;
        if (typeof translated !== 'string' || !translated.trim()) throw new Error('Переводчик вернул пустой результат. Повторите позже.');
        parts.push(translated.trim());
      }
      result.push(parts.join(' '));
    }
    if (controller.signal.aborted) throw new Error('Перевод отменён.');
    return result.join('\n');
  } catch (error) {
    if (timedOut) throw new Error('Переводчик не ответил за 30 секунд. Повторите позже.');
    if (controller.signal.aborted) throw new Error('Перевод отменён.');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}
