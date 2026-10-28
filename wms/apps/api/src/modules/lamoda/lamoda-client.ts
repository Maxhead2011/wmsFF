import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { LamodaCommand, lamodaPathId, prepareLamodaCommand } from './lamoda-commands';

export type LamodaCredentials = { oauthClientId: string; secret: string; sellerId: string };
export class LamodaApiError extends Error {
  constructor(public readonly code: string, public readonly status?: number, public readonly outcome?: 'REJECTED' | 'UNKNOWN') {
    // FIX: never propagate remote bodies (which can contain credentials/customer data).
    super(`Lamoda: ${code}${status ? ` (${status})` : ''}`);
  }
}

function encryptionKey() {
  const value = process.env.WMS_LAMODA_SECRET_KEY ?? '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new LamodaApiError('SECRET_KEY_NOT_CONFIGURED');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new LamodaApiError('SECRET_KEY_NOT_CONFIGURED');
  return key;
}

export function sealSecret(secret: string, identity: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(identity));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function openSecret(encrypted: string, identity: string): string {
  const key = encryptionKey();
  try {
    const [version, iv, tag, body, extra] = encrypted.split('.');
    if (version !== 'v1' || extra || !iv || !tag || !body) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(identity));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new LamodaApiError('SECRET_DECRYPTION_FAILED'); }
}

export type LamodaResource = 'CATALOG' | 'ORDERS' | 'FBO_SHIPMENTS' | 'FBS_SHIPMENTS' | 'RETURNS';
const resources: Record<LamodaResource, { path: string; key: string }> = {
  CATALOG: { path: '/nomenclatures', key: 'nomenclatures' },
  ORDERS: { path: '/orders', key: 'orders' },
  FBO_SHIPMENTS: { path: '/fbo/shipments', key: 'shipments' },
  FBS_SHIPMENTS: { path: '/fbs/shipments', key: 'items' },
  RETURNS: { path: '/fbs/return-items', key: 'data' },
};
export const lamodaResources = Object.keys(resources) as LamodaResource[];
const base = 'https://public-api-seller.lamoda.ru/api/v2';
type Token = { value: string; until: number };

// FIX: operational writes are allow-listed, gated and never automatically retried.
export class LamodaClient {
  private tokens = new Map<string, Token>();
  private pending = new Map<string, Promise<Token>>();
  constructor(private readonly http: typeof fetch = fetch, private readonly now = Date.now) {}

  private key(c: LamodaCredentials) {
    return createHash('sha256').update(JSON.stringify([c.oauthClientId, c.secret, c.sellerId])).digest('hex');
  }
  private async json(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try { response = await this.http(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
    catch { throw new LamodaApiError('TRANSPORT_ERROR'); }
    if (!response.ok) throw new LamodaApiError('HTTP_ERROR', response.status);
    const raw = await response.text().catch(() => { throw new LamodaApiError('TRANSPORT_ERROR'); });
    if (raw.length > 10_000_000) throw new LamodaApiError('RESPONSE_TOO_LARGE');
    try { return JSON.parse(raw); } catch { throw new LamodaApiError('INVALID_JSON'); }
  }
  private async token(c: LamodaCredentials): Promise<Token> {
    const key = this.key(c), cached = this.tokens.get(key);
    if (cached && cached.until > this.now()) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = (async () => {
      const raw = record(await this.json(`${base}/auth-token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: c.oauthClientId, client_secret: c.secret }),
      }));
      if (typeof raw.access_token !== 'string' || !raw.access_token || raw.token_type?.toString().toLowerCase() !== 'bearer' ||
          !Number.isSafeInteger(raw.expires_in) || Number(raw.expires_in) <= 0) throw new LamodaApiError('INVALID_TOKEN_RESPONSE');
      const lifetime = Number(raw.expires_in) * 1000;
      const token = { value: raw.access_token, until: this.now() + lifetime - Math.min(30_000, lifetime / 10) };
      // Bound process-local memory. Tokens are never stored in DB/logs or returned to the UI.
      if (this.tokens.size >= 100) this.tokens.delete(this.tokens.keys().next().value!);
      this.tokens.set(key, token);
      return token;
    })();
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
  private async get(c: LamodaCredentials, path: string, params: Record<string, string>) {
    const url = new URL(`${base}${path}`);
    Object.entries({ ...params, sellerId: c.sellerId }).forEach(([key, value]) => url.searchParams.set(key, value));
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(c);
      try { return record(await this.json(url.toString(), { headers: { Authorization: `Bearer ${token.value}` } })); }
      catch (error) {
        if (attempt === 0 && error instanceof LamodaApiError && error.status === 401) {
          if (this.tokens.get(this.key(c)) === token) this.tokens.delete(this.key(c));
          continue;
        }
        throw error;
      }
    }
  }
  async execute(c: LamodaCredentials, command: LamodaCommand): Promise<unknown> {
    if (process.env.WMS_LAMODA_EXTERNAL_WRITES_ENABLED !== 'true') throw new LamodaApiError('WRITES_DISABLED', undefined, 'REJECTED');
    let request: ReturnType<typeof prepareLamodaCommand>;
    try { request = prepareLamodaCommand(command, c.sellerId); }
    catch { throw new LamodaApiError('INVALID_COMMAND', undefined, 'REJECTED'); }
    // Authentication happens before the business request: failure cannot have changed a shipment.
    let token: Token;
    try { token = await this.token(c); }
    catch { throw new LamodaApiError('AUTH_FAILED', undefined, 'REJECTED'); }
    let response: Response;
    try {
      response = await this.http(`${base}${request.path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' },
        body: request.body, redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new LamodaApiError('TRANSPORT_ERROR', undefined, 'UNKNOWN'); }
    if (!response.ok) {
      const rejected = [400, 401, 403, 404, 405, 422, 429].includes(response.status);
      throw new LamodaApiError('HTTP_ERROR', response.status, rejected ? 'REJECTED' : 'UNKNOWN');
    }
    // A malformed success response must not be treated as permission to repeat a write.
    if (response.status === 204) return null;
    try {
      const bytes = await this.boundedBody(response);
      return JSON.parse(bytes.toString('utf8'));
    } catch { throw new LamodaApiError('INVALID_WRITE_RESPONSE', response.status, 'UNKNOWN'); }
  }
  private async boundedBody(response: Response): Promise<Buffer> {
    const reader = response.body?.getReader();
    if (!reader) throw new LamodaApiError('EMPTY_RESPONSE');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 10_000_000) { await reader.cancel(); throw new LamodaApiError('RESPONSE_TOO_LARGE'); }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } finally { reader.releaseLock(); }
  }
  async packLabel(c: LamodaCredentials, orderId: string, packNumber: string, labelFormat = 'M'): Promise<Buffer> {
    if (!['S', 'M', 'L'].includes(labelFormat)) throw new LamodaApiError('INVALID_LABEL_FORMAT');
    const url = new URL(`${base}/orders/${lamodaPathId(orderId)}/packs/${lamodaPathId(packNumber)}/label`);
    url.searchParams.set('sellerId', c.sellerId); url.searchParams.set('labelFormat', labelFormat);
    const token = await this.token(c);
    let response: Response;
    try { response = await this.http(url.toString(), { headers: { Authorization: `Bearer ${token.value}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
    catch { throw new LamodaApiError('TRANSPORT_ERROR'); }
    if (!response.ok) throw new LamodaApiError('HTTP_ERROR', response.status);
    const bytes = await this.boundedBody(response);
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf' || bytes.subarray(0,5).toString('ascii') !== '%PDF-') throw new LamodaApiError('INVALID_PDF');
    return bytes;
  }
  async check(c: LamodaCredentials) {
    // Verify seller access too, rather than treating OAuth success as a working connection.
    const data = await this.get(c, '/nomenclatures', { page: '1', limit: '1' });
    if (!Array.isArray(data.nomenclatures) || record(data.meta).page !== 1) throw new LamodaApiError('INVALID_PAGE');
    return data;
  }
  // FIX: fetch every planned line through the fixed API host and verify seller ownership.
  async fboShipment(c: LamodaCredentials, id: string) {
    const path=`/fbo/shipments/${lamodaPathId(id)}`;
    const shipment=await this.get(c,path,{});
    if(shipment.id!==id||String(shipment.sellerId)!==c.sellerId) throw new LamodaApiError('SHIPMENT_SCOPE_MISMATCH');
    const items:Record<string,unknown>[]=[];
    for(let page=1;page<=40;page++) {
      const response=await this.get(c,`${path}/items`,{page:String(page),limit:'25'}),meta=record(response.meta);
      if(!Array.isArray(response.items)||meta.page!==page||!Number.isSafeInteger(meta.totalPages)||Number(meta.totalPages)<1||response.items.length>25) throw new LamodaApiError('INVALID_PAGE');
      items.push(...response.items.map(record));
      if(page===meta.totalPages) return {shipment,items};
    }
    throw new LamodaApiError('SYNC_PAGE_LIMIT');
  }
  async collection(c: LamodaCredentials, kind: LamodaResource, params: Record<string, string> = {}) {
    const resource = resources[kind];
    if (!resource) throw new LamodaApiError('UNKNOWN_RESOURCE');
    const result: Record<string, unknown>[] = [], started = this.now();
    for (let page = 1; page <= 100; page++) {
      if (this.now() - started > 120_000) throw new LamodaApiError('SYNC_TIME_LIMIT');
      const data = await this.get(c, resource.path, { ...params, page: String(page), limit: '100' });
      const items = data[resource.key], meta = record(data.meta);
      if (!Array.isArray(items) || items.length > 100 || meta.page !== page || !Number.isSafeInteger(meta.totalPages) ||
          Number(meta.totalPages) < 0 || (Number(meta.totalPages) === 0 && items.length !== 0) ||
          (Number(meta.totalPages) > page && !items.length)) throw new LamodaApiError('INVALID_PAGE');
      result.push(...items.map(record));
      if (page >= Number(meta.totalPages)) return result;
    }
    throw new LamodaApiError('SYNC_PAGE_LIMIT');
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LamodaApiError('INVALID_OBJECT');
  return value as Record<string, unknown>;
}
