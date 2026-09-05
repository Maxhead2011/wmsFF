import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderAssemblyPanel } from './OrderAssemblyPanel';
import { fetchWebOrderAssemblyHistory, type AuthSession } from '../../lib/api';

afterEach(() => vi.unstubAllGlobals());
// TEST: order search has a separate accessible input, not the mutating KIZ scanner.
it('renders a dedicated order-number search and reset', () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  const html = renderToStaticMarkup(createElement(OrderAssemblyPanel, { session: { accessToken: 'test' } as AuthSession }));
  expect(html).toContain('Номер заказа WB');
  expect(html).toContain('id="assembly-order-search"');
  expect(html).toContain('Сбросить поиск');
  expect(html).toContain('id="order-kiz"');
});
// TEST: older prints are found server-side; the existing URL without query stays compatible.
it('sends the trimmed number through a read-only history request', async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await (fetchWebOrderAssemblyHistory as any)('test', ' 5630810674 ');
  expect(fetch.mock.calls[0][0]).toContain('/history?orderId=5630810674');
  expect(fetch.mock.calls[0][1].method || 'GET').toBe('GET');
  await fetchWebOrderAssemblyHistory('test');
  expect(fetch.mock.calls[1][0]).toMatch(/\/history$/);
});
