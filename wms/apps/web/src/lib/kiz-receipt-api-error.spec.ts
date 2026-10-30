import { afterEach, expect, it, vi } from 'vitest';
import { addOnlineReceiptItem } from './api';

afterEach(() => vi.unstubAllGlobals());
it('keeps duplicate receipt identity and origin evidence with the server error', async () => {
  // TEST: a generic Error previously discarded the evidence required by the stop screen.
  const duplicateInfo = { identity: 'identity', firstReceivedAt: null, firstBoxCode: 'FFL_OLD', productName: 'Костюм' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'KIZ_DUPLICATE', duplicate: true,
    duplicateInfo, message: 'ОТЛОЖИТЕ ТОВАР' }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
  await expect(addOnlineReceiptItem('test', { clientId: 'client', boxCode: 'FFL_NEW', quantity: 1 } as any))
    .rejects.toMatchObject({ message: 'ОТЛОЖИТЕ ТОВАР', code: 'KIZ_DUPLICATE', duplicateInfo });
});
it('keeps the existing message for ordinary API errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: ['first', 'second'] }), { status: 400 })));
  await expect(addOnlineReceiptItem('test', {} as any)).rejects.toThrow('first\nsecond');
});
