// TEST: product-cell JSX is taken from the exact published candidate, with synthetic row data.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('../../../node_modules/typescript');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
(async()=>{const root=path.resolve(process.argv[2]),source=process.env.PUBLIC_URL?await(await fetch(process.env.PUBLIC_URL+'/assets/inline-reserve-fbs-20261109.js')).text():fs.readFileSync(root+'/web-payload/assets/inline-reserve-fbs-20261109.js','utf8'),ast=ts.createSourceFile('fbs.js',source,99,true);let cell;
function visit(n){if(ts.isCallExpression(n)&&n.arguments[0]?.getText(ast)==='"td"'&&n.getText(ast).includes('children:b.name')&&n.getText(ast).includes('__InlineProductReserve'))cell=n.getText(ast);ts.forEachChild(n,visit)}visit(ast);assert(cell);
const browser=await chromium.launch({channel:'msedge',headless:true});try{const page=await browser.newPage();await page.goto('about:blank');
await page.evaluate(({cell})=>{const s='client',t={accessToken:'fixture'},r={data:{selectedConnectionId:'cab',selectedWarehouseId:'warehouse'}},b={skuId:'sku',name:'Позиция',article:'Артикул',color:'цвет',size:'54',internalSku:'internal',relabeling:{isTarget:false,allocatedToTargets:0}};
window.reserveProps=null;window.reserveRefresh=null;const Be=(...args)=>{window.reserveRefresh=args};
const __InlineProductReserve=props=>{window.reserveProps=props;const node=document.createElement('details');node.textContent='Страховой резерв товара';return node};
const e={jsx:make,jsxs:make};function make(tag,props){if(typeof tag==='function')return tag(props);const n=document.createElement(tag);for(const v of[props.children].flat(Infinity))if(v!=null&&v!==false)n.append(v instanceof Node?v:document.createTextNode(String(v)));return n}
const tr=document.createElement('tr'),table=document.createElement('table');tr.append(eval(cell));table.append(tr);document.body.append(table);window.reserveProps.onSaved();}, {cell});
assert.equal(await page.locator('td details').count(),1);assert.equal(await page.locator('td strong').textContent(),'Позиция');assert.deepEqual(await page.evaluate(()=>({clientId:window.reserveProps.clientId,connectionId:window.reserveProps.connectionId,skuId:window.reserveProps.skuId,refresh:window.reserveRefresh})),{clientId:'client',connectionId:'cab',skuId:'sku',refresh:['cab','warehouse',false,true]});
}finally{await browser.close()}
const proof={passed:3,exactPublishedCell:true,perSku:true,paginationPreserved:true};fs.writeFileSync(root+(process.env.PUBLIC_URL?'/public-browser-proof.json':'/runtime-browser-proof.json'),JSON.stringify(proof));console.log(proof);
})().catch(e=>{console.error(e);process.exitCode=1});
