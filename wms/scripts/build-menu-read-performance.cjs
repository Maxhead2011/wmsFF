// FIX: exact, guarded overlay; never replace production with the old full TS build.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const root=process.argv[2];if(!root)throw Error('candidate directory required');
for(const name of ['stock/menu-read-catalog','warehouse/receipt-report-evidence']){
 const source=path.resolve(__dirname,'../apps/api/src/modules/'+name+'.ts');
 fs.writeFileSync(path.join(root,'modules/'+name+'.js'),ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
}
function patch(name,pairs){const file=path.join(root,'modules/'+name+'.js');let s=fs.readFileSync(file,'utf8');for(const [a,b] of pairs){if(s.split(a).length!==2)throw Error('guard: '+name+' '+a);s=s.replace(a,b);}fs.writeFileSync(file,s);}
patch('stock/pick-instruction.service',[
 ['return balances.sort(compareInstructionBalances);','return balances.map(b=>({...b,sku:{marketplacePayload:null,...b.sku}})).sort(compareInstructionBalances);'],
 ['...stockBalanceArgs,\r\n            orderBy:', '...stockBalanceArgs,\r\n            ...(process.env.WMS_MENU_READS_ENABLED === "true" ? {include:{...stockBalanceArgs.include,sku:{...stockBalanceArgs.include.sku,omit:{marketplacePayload:true}}}} : {}),\r\n            orderBy:'],
 ['this.prisma.sku.findMany({\r\n                where: { clientId },\r\n                ...skuCatalogArgs,','process.env.WMS_MENU_READS_ENABLED === "true" ? require("./menu-read-catalog").leanInstructionCatalog(this.prisma, clientId) : this.prisma.sku.findMany({\r\n                where: { clientId },\r\n                ...skuCatalogArgs,']
]);
patch('tsd/tsd-assembly.service', [['if (user.deviceId && this.fbo &&','if ((user.deviceId || process.env.WMS_MENU_READS_ENABLED === "true") && this.fbo &&']]);
{
 const file=path.join(root,'modules/tsd/tsd-assembly.service.js');let s=fs.readFileSync(file,'utf8');
 const a=s.indexOf('        const exists =',s.indexOf('    async getRequestPlan(')),b=s.indexOf('        const document = await this.getCachedInstruction',a);
 if(a<0||b<a)throw Error('read guard extraction failed');const block=s.slice(a,b);
 s=s.slice(0,a)+'        const exists = await this.requirePlanRead(requestId,user);\n'+s.slice(b);
 s=s.replace('    async getRequestPlan(', '    async requirePlanRead(requestId,user) {\n'+block+'        return exists;\n    }\n    async getRequestPlan(');
 s=s.replace('const fbo = await this.fbo.plan(requestId, user);','if (!user.deviceId) await this.requirePlanRead(requestId,user);\n            const fbo = await this.fbo.plan(requestId, user);');
 fs.writeFileSync(file,s);
}
patch('warehouse/receipt-channel-policy',[
 ['async function receiptDocuments(db, clientId, warehouseId, since, boxIds)', 'async function receiptDocuments(db, clientId, warehouseId, since, boxIds, report = false)'],
 ['const movements = await db.stockMovement.findMany({ where: { clientId, warehouseId, type: \'RECEIPT\',', 'const evidence=report&&!boxIds&&process.env.WMS_MENU_READS_ENABLED===\'true\'?await require("./receipt-report-evidence").receiptReportEvidence(db,clientId,warehouseId):undefined;\n    const movements = evidence?.movements??await db.stockMovement.findMany({ where: { clientId, warehouseId, type: \'RECEIPT\','],
 ["const openings = await db.tsdOperation.findMany({ where: { operationType: { in: ['receipt_open_box', 'receipt_box_status'] }", "const openings = evidence?.openings??await db.tsdOperation.findMany({ where: { operationType: { in: ['receipt_open_box', 'receipt_box_status'] }"]
]);
patch('warehouse/receipt-channels.controller',[
 ['async list(user, clientId, from, to)', 'async list(user, clientId, from, to, summary, receiptId)'],
 ['docs.filter(d => d.current || new Date(d.date) <= until)', 'docs.filter(d => (!receiptId||d.id===receiptId)&&(d.current || new Date(d.date) <= until))'],
 ['map(d => ({ ...d, approvalEnabled:', 'map(d => ({ ...d, ...(summary==="1"&&process.env.WMS_MENU_READS_ENABLED==="true"?{boxCount:d.boxes.length,boxes:[]}:{}), approvalEnabled:'],
 ["__param(3, (0, common_1.Query)('to')),",'__param(3, (0, common_1.Query)("to")),\n    __param(4, (0, common_1.Query)("summary")),\n    __param(5, (0, common_1.Query)("receiptId")),'],
 ['receiptDocuments)(this.prisma, clientId, w, since)', 'receiptDocuments)(this.prisma, clientId, w, since, undefined, true)'],
 ['receiptDocuments)(this.prisma, clientId, warehouseId)', 'receiptDocuments)(this.prisma, clientId, warehouseId, undefined, undefined, true)']
]);
