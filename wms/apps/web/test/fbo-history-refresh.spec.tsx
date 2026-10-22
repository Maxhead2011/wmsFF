import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { FboHistory } from '../src/components/client-requests/FboHistory';
import { fetchFboHistory, type FboPlan } from '../src/lib/api';

// TEST: exercise the component's effects and rendered rows with deferred network reads.
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: any) {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [h.slots[i], (v: any) => { h.slots[i] = typeof v === 'function' ? v(h.slots[i]) : v; }];
  },
  useRef(initial: any) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useEffect(fn: () => any, deps: any[]) {
    const i = h.cursor++, old = h.slots[i];
    if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) {
      h.slots[i] = { deps, cleanup: old?.cleanup };
      h.effects.push(() => { old?.cleanup?.(); h.slots[i].cleanup = fn(); });
    }
  },
}));
vi.mock('../src/lib/api', () => ({ fetchFboHistory: vi.fn() }));
const pending: { resolve: (v: any) => void; reject: (e: Error) => void }[] = [];
const row = { id: 'unit-1', requestItemId: 'item', barcode: '123', sourceBoxCode: 'BOX' };
let plan: FboPlan;
function render() {
  h.cursor = 0;
  const tree = FboHistory({ plan, accessToken: 'token' });
  h.effects.splice(0).forEach(fn => fn());
  return tree;
}
function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(x => nodes(x, type));
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}
async function loaded() {
  render().props.onToggle({ currentTarget: { open: true } }); render();
  pending[0].resolve({ pickedUnits: [row], total: 201 });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  return render();
}
beforeEach(() => {
  h.slots = []; h.effects = []; h.cursor = 0; pending.length = 0;
  vi.stubEnv('VITE_MENU_READS_ENABLED', 'true');
  vi.stubGlobal('React', React);
  vi.mocked(fetchFboHistory).mockReset().mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  plan = { requestId: 'request', observedAt: 'first', lines: [], pickedUnitsCount: 201 } as unknown as FboPlan;
});
afterEach(() => { h.slots.forEach(s => s?.cleanup?.()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('keeps rows and avoids a loading paragraph during background refresh', async () => {
  await loaded(); plan = { ...plan, observedAt: 'second' }; render();
  const tree = render();
  expect(nodes(tree, 'tbody')[0].props.children).toHaveLength(1);
  expect(nodes(tree, 'p').filter(n => n.props.role === 'status')).toHaveLength(0);
});
it('keeps the last page when a background refresh fails', async () => {
  await loaded(); plan = { ...plan, observedAt: 'second' }; render();
  pending[1].reject(new Error('offline')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(nodes(render(), 'tbody')[0].props.children).toHaveLength(1);
});
it('clears the old page and ignores its late refresh response', async () => {
  await loaded(); plan = { ...plan, observedAt: 'second' }; render();
  nodes(render(), 'button').find(n => n.props.children === 'Далее').props.onClick(); render();
  expect(nodes(render(), 'tbody')[0].props.children).toHaveLength(0);
  pending[1].resolve({ pickedUnits: [row], total: 201 }); await Promise.resolve();
  expect(nodes(render(), 'tbody')[0].props.children).toHaveLength(0);
  expect(fetchFboHistory).toHaveBeenLastCalledWith('token', 'request', 100);
});
it('does not retain another request history', async () => {
  await loaded(); plan = { ...plan, requestId: 'another-request' }; render();
  expect(nodes(render(), 'tbody')[0].props.children).toHaveLength(0);
  expect(fetchFboHistory).toHaveBeenLastCalledWith('token', 'another-request', 0);
});
