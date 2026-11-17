import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BulkVolumeEditor } from '../src/components/catalog/BulkVolumeEditor';
import { fetchBulkSkuVolume, updateBulkSkuVolume } from '../src/lib/api';

// TEST: exercise the rendered controls and effects with deferred API responses.
const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useMemo: (fn: () => unknown) => fn(),
  useState(initial: any) {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[i], (value: any) => { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }];
  },
  useEffect(fn: () => any, deps: any[]) {
    const i = hooks.cursor++, old = hooks.slots[i];
    if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) {
      hooks.slots[i] = { deps, cleanup: old?.cleanup };
      hooks.effects.push(() => { old?.cleanup?.(); hooks.slots[i].cleanup = fn(); });
    }
  },
}));
vi.mock('../src/lib/rememberedClient', () => ({ useRememberedClientId: () => useState('client-1') }));
vi.mock('../src/lib/api', () => ({ fetchBulkSkuVolume: vi.fn(), updateBulkSkuVolume: vi.fn() }));
const pending: { resolve: (data: any) => void; reject: (e: Error) => void }[] = [];
const props: any = { clients: [{ id: 'client-1', code: 'C1', name: 'Клиент 1' }, { id: 'client-2', code: 'C2', name: 'Клиент 2' }], defaultClientId: '', onApplied: vi.fn(), session: { accessToken: 'test', user: { id: 'user-1' } } };
const data = { client: { id: 'client-1' }, volumes: [], total: 2, items: ['sku-1', 'sku-2'].map(id => ({ id, name: id, article: 'ART-1', internalSku: id, barcodes: [{ value: '00123' }], volumeLiters: null })) };
function render() { hooks.cursor = 0; const tree = BulkVolumeEditor(props); hooks.effects.splice(0).forEach(fn => fn()); return tree; }
function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(n => nodes(n, type));
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}
function field(tree: any, label: string) {
  const node = nodes(tree, 'label').find(n => nodes(n, 'span').some(s => s.props.children === label));
  expect(node, `field: ${label}`).toBeDefined();
  return [...nodes(node, 'input'), ...nodes(node, 'select')][0];
}
function change(label: string, value: string) { field(render(), label).props.onChange({ target: { value } }); return render(); }
async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
async function loaded(search = '00123') {
  render();
  change('Артикул / баркод', search);
  pending.at(-1)!.resolve(data); await flush();
  return render();
}
const submit = (tree: any) => nodes(tree, 'button').find(n => n.props.type === 'submit');
beforeEach(() => {
  hooks.slots = []; hooks.effects = []; pending.length = 0; vi.clearAllMocks();
  vi.stubEnv('VITE_BULK_VOLUME_SEARCH_ENABLED', 'true');
  vi.stubGlobal('window', { confirm: vi.fn(() => true) });
  vi.mocked(fetchBulkSkuVolume).mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  vi.mocked(updateBulkSkuVolume).mockResolvedValue({ clientId: 'client-1', newVolumeLiters: 2.5, updated: 1 });
});
afterEach(() => { hooks.slots.forEach(s => s?.cleanup?.()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('searches without volume bounds and submits only checked products', async () => {
  let tree = await loaded();
  expect(fetchBulkSkuVolume).toHaveBeenLastCalledWith('test', { clientId: 'client-1', search: '00123', sourceVolumeFrom: undefined, sourceVolumeTo: undefined });
  expect(field(tree, 'Литраж от, л').props.required).toBe(false);
  nodes(tree, 'input').find(n => n.props['aria-label'] === 'Выбрать sku-2').props.onChange({ target: { checked: false } });
  tree = change('Новый литраж, л', '2.5');
  await nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }); await flush();
  expect(updateBulkSkuVolume).toHaveBeenCalledWith('test', { clientId: 'client-1', search: '00123', skuIds: ['sku-1'], newVolumeLiters: 2.5, sourceVolumeFrom: undefined, sourceVolumeTo: undefined });
  expect(props.onApplied).toHaveBeenCalledOnce();
  expect(field(render(), 'Литраж от, л').props.value).toBe('');
});
it('combines product search with a complete optional range', async () => {
  await loaded('ART-1'); change('Литраж от, л', '1'); change('Литраж до, л', '3');
  expect(fetchBulkSkuVolume).toHaveBeenLastCalledWith('test', { clientId: 'client-1', search: 'ART-1', sourceVolumeFrom: 1, sourceVolumeTo: 3 });
});
it('does not allow a partial range to silently broaden the selection', async () => {
  await loaded(); vi.mocked(fetchBulkSkuVolume).mockClear();
  expect(submit(change('Литраж от, л', '1')).props.disabled).toBe(true);
  expect(fetchBulkSkuVolume).not.toHaveBeenCalled();
});
it('clears stale selection immediately and ignores late responses', async () => {
  await loaded(); change('Артикул / баркод', 'second'); const second = pending.at(-1)!;
  const tree = change('Артикул / баркод', 'third');
  expect(submit(tree).props.disabled).toBe(true);
  expect(nodes(tree, 'input').some(n => n.props['aria-label'] === 'Выбрать sku-1')).toBe(false);
  second.resolve(data); await flush();
  expect(submit(render()).props.disabled).toBe(true);
  pending.at(-1)!.resolve({ ...data, items: [], total: 0 }); await flush();
  expect(submit(render()).props.disabled).toBe(true);
});
it('blocks submission after a failed search', async () => {
  await loaded(); change('Артикул / баркод', 'second'); pending.at(-1)!.reject(new Error('offline')); await flush();
  expect(submit(render()).props.disabled).toBe(true);
  await nodes(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await flush();
  expect(updateBulkSkuVolume).not.toHaveBeenCalled();
});
it('clears selection and search when the client changes', async () => {
  await loaded(); const tree = change('Клиент', 'client-2');
  expect(field(tree, 'Артикул / баркод').props.value).toBe('');
  expect(submit(tree).props.disabled).toBe(true);
});
it('requires confirmation and locks controls during saving', async () => {
  await loaded(); let tree = change('Новый литраж, л', '2.5');
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  await nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }); await flush();
  expect(updateBulkSkuVolume).not.toHaveBeenCalled();
  vi.mocked(updateBulkSkuVolume).mockReturnValueOnce(new Promise(() => {}));
  nodes(tree, 'form')[0].props.onSubmit({ preventDefault() {} }); tree = render();
  expect(field(tree, 'Артикул / баркод').props.disabled).toBe(true);
  expect(field(tree, 'Клиент').props.disabled).toBe(true);
  expect(submit(tree).props.disabled).toBe(true);
});
it('retains the range-only screen with the feature disabled', async () => {
  vi.stubEnv('VITE_BULK_VOLUME_SEARCH_ENABLED', 'false');
  const tree = render();
  expect(nodes(tree, 'span').some(n => n.props.children === 'Артикул / баркод')).toBe(false);
  expect(field(tree, 'Литраж от, л').props.required).toBe(true);
  change('Литраж от, л', '1'); change('Литраж до, л', '3');
  expect(fetchBulkSkuVolume).toHaveBeenLastCalledWith('test', expect.objectContaining({ clientId: 'client-1', sourceVolumeFrom: 1, sourceVolumeTo: 3 }));
});
