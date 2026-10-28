import { expect, it } from 'vitest';
import { lamodaShipmentId, lamodaShipmentLines, resolveLamodaLines } from '../src/modules/lamoda/lamoda-fbo-policy';
// TEST: user URLs are identifiers only, never network destinations.
it('accepts IDs and rejects foreign hosts, credentials and ambiguous URLs',()=>{
 expect(lamodaShipmentId('MPG197447')).toBe('MPG197447');
 expect(lamodaShipmentId('https://seller.lamoda.tech/shipments/MPG197447')).toBe('MPG197447');
 for(const s of ['https://evil.test/MPG197447','https://seller.lamoda.tech.evil.test/MPG197447','https://u:p@seller.lamoda.tech/MPG197447','../../admin','https://seller.lamoda.tech/shipments']) expect(()=>lamodaShipmentId(s)).toThrow();
});
it('preserves planned quantities, ignores received quantities, rejects malformed items',()=>{
 const rows=[{sku:'sku',ean:'04670245370334',quantityPlanned:2,quantityAccepted:1}];
 expect(lamodaShipmentLines(rows,'BYKOVO')).toEqual([{remoteSku:'sku',barcode:'04670245370334',quantity:2,article:'',destination:'BYKOVO'}]);
 expect(()=>lamodaShipmentLines([{...rows[0],quantityPlanned:-1}],'B')).toThrow();
});
it('groups demand but retains direction quotas and requires exact confirmed identity',()=>{
 const products=[{remoteSku:'lm',barcode:'12345678',externalSku:'a',skuId:'sku',linkState:'CONFIRMED',isPresent:true}];
 const lines=[{barcode:'12345678',article:'',quantity:2,destination:'A'},{barcode:'12345678',article:'',quantity:3,destination:'B'}];
 expect(resolveLamodaLines(lines,products).items[0].quantity).toBe(5);
 expect(resolveLamodaLines(lines,products).directions).toHaveLength(2);
 expect(()=>resolveLamodaLines(lines,[...products,{...products[0],remoteSku:'other'}])).toThrow();
 expect(()=>resolveLamodaLines(lines,[{...products[0],linkState:'REVIEW'}])).toThrow();
});
