import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountFbsOrderByWb } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('WB accounting HTTP transport', () => {
  // TEST: the real request helper must encode the DTO exactly once, including special characters.
  it('sends the manager comment as a JSON object accepted by a strict JSON endpoint', async () => {
    const comment = 'Заявка 783: КИЗ "подтверждён"\nШК–товар \\ WB';
    const result = { accounted: true, shipped: true, requestId: 'request-783', assemblyId: 'task', orderId: 'order' };
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body).toEqual({ comment });
      return { ok: true, json: async () => result };
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(accountFbsOrderByWb('test-token', 'request-783', 'task', comment)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/fbs\/requests\/request-783\/orders\/task\/account-by-wb$/),
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }) }));
  });
  // TEST: a business validation failure remains readable and does not repeat the stock command.
  it('preserves the server conflict message without retrying the action', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ message: 'По заявке уже выполнена отгрузка.' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(accountFbsOrderByWb('test-token', 'request-783', 'task', 'Проверено')).rejects.toThrow('По заявке уже выполнена отгрузка.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
