import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SortingProblemSummary } from './PalletSortingPanel';

it('shows problem boxes and recovered quantities explicitly, not as normal moves', () => {
  // TEST: missing-source stock must never be disguised as a normal balanced transfer.
  const html = renderToStaticMarkup(<SortingProblemSummary problems={[
    { code: 'UNKNOWN', scanned: true, reason: 'BOX_NOT_FOUND' },
    { code: 'NOT_SCANNED', scanned: false, reason: 'BOX_NOT_FOUND' },
  ]} recovered={2} />);
  expect(html).toContain('Проблемные короба');
  expect(html).toContain('UNKNOWN');
  expect(html).toContain('не найден в WMS');
  expect(html).toContain('не отсканирован');
  expect(html).toContain('Оприходовано найденных: 2');
});
it('keeps old saved sessions without problems renderable', () => {
  // TEST: JSON state is additive; pre-update sessions remain readable.
  expect(renderToStaticMarkup(<SortingProblemSummary recovered={0} />)).toBe('');
});
