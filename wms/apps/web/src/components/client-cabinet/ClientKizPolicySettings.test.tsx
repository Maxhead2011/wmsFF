import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ClientKizPolicySettings } from './ClientKizPolicySettings';
it('keeps the switch and save disabled until the persisted client policy loads', () => {
  // TEST: loading must never allow overwriting an enabled policy with the default false.
  const html = renderToStaticMarkup(<ClientKizPolicySettings accessToken="test" clientId="c" />);
  expect(html).toContain('Все товары с КИЗ');
  expect(html).toMatch(/<input[^>]*role="switch"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*disabled/);
  expect(html).toContain('Загружаю настройку');
});
