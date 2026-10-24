// FIX: patch current runtime anchors only; preserve shared list/routing behavior and historical source divergence.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('../node_modules/typescript');
const root=process.argv[2];
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unique anchor: '+a);return s.replace(a,b)};
const helper=fs.readFileSync(path.join(__dirname,'../apps/api/src/common/fbs-client-visibility.ts'),'utf8');
fs.writeFileSync(path.join(root,'common/fbs-client-visibility.js'),ts.transpileModule(helper,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
let file=path.join(root,'modules/clients/clients.service.js'),s=fs.readFileSync(file,'utf8');
s=once(s,'    list(user, includeArchived = false, view = {}) {','    async list(user, includeArchived = false, view = {}) {');
s=once(s,'        const warehouseFilter = explicitView', '        const hiddenClients = explicitView ? await require("../../common/fbs-client-visibility").hiddenFbsClientIds(this.prisma,user) : [];\n        const warehouseFilter = explicitView');
s=once(s,'        const where = {\n            ...(clientFilter', '        const where = {\n            ...(hiddenClients.length ? {AND:[{id:{notIn:hiddenClients}}]} : {}),\n            ...(clientFilter');
fs.writeFileSync(file,s);
file=path.join(root,'modules/marketplace-connections/marketplace-connections.service.js');s=fs.readFileSync(file,'utf8');
for(const name of ['listFbsOrders','listFbsOrdersForDisplay']){
 const signature=`    async ${name}(clientId, user, refresh = false, allBranches = false, displayWarehouseId) {`;
 s=once(s,signature,signature+'\n        await require("../../common/fbs-client-visibility").assertFbsClientVisible(this.prisma,user,clientId);');
}
const signature='    async listFbsActiveClients(user, marketplaceValue = undefined, displayOnly = false, allBranches = false, displayWarehouseId) {';
s=once(s,signature,signature+'\n        const hiddenClients = await require("../../common/fbs-client-visibility").hiddenFbsClientIds(this.prisma,user);');
const start=s.indexOf(signature),end=s.indexOf('\n    async ',start+signature.length);assert(end>start);
const part=once(s.slice(start,end),'                clientId: clientFilter,','                clientId: clientFilter,\n                ...(hiddenClients.length ? {AND:[{clientId:{notIn:hiddenClients}}]} : {}),');
s=s.slice(0,start)+part+s.slice(end);fs.writeFileSync(file,s);
