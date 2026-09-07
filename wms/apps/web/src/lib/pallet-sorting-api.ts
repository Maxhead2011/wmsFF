export type SortingState = {
  id: string; version: number; sourceCode: string; stage: 'CHECKING' | 'FORMING' | 'COMPLETED';
  sources: Array<{ id: string; code: string; scanned: boolean; archived: boolean }>;
  targets: Array<{ id: string; code: string; closed: boolean; quantity: number; palletCode: string }>;
  activeTargetId?: string | null;
  pendingRoutes: Array<{ requestId: string; taskIds: string[]; error?: string }>;
  moves: Array<{ identity: string }>;
};
export type SortingPreview = {
  fingerprint: string; quantity: number; affectedOrders: string[];
  boxes: Array<{ id: string; code: string; balances: Array<{ id: string; quantity: number; sku: { article: string; name: string; size: string; color: string } }> }>;
};
export class SortingHttpError extends Error { constructor(public status: number, message: string) { super(message); } }

// ADDED: same authenticated API for the isolated screen; existing large api.ts is untouched.
export async function sortingRequest<T>(token: string, path = '', body?: unknown): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/pallet-sorting${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new SortingHttpError(response.status, Array.isArray(data?.message) ? data.message.join('; ') : data?.message ?? `Ошибка сервера (${response.status}).`);
  if (data === null) throw new Error('Не удалось прочитать ответ. Повторите тот же запрос для проверки результата.');
  return data as T;
}
