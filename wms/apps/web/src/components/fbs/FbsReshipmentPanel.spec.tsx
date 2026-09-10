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
    const blocked = { ...candidate, id: 'blocked', eligibleModes: [], blockedReason: 'Получен покупателем' };
    const other = { ...candidate, id: 'other', connectionId: 'other-cabinet' };
    api.check.mockResolvedValue({ candidates: [candidate, blocked, other], runs: [] });
    await model.check(); model.toggle(blocked); model.toggle(candidate); model.toggle(other);
    expect(model.state.selected).toEqual([candidate]);
    expect(renderToStaticMarkup(<FbsReshipmentView model={model} />)).toContain('Получен покупателем');
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
});
