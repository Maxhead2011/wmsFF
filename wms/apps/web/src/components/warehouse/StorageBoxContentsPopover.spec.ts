import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoxContentsCard, createBoxPreviewLoader, positionBoxPreview, StorageBoxContentsPopover } from './StorageBoxContentsPopover';
import type { TurnoverBoxDetails } from '../../lib/api';

const details = { box: { code: 'BOX-1' }, totals: { quantity: 3 }, contents: [
  { balanceId: 'b1', skuId: 'sku1', name: 'Костюм', article: 'Лаунж', color: 'Серый', size: 'M / 46', barcode: '0012345678901', quantity: 2, statusLabel: 'Доступно' },
  { balanceId: 'b2', skuId: 'sku2', name: 'Брюки', article: null, color: null, size: null, barcode: null, quantity: 1, statusLabel: 'В сборке' },
] } as TurnoverBoxDetails;

describe('pallet-sort box contents preview', () => {
  // TEST: all rows, leading-zero barcode and stock statuses remain visible.
  it('renders every product with identifying fields and quantity', () => {
    const html = renderToStaticMarkup(createElement(BoxContentsCard, { state: { status: 'ready', data: details } }));
    for (const text of ['Костюм', 'Брюки', 'Лаунж', 'Серый', 'M / 46', '0012345678901', 'Доступно', 'В сборке', '2 шт.', '1 шт.']) expect(html).toContain(text);
  });
  it('distinguishes an empty box from a failed request and loading', () => {
    const render = (state: Parameters<typeof BoxContentsCard>[0]['state']) => renderToStaticMarkup(createElement(BoxContentsCard, { state }));
    expect(render({ status: 'ready', data: { ...details, contents: [] } })).toContain('нет товаров');
    expect(render({ status: 'loading' })).toContain('Загружаю');
    expect(render({ status: 'error', error: 'Нет доступа' })).toContain('Нет доступа');
    expect(render({ status: 'error', error: 'Нет доступа' })).not.toContain('нет товаров');
  });
  it('renders an accessible button without fetching any box on initial render', () => {
    const html = renderToStaticMarkup(createElement(StorageBoxContentsPopover, {
      accessToken: 'test-token', warehouseId: 'wh1', clientId: 'client1', boxCode: 'BOX-1', exists: true,
      children: createElement('strong', null, 'BOX-1'),
    }));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
  });
  it('coalesces concurrent loads and refreshes on the next opening', async () => {
    let resolve!: (value: TurnoverBoxDetails) => void;
    const fetcher = vi.fn(() => new Promise<TurnoverBoxDetails>(done => { resolve = done; }));
    const publish = vi.fn();
    const loader = createBoxPreviewLoader(fetcher, publish);
    const first = loader.load(); const second = loader.load();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(details); await Promise.all([first, second]);
    expect(publish).toHaveBeenLastCalledWith({ status: 'ready', data: details });
    const third = loader.load(); expect(fetcher).toHaveBeenCalledTimes(2); resolve(details); await third;
  });
  it('ignores a late response after the client/session/box changed', async () => {
    let resolve!: (value: TurnoverBoxDetails) => void;
    const publish = vi.fn();
    const loader = createBoxPreviewLoader(() => new Promise(done => { resolve = done; }), publish);
    const pending = loader.load(); loader.invalidate(); resolve(details); await pending;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ status: 'loading' });
  });
  it('shows a request error and allows retry', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('Нет доступа')).mockResolvedValueOnce(details);
    const publish = vi.fn(); const loader = createBoxPreviewLoader(fetcher, publish);
    await loader.load(); expect(publish).toHaveBeenLastCalledWith({ status: 'error', error: 'Нет доступа' });
    await loader.load(); expect(publish).toHaveBeenLastCalledWith({ status: 'ready', data: details });
  });
  it.each([375, 768, 1440])('keeps the popover inside a %s px viewport', width => {
    for (const left of [0, width - 100]) {
      const result = positionBoxPreview({ left, right: left + 100, top: 600, bottom: 630 }, width, 700);
      expect(result.left).toBeGreaterThanOrEqual(12);
      expect(result.left + result.width).toBeLessThanOrEqual(width - 12);
      expect(result.top + result.maxHeight).toBeLessThanOrEqual(688);
    }
  });
});
