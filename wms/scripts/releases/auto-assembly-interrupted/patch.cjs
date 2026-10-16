// FIX: exact delta over the verified runtime; never deploy the divergent full local build.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ts=require('../../../node_modules/typescript');
const root=process.argv[2]; if(!root)throw Error('Pass captured API directory');
const preimage=require('./preimage.json');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
for(const [n,hash] of Object.entries(preimage)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex'),hash,'Live module changed: '+n);
function replace(s,a,b){assert.equal(s.split(a).length,2,'Unique anchor: '+a);return s.replace(a,b);}
function method(s,name,edit){const ast=ts.createSourceFile('a.js',s,99,true);let node;function visit(n){if(ts.isMethodDeclaration(n)&&n.name?.getText(ast)===name)node=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(node,name);const start=node.getStart(ast);return s.slice(0,start)+edit(s.slice(start,node.end))+s.slice(node.end);}
const helper='modules/marketplace-connections/auto-assembly-durable.js';
const input=fs.readFileSync(path.resolve(__dirname,'../../../apps/api/src/modules/marketplace-connections/auto-assembly-durable.ts'),'utf8');
fs.writeFileSync(path.join(root,helper),ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
const names=Object.keys(preimage);
let s=read(names[0]);
s=replace(s,'"use strict";','"use strict";\nconst durable = require("../marketplace-connections/auto-assembly-durable");');
s=method(s,'run',v=>{
 v=replace(v,"async run(id, user, slot = 'manual') {","async run(id, user, slot = 'manual') {\n return durable.withRun(this.prisma, id, async () => {");
 v=replace(v,'const startedAt = new Date().toISOString();','durable.setRunKey(key);\n        const startedAt = new Date().toISOString();');
 return v.slice(0,v.lastIndexOf('}'))+'});\n    }';
});
fs.writeFileSync(path.join(root,names[0]),s);
s=read(names[1]);s=replace(s,'"use strict";','"use strict";\nconst durable = require("./auto-assembly-durable");');
s=method(s,'createFbsRequestUnlocked',v=>replace(v,'return created;','if (automatic) await durable.requestCreated(tx, created, clientId, orders, user.id);\n                return created;'));
s=method(s,'runAutoAssembly',v=>replace(v,'await this.assembleFbsOrdersUnlocked({ clientId, orders: newWbOrders.map(order => ({ connectionId, id: order.id })) }, user);',
 'await this.assembleFbsOrdersUnlocked({ clientId, orders: newWbOrders.map(order => ({ connectionId, id: order.id })) }, user);\n                        if (connection.marketplace === "WILDBERRIES") await durable.finishOperation(this.prisma, require("./auto-assembly-recovery").wbRecoveryHttp(connection.apiKey));'));
s=method(s,'moveFbsOrdersToSupply',v=>{
 v=replace(v,'const supplyName = fbsSupplyName(response.client.code, supplyIndex, groupedOrders.size);',
 'const originalName = fbsSupplyName(response.client.code, supplyIndex, groupedOrders.size);\n            const journal = await durable.beginSupply(this.prisma, connection.id, group, originalName);\n            const supplyName = journal?.name ?? originalName;');
 v=replace(v,'let addedOrders = 0;','await durable.stage(this.prisma, journal, { stage: "SUPPLY_CREATED", supplyId });\n            let addedOrders = 0;');
 v=replace(v,'const orderIds = orderChunk.map((order) => numericWbOrderId(order.id));','const orderIds = orderChunk.map((order) => numericWbOrderId(order.id));\n                    await durable.stage(this.prisma, journal, { stage: "ASSIGN_PENDING", supplyId, pendingOrderIds: orderIds.map(String) });');
 v=replace(v,'addedOrders += orderIds.length;','addedOrders += orderIds.length;\n                    await durable.stage(this.prisma, journal, { stage: "VERIFY_PENDING", supplyId });');
 v=replace(v,'if (addedOrders === 0) {','if (addedOrders === 0 && !journal) {');
 v=replace(v,'supplies.push({','await durable.completeSupply(this.prisma, journal, supplyId);\n            supplies.push({');
 return v;
});
fs.writeFileSync(path.join(root,names[1]),s);
s=read(names[2]);s=replace(s,'"use strict";','"use strict";\nconst durable = require("./auto-assembly-durable");');
// The existing order locks, fresh status checks and transaction remain authoritative.
s=s.replaceAll("marketplace: 'WILDBERRIES', syncStatus: 'ACTIVE' } });", "marketplace: 'WILDBERRIES', syncStatus: 'ACTIVE', ...(options.orderIds ? { orderId: { in: options.orderIds } } : {}) } });");
assert.equal((s.match(/options.orderIds \?/g)||[]).length,2);
s=replace(s,'const key = `fbs.autoAssembly.recovery.${connectionId}.${request.id}`;','const key = options.checkpointKey ?? `fbs.autoAssembly.recovery.${connectionId}.${request.id}`;');
s=replace(s,'let supplyId = hints[0];',`let supplyId = hints[0];
        if (options.durable && !supplyId && (options.legacy || checkpoint?.stage === 'CREATE_PENDING' || newIds.length !== liveIds.length)) {
            supplyId = await durable.discoverSupply(http, liveIds, checkpoint?.stage === 'CREATE_PENDING' ? checkpoint.name : undefined);
            if (supplyId && apply) await write({ ...checkpoint, stage: 'SUPPLY_CREATED', supplyId, orderIds: liveIds });
            // Legacy runs had no durable POST intent; absence from a list is not proof POST never happened.
            if (!supplyId && options.legacy) throw new Error('Прерванная старая операция: результат WB неизвестен, требуется разбор.');
        }`);
s=replace(s,"const tasks = await prisma.fbsTsdAssembly.findMany({ where: { requestId: request.id, clientId, connectionId, marketplace: 'WILDBERRIES', orderId: { in: ids } } });",
 `if (options.durable) await durable.validateRoute(prisma, await prisma.clientMarketplaceConnection.findUniqueOrThrow({ where: { id: connectionId } }), currentRequest, fresh, options.routeConfig);
        const tasks = await prisma.fbsTsdAssembly.findMany({ where: { requestId: request.id, clientId, connectionId, marketplace: 'WILDBERRIES', orderId: { in: ids } } });`);
// A partial PATCH is retried only against the same supply with both composition and new-order evidence.
s=replace(s,"if (checkpoint && ['ASSIGN_PENDING', 'VERIFY_PENDING'].includes(checkpoint.stage))",
 "if (!options.durable && checkpoint && ['ASSIGN_PENDING', 'VERIFY_PENDING'].includes(checkpoint.stage))");
s=replace(s,"await write({ stage: 'ASSIGN_PENDING', supplyId: target, orderIds: liveIds });",`if (options.durable) {
                const freshNew = await http('/api/v3/orders/new');
                if (!Array.isArray(freshNew.orders) || missing.some(id => !freshNew.orders.some(row => String(row.id) === id && String(row.warehouseId) === warehouses[0] && !row.supplyId)))
                    throw new Error('WB не подтвердил новые заказы перед повторным добавлением.');
                const rechecked = await readComposition(target);
                if (rechecked.slice().sort().join(',') !== members.slice().sort().join(',')) throw new Error('Состав WB изменяется; повторите сверку позже.');
            }
            await write({ stage: 'ASSIGN_PENDING', supplyId: target, orderIds: liveIds });`);
// Preserve the original uncertain-response barrier; partial results are re-read, never replayed blindly.
s=replace(s,'const candidates = new Map();',`const interrupted = await durable.recoverInterrupted(prisma, connection, actorId, config, recoverAutoAssemblyRequest, wbRecoveryHttp(connection.apiKey));
    const candidates = new Map();`);
s=replace(s,'const results = [];','const results = [...interrupted];');
s=replace(s,"const checkpoint = await prisma.systemSetting.findUnique({ where: { key: `fbs.autoAssembly.recovery.${connectionId}.${request.id}` } });",
 "if (durable.enabled() && await prisma.systemSetting.findUnique({ where: { key: `fbs.autoAssembly.operation.${connectionId}.${request.id}` } })) continue;\n        const checkpoint = await prisma.systemSetting.findUnique({ where: { key: `fbs.autoAssembly.recovery.${connectionId}.${request.id}` } });");
fs.writeFileSync(path.join(root,names[2]),s);
const changed=[...names,helper];
for(const n of changed){const ast=ts.createSourceFile(n,read(n),99,true);assert.equal(ast.parseDiagnostics.length,0,n);}
fs.writeFileSync(path.join(root,'../api-changes.json'),JSON.stringify(changed));
console.log(JSON.stringify({changed}));
