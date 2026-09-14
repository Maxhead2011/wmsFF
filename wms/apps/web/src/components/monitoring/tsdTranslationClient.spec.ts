import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateTsdMessage, translationParagraphs } from './tsdTranslationClient';

// TEST: inline translation uses a documented public API without WMS credentials.
describe('inline TSD translation API', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  for (const language of ['uz', 'en', 'ky'] as const) {
    it(`returns ${language} text directly without a new browser tab`, async () => {
      const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Translated text' } }) });
      vi.stubGlobal('fetch', request);
      expect(await translateTsdMessage('Подойдите к упаковке', language)).toBe('Translated text');
      const [url, options] = request.mock.calls[0];
      expect(new URL(url).origin).toBe('https://api.mymemory.translated.net');
      expect(new URL(url).searchParams.get('langpair')).toBe(`ru|${language}`);
      expect(new URL(url).searchParams.get('q')).toBe('Подойдите к упаковке');
      expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
      expect(options.headers).toBeUndefined();
    });
  }
  it('splits Unicode paragraphs within 500 UTF-8 bytes without splitting codes', () => {
    const source = ('Возьмите короб TEST_BOX_123. '.repeat(30) + '\n\nСпасибо').trim();
    const paragraphs = translationParagraphs(source);
    expect(paragraphs.flat().every(part => new TextEncoder().encode(part).length <= 500)).toBe(true);
    expect(paragraphs.map(parts => parts.join(' ')).join('\n')).toBe(source.split('\n').map(line => line.trim()).join('\n'));
    expect(() => translationParagraphs('я'.repeat(251))).toThrow(/длинное слово/);
    expect(() => translationParagraphs('а'.repeat(2001))).toThrow(/2000/);
    expect(() => translationParagraphs('  ')).toThrow(/Введите/);
    expect(() => translationParagraphs('Строка\n'.repeat(21))).toThrow(/много отдельных строк/);
  });
  it('preserves paragraph breaks and returns no partial result on failure', async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'First' } }) })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal('fetch', request);
    await expect(translateTsdMessage('Первый\n\nВторой', 'en')).rejects.toThrow(/503/);
    request.mockReset().mockResolvedValue({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Text' } }) });
    expect(await translateTsdMessage('Первый\n\nВторой', 'en')).toBe('Text\n\nText');
  });
  it.each([
    [{ responseStatus: 429 }, /лимит/],
    [{ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'quota' } }, /лимит/],
    [{ responseStatus: 403, responseDetails: 'private external detail' }, /отклонил/],
    [{ responseStatus: 200, responseData: { translatedText: '' } }, /пустой/],
    [{ responseStatus: 200, responseData: { translatedText: 4 } }, /пустой/],
  ])('rejects provider failure payload %j', async (payload, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    await expect(translateTsdMessage('Привет', 'en')).rejects.toThrow(message);
  });
  it('handles network failures without exposing URLs or source text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret URL')));
    await expect(translateTsdMessage('Привет', 'en')).rejects.toThrow('Не удалось связаться с переводчиком. Проверьте интернет и повторите попытку.');
  });
  it('handles invalid JSON and HTTP quota failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('invalid'); } }));
    await expect(translateTsdMessage('Привет', 'en')).rejects.toThrow(/некорректный/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(translateTsdMessage('Привет', 'en')).rejects.toThrow(/лимит/);
  });
  it('aborts on timeout and on caller cancellation', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const pending = expect(translateTsdMessage('Привет', 'en')).rejects.toThrow(/не ответил/);
    await vi.advanceTimersByTimeAsync(30000); await pending;
    const controller = new AbortController();
    const cancelled = expect(translateTsdMessage('Привет', 'en', controller.signal)).rejects.toThrow(/отменён/);
    controller.abort(); await cancelled;
  });
  it('does not start a cancelled request or accept unsupported languages', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    const controller = new AbortController(); controller.abort();
    await expect(translateTsdMessage('Привет', 'en', controller.signal)).rejects.toThrow(/отменён/);
    await expect(translateTsdMessage('Привет', 'fr' as 'en')).rejects.toThrow(/язык/);
    expect(request).not.toHaveBeenCalled();
  });
});
