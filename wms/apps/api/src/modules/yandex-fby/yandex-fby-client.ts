import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { supplyReference } from './yandex-fby-policy';

export type Supply = { id: { id: number; marketplaceRequestId?: string; warehouseRequestId?: string }; type: string; subtype: string; status: string; targetLocation?: { name?: string; requestedDate?: string }; transitLocation?: { name?: string; requestedDate?: string } | null };
export type SupplyItem = { offerId: string; name?: string; counters: { planCount: number } };
export type FbyCredentials = { sellerId: string | null; apiKey: string };

// FIX: only read operations against a fixed API origin. Caller-controlled links never become fetch URLs.
export class YandexFbyClient {
  constructor(private readonly send: typeof fetch = fetch) {}
  private async pages<T>(c: FbyCredentials, suffix: string, body: object, field: string, maxPages: number): Promise<T[]> {
    if (!c.sellerId || !/^[1-9]\d*$/.test(c.sellerId)) throw new BadRequestException('В подключении Яндекса укажите ID кампании.');
    const rows: T[] = [], seen = new Set<string>();
    let token = '';
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`https://api.partner.market.yandex.ru/v2/campaigns/${c.sellerId}/supply-requests${suffix}`);
      url.searchParams.set('limit', suffix ? '500' : '100');
      if (token) url.searchParams.set('pageToken', token);
      let response: Response;
      try { response = await this.send(url, { method: 'POST', headers: { 'Api-Key': c.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
      catch { throw new BadGatewayException('Яндекс не ответил вовремя. Повторите загрузку.'); }
      if (!response.ok) throw new BadGatewayException(response.status === 429 || response.status === 420 ? 'Яндекс ограничил частоту запросов. Повторите загрузку позже.' : `Яндекс: HTTP ${response.status}. Проверьте доступ к поставкам FBY.`);
      let data: any;
      try { data = await response.json(); } catch { throw new BadGatewayException('Некорректный ответ Яндекса.'); }
      if (data.status !== 'OK' || !Array.isArray(data.result?.[field])) throw new BadGatewayException('Яндекс вернул неполные данные.');
      rows.push(...data.result[field]);
      const next = data.result.paging?.nextPageToken;
      if (!next) return rows;
      if (typeof next !== 'string' || seen.has(next)) throw new BadGatewayException('Яндекс повторил страницу. Неполный состав не сохранён.');
      seen.add(next); token = next;
    }
    throw new BadGatewayException('Превышен размер загрузки. Неполный результат не сохранён.');
  }
  async supply(c: FbyCredentials, input: string): Promise<Supply> {
    const ref = supplyReference(input);
    const rows = await this.pages<Supply>(c, '', { requestTypes: ['SUPPLY'], sorting: { attribute: 'ID', direction: 'DESC' } }, 'requests', 50);
    const found = rows.filter(r => r.id?.marketplaceRequestId === ref || r.id?.warehouseRequestId === ref);
    if (found.length > 1) throw new BadRequestException('Номер неоднозначен. Укажите номер отдельной поставки из кабинета.');
    if (!found.length) throw new NotFoundException('Поставка с таким номером не найдена в выбранном кабинете Яндекса.');
    if (!Number.isSafeInteger(found[0].id.id) || found[0].id.id < 1) throw new BadGatewayException('Яндекс вернул некорректный ID поставки.');
    return found[0];
  }
  async items(c: FbyCredentials, requestId: number): Promise<SupplyItem[]> {
    const rows = await this.pages<SupplyItem>(c, '/items', { requestId }, 'items', 10);
    if (!rows.length || rows.some(r => !r.offerId || !Number.isSafeInteger(r.counters?.planCount) || r.counters.planCount < 0)) throw new BadGatewayException('Яндекс вернул некорректный состав поставки.');
    const seen = new Set<string>();
    for (const r of rows) { if (seen.has(r.offerId)) throw new BadGatewayException('В ответе Яндекса повторяется товар.'); seen.add(r.offerId); }
    return rows.filter(r => r.counters.planCount > 0);
  }
}
