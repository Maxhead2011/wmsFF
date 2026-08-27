import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export type WildberriesRequestPriority = 'interactive' | 'background';

type QueueEntry = {
  priority: WildberriesRequestPriority;
  signal?: AbortSignal | null;
  resolve: () => void;
  reject: (reason: unknown) => void;
  removeAbortListener?: () => void;
};

type SellerQueue = {
  nextRequestAt: number;
  running: boolean;
  interactive: QueueEntry[];
  background: QueueEntry[];
};

const priorityContext = new AsyncLocalStorage<WildberriesRequestPriority>();

export function runWithWildberriesRequestPriority<T>(
  priority: WildberriesRequestPriority,
  action: () => Promise<T>,
) {
  return priorityContext.run(priority, action);
}

export function currentWildberriesRequestPriority(): WildberriesRequestPriority {
  return priorityContext.getStore() ?? 'interactive';
}

export class WildberriesRequestScheduler {
  private readonly queues = new Map<string, SellerQueue>();

  constructor(private readonly intervalMs = 240) {}

  async waitForSlot(url: string, init: RequestInit) {
    const key = wildberriesRateLimitKey(url, init);
    if (!key) return;
    const signal = init.signal;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    }

    const queue = this.queueFor(key);
    await new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        priority: currentWildberriesRequestPriority(),
        signal,
        resolve,
        reject,
      };
      if (signal) {
        const onAbort = () => {
          this.removeEntry(queue, entry);
          reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      }
      queue[entry.priority].push(entry);
      this.pump(key, queue);
    });
  }

  defer(url: string, init: RequestInit, delayMs: number) {
    const key = wildberriesRateLimitKey(url, init);
    if (!key || !Number.isFinite(delayMs) || delayMs <= 0) return;
    const queue = this.queueFor(key);
    queue.nextRequestAt = Math.max(queue.nextRequestAt, Date.now() + Math.ceil(delayMs));
    this.pump(key, queue);
  }

  clear() {
    for (const queue of this.queues.values()) {
      for (const entry of [...queue.interactive, ...queue.background]) {
        entry.removeAbortListener?.();
        entry.reject(new Error('Wildberries request scheduler was cleared.'));
      }
    }
    this.queues.clear();
  }

  private queueFor(key: string) {
    const existing = this.queues.get(key);
    if (existing) return existing;
    const created: SellerQueue = {
      nextRequestAt: 0,
      running: false,
      interactive: [],
      background: [],
    };
    this.queues.set(key, created);
    return created;
  }

  private pump(key: string, queue: SellerQueue) {
    if (queue.running) return;
    queue.running = true;
    void this.runQueue(key, queue);
  }

  private async runQueue(key: string, queue: SellerQueue) {
    try {
      while (queue.interactive.length > 0 || queue.background.length > 0) {
        while (queue.nextRequestAt > Date.now()) {
          await delay(queue.nextRequestAt - Date.now());
        }
        // Select only when the slot is actually available. An interactive scan
        // that arrived while we waited must overtake queued background work.
        const entry = queue.interactive.shift() ?? queue.background.shift();
        if (!entry) break;
        if (entry.signal?.aborted) {
          entry.removeAbortListener?.();
          entry.reject(
            entry.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'),
          );
          continue;
        }

        queue.nextRequestAt = Date.now() + this.intervalMs;
        entry.removeAbortListener?.();
        entry.resolve();
      }
    } finally {
      queue.running = false;
      if (queue.interactive.length > 0 || queue.background.length > 0) {
        this.pump(key, queue);
      } else if (queue.nextRequestAt <= Date.now()) {
        this.queues.delete(key);
      }
    }
  }

  private removeEntry(queue: SellerQueue, entry: QueueEntry) {
    const entries = queue[entry.priority];
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    entry.removeAbortListener?.();
  }
}

export function wildberriesRateLimitKey(url: string, init: RequestInit) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (!parsedUrl.hostname.endsWith('wildberries.ru')) return null;

  const token = authorizationToken(init);
  if (!token) return null;
  const sellerId = wildberriesSellerIdFromToken(token);
  const sellerKey = sellerId
    ? `seller:${sellerId}`
    : `token:${createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
  return `${sellerKey}:${wildberriesRateLimitGroup(parsedUrl.hostname)}`;
}

export function wildberriesReadRequestKey(url: string, init: RequestInit) {
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') return null;
  const rateLimitKey = wildberriesRateLimitKey(url, init);
  const token = authorizationToken(init);
  if (!rateLimitKey || !token) return null;
  const tokenKey = createHash('sha256').update(token).digest('hex').slice(0, 24);
  return `${rateLimitKey}:${tokenKey}:${url}`;
}

export function wildberriesSellerIdFromToken(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const sellerId = typeof decoded.sid === 'string' ? decoded.sid.trim() : '';
    return sellerId || null;
  } catch {
    return null;
  }
}

function authorizationToken(init: RequestInit) {
  const value = new Headers(init.headers).get('authorization')?.trim() ?? '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

function wildberriesRateLimitGroup(hostname: string) {
  if (hostname === 'marketplace-api.wildberries.ru') return 'marketplace';
  return hostname;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

