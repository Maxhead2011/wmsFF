import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { OzonFboPanel } from './OzonFboPanel';
import type { AuthSession } from '../../lib/api';

vi.mock('../../lib/rememberedClient', () => ({ useRememberedClientId: () => ['', vi.fn()] }));

// TEST: the customer-facing FBO banner must not advertise another WMS brand.
it('renders a neutral Ozon banner without FFULLHAB branding', () => {
  const html = renderToStaticMarkup(<OzonFboPanel session={{ accessToken: 'test', user: { id: 'test', clientIds: [] } } as unknown as AuthSession} />);
  expect(html).toContain('WMS × OZON');
  expect(html).not.toMatch(/ffullhab|ффулл?хаб/i);
  expect(html).toContain('Поставки FBO без ручной рутины');
});
