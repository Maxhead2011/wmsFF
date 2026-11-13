// TEST: live source read inside a read-only transaction; never writes inventory or client data.
const assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client'),XLSX=require('xlsx');
const {receiptKizRows,appendReceiptKizSheet}=require('./dist/modules/warehouse/receipt-kiz-export');
const db=new PrismaClient();
(async()=>{
 const proof=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const rows=await tx.stockMovement.findMany({where:{type:'RECEIPT',quantity:{gt:0},productMarks:{some:{}}},include:{sku:{include:{barcodes:true}},box:true,productMarks:true},orderBy:{createdAt:'desc'},take:10});
  assert(rows.length>0);
  const details=await receiptKizRows(tx,rows);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Количество'],[rows.reduce((s,r)=>s+r.quantity,0)]]),'Приёмка');
  const result=XLSX.read(appendReceiptKizSheet(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),details),{type:'buffer'});
  const read=XLSX.utils.sheet_to_json(result.Sheets['КИЗ по товарам'],{header:1}).slice(1);
  assert.equal(read.length,details.length);details.forEach((r,i)=>assert.equal(read[i][7],r[7]));
  assert.equal(result.Sheets['Приёмка'].A2.v,rows.reduce((s,r)=>s+r.quantity,0));
  return {readOnly:true,receiptRows:rows.length,codes:details.filter(r=>r[7]).length,fullCodesPreserved:true,quantitiesUnchanged:true};
 },{timeout:60000});console.log(JSON.stringify(proof));
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exit(1)});
