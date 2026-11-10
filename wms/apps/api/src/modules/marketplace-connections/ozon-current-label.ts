import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
type Json = (url: string, init: RequestInit) => Promise<any>;
// FIX: Ozon disabled the synchronous label endpoint on 2026-11-02.
export async function currentOzonLabel(init: RequestInit, json: Json, download: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const body = JSON.parse(String(init.body));
  const postings = [...new Set<string>(body.posting_number ?? [])];
  if (!postings.length || postings.length > 1000 || postings.some(p => typeof p !== 'string' || !p))
    throw new BadRequestException('Не указаны отправления Ozon для этикеток.');
  const deadline = AbortSignal.timeout(25000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  signal.throwIfAborted();
  const call = (path: string, payload: unknown) => json('https://api-seller.ozon.ru'+path,
    { method:'POST', headers:init.headers, body:JSON.stringify(payload), signal });
  const created = await call('/v3/posting/fbs/package-label/create', { posting_numbers:postings });
  const tasks = created.tasks;
  const small = Array.isArray(tasks) ? tasks.filter(t => t.task_type === 'small_label') : [];
  if (small.length !== 1 || !small[0].task_id) throw new BadRequestException('Ozon не вернул задание этикетки 58 × 40.');
  for (let attempt=0; attempt<12; attempt++) {
    signal.throwIfAborted();
    const result = await call('/v2/posting/fbs/package-label/get', { task_id:small[0].task_id });
    if (result.error || ['failed','error'].includes(result.status?.code))
      throw new BadRequestException('Ozon не смог сформировать этикетку. Повторите запрос позже.');
    if (result.status?.code === 'completed') {
      if (result.status.postings_count !== postings.length || result.status.printed_postings_count !== postings.length || result.status.unprinted_postings?.length)
        throw new BadRequestException('Ozon сформировал неполный комплект этикеток.');
      let url: URL; try { url = new URL(result.file_url); } catch { throw new BadRequestException('Ozon не вернул ссылку на этикетку.'); }
      if (url.protocol !== 'https:' || url.hostname !== 'ir.ozone.ru' || url.username || url.password || url.port)
        throw new BadRequestException('Ozon вернул неподдерживаемый адрес этикетки.');
      // No seller credentials on the CDN request; redirects cannot forward them.
      const response = await download(url.toString(), { signal, redirect:'error' });
      if (!response.ok) throw new BadRequestException('Не удалось скачать готовую этикетку Ozon.');
      const buffer = Buffer.from(await response.arrayBuffer());
      try { if (!(await PDFDocument.load(buffer)).getPageCount()) throw Error(); }
      catch { throw new BadRequestException('Ozon вернул некорректный PDF этикетки.'); }
      return { buffer, contentType:'application/pdf' };
    }
    if (!['pending','processing','in_progress','created'].includes(result.status?.code))
      throw new BadRequestException('Ozon вернул неизвестный статус формирования этикетки.');
    if (attempt<11) await pause(1000);
  }
  throw new BadRequestException('Ozon ещё формирует этикетку. Повторите запрос через несколько секунд.');
}
