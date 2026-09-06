import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FbsExcludedOrders } from './FbsExcludedOrders';

describe('terminal FBS order history', () => {
  // TEST: terminal scans remain visible, but cannot trigger another collection.
  it('renders collapsible evidence without action buttons', () => {
    const html = renderToStaticMarkup(<FbsExcludedOrders rows={[{
      id: 'task', orderId: '5630760859', wbStatus: 'complete/canceled_by_client',
      productName: 'Костюм', productBarcode: '123', kiz: 'saved-mark',
      sourceBoxCode: null, workerName: 'Шохида', syncIssue: 'Старый конфликт',
    }]} />);
    expect(html).toContain('<details');
    expect(html).toContain('Не требуется собирать');
    expect(html).toContain('5630760859');
    expect(html).toContain('saved-mark');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
  });
  it('adds no section for older servers or a disabled feature', () => {
    expect(renderToStaticMarkup(<FbsExcludedOrders rows={[]} />)).toBe('');
  });
});
