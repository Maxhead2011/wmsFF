import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

export type LamodaCredentials = { oauthClientId: string; secret: string; sellerId: string };
export class LamodaApiError extends Error {
  constructor(public readonly code: string, public readonly status?: number) {
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

// FIX: this adapter only reads business data. No generic method/body proxy or write switch.
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
  async check(c: LamodaCredentials) {
    // Verify seller access too, rather than treating OAuth success as a working connection.
    const data = await this.get(c, '/nomenclatures', { page: '1', limit: '1' });
    if (!Array.isArray(data.nomenclatures) || record(data.meta).page !== 1) throw new LamodaApiError('INVALID_PAGE');
    return data;
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
