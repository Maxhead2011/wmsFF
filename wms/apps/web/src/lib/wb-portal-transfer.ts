import type { FbsReshipmentRun, WbPortalCommand } from './api';

type Bridge = (message: Record<string, unknown>) => Promise<{ ticket?: string }>;
// FIX: authenticated WMS operations remain on the server; the extension receives only supply/order IDs.
export function wbPortalBridge(message: Record<string, unknown>): Promise<{ ticket?: string }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => finish(new Error(message.kind === 'PING'
      ? 'Установите расширение LOGOFF для переноса WB и перезагрузите страницу ВМС.'
      : 'Ответ расширения не получен. Проверьте сохранённую операцию в журнале повторной отгрузки.')), message.kind === 'PING' ? 2000 : 120_000);
    function finish(error?: Error, result?: { ticket?: string }) {
      window.clearTimeout(timer); window.removeEventListener('message', listener);
      if (error) reject(error); else resolve(result ?? {});
    }
    function listener(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'LOGOFF_WB_RESPONSE' || event.data.id !== id) return;
      const response = event.data.response;
      if (response?.ok === true) finish(undefined, response.result);
      else finish(new Error(typeof response?.error === 'string' ? response.error : 'Ошибка расширения WB.'));
    }
    window.addEventListener('message', listener);
    window.postMessage({ channel: 'LOGOFF_WB_REQUEST', id, message }, location.origin);
  });
}

type Run = Pick<FbsReshipmentRun, 'runId' | 'errorMessage' | 'portal' | 'portalCommand'> & { status: string };
export async function completePortalRun<T extends Run>(run: T, api: {
  start: () => Promise<FbsReshipmentRun>; reconcile: () => Promise<FbsReshipmentRun>;
}, bridge: Bridge = wbPortalBridge): Promise<T> {
  if (!run.portal?.ready || run.status === 'CREATED') return run;
  let issued = false; let current: Run = run;
  try {
    await bridge({ kind: 'PING' });
    const prepared = await bridge({ kind: 'PREPARE', plan: { ...run.portal, runId: run.runId } });
    if (!prepared.ticket) throw new Error('Расширение не подтвердило кабинет WB.');
    const started = await api.start(); current = started;
    const command: WbPortalCommand | null | undefined = started.portalCommand;
    if (!command) return { ...run, ...started };
    issued = true;
    await bridge({ kind: 'EXECUTE', ticket: prepared.ticket, command });
    return { ...run, ...await api.reconcile() };
  } catch (error) {
    // An extension timeout says nothing about the remote result; reconcile without replaying PATCH.
    if (issued) {
      try { const verified = await api.reconcile(); if (verified.status === 'CREATED') return { ...run, ...verified }; current = verified; }
      catch { /* retain the durable handle and instructions below */ }
    }
    return { ...run, ...current, portalCommand: null,
      errorMessage: `${error instanceof Error ? error.message : 'Перенос через кабинет WB не подтверждён.'} Операция ${run.runId} сохранена; продолжите её через журнал повторной отгрузки.` };
  }
}
