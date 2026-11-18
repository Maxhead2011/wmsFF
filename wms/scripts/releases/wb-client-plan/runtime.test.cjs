// TEST: execute the actual captured/patched production handlers, without a live database.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'), req=createRequire(path.join(root,'apps/api/package.json'));
const target=path.resolve(process.argv[2]), baseline=process.argv.includes('--baseline');
const service=fs.readFileSync(path.join(target,baseline?'client-requests.service.js':'api/modules/client-requests/client-requests.service.js'),'utf8');
const a=service.indexOf('    async create(dto, user)'),b=service.indexOf('    async update(',a);
let availability={canCommit:false,lines:[{skuId:'sku',barcode:'2002233639031',requestedQuantity:6,availableQuantity:0,reservedQuantity:0,stockQuantity:0,canFulfill:false}]};
class Checker{async previewAvailability(){return availability}}
function loadHelper(){const ctx={exports:{},require:req,process};vm.runInNewContext(fs.readFileSync(path.join(target,'api/modules/client-requests/wb-client-plan.js'),'utf8'),ctx);return ctx.exports;}
const actualRequire=name=>name==='./wb-client-plan'?loadHelper():req(name);
const create=new Function('require','common_1','client_1','ClientRequestsService','clientRequestInclude','normalizeRequiredText','normalizeText',`return ({${service.slice(a,b)}}).create`)(actualRequire,req('@nestjs/common'),req('@prisma/client'),Checker,{},s=>s,s=>s);
async function api(){
 process.env.WMS_FBO_EXCEL_PICK_CHECK_ENABLED='true';
 let writes=0,audits=[];
 const tx={clientRequest:{create:async({data})=>{writes++;return {...data,id:'r',client:{name:'c'},items:data.items.create}}},clientRequestEvent:{create:async()=>{}},auditLog:{create:async d=>audits.push(d)}};
 const self={clientScopes:{requireClientAccess(){}},resolveRequestWarehouse:async()=> 'w',ensureSkuItemsBelongToClient:async()=>{},prisma:{$transaction:async fn=>fn(tx)}};
 const dto={clientId:'c',type:'OUTBOUND',title:'WB',destinationCity:'Moscow',fboExcel:true,fboFormationMode:'WB_CLIENT_PLAN',items:[{skuId:'sku',barcode:'2002233639031',quantity:6}]};
 const result=await create.call(self,dto,{id:'u'});
 assert.equal(result.items[0].quantity,6);assert.equal(result.status,'SUBMITTED');assert.equal(audits[0].data.payload.formationMode,'WB_CLIENT_PLAN');
 await assert.rejects(create.call(self,{...dto,fboFormationMode:undefined},{id:'u'}));assert.equal(writes,1);
 availability={canCommit:false,lines:[{skuId:null,requestedQuantity:6}]};
 await assert.rejects(create.call(self,dto,{id:'u'}));assert.equal(writes,1);
 if(process.env.WB_PLAN_PROOF){
  const groups=JSON.parse(fs.readFileSync(process.env.WB_PLAN_PROOF,'utf8'));
  for(const g of groups){availability=g.preview;const replay=await create.call(self,{...dto,items:g.items},{id:'u'});assert.deepEqual(replay.items.map(({skuId,barcode,quantity})=>({skuId,barcode,quantity})),g.items);console.log(g.label+': preserved '+replay.items.reduce((n,l)=>n+l.quantity,0)+' requested units in offline replay; no production writes.');}
 }
 console.log('Actual API handler: full demand, shortage audit, default rejection, unresolved SKU rejection passed.');
}
async function web(){
 const ts=req('typescript'),s=fs.readFileSync(path.join(target,'web/assets/wb-client-plan-20261118.js'),'utf8');
 const file=ts.createSourceFile('runtime.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const line={skuId:'sku',barcode:'2002233639031',name:'Suit',requestedQuantity:6,availableQuantity:0,reservedQuantity:0,stockQuantity:0,conflicts:[],sourceRows:[2],key:'k',needsRelabel:false};
 let states=['WB',[],'warehouse','NORMAL','','Moscow',{name:'client.xlsx'},0,{title:'WB',wbClientPlanEnabled:true,clientPlanHasParseErrors:false,lines:[line],issues:[],relabelSourceOptions:[]},[line],{},null,'',false,false,false],index=0,calls=[];
 const initialStates=structuredClone(states);
 const context={console,Set,Map,Number,Math,Date,Boolean,Array,Object,String,Promise,JSON};
 function walk(n){if(ts.isIdentifier(n)&&!(n.text in context))context[n.text]=()=>{};ts.forEachChild(n,walk)}walk(file);
 context.o={useMemo:f=>f(),useState:initial=>{const i=index++;return [states[i]===undefined?initial:states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef:()=>({current:0}),useEffect:()=>{}};
 context.e={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};context.ut=[];context.ut=[];context.ot=()=>['client',()=>{}];
 context.hn=async(token,payload)=>{calls.push(payload);return {id:'r',title:'WB',files:[]}};context.Ca=async()=>({id:'file'});
 vm.createContext(context);
 for(const node of file.statements)if(ts.isFunctionDeclaration(node))vm.runInContext(node.getText(file),context);
 const render=()=>{index=0;return context.ni({clients:[{id:'client',name:'Client'}],session:{accessToken:'test',user:{id:'u',activeWarehouseId:'warehouse',permissionCodes:['system:admin']}},onCreated:()=>{}})};
 function nodes(tree){return !tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)]}
 let list=nodes(render());let submit=list.find(n=>n.type==='button'&&n.props.className==='primary-button');assert.equal(submit.props.disabled,true);
 const check=list.find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.disabled===false);assert.ok(check);check.props.onChange({target:{checked:true}});
 list=nodes(render());submit=list.find(n=>n.type==='button'&&n.props.className==='primary-button');assert.equal(Boolean(submit.props.disabled),false);
 submit.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.equal(calls[0].fboFormationMode,'WB_CLIENT_PLAN');assert.equal(calls[0].items[0].quantity,6);assert.equal(calls[0].warehouseId,'warehouse');
 states=structuredClone(initialStates);states[15]=true;states[8].clientPlanHasParseErrors=true;
 assert.equal(Boolean(nodes(render()).find(n=>n.type==='button'&&n.props.className==='primary-button').props.disabled),true);
 states=structuredClone(initialStates);states[8].wbClientPlanEnabled=false;
 assert.equal(nodes(render()).some(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.disabled===false),false);
 // Existing warehouse selection and default submit behavior are preserved in the exact web overlay.
 console.log('Actual web component: shortage blocked by default, explicit choice submits all units and warehouse.');
}
api().then(()=>baseline?null:web()).catch(e=>{console.error(e);process.exitCode=1});
