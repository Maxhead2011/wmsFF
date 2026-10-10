import {ConflictException} from '@nestjs/common';
import ExcelJS from 'exceljs';
import {supplyOrders,type SupplyIntegration} from './ozon-supply-policy';
type Box={id:string;boxCode:string;direction:string|null};
// FIX: the Ozon receipt key is the assembly-box ID, never its position in the response.
export async function cargoMappingWorkbook(boxes:Box[],link:SupplyIntegration|null){
 if(!link||!boxes.length)throw new ConflictException('Сначала дождитесь подтверждения всех грузомест Ozon.');
 const seen=new Set<string>(),keys=new Set<string>(),rows:string[][]=[];
 for(const [supplyId,op] of Object.entries(link.operations)){
  if(op.state!=='SUCCESS'||!op.cargoes?.length)throw new ConflictException('Не все грузоместа подтверждены Ozon.');
  for(const receipt of op.cargoes){
   const box=boxes.find(b=>b.id===receipt.key);
   const owners=supplyOrders(link).filter(o=>o.supplies.some(s=>s.id===supplyId));
   if(!box||!box.boxCode||!box.direction||link.mapping[box.direction]!==supplyId||owners.length!==1||
      !/^\d+$/.test(receipt.cargoId)||keys.has(receipt.key)||seen.has(receipt.cargoId))
    throw new ConflictException('Неоднозначное соответствие коробов и грузомест. Нужна сверка с Ozon.');
   keys.add(receipt.key);seen.add(receipt.cargoId);
   rows.push([box.boxCode,box.direction,receipt.cargoId,supplyId,owners[0].orderNumber]);
  }
 }
 if(keys.size!==boxes.length||boxes.some(b=>!keys.has(b.id)))throw new ConflictException('Не все короба подтверждены Ozon.');
 rows.sort((a,b)=>a[0].localeCompare(b[0],'ru',{numeric:true}));
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Короба и грузоместа');
 sheet.columns=['Короб WMS','Направление','Грузоместо Ozon','Поставка Ozon','Заявка Ozon'].map((header,i)=>({header,width:[32,36,24,24,24][i],style:{numFmt:'@'}}));
 sheet.addRows(rows);sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
 sheet.autoFilter={from:'A1',to:`E${rows.length+1}`};
 return Buffer.from(await book.xlsx.writeBuffer());
}
