// TEST: actual compiled runtime, synthetic storage and a saved official PDF; network disabled.
const assert=require('node:assert/strict'),fs=require('fs');
const {ozonPrintManifest,renderOzonPrintPages}=require('/candidate/modules/client-requests/ozon-print-labels.js');
const {OzonAssemblySupplyService}=require('/candidate/modules/client-requests/ozon-assembly-supply.service.js');
(async()=>{
 const cargo='1022120387365000',link={mapping:{Ростов:'1'},operations:{'1':{state:'SUCCESS',cargoes:[{cargoId:cargo}],labelUrl:'https://cdn1.ozone.ru/test.pdf'}},connectionId:'own'};
 const m=ozonPrintManifest([{name:'Ростов'}],link);assert.equal(m.total,1);
 assert.throws(()=>ozonPrintManifest([{name:'Other'}],link));
 const pdf=fs.readFileSync('/sample.pdf'),rendered=await renderOzonPrintPages(pdf,[cargo]);assert.equal(rendered.pages.length,1);assert.equal(rendered.pages[0].value,cargo);assert.equal(rendered.widthMm,120);assert.equal(rendered.heightMm,75);fs.writeFileSync('/result/rendered.png',Buffer.from(rendered.pages[0].imageBase64,'base64'));
 await assert.rejects(()=>renderOzonPrintPages(pdf,['9999999999999999']));
 const s=new OzonAssemblySupplyService({},{}),user={permissionCodes:['system:admin']};s.load=async()=>({directions:[{name:'Ростов'}],integration:link,request:{clientId:'client'}});s.connection=async()=>({});
 process.env.WMS_PRINT_SERIES_ENABLED='false';await assert.rejects(()=>s.printLabels('r',undefined,user));process.env.WMS_PRINT_SERIES_ENABLED='true';
 assert.equal((await s.printLabels('r',undefined,user)).clientId,'client');await assert.rejects(()=>s.printLabels('r','other',user));
 global.fetch=async()=>new Response(pdf);assert.equal((await s.printLabels('r','1',user)).pages.length,1);
 console.log('8 runtime checks passed');fs.writeFileSync('/result/runtime-api-proof.json',JSON.stringify({passed:8,realPdf:true,syntheticOnly:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
