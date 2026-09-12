import { describe, it, expect, vi } from 'vitest';
import { completePortalRun } from './wb-portal-transfer';
import type { FbsReshipmentRun } from './api';
// TEST: UI failures must keep the durable handle and never replay an uncertain browser mutation.
function fixture() {
  const run: FbsReshipmentRun = { runId: 'operation', status: 'PENDING', mode: 'NEW_ITEM', supplyId: 'new', requestId: null, errorMessage: null,
    portal: { ready: true, started: false, sourceSupplyId: 'old', targetSupplyId: 'new', targetSupplyName: 'Target', orderIds: ['123'], connectionId: 'wb', stickers: [] } };
  const started = { ...run, portal: { ...run.portal!, ready: false, started: true }, portalCommand: { ...run.portal!, runId: run.runId, commandId: 'once', expiresAt: 'future' } };
  const api = { start: vi.fn(async () => started), reconcile: vi.fn(async () => ({ ...started, status: 'CREATED' as const, requestId: 'request', portalCommand: null })) };
  const bridge = vi.fn(async (message: Record<string, unknown>) => message.kind === 'PREPARE' ? { ticket: 'ticket' } : {});
  return { run, api, bridge };
}
describe('WB portal transfer continuation', () => {
  it('prepares the account before issuing a command and verifies success on the server', async () => {
    const { run, api, bridge } = fixture();
    expect(await completePortalRun(run, api, bridge)).toMatchObject({ status: 'CREATED', runId: 'operation', requestId: 'request' });
    expect(bridge.mock.calls.map(([message]) => message.kind)).toEqual(['PING', 'PREPARE', 'EXECUTE']);
    expect(api.start).toHaveBeenCalledTimes(1); expect(api.reconcile).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(bridge.mock.calls)).not.toContain('accessToken');
  });
  it('leaves a recoverable ready operation when extension is missing or wrong account', async () => {
    const { run, api, bridge } = fixture(); bridge.mockRejectedValueOnce(new Error('Установите расширение'));
    expect(await completePortalRun(run, api, bridge)).toMatchObject({ runId: 'operation', portal: { ready: true }, errorMessage: expect.stringContaining('Установите') });
    expect(api.start).not.toHaveBeenCalled(); expect(api.reconcile).not.toHaveBeenCalled();
  });
  it('recovers a lost browser response only via server reads', async () => {
    const { run, api, bridge } = fixture();
    bridge.mockImplementation(async message => { if (message.kind === 'EXECUTE') throw new Error('timeout'); return { ticket: 'ticket' }; });
    expect((await completePortalRun(run, api, bridge)).status).toBe('CREATED');
    expect(bridge.mock.calls.filter(([message]) => message.kind === 'EXECUTE')).toHaveLength(1);
    expect(api.reconcile).toHaveBeenCalledTimes(1);
  });
  it('does not send an expired/reissued command or restart an already started operation', async () => {
    const { run, api, bridge } = fixture();
    api.start.mockResolvedValueOnce({ ...run, portal: { ...run.portal!, ready: false, started: true }, portalCommand: null } as never);
    const pending = await completePortalRun(run, api, bridge);
    expect(bridge.mock.calls.filter(([message]) => message.kind === 'EXECUTE')).toHaveLength(0);
    bridge.mockClear(); await completePortalRun(pending, api, bridge); expect(bridge).not.toHaveBeenCalled();
  });
  it('keeps reconciliation errors and the operation id after an unknown remote outcome', async () => {
    const { run, api, bridge } = fixture();
    bridge.mockImplementation(async message => { if (message.kind === 'EXECUTE') throw new Error('WB 409'); return { ticket: 'ticket' }; });
    api.reconcile.mockRejectedValue(new Error('server temporarily unavailable'));
    expect(await completePortalRun(run, api, bridge)).toMatchObject({ runId: 'operation', portal: { ready: false }, portalCommand: null, errorMessage: expect.stringContaining('WB 409') });
  });
});
