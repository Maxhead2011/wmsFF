'use strict';
const fs = require('node:fs'), path = require('node:path');
function once(text, from, to) { if (text.split(from).length !== 2) throw Error('Runtime changed: ' + from.slice(0, 90)); return text.replace(from, to); }
// FIX: apply only the catalog integration to the caller's verified live modules.
function patchRolls(text) {
 text = once(text, "function fabricSku(sku){", "function fabricSku(sku){\n const b=require('./fabric-catalog').readFabricBinding(sku.marketplacePayload);\n if(b)return {skuId:sku.id,name:sku.name,material:b.material,color:b.color,colorName:b.colorName,meters:b.lengthMm/1000,key:b.material+':'+b.color,requiresKiz:sku.needsChestnyZnak&&!sku.isUnmarked,barcodes:(sku.barcodes||[]).map(x=>x.value)};");
 text = once(text, '!COLORS[dto.color]', "!(COLORS[dto.color]||state.catalogColors?.some(c=>c.id===dto.color&&c.material===dto.material))");
 text = once(text, 'const skus=(await this.db.sku.findMany', "const catalog=await this.db.systemSetting.findUnique({where:{key:'fabric.catalog.v1:'+id}});\n  const colorLabel=(material,color)=>COLORS[color]||catalog?.value?.colors?.find(c=>c.id===color&&c.material===material)?.name||color;\n  const skus=(await this.db.sku.findMany");
 text = once(text, 'colorName:COLORS[r.color]', 'colorName:colorLabel(r.material,r.color)');
 const anchor='const after=applyRollAction(before,dto,sku,warehouseId);';
 if (!text.includes(anchor)) throw Error('Receipt writer changed');
 text = once(text, anchor, "before.catalogColors=(await tx.systemSetting.findUnique({where:{key:'fabric.catalog.v1:'+id}}))?.value?.colors||[];\n   "+anchor);
 return text;
}
function patchAccounting(text) {
 text = once(text, 'select:{id:true,name:true,internalSku:true}', 'select:{id:true,name:true,internalSku:true,marketplacePayload:true}');
 return once(text, 'function identify(s){', "function identify(s){\n const b=require('./fabric-catalog').readFabricBinding(s.marketplacePayload);if(b)return {material:b.material,color:b.color,mm:b.lengthMm};");
}
function patchWarehouseModule(text) {
 text=once(text,'let WarehouseModule = class WarehouseModule', 'const {FabricCatalogController}=require("./fabric-catalog.controller");\nlet WarehouseModule = class WarehouseModule');
 return once(text,'controllers: [', 'controllers: [FabricCatalogController, ');
}
function patchMarketplace(text) {
 const anchor='const data = {...marketplaceSkuData(clientId, product, preserveManualVolume), ...await require("../../common/client-receipt-kiz-policy").clientReceiptMarking(this.prisma,clientId)};';
 return once(text,anchor,anchor+'\n        if(process.env.WMS_FBS_FABRIC_CUT_ENABLED===\'true\')data.marketplacePayload=require("../warehouse/fabric-catalog").preserveFabricBinding(data.marketplacePayload,existing?.marketplacePayload);');
}
function patchReservation(text) { return once(text, 'internalSku: true, needsChestnyZnak:', 'internalSku: true, marketplacePayload: true, needsChestnyZnak:'); }
module.exports={patchRolls,patchAccounting,patchWarehouseModule,patchMarketplace,patchReservation};
if(require.main===module){
 const [base,out]=process.argv.slice(2);if(!base||!out)throw Error('Usage: prepare.cjs verified-api-dir output-api-dir');
 for(const [file,fn]of [['warehouse/fabric-rolls.js',patchRolls],['warehouse/fabric-shipment-accounting.js',patchAccounting],['warehouse/warehouse.module.js',patchWarehouseModule],['marketplace-connections/marketplace-connections.service.js',patchMarketplace],['marketplace-connections/fbs-fabric-reservation.js',patchReservation]]){
  const target=path.join(out,'modules',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,fn(fs.readFileSync(path.join(base,'modules',file),'utf8')));
 }
}
