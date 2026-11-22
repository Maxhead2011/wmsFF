// TEST: exercise the published button handler with selected postings and simulated printer.
const fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm');
const s=fs.readFileSync(process.argv[2],'utf8'),a=s.indexOf('async function ga(o,all='),b=s.indexOf('async function ',a+10);
assert(a>=0&&b>a);
async function run(consent,status,mode='print',fail=false){
 const calls=[],noop=()=>{},ctx={f:'client',s:{accessToken:'test'},be:noop,Fe:noop,ke:noop,ie:noop,le:noop,window:{confirm:()=>{calls.push('confirm');return consent}},en:async(t,p)=>{assert.deepEqual(Array.from(p.orders,x=>x.id),['A']);calls.push('assemble');if(fail)throw Error('blocked')},__downloadWbAllLabels:async()=>{calls.push('labels');return {}},openWbRibbonPrint:async()=>calls.push('print')};
 vm.createContext(ctx);vm.runInContext(s.slice(a,b),ctx);
 await ctx.ga([{marketplace:'OZON',supplierStatus:status,id:'A',connectionId:'O'},{marketplace:'OZON',supplierStatus:'awaiting_deliver',id:'B',connectionId:'O'}],mode);
 return calls;
}
(async()=>{assert.deepEqual(await run(false,'awaiting_packaging'),['confirm']);assert.deepEqual(await run(true,'awaiting_packaging'),['confirm','assemble','labels','print']);assert.deepEqual(await run(true,'awaiting_deliver'),['labels','print']);assert.deepEqual(await run(true,'awaiting_packaging','print',true),['confirm','assemble']);console.log('PASS 4 print flows')})().catch(e=>{console.error(e);process.exitCode=1});
