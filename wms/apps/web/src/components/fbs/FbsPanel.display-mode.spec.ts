import { beforeEach, expect, it, vi } from 'vitest';
import { FbsPanel } from './FbsPanel';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => {},
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: any) => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next;
    }];
  },
}));

const props = { session: { accessToken: 'test', user: { id: 'user', activeWarehouseId: 'moscow' } } } as any;
function render() { hooks.cursor = 0; return FbsPanel(props); }
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });

// TEST: reproduce WB's branch leaking into Ozon and Ozon's all-branches leaking back into WB.
it('retains a separate display choice for each marketplace', () => {
  render().props.setMarketplace('WILDBERRIES');
  render().props.setDisplayMode('moscow');
  render().props.setMarketplace('OZON');
  render().props.setDisplayMode('all');
  render().props.setMarketplace('WILDBERRIES');
  expect(render().props.displayMode).toBe('moscow');
  render().props.setMarketplace('OZON');
  expect(render().props.displayMode).toBe('all');
  render().props.setMarketplace('YANDEX_MARKET');
  expect(render().props.displayMode).toBe('moscow');
  render().props.setDisplayMode('noginsk');
  render().props.setMarketplace('OZON');
  expect(render().props.displayMode).toBe('all');
  expect(props.session.user.activeWarehouseId).toBe('moscow');
});

// TEST: remount content on marketplace switches even when both modes match, discarding stale rows/actions.
it('isolates content and exposes independent modes for marketplace counters', () => {
  render().props.setMarketplace('WILDBERRIES');
  const wb = render();
  wb.props.setMarketplace('OZON');
  expect(render().key).not.toBe(wb.key);
  render().props.setDisplayMode('all');
  render().props.setMarketplace(null);
  expect(render().props.displayModes).toEqual({ WILDBERRIES: 'moscow', OZON: 'all', YANDEX_MARKET: 'moscow' });
});
