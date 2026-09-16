// FIX: disposable read-only UI cache; never authorizes warehouse/financial mutations.
export type FbsDisplaySync = {
  refreshing: boolean;
  partial: boolean;
  lastSuccessAt: string | null;
  error: string | null;
};
type Entry<T> = { value?: T; pending: boolean; retryAt: number; startedAt: number; error: string | null };
export class FbsDisplayCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly queue: Array<{ key: string; load: () => Promise<T> }> = [];
  private running = 0;
  private stopped = false;
  get(key: string) { return this.entries.get(key); }

  refresh(key: string, load: () => Promise<T>, force = false) {
    let entry = this.entries.get(key);
    if (this.stopped || entry?.pending || (entry && entry.retryAt > Date.now() && (!force || entry.error))) return;
    if (entry && Date.now() - entry.startedAt < 5_000) return;
    if (this.entries.size >= 128 && !entry) {
      const oldest = [...this.entries].find(([, value]) => !value.pending);
      if (!oldest) return;
      this.entries.delete(oldest[0]);
    }
    entry ??= { pending: false, retryAt: 0, startedAt: 0, error: null };
    entry.pending = true;
    entry.startedAt = Date.now();
    this.entries.set(key, entry);
    this.queue.push({ key, load });
    // Yield HTTP first; two workers bound load. Repeated clicks share one refresh.
    setImmediate(() => this.drain());
  }

  stop() { this.stopped = true; this.queue.length = 0; }

  private drain() {
    while (!this.stopped && this.running < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      const entry = this.entries.get(job.key)!;
      this.running++;
      void Promise.resolve().then(job.load).then(value => {
        entry.value = value;
        entry.error = null;
        entry.retryAt = Date.now() + 60_000;
      }, error => {
        // Never expose external response bodies, tokens or internal SQL to the browser.
        const text = error instanceof Error ? error.message : '';
        entry.error = /401|403|token.*withdrawn/i.test(text)
          ? 'Маркетплейс отклонил доступ. Проверьте API-ключ кабинета.'
          : 'Не удалось обновить данные маркетплейса. Показаны сохранённые данные; повторим попытку.';
        entry.retryAt = Date.now() + 30_000;
      }).finally(() => {
        entry.pending = false;
        this.running--;
        this.drain();
      });
    }
  }
}
