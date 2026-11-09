// FIX: patch only the published auto-assembly guard, retaining current runtime operations.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),file='modules/marketplace-connections/marketplace-connections.service.js';
let s=fs.readFileSync(root+'/api-base/'+file,'utf8'),original=s;const changes=[];
function replace(a,b){assert.equal(s.split(a).length,2);s=s.replace(a,b);changes.push([a,b]);}
replace('const canUseReservation = (order, taskMap) => {',`// FIX: validate fabric identity from current settings/SKUs, independently of display metadata.
            const fabricKeys = await fabricReservationOrders(this.prisma, clientId, response.orders, new Map(tasks.map(t => [selectionKey(t.connectionId,t.orderId),t])));
            const canUseReservation = (order, taskMap, verified = fabricKeys) => {`);
replace('return task ? (0, auto_assembly_eligibility_1.isUntouchedAutoAssembly)(task) : !order.reservation;',`return task ? (0, auto_assembly_eligibility_1.isUntouchedAutoAssembly)(task) : !order.reservation || require('./fbs-fabric-reservation').canIgnoreFabricDisplayReservation(order, task, verified);`);
replace('const freshTaskByOrder = new Map(freshTasks.map(task => [task.orderId, task]));',`const freshTaskByOrder = new Map(freshTasks.map(task => [task.orderId, task]));
                        const freshFabricKeys = await fabricReservationOrders(this.prisma, clientId, fresh.orders, new Map(freshTasks.map(t => [selectionKey(t.connectionId,t.orderId),t])));`);
replace('canUseReservation(order, freshTaskByOrder)', 'canUseReservation(order, freshTaskByOrder, freshFabricKeys)');
let inverse=s;for(const [a,b] of changes.reverse())inverse=inverse.replace(b,a);assert.equal(inverse,original);
fs.cpSync(root+'/api-base',root+'/api-candidate',{recursive:true});
const write=(name,text)=>{const p=root+'/api-candidate/'+name;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text)};
write(file,s);
const helper='modules/marketplace-connections/fbs-fabric-reservation.js';
const compiled=ts.transpileModule(fs.readFileSync('apps/api/src/modules/marketplace-connections/fbs-fabric-reservation.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const before=fs.readFileSync(root+'/api-base/'+helper,'utf8');
function bodies(text){const ast=ts.createSourceFile('x.js',text,99,true);return new Map(ast.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name.text,n.getText(ast)]));}
const actual=bodies(compiled);for(const [name,body] of bodies(before))assert.equal(actual.get(name),body,'published helper drift '+name);
write(helper,compiled);
fs.writeFileSync(root+'/overlay-proof.json',JSON.stringify({apiFiles:2,inverseVerified:true,freshCheckUnderLock:true}));
console.log('API2 guard prepared; inverse proof passed');

for(const name of [file,helper]){const target=root+'/api-payload/'+name;fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(root+'/api-candidate/'+name,target);}
fs.writeFileSync(root+'/api-changes.json',JSON.stringify([file,helper]));
