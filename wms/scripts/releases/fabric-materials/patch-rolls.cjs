'use strict';
// FIX: additive support for the selected client's material registry; preserve the published receipt/cut writers.
function once(text,from,to){if(text.split(from).length!==2)throw Error('Fabric runtime anchor changed: '+from);return text.replace(from,to);}
function patchRolls(text){
 text=once(text,"!['SATIN','GABARDINE'].includes(dto.material)","!require('./fabric-catalog').isFabricMaterial(dto.material,state.catalogMaterials||[])");
 text=once(text,"before.catalogColors=(await tx.systemSetting.findUnique({where:{key:'fabric.catalog.v1:'+id}}))?.value?.colors||[];", "const fabricCatalog=(await tx.systemSetting.findUnique({where:{key:'fabric.catalog.v1:'+id}}))?.value||{};\n   before.catalogColors=fabricCatalog.colors||[];before.catalogMaterials=fabricCatalog.materials||[];");
 text=once(text,'groups:[...groups.values()]',"materials:{...require('./fabric-catalog').BASE_FABRIC_MATERIALS,...Object.fromEntries((catalog?.value?.materials||[]).map(m=>[m.id,m.name]))},catalogColors:catalog?.value?.colors||[],groups:[...groups.values()].map(g=>({...g,materialName:require('./fabric-catalog').BASE_FABRIC_MATERIALS[g.material]||catalog?.value?.materials?.find(m=>m.id===g.material)?.name||g.material}))");
 return text;
}
module.exports={patchRolls};
