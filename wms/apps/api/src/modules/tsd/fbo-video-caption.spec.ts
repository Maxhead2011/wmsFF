import {afterEach, describe, expect, it, vi} from 'vitest';
import {createFboVideoCaption} from './fbo-video-caption';

// TEST: the accepted physical unit, not a later HTTP plan, owns its video caption.
function fixture(action = 'PACK_PRODUCT') {
  const tx: any = {
    clientRequest: {findUnique: vi.fn().mockResolvedValue({id: 'request-1', clientId: 'client-1', number: 2537,
      items: [{id: 'line-1', skuId: 'sku-1', name: 'Принятый товар', quantity: 5,
        sku: {id: 'sku-1', clientId: 'client-1', name: 'Каталог', article: 'SKU-42'}},
      {id: 'line-2', skuId: 'sku-2', name: 'Следующий товар', quantity: 3,
        sku: {id: 'sku-2', clientId: 'client-1', name: 'Следующий', article: 'WRONG'}}]})},
    fboAssemblyUnit: {count: vi.fn().mockResolvedValue(4)},
    $queryRaw: vi.fn().mockResolvedValue([{pickClosure: null}]),
  };
  const context: any = {requestId: 'request-1', operationId: 'operation-1', action,
    user: {id: 'actor-1', name: 'Анна', deviceId: 'device-id', deviceCode: 'TSD-1'},
    barcode: '4610000000001', kiz: '010461000000000121ABC\x1d91TAIL\x1d',
    unit: {id: 'unit-1', requestId: 'request-1', requestItemId: 'line-1', skuId: 'sku-1',
      state: 'PACKED', packedByUserId: 'actor-1', targetBoxCode: 'FFL-TARGET',
      packedAt: new Date('2026-10-29T10:00:00.123Z')}, boxNumber: 'FFL-TARGET'};
  return {tx, context};
}

afterEach(() => {delete process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED; vi.useRealTimers();});

describe('atomic FBO video captions', () => {
  it('does not read anything or add a payload when the own-WMS flag is off', async () => {
    const {tx, context} = fixture();
    expect(await createFboVideoCaption(tx, context)).toBeUndefined();
    expect(tx.clientRequest.findUnique).not.toHaveBeenCalled();
    expect(tx.fboAssemblyUnit.count).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses the exact accepted unit and authenticated employee/device snapshot', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture();
    context.actor_name = 'Подмена'; context.device_code = 'FAKE';
    const value = await createFboVideoCaption(tx, context);
    expect(value).toMatchObject({schemaVersion: 1, source_id: 'fbo:request-1:operation-1',
      product_name: 'Принятый товар', product_sku: 'SKU-42', actor_name: 'Анна', device_code: 'TSD-1',
      box_number: 'FFL-TARGET', packed_count: 4, total_count: 8, status: 'accepted',
      occurred_at: 1793268000.123, barcode: '4610000000001', kiz: context.kiz,
      evidence: {actor_id: 'actor-1', device_id: 'device-id', device_code: 'TSD-1',
        request_id: 'request-1', operation_id: 'operation-1', action: 'PACK_PRODUCT',
        unit_id: 'unit-1', sku_id: 'sku-1', request_item_id: 'line-1'}});
  });

  it('reads the refreshed partial-pick target after a manual added unit', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture('MANUAL_PACK_UNIT');
    tx.$queryRaw.mockResolvedValue([{pickClosure: {version: 1, quantities: {'line-1': 4, 'line-2': 1}}}]);
    expect(await createFboVideoCaption(tx, context)).toMatchObject({packed_count: 4, total_count: 5});
  });

  it('preserves zero counts and does not invent unknown totals', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture();
    tx.fboAssemblyUnit.count.mockResolvedValue(0);
    tx.$queryRaw.mockResolvedValue([{pickClosure: {version: 2, quantities: {}}}]);
    expect(await createFboVideoCaption(tx, context)).toMatchObject({packed_count: 0, total_count: null, status: 'unresolved'});
  });

  it('rejects a unit from a different request or authenticated actor', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture();
    context.unit.requestId = 'other-request';
    await expect(createFboVideoCaption(tx, context)).rejects.toThrow('unit');
    context.unit.requestId = 'request-1'; context.unit.packedByUserId = 'other-actor';
    await expect(createFboVideoCaption(tx, context)).rejects.toThrow('unit');
  });

  it('does not confuse two request lines sharing a scanned barcode', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture();
    context.unit.requestItemId = 'line-2'; context.unit.skuId = 'sku-2';
    expect(await createFboVideoCaption(tx, context)).toMatchObject({product_name: 'Следующий товар', product_sku: 'WRONG'});
  });

  it('keeps a clear unresolved label if a source name is missing', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture();
    const request = await tx.clientRequest.findUnique();
    request.items[0].name = ''; request.items[0].sku.name = '';
    expect(await createFboVideoCaption(tx, context)).toMatchObject({product_name: 'Товар не определён по журналу', status: 'unresolved'});
  });

  it('does not caption admin recovery or an undo as a TSD packaging scan', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture('UNDO_PACK_UNIT');
    expect(await createFboVideoCaption(tx, context)).toBeUndefined();
    context.action = 'PACK_UNIT'; delete context.user.deviceCode;
    expect(await createFboVideoCaption(tx, context)).toBeUndefined();
    expect(tx.clientRequest.findUnique).not.toHaveBeenCalled();
  });

  it('records a whole-box action without fabricating one product or KIZ', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T10:00:00.123Z'));
    const {tx, context} = fixture('PACK_BOX');
    context.unit = null;
    expect(await createFboVideoCaption(tx, context)).toMatchObject({product_name: 'Упаковка короба',
      barcode: '', kiz: '', product_sku: '', box_number: 'FFL-TARGET', status: 'accepted',
      evidence: {unit_id: null, sku_id: null, request_item_id: null}});
  });

  it('propagates a snapshot read failure so the enclosing stock transaction cannot commit without its audit', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture();
    tx.fboAssemblyUnit.count.mockRejectedValue(new Error('transaction failed'));
    await expect(createFboVideoCaption(tx, context)).rejects.toThrow('transaction failed');
  });

  it('uses the portal text contract while retaining KIZ group separators', async () => {
    process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED = 'true';
    const {tx, context} = fixture();
    const request = await tx.clientRequest.findUnique();
    request.items[0].name = ' Товар\n\tА\x00 ';
    request.items[0].sku.article = 'SKU\t42'; context.user.name = 'Анна\r\nБ';
    expect(await createFboVideoCaption(tx, context)).toMatchObject({product_name: 'ТоварА', product_sku: 'SKU42', actor_name: 'АннаБ', kiz: context.kiz});
    request.items[0].sku = null;
    expect(await createFboVideoCaption(tx, context)).toMatchObject({product_name: 'Товар не определён по журналу', status: 'unresolved'});
  });
});
