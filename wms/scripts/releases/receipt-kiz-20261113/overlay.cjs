// FIX: additive runtime patch; preserve recovered receipts and client summary rendering.
const fs=require('node:fs'),path=require('node:path');
const ts=require('../../../node_modules/typescript');
const root=process.argv[2];
function patch(name,changes){const p=path.join(root,name);let text=fs.readFileSync(p,'utf8');for(const [from,to]of changes){if(text.split(from).length!==2)throw Error('Unexpected runtime anchor: '+from);text=text.replace(from,to)}fs.writeFileSync(p,text)}
const helper=path.join(root,'modules/warehouse/receipt-kiz-export.js');
fs.writeFileSync(helper,ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../../apps/api/src/modules/warehouse/receipt-kiz-export.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText);
patch('modules/warehouse/receipt-channels.controller.js',[
 ['include: { sku: { include: { barcodes: true } } }, orderBy:',"include: { sku: { include: { barcodes: true } }, ...(require('./receipt-kiz-export').receiptKizExportEnabled()?{productMarks:true}:{}) }, orderBy:"],
 ['response.send(Buffer.from(await workbook.xlsx.writeBuffer()));',`const content=Buffer.from(await workbook.xlsx.writeBuffer());
        const kizExport=require('./receipt-kiz-export');
        response.send(!recoveredRows && kizExport.receiptKizExportEnabled()?kizExport.appendReceiptKizSheet(content,await kizExport.receiptKizRows(this.prisma,rows,boxes)):content);`]
]);
patch('modules/turnover/turnover.service.js',[
 ['return buildReceiptDocument(seed.id, movements.length ? movements : [seed], sourceDocument);',`const selected=movements.length?movements:[seed];
        const document=buildReceiptDocument(seed.id,selected,sourceDocument);
        const kizExport=require('../warehouse/receipt-kiz-export');
        if(kizExport.receiptKizExportEnabled() && document.type===client_1.MovementType.RECEIPT)document.receiptKizRows=await kizExport.receiptKizRows(this.prisma,selected);
        return document;`],
 ['const content = (0, turnover_receipt_xlsx_1.buildTurnoverReceiptWorkbook)(document, this.isExternalClient(user) && document.type !== client_1.MovementType.SHIP);',`const original = (0, turnover_receipt_xlsx_1.buildTurnoverReceiptWorkbook)(document, this.isExternalClient(user) && document.type !== client_1.MovementType.SHIP);
        const kizExport=require('../warehouse/receipt-kiz-export');
        const content=kizExport.receiptKizExportEnabled() && document.receiptKizRows?kizExport.appendReceiptKizSheet(original,document.receiptKizRows):original;`],
 ['const content = (0, turnover_receipt_xlsx_1.buildTurnoverReceiptPeriodWorkbook)(document, this.isExternalClient(user));',`const original = (0, turnover_receipt_xlsx_1.buildTurnoverReceiptPeriodWorkbook)(document, this.isExternalClient(user));
        const kizExport=require('../warehouse/receipt-kiz-export');
        const content=kizExport.receiptKizExportEnabled()?kizExport.appendReceiptKizSheet(original,await kizExport.receiptKizRows(this.prisma,movements)):original;`]
]);
console.log('API3 overlay prepared; existing recovery/summary paths retained');
