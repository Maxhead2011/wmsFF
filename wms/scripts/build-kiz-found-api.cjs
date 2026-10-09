// FIX: apply only the reviewed delta to a verified production baseline.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
function build(dir){
 const changed=[];const edit=(name,from,to)=>{const p=path.join(dir,name),s=fs.readFileSync(p,'utf8');if(s.split(from).length!==2)throw Error('Runtime drift: '+name);fs.writeFileSync(p,s.replace(from,to));changed.push(name);};
 for(const name of ['kiz-found-review','kiz-found-review.controller']){
  const source=fs.readFileSync(path.join(__dirname,'../apps/api/src/modules/inventory',name+'.ts'),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
  const relative='modules/inventory/'+name+'.js';fs.writeFileSync(path.join(dir,relative),output);changed.push(relative);
 }
 edit('modules/inventory/inventory.module.js','controllers: [inventory_controller_1.InventoryController,','controllers: [require("./kiz-found-review.controller").KizFoundReviewController, inventory_controller_1.InventoryController,');
 edit('modules/inventory/kiz-location.service.js','return { found: matches.length > 0, ambiguous: matches.length > 1, identity, matches, reviews };',`const foundCandidate=process.env.WMS_KIZ_FOUND_REVIEW_ENABLED==='true'&&matches.length===1&&matches[0].status==='SHIPPING'&&!matches[0].boxCode?{markId:matches[0].id,identity}:undefined;
        return { found: matches.length > 0, ambiguous: matches.length > 1, identity, matches, reviews, foundCandidate };`);
 edit('common/kiz-review-queue.js',"NOT: { taskId: { startsWith: 'UNIT:' } },","NOT: [{ taskId: { startsWith: 'UNIT:' } }, { taskId: { startsWith: 'FOUND:' } }],");
 edit('modules/administration/administration-internal-api.service.js',"prefixes: ['/inventory', '/pallet-sorting', '/inventory/kiz-location'],","prefixes: ['/inventory', '/pallet-sorting', '/inventory/kiz-location', '/inventory/kiz-found'],");
 edit('modules/administration/administration-internal-api.service.js','routeCount: 29, // FIX: include SKU collection','routeCount: 31, // FIX: include SKU collection');
 return [...new Set(changed)];
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(process.argv[2])));
