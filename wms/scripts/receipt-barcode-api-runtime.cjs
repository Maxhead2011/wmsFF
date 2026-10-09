// FIX: transplant only reviewed receipt methods into the verified live runtime.
const fs=require('fs'),path=require('path'),ts=require(require.resolve('typescript',{paths:[require.resolve('../apps/web/node_modules/vite/package.json')]}));
function build(base,compiled,out){
 const changed=[],read=(root,n)=>fs.readFileSync(path.join(root,n),'utf8');
 const write=(n,s)=>{if(!s.startsWith('"use strict";'))s='"use strict";\n'+s;const p=path.join(out,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);changed.push(n);};
 function one(s,a,b){if(s.split(a).length!==2)throw Error('Runtime guard: '+a);return s.replace(a,b);}
 function method(s,name){const sf=ts.createSourceFile('runtime.js',s,99,true),nodes=[];function walk(n){if((ts.isMethodDeclaration(n)&&n.name.getText(sf)===name)||(name==='constructor'&&ts.isConstructorDeclaration(n)))nodes.push(n);ts.forEachChild(n,walk);}walk(sf);if(nodes.length!==1)throw Error('Method guard '+name);const n=nodes[0];return{start:n.getStart(sf),end:n.end,text:n.getText(sf)};}
 const policy='const receipt_barcode_policy_1 = require("./receipt-barcode-policy");\n';
 for(const [file,names] of [['stock/stock-operations.service',['receiveIntoBox']],['tsd/tsd-receipt.service',['openBox','closeBox']],['tsd/tsd-sync.service',['constructor','applyReceiptScan']]]){
  const n='modules/'+file+'.js';let s=read(base,n),c=read(compiled,n);
  for(const name of names){const old=method(s,name),fresh=method(c,name);s=s.slice(0,old.start)+fresh.text+s.slice(old.end);}
  if(file.startsWith('tsd/'))s=policy+s;
  if(file.endsWith('tsd-sync.service')){s='const receipt_barcode_review_service_1 = require("./receipt-barcode-review.service");\n'+s;s=one(s,'__param(7, (0, common_1.Optional)()),','__param(7, (0, common_1.Optional)()),\n    __param(8, (0, common_1.Optional)()),');s=one(s,'tsd_receipt_service_1.TsdReceiptService])','tsd_receipt_service_1.TsdReceiptService, receipt_barcode_review_service_1.ReceiptBarcodeReviewService])');}write(n,s);
 }
 let n='modules/tsd/tsd-review.service.js',s=read(base,n);const m=method(s,'resolveReviewOperation');let patched=one(m.text,"if (dto.action === 'REJECT') {","if ((0, receipt_barcode_policy_1.isBarcodeReview)(operation.payload)) throw new common_1.BadRequestException('Используйте «Администрирование → Проблемы приёмки → Подозрительные ШК».');\n        if (dto.action === 'REJECT') {");write(n,policy+s.slice(0,m.start)+patched+s.slice(m.end));
 n='modules/tsd/tsd.module.js';s=read(base,n);s='const receipt_barcode_review_service_1 = require("./receipt-barcode-review.service");\nconst receipt_barcode_review_controller_1 = require("./receipt-barcode-review.controller");\n'+s;s=one(s,'controllers: [','controllers: [receipt_barcode_review_controller_1.ReceiptBarcodeReviewController, ');s=one(s,'providers: [','providers: [receipt_barcode_review_service_1.ReceiptBarcodeReviewService, ');write(n,s);
 n='modules/administration/administration-internal-api.service.js';s=read(base,n);const c=read(compiled,n),pos=c.indexOf("id: 'receipt-barcode-review'");if(pos<0)throw Error('Registry missing');const start=c.lastIndexOf('{',pos),end=c.indexOf('},',pos)+2,entry=c.slice(start,end),anchor='exports.INTERNAL_API_DEFINITIONS = Object.freeze([';write(n,one(s,anchor,anchor+'\n    '+entry));
 for(const n of ['modules/tsd/receipt-barcode-policy.js','modules/tsd/receipt-barcode-review.service.js','modules/tsd/receipt-barcode-review.controller.js','modules/tsd/receipt-barcode-legacy.js','scripts/stage-suspicious-receipts.js']){if(fs.existsSync(path.join(base,n)))throw Error('Already exists '+n);write(n,read(compiled,n));}return changed;
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2)),null,2));
