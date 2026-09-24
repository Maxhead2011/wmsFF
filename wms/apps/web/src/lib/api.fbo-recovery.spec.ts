import { afterEach, describe, it, expect, vi } from 'vitest';
import { applyFboRecovery, downloadFboPickReport, fetchFboPickReport, previewFboRecovery } from './api';
describe('FBO recovery API', () => {
    afterEach(() => vi.unstubAllGlobals());
    // TEST: UI sends only the server token to apply, with authenticated POST; report filters match Excel.
    it('separates preview, apply and read-only exports', async () => {
        const fetch = vi.fn().mockImplementation(async (url: string) => new Response(url.includes('xlsx') ? 'xlsx' : '[]', { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        await previewFboRecovery('auth', 'request', { action: 'FINISH', reason: 'Все короба проверены', physicalConfirmed: true });
        await applyFboRecovery('auth', 'request', 'preview-token');
        expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ token: 'preview-token' });
        expect(fetch.mock.calls[1][1].method).toBe('POST');
        const filter = { worker: 'Гуля', pallet: 'PALET_1', from: '2026-09-23', to: '2026-09-24', state: 'PACKED' };
        await fetchFboPickReport('auth', 'request', filter);
        await downloadFboPickReport('auth', 'request', filter);
        expect(String(fetch.mock.calls[2][0]).split('?')[1]).toBe(String(fetch.mock.calls[3][0]).split('?')[1]);
        for (const [, init] of fetch.mock.calls)
            expect(new Headers(init.headers).get('Authorization')).toBe('Bearer auth');
        expect(fetch.mock.calls.slice(2).every(([, init]) => (init.method ?? 'GET') === 'GET')).toBe(true);
    });
});
