import {afterEach,expect,it,vi} from 'vitest';
import {loadShipmentKizReads} from '../src/common/kiz-shipment-reads';
import {prefixEnd,shipmentPrefixIds} from '../src/common/kiz-shipment-prefix';
afterEach(()=>vi.unstubAllEnvs());
// TEST: exact prefixes include punctuation, Unicode and scanner control delimiters.
it.each(['ABC','A%_\\','A\u001d','Яя','A😀','A\u{10ffff}'])('bounds literal prefix %s',p=>{
 const end=prefixEnd(p);for(const suffix of ['','91xyz','%_\\','😀']){
  expect(Buffer.compare(Buffer.from(p+suffix),Buffer.from(p))).toBeGreaterThanOrEqual(0);
  expect(Buffer.compare(Buffer.from(p+suffix),Buffer.from(end))).toBeLessThan(0);
 }
});
it('fails closed on saturation',async()=>{
 await expect(shipmentPrefixIds({$queryRaw:vi.fn(async()=>[{id:'1'},{id:'2'}])},{clientId:'c'},['010460000000000121AAAAAAAAAAAAA'],'marks',2)).rejects.toThrow('Слишком много');
});
it('uses indexed ID hydration instead of hundreds of LIKE predicates in the enabled shipment path',async()=>{
 vi.stubEnv('WMS_KIZ_SHIPMENT_PREFIX_ENABLED','true');const r={id:'r',clientId:'c',warehouseId:'w',status:'IN_WORK'};
 const db:any={$queryRaw:vi.fn(async()=>[]),clientRequest:{findUnique:vi.fn(async()=>r)}};
 for(const m of ['productMark','shippedKizHistory','fboAssemblyUnit','kizReviewCase','fbsTsdAssembly'])db[m]={findMany:vi.fn(async()=>[])};
 await loadShipmentKizReads(db,r,[{kiz:'010460000000000121AAAAAAAAAAAAA'}]);
 expect(db.productMark.findMany.mock.calls[0][0].where).toEqual({id:{in:[]}});
 expect(db.$queryRaw).toHaveBeenCalledTimes(6);
});
