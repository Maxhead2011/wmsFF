export type ShopAccount = { id: string; marketplace: string; apiKey: string; sellerId: string | null };
export type ShopDestination = { connectionId: string; marketplace: 'WILDBERRIES' | 'OZON'; warehouseId: string; productId: string; offerId: string };
type Json = Record<string, any>;
export type ShopHttp = (url: string, init: RequestInit) => Promise<Response>;

// FIX: one bounded request, never a hidden retry of an unknown stock write.
export class MultishopStockTransport {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly nextAt = new Map<string, number>();
  constructor(private readonly http: ShopHttp = fetch) {}
  private async json(account: ShopAccount, path: string, body?: unknown, method = 'POST'): Promise<Json> {
    const previous = this.pending.get(account.id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.pending.set(account.id, current);
    await previous;
    try {
      const delay = (this.nextAt.get(account.id) ?? 0) - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.nextAt.set(account.id, Date.now() + (account.marketplace === 'OZON' ? 800 : 300));
      return await this.request(account, path, body, method);
    } finally { release(); if (this.pending.get(account.id) === current) this.pending.delete(account.id); }
  }
  private async request(account: ShopAccount, path: string, body: unknown, method: string): Promise<Json> {
    const ozon = account.marketplace === 'OZON';
    if (ozon && !account.sellerId) throw new Error('Не задан Client-Id кабинета Ozon.');
    const response = await this.http((ozon ? 'https://api-seller.ozon.ru' : 'https://marketplace-api.wildberries.ru') + path, {
      method, headers: ozon ? { 'Client-Id': account.sellerId!, 'Api-Key': account.apiKey, 'Content-Type': 'application/json' } : { Authorization: account.apiKey, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Маркетплейс вернул HTTP ${response.status}; результат требует проверки.`);
    if (response.status === 204) return {};
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Маркетплейс вернул неверный ответ.');
    return data;
  }

  // Verified against the live read-only v4/v2 contracts on 2026-10-26.
  private async pages(account: ShopAccount, path: string, body: Json, field: string): Promise<Json[]> {
    const result: Json[] = [], seen = new Set<string>(); let cursor = '';
    for (let page = 0; page < 1000; page++) {
      const response = await this.json(account, path, { ...body, cursor });
      if (!Array.isArray(response[field]) || typeof response.has_next !== 'boolean') throw new Error('Неполный ответ маркетплейса: неизвестно, все ли строки получены.');
      result.push(...response[field]);
      if (!response.has_next) return result;
      if (typeof response.cursor !== 'string' || !response.cursor || seen.has(response.cursor)) throw new Error('Маркетплейс не вернул следующий курсор.');
      seen.add(response.cursor); cursor = response.cursor;
    }
    throw new Error('Не удалось получить полный список маркетплейса.');
  }
  async ozonPending(account: ShopAccount) {
    if (account.marketplace !== 'OZON') throw new Error('Неверный маркетплейс.');
    // No trailing thirty-day cutoff: old outstanding and future-shipment orders also reserve stock.
    return this.pages(account, '/v4/posting/fbs/unfulfilled/list', { filter: { cutoff_from: '2000-01-01T00:00:00Z', cutoff_to: '2100-01-01T00:00:00Z' },
      limit: 100, sort_dir: 'ASC', with: { analytics_data: true } }, 'postings');
  }
  async observe(account: ShopAccount, target: ShopDestination): Promise<number | null> {
    this.validate(account, target);
    if (target.marketplace === 'OZON') {
      const rows = await this.pages(account, '/v2/product/info/stocks-by-warehouse/fbs', { offer_id: [target.offerId], limit: 1000 }, 'products');
      const matches = rows.filter(r => String(r.warehouse_id) === target.warehouseId && r.offer_id === target.offerId);
      if (matches.length !== 1) return null;
      const row = matches[0];
      if (String(row.product_id) !== target.productId) throw new Error('Карточка Ozon изменилась относительно подтверждённого соответствия.');
      for (const n of [row.free_stock, row.present, row.reserved]) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Некорректный остаток Ozon.');
      if (row.free_stock !== Math.max(0, row.present - row.reserved)) throw new Error('Остаток Ozon требует сверки: свободный и зарезервированный остатки расходятся.');
      return row.free_stock;
    }
    const chrtId = Number(target.productId.split(':').at(-1));
    const response = await this.json(account, `/api/v3/stocks/${target.warehouseId}`, { chrtIds: [chrtId] });
    if (!Array.isArray(response.stocks)) throw new Error('Неполный ответ WB об остатках.');
    const rows = response.stocks.filter((r: Json) => r.chrtId === chrtId);
    if (rows.length !== 1) return null;
    if (!Number.isSafeInteger(rows[0].amount) || rows[0].amount < 0) throw new Error('Некорректный остаток WB.');
    return rows[0].amount;
  }
  async write(account: ShopAccount, target: ShopDestination, amount: number) {
    this.validate(account, target);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Некорректный публикуемый остаток.');
    if (target.marketplace === 'OZON') {
      const response = await this.json(account, '/v2/products/stocks', { stocks: [{ offer_id: target.offerId, stock: amount, warehouse_id: Number(target.warehouseId) }] });
      if (!Array.isArray(response.result) || response.result.length !== 1 || response.result[0].updated !== true || response.result[0].errors?.length) throw new Error('Ozon не подтвердил обновление остатка; перед повтором нужна сверка.');
    } else {
      await this.json(account, `/api/v3/stocks/${target.warehouseId}`, { stocks: [{ chrtId: Number(target.productId.split(':').at(-1)), amount }] }, 'PUT');
    }
    // The queue still requires an independent subsequent observation; ACK is not DONE.
  }
  private validate(account: ShopAccount, target: ShopDestination) {
    if (account.id !== target.connectionId || account.marketplace !== target.marketplace) throw new Error('Кабинет назначения изменился.');
    if (!/^\d+$/.test(target.warehouseId) || !Number.isSafeInteger(Number(target.warehouseId)) || Number(target.warehouseId) <= 0) throw new Error('Некорректный ID склада маркетплейса.');
    if (target.marketplace === 'OZON' ? !target.offerId : !/^\d+:\d+$/.test(target.productId) || !Number.isSafeInteger(Number(target.productId.split(':').at(-1)))) throw new Error('Не подтверждено соответствие карточки маркетплейса.');
  }
}
