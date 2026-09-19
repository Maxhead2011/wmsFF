type Connection = { id: string; marketplace: string; accountName: string | null };
export type FbsConnectionError = { connectionId: string; marketplace: string; accountName: string | null; message: string };
export function fbsConnectionIsolationEnabled(readOnly: boolean, flag = process.env.WMS_FBS_CONNECTION_ISOLATION): boolean {
  return readOnly && flag === 'true';
}
export async function collectFbsConnectionOrders<C extends Connection, T>(connections: C[], load: (connection: C) => Promise<T[]>, allowPartial: boolean): Promise<{ groups: T[][]; errors: FbsConnectionError[] }> {
  const tasks = connections.map(connection => Promise.resolve().then(() => load(connection)));
  // FIX: operational validation and sold deployments must never consume partial results.
  if (!allowPartial) return { groups: await Promise.all(tasks), errors: [] };
  const results = await Promise.allSettled(tasks);
  const errors: FbsConnectionError[] = [];
  const groups = results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    const connection = connections[index];
    // FIX: expose the affected cabinet, never credentials or a raw upstream response.
    errors.push({ connectionId: connection.id, marketplace: connection.marketplace,
      accountName: connection.accountName,
      message: `Не удалось загрузить подключение ${connection.marketplace} «${connection.accountName || connection.id}». Показаны заказы доступных подключений.` });
    return [];
  });
  // FIX: preserve the last successful display snapshot when all upstream reads fail.
  if (connections.length && errors.length === connections.length) throw new Error('Не удалось загрузить подключение: все подключения недоступны.');
  return { groups, errors };
}
