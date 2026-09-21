import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeDuplicateGroups, calculateActiveDuplicateQuantities, unavailableDuplicateChrtIds, validateActiveDuplicatePairs } from '../src/modules/marketplace-connections/duplicate-stock-runtime';
import { validateDuplicateGroup, type DuplicateGroup } from '../src/modules/marketplace-connections/duplicate-stock-groups';
const group = (): DuplicateGroup => ({ id: 'g', name: 'test', connectionId: 'wb', reserve: { mode: 'COMMON', value: 0 }, shares: [{ targetKey: 'original', label: 'original', percent: 0 }, { targetKey: 'duplicate', label: 'duplicate', percent: 100 }],
  variants: ['M','L'].map(size => ({ sourceSkuId: 's'+size, targets: [{ targetKey: 'original', targetId: 's'+size, confirmed: true, requiresRelabel: false }, { targetKey: 'duplicate', targetId: 't'+size, confirmed: true, requiresRelabel: true }] })), overrides: [] });
const quantity = (skuId: string, available: number, reserved = 0) => ({ skuId, chrtId: 1, available, reserved, sellable: Math.max(0, available-reserved) });
const base = () => new Map([quantity('sM',20,2),quantity('tM',0),quantity('sL',4),quantity('tL',0)].map(q=>[q.skuId,q]));
afterEach(()=>vi.unstubAllEnvs());
describe('active duplicate stock rules',()=>{
  // TEST: every size inherits 0/100 and the common low-stock replacement is applied once.
  it('moves the complete distributable pool to duplicates for every size',()=>{
    const g=validateDuplicateGroup(group());
    const result=calculateActiveDuplicateQuantities([g],base(),{mode:'UNITS',value:3,lowStock:{threshold:5,reserveUnits:1}});
    expect([...result.quantities.values()].map(q=>[q.skuId,q.sellable])).toEqual([['tM',15],['sM',0],['tL',3],['sL',0]]);
  });
  it('does not count demand for an unassigned duplicate as fresh stock',()=>{
    const stocks=base(); stocks.set('tM',quantity('tM',2,7));
    const result=calculateActiveDuplicateQuantities([group()],stocks,{mode:'UNITS',value:3});
    expect(result.quantities.get('tM')?.sellable).toBe(10);
  });
  it('preserves ready target stock as a separate physical pool',()=>{
    const stocks=base();stocks.set('tM',quantity('tM',10,2));
    expect(calculateActiveDuplicateQuantities([group()],stocks,{mode:'UNITS',value:3}).quantities.get('tM')?.sellable).toBe(23);
  });
  it('holds one common reserve even when some units are already relabeled',()=>{
    const stocks=base();stocks.set('sM',quantity('sM',2));stocks.set('tM',quantity('tM',3));
    const result=calculateActiveDuplicateQuantities([group()],stocks,{mode:'UNITS',value:3,lowStock:{threshold:5,reserveUnits:1}});
    expect(result.quantities.get('sM')?.sellable).toBe(0);expect(result.quantities.get('tM')?.sellable).toBe(2);
  });
  it('inherits common percentage changes except for explicit size overrides',()=>{
    const g=group(); g.shares[0].percent=75;g.shares[1].percent=25;
    g.overrides=[{sourceSkuId:'sL',shares:[{targetKey:'original',percent:0},{targetKey:'duplicate',percent:100}]}];
    const result=calculateActiveDuplicateQuantities([g],base(),{mode:'PERCENT',value:10});
    expect(result.quantities.get('sM')?.sellable).toBe(12); expect(result.quantities.get('tM')?.sellable).toBe(4);
    expect(result.quantities.get('sL')?.sellable).toBe(0);expect(result.quantities.get('tL')?.sellable).toBe(3);
  });
  it('stops after a mapping is deleted instead of publishing unsupported capacity',()=>{
    const skus=['sM','tM','sL','tL'].map(id=>({id,article:id[0],clientSku:null,internalSku:id,size:id[1]}));
    expect(()=>validateActiveDuplicatePairs([group()],skus,[])).toThrow('Переклейка');
    expect(validateActiveDuplicatePairs([group()],skus,[{sourceArticle:'s',targetArticle:'t'}]).size).toBe(4);
  });
  it('keeps the sold VM unchanged with publication flag off',async()=>{
    vi.stubEnv('WMS_DUPLICATE_STOCK_PUBLICATION_ENABLED','false');
    const db:any={systemSetting:{findUnique:vi.fn()}};
    expect(await activeDuplicateGroups(db,'client')).toEqual([]);expect(db.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('requires reliable publication and reservation dependencies',async()=>{
    vi.stubEnv('WMS_DUPLICATE_STOCK_PUBLICATION_ENABLED','true');vi.stubEnv('WMS_WB_STOCK_FINE_SETTINGS','false');
    const db:any={systemSetting:{findUnique:vi.fn().mockResolvedValue({value:{version:1,groupIds:['g'],connectionId:'wb',warehouseId:'w'}})}};
    await expect(activeDuplicateGroups(db,'client')).rejects.toThrow('единый учёт');
  });
  it('blocks both cards when WB did not return one amount',()=>{
    const stocks=base();let n=0;stocks.forEach(q=>q.chrtId=++n);
    expect([...unavailableDuplicateChrtIds([group()],stocks,new Set([1]))]).toEqual([1,2]);
  });
});
