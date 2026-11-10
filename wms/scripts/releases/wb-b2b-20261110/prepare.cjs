// FIX: additive overlay only; preserve manual request and durable journal runtime.
const fs=require('fs'),path=require('path'),a=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const root=path.resolve(process.argv[2]),mod='modules/marketplace-connections/';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:9,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
const source=compile(fs.readFileSync('apps/api/src/'+mod+'marketplace-connections.service.ts','utf8'));
let live=fs.readFileSync(root+'/candidate/'+mod+'marketplace-connections.service.js','utf8'),original=live;
const begin=source.indexOf('        // FIX: fresh WB options');a(begin>=0);
// Include all preflight loops through the grouping loop anchor.
const group=source.indexOf('            const groupKey = [',begin),startLoop=source.lastIndexOf('        for (const order of orders)',group);
const fullBlock=source.slice(begin,startLoop);
const anchor='        const groupedOrders = new Map();';a.equal(live.split(anchor).length,2);a(!live.includes('const b2bByOrder'));
live=live.replace(anchor,anchor+'\n'+fullBlock.trimEnd());
const line="                ...(splitB2b ? [b2bByOrder.get(JSON.stringify([order.connectionId, order.id])) ? 'b2b' : 'retail'] : []),";
a(source.includes(line));const cross="                order.crossBorderType ?? 'regular',";a.equal(live.split(cross).length,2);live=live.replace(cross,cross+'\n'+line);
a.equal(live.replace('\n'+fullBlock.trimEnd(),'').replace('\n'+line,''),original,'inverse byte proof');
function put(name,content){const p=root+'/api-payload/'+mod+name;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);fs.writeFileSync(root+'/candidate/'+mod+name,content)}
put('marketplace-connections.service.js',live);
let helper=fs.readFileSync(root+'/candidate/'+mod+'wb-label-orders.js','utf8'),old=helper;
const field="            isB2b: typeof o.options?.isB2B === 'boolean' ? o.options.isB2B : null,";
const helperSource=compile(fs.readFileSync('apps/api/src/'+mod+'wb-label-orders.ts','utf8'));a(helperSource.includes(field));
const mark='            category: cancelled ?';a.equal(helper.split(mark).length,2);helper=helper.replace(mark,field+'\n'+mark);a.equal(helper.replace(field+'\n',''),old);put('wb-label-orders.js',helper);
console.log('PASS API2 additive overlay, inverse bytes, manual request and durable journal retained');
