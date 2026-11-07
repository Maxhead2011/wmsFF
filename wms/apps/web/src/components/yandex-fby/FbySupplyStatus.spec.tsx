import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FbySupplyStatus } from './FbySupplyStatus';

// TEST: remote status and timestamp remain visible independently of the WMS stage.
it('shows the saved marketplace status and Moscow check time', () => {
  const html = renderToStaticMarkup(<FbySupplyStatus status="FINISHED" checkedAt="2026-11-07T10:00:00Z" />);
  expect(html).toContain('FINISHED');
  expect(html).toContain('07.11.2026');
  expect(html).toContain('13:00:00');
  expect(html).toContain('Сверить с Яндексом');
});
it('shows an explicit unchecked state without a fabricated check time', () => {
  const html = renderToStaticMarkup(<FbySupplyStatus status={null} checkedAt={null} />);
  expect(html).toContain('Ещё не проверен');
  expect(html).not.toContain('МСК');
});
