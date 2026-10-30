import { describe, expect, it } from 'vitest';
import { validateStoreDirectory, classifyStoreStock, storeForConnection } from '../src/modules/clients/client-stores.policy';

// TEST: two seller cabinets may use the same physical SKU; never duplicate its balance.
const stores = [
  { id: 'monlarti', name: 'Монларти', connectionIds: ['m-wb', 'm-ozon'] },
  { id: 'braibo', name: 'Брайбо', connectionIds: ['b-wb', 'b-ozon'] },
];
describe('client stores and shared physical stock', () => {
  it('identifies stores by connection, never mutable account names or brands', () => {
    expect(storeForConnection(stores, 'b-wb')?.id).toBe('braibo');
    expect(storeForConnection(stores, 'unknown')).toBeNull();
  });
  it('rejects a connection attached to two stores and unknown client connections', () => {
    expect(() => validateStoreDirectory([...stores, { id: 'other', name: 'Other', connectionIds: ['b-wb'] }], ['m-wb','m-ozon','b-wb','b-ozon'])).toThrow();
    expect(() => validateStoreDirectory(stores, ['m-wb','m-ozon'])).toThrow();
  });
  it('validates empty, duplicate and reserved store identities', () => {
    for (const invalid of [null, [], [{id:'all',name:'All',connectionIds:[]}], [stores[0],stores[0]]]) {
      expect(() => validateStoreDirectory(invalid, ['m-wb','m-ozon'])).toThrow();
    }
  });
  it('counts 108 shared units once, with aggregate reservations from both stores', () => {
    const result = classifyStoreStock([{id:'s',barcodes:['001','002'],quantity:108,reserved:15}],
      [{barcode:'001',storeId:'monlarti'},{barcode:'002',storeId:'braibo'}], stores, ['s']);
    expect(result.rows[0]).toMatchObject({kind:'SHARED',quantity:108,reserved:15,available:93,storeIds:['braibo','monlarti']});
    expect(result.totals).toEqual({quantity:108,reserved:15,available:93,unresolvedQuantity:0});
  });
  it('requires explicit shared confirmation, preserving quantities and reservations', () => {
    const result = classifyStoreStock([{id:'s',barcodes:['1','2'],quantity:9,reserved:12}],
      [{barcode:'1',storeId:'monlarti'},{barcode:'2',storeId:'braibo'}], stores, []);
    expect(result.rows[0]).toMatchObject({kind:'REVIEW',quantity:9,reserved:12,available:0,deficit:3});
    expect(result.totals.unresolvedQuantity).toBe(9);
  });
  it('does not guess unknown products or strip leading zeros from barcodes', () => {
    const input=Object.freeze({id:'s',barcodes:['001'],quantity:2,reserved:0});
    const result=classifyStoreStock([input],[{barcode:'1',storeId:'monlarti'}],stores,[]);
    expect(result.rows[0].kind).toBe('UNASSIGNED');
    expect(input.quantity).toBe(2);
  });
  it('rejects duplicate SKU rows, invalid quantities and unknown evidence stores', () => {
    const sku={id:'s',barcodes:['1'],quantity:1,reserved:0};
    expect(()=>classifyStoreStock([sku,sku],[],stores,[])).toThrow();
    expect(()=>classifyStoreStock([{...sku,quantity:NaN}],[],stores,[])).toThrow();
    expect(()=>classifyStoreStock([sku],[{barcode:'1',storeId:'other'}],stores,[])).toThrow();
  });
});
