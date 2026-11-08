import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { fabricPairedLabels } from './fbs-paired-labels';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';
function fixture(marketplace = 'WILDBERRIES') {
  const sku = { id: 's', name: 'Ткань сатин белая 5 метров', internalSku: 'white_5',
    marketplaceProductId: '12', marketplaceOfferId: 'white_5', barcodes: [{ value: '2000000000053' }] };
  const order = { id: '123', connectionId: 'c', marketplace, supplierStatus: 'confirm',
    product: sku, barcodes: ['2000000000053'], itemCount: 2, article: 'white_5' };
  const db = { systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { enabled: true } }) },
    clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue([{ id: 'c', marketplace, sellerId: 'seller', apiKey: 'test-only' }]) },
    sku: { findMany: vi.fn().mockResolvedValue([sku]) } };
  const resolve = vi.fn().mockResolvedValue({ orders: [order] });
  const json = vi.fn().mockResolvedValue({ stickers: [{ orderId: 123, file: png, barcode: 'official' }] });
  const binary = vi.fn(async (_url: string, _init: RequestInit) => { const p = await PDFDocument.create(); p.addPage([200, 300]); return { buffer: Buffer.from(await p.save()) }; });
  const call = (selections = [{ id: '123', connectionId: 'c' }]) => fabricPairedLabels(db, 'client', selections, resolve, json, binary);
  return { db, sku, order, resolve, json, binary, call };
}
afterEach(() => vi.unstubAllEnvs());
describe('fabric paired downloads', () => {
  // TEST: request 2781 used to return marketplace-only pages.
  it('downloads product barcode then official WB sticker, deduplicating a selection', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture();
    const result = await f.call([{ id: '123', connectionId: 'c' }, { id: '123', connectionId: 'c' }]);
    expect(result?.count).toBe(1); const pdf = await PDFDocument.load(result!.buffer);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(58 * 72 / 25.4, 2);
    expect(f.binary).not.toHaveBeenCalled();
    expect(f.json.mock.calls.every(([url]) => String(url).includes('/stickers?'))).toBe(true);
  });
  it('preserves sold/disabled-client behaviour without marketplace requests', async () => {
    const f = fixture(); vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false'); expect(await f.call()).toBeNull();
    expect(f.db.systemSetting.findUnique).not.toHaveBeenCalled();
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); f.db.systemSetting.findUnique.mockResolvedValue(null);
    expect(await f.call()).toBeNull(); expect(f.json).not.toHaveBeenCalled(); expect(f.resolve).not.toHaveBeenCalled();
  });
  it('refuses an unavailable account before downloading anything', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture(); f.db.clientMarketplaceConnection.findMany.mockResolvedValue([]);
    await expect(f.call()).rejects.toThrow('Подключение'); expect(f.json).not.toHaveBeenCalled();
  });
  it('does not silently return an incomplete pair when product barcode is missing', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture(); f.order.barcodes = [];
    await expect(f.call()).rejects.toThrow('ШК'); expect(f.json).not.toHaveBeenCalled();
  });
  it('rejects a missing official WB sticker instead of returning a product label alone', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture(); f.json.mockResolvedValue({ stickers: [] });
    await expect(f.call()).rejects.toThrow('123');
  });
  it('does not treat catalogue product IDs as barcodes', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture(); f.order.barcodes = ['12'];
    await expect(f.call()).rejects.toThrow('ШК');
  });
  it('pairs each Ozon posting separately, retaining the original marketplace page size', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture('OZON');
    f.json.mockResolvedValue({ result: { posting_number: '123', status: 'awaiting_deliver',
      products: [{ sku: 12, offer_id: 'white_5', quantity: 2 }] } });
    const result = await f.call(); const pdf = await PDFDocument.load(result!.buffer);
    expect(pdf.getPageCount()).toBe(2); expect(pdf.getPage(1).getSize()).toEqual({ width: 200, height: 300 });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(JSON.parse(String(f.binary.mock.calls[0][1].body))).toEqual({ posting_number: ['123'] });
  });
  it('does not transfer Ozon to assembly or debit fabric merely to obtain a label', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture('OZON');
    f.json.mockResolvedValue({ result: { posting_number: '123', status: 'awaiting_packaging' } });
    await expect(f.call()).rejects.toThrow('Ozon'); expect(f.binary).not.toHaveBeenCalled(); expect(f.json).toHaveBeenCalledTimes(1);
  });
  it('includes the blue cut in 2781 even when the roll-consumption parser does not recognise blue', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture();
    f.sku.internalSku = 'blue_30-0'; f.sku.name = 'Ткань атлас сатин синий 30 метров';
    expect((await PDFDocument.load((await f.call())!.buffer)).getPageCount()).toBe(2);
  });
  it('keeps orders with the same number in different accounts separate', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture();
    f.db.clientMarketplaceConnection.findMany.mockResolvedValue([
      { id:'c', marketplace:'WILDBERRIES', sellerId:'seller', apiKey:'a' },
      { id:'d', marketplace:'WILDBERRIES', sellerId:'seller', apiKey:'b' },
    ]);
    f.resolve.mockResolvedValue({ orders: [f.order, { ...f.order, connectionId:'d' }] });
    const result = await f.call([{id:'123',connectionId:'c'},{id:'123',connectionId:'d'}]);
    expect(result?.count).toBe(2); expect((await PDFDocument.load(result!.buffer)).getPageCount()).toBe(4);
    expect(f.json).toHaveBeenCalledTimes(2);
  });
  it('includes every Ozon product line with its own quantity before the official label', async () => {
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'true'); const f = fixture('OZON');
    f.db.sku.findMany.mockResolvedValue([f.sku, { ...f.sku, id:'s2', internalSku:'red_1', marketplaceProductId:'13', marketplaceOfferId:'red_1' }]);
    f.json.mockResolvedValue({ result: { posting_number:'123', status:'awaiting_deliver', products:[
      {sku:12,offer_id:'white_5',quantity:2}, {sku:13,offer_id:'red_1',quantity:3},
    ] } });
    expect((await PDFDocument.load((await f.call())!.buffer)).getPageCount()).toBe(3);
  });
});

describe('unmarked goods without fabric accounting', () => {
  it('resolves an existing WB-origin warehouse card using the exact Ozon product barcode', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','true');const f=fixture('OZON');
    f.sku.marketplaceProductId='wb-only';f.sku.marketplaceOfferId='2000000000053';
    f.json.mockResolvedValueOnce({result:{posting_number:'123',status:'awaiting_deliver',products:[{sku:12,offer_id:'white_5',quantity:2}]}})
      .mockResolvedValueOnce({items:[{offer_id:'white_5',sources:[{sku:12}],barcodes:['2000000000053']}]});
    expect((await PDFDocument.load((await f.call())!.buffer)).getPageCount()).toBe(2);
    expect(JSON.parse(String(f.json.mock.calls[1][1].body))).toEqual({sku:['12']});
  });
  it('does not use a barcode returned for a different Ozon offer or SKU', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','true');const f=fixture('OZON');
    f.sku.marketplaceProductId='wb-only';f.sku.marketplaceOfferId='2000000000053';
    f.json.mockResolvedValueOnce({result:{posting_number:'123',status:'awaiting_deliver',products:[{sku:12,offer_id:'white_5',quantity:2}]}})
      .mockResolvedValueOnce({items:[{offer_id:'other',sources:[{sku:12}],barcodes:['2000000000053']},{offer_id:'white_5',sources:[{sku:13}],barcodes:['2000000000053']}]});
    await expect(f.call()).rejects.toThrow('соответствие');expect(f.binary).not.toHaveBeenCalled();
  });
  // TEST: ordinary clients such as Balandin must not need fabric enablement.
  it('pairs WB for an ordinary client even with fabric deployment and client settings disabled', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true');
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false'); const f = fixture();
    f.db.systemSetting.findUnique.mockResolvedValue(null);
    const result = await f.call();
    expect((await PDFDocument.load(result!.buffer)).getPageCount()).toBe(2);
    expect(f.db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('pairs ordinary Ozon goods without opting the client into fabric', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true');
    vi.stubEnv('WMS_FBS_FABRIC_CUT_ENABLED', 'false'); const f = fixture('OZON');
    f.db.systemSetting.findUnique.mockResolvedValue(null);
    f.json.mockResolvedValue({ result: { posting_number:'123',status:'awaiting_deliver',products:[{sku:12,offer_id:'white_5',quantity:2}] } });
    expect((await PDFDocument.load((await f.call())!.buffer)).getPageCount()).toBe(2);
    expect(f.db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('leaves WB marked-only selections on the official-label path', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true'); const f = fixture();
    Object.assign(f.sku, { needsChestnyZnak:true, isUnmarked:false });
    expect(await f.call()).toBeNull(); expect(f.json).not.toHaveBeenCalled();
  });
  it('respects WB sgtin metadata even when the local card says unmarked', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true'); const f = fixture();
    Object.assign(f.sku, { needsChestnyZnak:false, isUnmarked:true });
    Object.assign(f.order, { requiredMeta:['SGTIN'] });
    expect(await f.call()).toBeNull(); expect(f.json).not.toHaveBeenCalled();
  });
  it('keeps an official WB sticker for a marked order in a mixed selection', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true'); const f = fixture();
    const marked={...f.sku,id:'marked',needsChestnyZnak:true,isUnmarked:false,barcodes:[]};
    f.db.sku.findMany.mockResolvedValue([f.sku,marked]);
    f.resolve.mockResolvedValue({orders:[f.order,{...f.order,id:'124',product:marked,barcodes:[]}]});
    f.json.mockResolvedValue({stickers:[{orderId:123,file:png,barcode:'one'},{orderId:124,file:png,barcode:'two'}]});
    expect((await PDFDocument.load((await f.call([{id:'123',connectionId:'c'},{id:'124',connectionId:'c'}]))!.buffer)).getPageCount()).toBe(3);
  });
  it('prints only the unmarked product in a mixed Ozon posting, preserving its official label', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true'); const f=fixture('OZON');
    f.db.sku.findMany.mockResolvedValue([f.sku,{...f.sku,id:'marked',marketplaceProductId:'13',marketplaceOfferId:'marked',needsChestnyZnak:true,isUnmarked:false,barcodes:[]}]);
    f.json.mockResolvedValue({result:{posting_number:'123',status:'awaiting_deliver',products:[{sku:12,offer_id:'white_5',quantity:2},{sku:13,offer_id:'marked',quantity:1}]}});
    expect((await PDFDocument.load((await f.call())!.buffer)).getPageCount()).toBe(2);
  });
  it('leaves an Ozon marked-only posting on the official-label path without requiring a product barcode', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true');const f=fixture('OZON');
    Object.assign(f.sku,{needsChestnyZnak:true,isUnmarked:false,barcodes:[]});
    f.json.mockResolvedValue({result:{posting_number:'123',status:'awaiting_deliver',products:[{sku:12,offer_id:'white_5',quantity:2}]}});
    expect(await f.call()).toBeNull();expect(f.binary).not.toHaveBeenCalled();
  });
  it('respects mandatory Ozon marking even when the catalogue says unmarked', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true');const f=fixture('OZON');
    f.json.mockResolvedValue({result:{posting_number:'123',status:'awaiting_deliver',requirements:{products_requiring_mandatory_mark:[12]},products:[{sku:12,offer_id:'white_5',quantity:2}]}});
    expect(await f.call()).toBeNull();expect(f.binary).not.toHaveBeenCalled();
  });
});
