// TEST: exact runtime dispatch plus real PDF parsing; no network or warehouse writes.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),root=process.argv[2],out=process.argv[3];
const req=require('module').createRequire(root+'/main.js'),{PDFDocument}=req('pdf-lib');
const text=fs.readFileSync(root+'/modules/marketplace-connections/marketplace-connections.service.js','utf8');
const start=text.indexOf('async function marketplaceBinary('),end=text.indexOf('\nfunction marketplaceErrorMessage(',start);
assert(start>=0&&end>start);
const helper=require((process.argv[4]||root)+'/modules/marketplace-connections/ozon-current-label');
(async()=>{
 const p=await PDFDocument.create();p.addPage();const bytes=await p.save();let old=0,jsonCalls=0;
 const json=async(url,init)=>{jsonCalls++;if(url.endsWith('/create')){assert.deepEqual(JSON.parse(init.body),{posting_numbers:['p']});return{tasks:[{task_type:'small_label',task_id:9}]}}assert.equal(JSON.parse(init.body).task_id,9);return{error:null,status:{code:'completed',postings_count:1,printed_postings_count:1,unprinted_postings:[]},file_url:'https://ir.ozone.ru/s3/a.pdf'}};
 const localProcess={env:{WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED:'true'}};
 const context={process:localProcess,Buffer,marketplaceJson:json,marketplaceFetch:async()=>{old++;return new Response(bytes,{headers:{'content-type':'application/pdf'}})},require:()=>({currentOzonLabel:(init,reader)=>helper.currentOzonLabel(init,reader,async(url,options)=>{assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');return new Response(bytes)})})};
 const call=vm.runInNewContext(text.slice(start,end)+';marketplaceBinary',context);
 const init={body:JSON.stringify({posting_number:['p']}),headers:{'Api-Key':'synthetic'}};
 const result=await call('https://api-seller.ozon.ru/v2/posting/fbs/package-label',init);assert.equal((await PDFDocument.load(result.buffer)).getPageCount(),1);assert.equal(old,0);assert.equal(jsonCalls,2);
 await call('https://supplies-api.wildberries.ru/test',init);assert.equal(old,1);
 localProcess.env.WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED='false';await call('https://api-seller.ozon.ru/v2/posting/fbs/package-label',init);assert.equal(old,2);assert.equal(jsonCalls,2);
 await assert.rejects(helper.currentOzonLabel(init,async()=>({tasks:[]})),/задание/);
 fs.writeFileSync(out+'/runtime-api-proof.json',JSON.stringify({passed:4,actualDispatch:true,pdfParsed:true,soldAndWbPreserved:true,noNetwork:true}));console.log('Runtime4 passed');
})().catch(e=>{console.error(e);process.exitCode=1});
