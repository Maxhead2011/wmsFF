import { ConflictException } from '@nestjs/common';
import * as XLSX from 'xlsx';
type PackedAssembly = {
  phase: string;
  boxes: Array<{boxId:string;boxCode:string;closedAt:Date|null;confirmedAt:Date|null}>;
  units: Array<{id:string;barcode:string;state:string;targetBoxId:string|null;targetBoxCode:string|null}>;
};
// FIX: export immutable physical packing evidence, grouped by barcode and destination box.
export function buildFboWbExport(assembly:PackedAssembly, expectedUnits:number, kind:'products'|'packages'):Buffer {
  if(assembly.phase!=='COMPLETED'||!assembly.boxes.length||assembly.boxes.some(b=>!b.closedAt||!b.confirmedAt))
    throw new ConflictException('Сначала подтвердите все короба поставки.');
  const totals=new Map<string,number>(), perBox=new Map<string,Map<string,number>>();
  const boxes=new Map(assembly.boxes.map(b=>[b.boxId,b.boxCode]));
  if(!assembly.units.length||assembly.units.length!==expectedUnits||new Set(assembly.units.map(u=>u.id)).size!==assembly.units.length)
    throw new ConflictException('Количество упакованных единиц расходится с составом поставки.');
  for(const u of assembly.units){
    if(u.state!=='PACKED'||!u.barcode.trim()||!u.targetBoxId||boxes.get(u.targetBoxId)!==u.targetBoxCode)
      throw new ConflictException('Не подтверждено распределение товара по коробам поставки.');
    totals.set(u.barcode,(totals.get(u.barcode)||0)+1);
    const rows=perBox.get(u.targetBoxCode!)??new Map<string,number>();
    rows.set(u.barcode,(rows.get(u.barcode)||0)+1);perBox.set(u.targetBoxCode!,rows);
  }
  if(perBox.size!==assembly.boxes.length)throw new ConflictException('В поставке обнаружен пустой или повторный короб.');
  const sort=(a:string,b:string)=>a.localeCompare(b,'ru',{numeric:true});
  const rows:Array<Array<string|number>>=kind==='products'
    ? [['Баркод','Количество'],...[...totals].sort(([a],[b])=>sort(a,b))]
    : [['Баркод товара','Кол-во товаров','ШК короба','Срок годности','ШК короба для печати в стороннем сервисе'],
      ...[...perBox].sort(([a],[b])=>sort(a,b)).flatMap(([box,items])=>[...items].sort(([a],[b])=>sort(a,b)).map(([barcode,quantity])=>[barcode,quantity,box,'','']))];
  const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=(kind==='products'?[24,16]:[24,18,28,20,52]).map(wch=>({wch}));
  // FIX: identifiers remain text, including leading zeroes; quantities remain numeric.
  for(const address of Object.keys(sheet))if(!address.startsWith('!')&&typeof sheet[address].v==='string'){sheet[address].t='s';sheet[address].z='@';}
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'Sheet1');
  return XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
