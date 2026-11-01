import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthSession } from '../../lib/api';
import { ReceiptBatchesPanel } from './ReceiptBatchesPanel';

vi.mock('../../lib/rememberedClient', () => ({
  useRememberedClientId: () => ['client-a', () => {}],
  validRememberedClientId: () => 'client-a',
}));
vi.mock('./ReceiptDirectionsPanel', () => ({
  ReceiptDirectionsPanel: ({fixedClientId}: {fixedClientId:string}) =>
    createElement('section', {'data-review': fixedClientId}),
}));
const session = {user:{id:'operator'}} as AuthSession;
describe('receipt client picker', () => {
  // TEST: keyboard and visual order both place client selection before the review.
  it('renders one picker before the selected client review', () => {
    const html = renderToStaticMarkup(createElement(ReceiptBatchesPanel,{session}));
    expect(html.match(/<select/g)).toHaveLength(1);
    expect(html).toContain('data-review="client-a"');
    expect(html.indexOf('<select')).toBeLessThan(html.indexOf('data-review'));
  });
  it('keeps the fixed-client view scoped without a picker', () => {
    const html = renderToStaticMarkup(createElement(ReceiptBatchesPanel,{session,fixedClientId:'client-a'}));
    expect(html).not.toContain('<select');
    expect(html).toContain('data-review="client-a"');
  });
});
