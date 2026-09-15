import { afterEach, expect, it, vi } from 'vitest';
import { previewOutboundRequestXlsx, commitOutboundRequestXlsx } from './api';

afterEach(() => vi.unstubAllGlobals());

// TEST: a CLIENT without a profile warehouse must send its selected branch alongside the actual file.
it.each([previewOutboundRequestXlsx, commitOutboundRequestXlsx])('keeps file and branch together in Excel requests', async (send) => {
  const file = new File(['workbook'], 'template (5).xlsx');
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = init.body as FormData;
    expect(body.get('warehouseId')).toBe('warehouse-msk');
    expect((body.get('file') as File).name).toBe(file.name);
    expect(await (body.get('file') as File).text()).toBe('workbook');
    expect(body.get('desiredDate')).toBe('2026-09-18');
    expect(init.headers).not.toHaveProperty('Content-Type');
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  await send('token', { file, clientId: 'client', warehouseId: 'warehouse-msk', destinationCity: 'Москва', desiredDate: '2026-09-18' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
