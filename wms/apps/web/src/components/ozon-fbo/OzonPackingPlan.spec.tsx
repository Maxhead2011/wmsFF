import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OzonSupplyView } from '../../lib/api';
import { OzonPackingPlan } from './OzonPackingPlan';

// TEST: the primary plan action keeps its availability guard.
describe('Ozon packing plan button', () => {
  it.each([false, true])('renders the primary action when busy is %s', busy => {
    const data = { plannedPackingSupported: true, differences: [] } as unknown as OzonSupplyView;
    const html = renderToStaticMarkup(<OzonPackingPlan data={data} busy={busy} action={async () => {}} />);
    const button = html.match(/<button[^>]*>Подготовить план коробов<\/button>/)?.[0];
    expect(button).toContain('class="primary-button"');
    expect(button?.includes('disabled')).toBe(busy);
  });
});
