import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FbsReshipmentController, FbsReshipmentView } from './FbsReshipmentPanel';

const candidate = { id: '123', connectionId: 'cabinet', productName: 'Костюм', article: 'S', barcode: '205',
  sourceRequestNumber: 712, sourceSupplyId: 'WB-GI-1', assemblyStatus: 'COMPLETED', supplierStatus: 'complete',
  wbStatus: 'waiting', eligibleModes: ['SAME_ITEM', 'NEW_ITEM'] as ('SAME_ITEM' | 'NEW_ITEM')[], blockedReason: null };
function setup() {
  const api = { check: vi.fn().mockResolvedValue({ candidates: [candidate], runs: [] }),
    preview: vi.fn().mockResolvedValue({ previewToken: 'proof', orders: [candidate], orderCount: 1, additionalUnits: 0, warning: 'Проверено' }),
    create: vi.fn().mockResolvedValue({ runId: 'run1', status: 'CREATED', mode: 'SAME_ITEM', supplyId: 'WB-GI-2', requestId: 'r1', requestNumber: 713, errorMessage: null }),
    resume: vi.fn().mockResolvedValue({ runId: 'run1', status: 'CREATED', mode: 'SAME_ITEM', supplyId: 'WB-GI-2', requestId: 'r1', requestNumber: 713, errorMessage: null }) };
  return { api, model: new FbsReshipmentController('client', api) };
}

describe('WB reshipment UI // TEST', () => {
  it('checks only the dedicated WB candidates and never creates during discovery', async () => {
    const { api, model } = setup();
    await model.check();
    expect(api.check).toHaveBeenCalledWith({ clientId: 'client' });
    expect(model.state.candidates).toEqual([candidate]);
    expect(api.create).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(<FbsReshipmentView model={model} />);
    expect(html).toContain('Проверить WB');
    expect(html).toContain('712');
    expect(html).toContain('WB-GI-1');
    expect(html).toContain('Повторная отгрузка / довоз');
  });
  it('requires preview and explicit confirmation; synchronously guards double clicks', async () => {
    const { api, model } = setup();
    await model.check(); model.toggle(candidate); await model.create();
    expect(api.create).not.toHaveBeenCalled();
    await model.preview(); await model.create();
    expect(api.create).not.toHaveBeenCalled();
    model.confirm(true);
    await Promise.all([model.create(), model.create()]);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith({ clientId: 'client', orders: [{ id: '123', connectionId: 'cabinet' }], mode: 'SAME_ITEM', previewToken: 'proof', confirm: true });
    expect(model.state.runs[0].requestNumber).toBe(713);
    expect(model.state.preview).toBeNull();
  });
  it('invalidates preview and confirmation on changed mode and selected orders', async () => {
    const { model } = setup(); await model.check(); model.toggle(candidate); await model.preview(); model.confirm(true);
    model.setMode('NEW_ITEM');
    expect(model.state.preview).toBeNull(); expect(model.state.confirmed).toBe(false);
    const html = renderToStaticMarkup(<FbsReshipmentView model={model} />);
    expect(html).toContain('дополнительное списание');
    await model.preview(); model.confirm(true); model.toggle(candidate);
    expect(model.state.preview).toBeNull(); expect(model.state.confirmed).toBe(false);
  });
  it('does not select blocked candidates or orders from different cabinets', async () => {
    const { api, model } = setup();
    const blocked = { ...candidate, id: 'blocked', eligibleModes: [], blockedReason: 'Сначала распакуйте грузокороб' };
    const other = { ...candidate, id: 'other', connectionId: 'other-cabinet' };
    api.check.mockResolvedValue({ candidates: [candidate, blocked, other], runs: [] });
    await model.check(); model.toggle(blocked); model.toggle(candidate); model.toggle(other);
    expect(model.state.selected).toEqual([candidate]);
    expect(renderToStaticMarkup(<FbsReshipmentView model={model} />)).toContain('Сначала распакуйте грузокороб');
  });
  it('discards late async responses after account/client/warehouse scope unmount', async () => {
    const { api, model } = setup();
    let resolve!: (value: unknown) => void;
    api.check.mockReturnValue(new Promise(r => { resolve = r; }));
    const pending = model.check(); model.dispose(); resolve({ candidates: [candidate], runs: [] }); await pending;
    expect(model.state.candidates).toEqual([]);
  });
  it('on uncertain create error requires discovery and resumes the durable run, not another create', async () => {
    const { api, model } = setup(); await model.check(); model.toggle(candidate); await model.preview(); model.confirm(true);
    api.create.mockRejectedValueOnce(new Error('Связь прервана'));
    await model.create(); await model.create();
    expect(api.create).toHaveBeenCalledTimes(1); expect(model.state.preview).toBeNull();
    api.check.mockResolvedValue({ candidates: [], runs: [{ runId: 'run1', status: 'NEEDS_RECONCILIATION', mode: 'SAME_ITEM', supplyId: 'WB-GI-2', requestId: null, errorMessage: 'Ожидает проверки WB' }] });
    await model.check(); await Promise.all([model.resume('run1'), model.resume('run1')]);
    expect(api.resume).toHaveBeenCalledTimes(1);
    expect(api.resume).toHaveBeenCalledWith({ clientId: 'client', runId: 'run1' });
  });
  // TEST: filters operate on the complete returned problem list, not just a page.
  it.each(['123', '712', 'wb-gi-1', '205', 'костюм', ' S '])('finds order by search %s', async query => {
    const { api, model } = setup();
    api.check.mockResolvedValue({ candidates: [candidate, { ...candidate, id: '999', productName: 'Джинсы',
      article: 'D', barcode: '888', sourceRequestNumber: 900, sourceSupplyId: 'WB-GI-9' }], runs: [] });
    await model.check(); model.setFilters({ query });
    expect(model.visibleCandidates().map(row => row.id)).toEqual(['123']);
  });
  it('combines cabinet, search and availability; keeps review rows unselectable', async () => {
    const { api, model } = setup();
    const blocked = { ...candidate, id: 'blocked', eligibleModes: [], blockedReason: 'Распакуйте грузокороб' };
    api.check.mockResolvedValue({ candidates: [candidate, blocked, { ...candidate, id: 'other', connectionId: 'other' }], runs: [] });
    await model.check(); model.setFilters({ query: 'костюм', connectionId: 'cabinet', availability: 'REVIEW' });
    expect(model.visibleCandidates().map(row => row.id)).toEqual(['blocked']); model.selectAllVisible();
    expect(model.state.selected).toEqual([]);
    model.setFilters({ availability: 'AVAILABLE' }); model.selectAllVisible();
    expect(model.state.selected).toEqual([candidate]);
  });
  it('selects all visible eligible orders once and clears confirmation on filtering and clear', async () => {
    const { api, model } = setup(); const second = { ...candidate, id: '124' };
    api.check.mockResolvedValue({ candidates: [candidate, second], runs: [] });
    await model.check(); model.selectAllVisible(); model.selectAllVisible();
    expect(model.state.selected).toEqual([candidate, second]);
    await model.preview(); model.confirm(true); model.setFilters({ query: '124' });
    expect(model.state.selected).toEqual([]); expect(model.state.preview).toBeNull(); expect(model.state.confirmed).toBe(false);
    model.selectAllVisible(); await model.preview(); model.confirm(true); model.clearSelection();
    expect(model.state.selected).toEqual([]); expect(model.state.preview).toBeNull(); expect(model.state.confirmed).toBe(false);
  });
  it('does not silently select a cabinet or truncate a bulk selection above 100', async () => {
    const { api, model } = setup();
    api.check.mockResolvedValue({ candidates: [candidate, { ...candidate, id: 'other', connectionId: 'other' }], runs: [] });
    await model.check(); model.selectAllVisible();
    expect(model.state.selected).toEqual([]); expect(model.state.error).toMatch(/кабинет/i);
    api.check.mockResolvedValue({ candidates: Array.from({ length: 101 }, (_, i) => ({ ...candidate, id: String(i) })), runs: [] });
    await model.check(); model.selectAllVisible(); expect(model.state.selected).toEqual([]); expect(model.state.error).toContain('100');
    api.check.mockResolvedValue({ candidates: Array.from({ length: 100 }, (_, i) => ({ ...candidate, id: String(i) })), runs: [] });
    await model.check(); model.selectAllVisible(); expect(model.state.selected).toHaveLength(100);
  });
  it('blocks bulk/filter changes during requests and after disposal', async () => {
    const { api, model } = setup(); await model.check(); model.selectAllVisible();
    let resolve!: (v: any) => void; api.preview.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const pending = model.preview(); model.setFilters({ query: 'no' }); model.clearSelection(); model.selectAllVisible();
    expect(model.state.selected).toEqual([candidate]); expect(model.visibleCandidates()).toEqual([candidate]);
    resolve({ previewToken: 'proof', orders: [candidate], orderCount: 1, additionalUnits: 0, warning: '' }); await pending;
    model.dispose(); model.clearSelection(); model.setFilters({ query: 'no' });
    expect(model.state.selected).toEqual([candidate]); expect(model.visibleCandidates()).toEqual([candidate]);
  });
  it('uses current action for availability and keeps uncertain operations outside filters', async () => {
    const { api, model } = setup(); const newOnly = { ...candidate, eligibleModes: ['NEW_ITEM'] as ('NEW_ITEM')[] };
    api.check.mockResolvedValue({ candidates: [newOnly], unverifiedCount: 3, runs: [{ runId: 'pending', status: 'NEEDS_RECONCILIATION',
      mode: 'SAME_ITEM', supplyId: null, requestId: null, errorMessage: 'Проверьте результат WB' }] });
    await model.check(); model.setFilters({ availability: 'AVAILABLE' }); expect(model.visibleCandidates()).toEqual([]);
    model.setMode('NEW_ITEM'); expect(model.visibleCandidates()).toEqual([newOnly]);
    model.setFilters({ query: 'no-match' }); const html = renderToStaticMarkup(<FbsReshipmentView model={model} />);
    expect(html).toContain('Статус WB не подтверждён: 3'); expect(html).toContain('Проверьте результат WB');
    expect(html).toContain('По выбранным фильтрам заказов нет'); expect(html).toContain('Сохранённые операции');
  });
});
