import {ConflictException} from '@nestjs/common';
export type PlannedBox={key:string;boxCode:string;supplyId:string;direction:string;cargoId?:string;items:Array<{skuId:string;barcode:string;quantity:number;zone:string}>};
export type PackingPlan={version:number;state:string;boxes:PlannedBox[];hash?:string;dispatch?:Record<string,{cargoes:any[];replaceEmpty:boolean;emptyCargoIds:string[]}> };
export const plannedPackingEnabled=()=>process.env.WMS_OZON_PLANNED_PACKING_ENABLED==='true';
const fail=(text:string):never=>{throw new ConflictException(text);};
// FIX: validate the complete plan against both WMS demand and the marketplace snapshot.
export function validatePackingPlan(input:unknown,directions:any[],link:any):PlannedBox[]{
 if(!Array.isArray(input)||!input.length||input.length>1000)fail('Нужен полный план коробов.');
 const boxes=input as PlannedBox[],keys=new Set(),codes=new Set(),expected=new Map<string,number>(),actual=new Map<string,number>();
 for(const d of directions)for(const i of d.items){const key=d.name+'\0'+i.skuId;expected.set(key,(expected.get(key)||0)+i.quantity);}
 for(const b of boxes){
  if(!b||typeof b.key!=='string'||!b.key||keys.has(b.key)||typeof b.boxCode!=='string'||!/^FFL[\w-]{1,96}$/i.test(b.boxCode)||codes.has(b.boxCode.toUpperCase()))fail('Повтор или неверный ШК короба в плане.');
  keys.add(b.key);codes.add(b.boxCode.toUpperCase());
  const d=directions.find(d=>d.name===b.direction),s=link.supplies.find((s:any)=>s.id===b.supplyId);
  if(!d||!s||link.mapping[b.direction]!==b.supplyId||!Array.isArray(b.items)||!b.items.length)fail('Короб не сопоставлен с направлением Ozon.');
  const skus=new Set(),zones=new Set();
  for(const i of b.items){
   const di=d.items.filter((v:any)=>v.skuId===i.skuId&&v.barcode===i.barcode),si=s.items.filter((v:any)=>v.barcode===i.barcode);
   if(di.length!==1||si.length!==1||!si[0].offerId||!Number.isSafeInteger(i.quantity)||i.quantity<=0||skus.has(i.skuId))fail('Неверный SKU или количество в плане.');
   if(!si[0].placementZone||i.zone!==si[0].placementZone)fail('Зона размещения не подтверждена Ozon.');
   zones.add(i.zone);skus.add(i.skuId);const key=b.direction+'\0'+i.skuId;actual.set(key,(actual.get(key)||0)+i.quantity);
  }
  if(zones.size!==1)fail('В одном коробе нельзя смешивать зоны размещения Ozon.');
 }
 if(expected.size!==actual.size||[...expected].some(([k,q])=>actual.get(k)!==q))fail('Количество плана не совпадает с заявкой.');
 for(const d of directions){const s=link.supplies.find((s:any)=>s.id===link.mapping[d.name]);if(!s)fail('Нет поставки Ozon.');const a=new Map<string,number>(),e=new Map<string,number>();for(const i of d.items)e.set(i.barcode,(e.get(i.barcode)||0)+i.quantity);for(const i of s.items)a.set(i.barcode,(a.get(i.barcode)||0)+i.quantity);if(a.size!==e.size||[...e].some(([k,q])=>a.get(k)!==q))fail('Состав Ozon изменился.');}
 return boxes;
}
export function assertPlannedAction(plan:PackingPlan|null|undefined,action:string){
 if(!plan)return;
 if(plan.state!=='ACTIVE')fail('План грузомест ожидает подтверждения Ozon. Сборка приостановлена.');
 if(!['START','PICK_UNIT','FINISH_PICK','PACK_PRODUCT','UNDO_PACK_UNIT','CLOSE_BOX','SORTED','CONFIRM_BOX','FINISH'].includes(action))fail('Для этой заявки обязательна упаковка по плану Ozon.');
}
const packed=(units:any[],code:string,sku?:string)=>units.filter(u=>u.state==='PACKED'&&u.targetBoxCode===code&&(!sku||u.skuId===sku));
export function plannedSuggestions(plan:PackingPlan,units:any[],physicalBoxes:any[]){
 if(plan.state!=='ACTIVE')return [];
 const skus=[...new Set(units.filter(u=>u.state==='PICKED'&&!u.wholeBox).map(u=>u.skuId))];
 return skus.flatMap(sku=>{
  const eligible=plan.boxes.filter(b=>b.items.some(i=>i.skuId===sku&&i.quantity>packed(units,b.boxCode,sku).length)&&!physicalBoxes.some(p=>p.boxCode===b.boxCode&&p.closedAt));
  const b=eligible.find(b=>packed(units,b.boxCode).length>0)??eligible[0];if(!b)return [];
  const i=b.items.find(i=>i.skuId===sku)!;return [{skuId:sku,barcode:i.barcode,direction:b.direction,targetBoxCode:b.boxCode,cargoId:b.cargoId,remaining:i.quantity-packed(units,b.boxCode,sku).length}];
 });
}
export function assertPlannedUnit(plan:PackingPlan,units:any[],boxCode:string,unitId:string){
 assertPlannedAction(plan,'PACK_PRODUCT');const unit=units.find(u=>u.id===unitId&&u.state==='PICKED'&&!u.wholeBox),b=plan.boxes.find(b=>b.boxCode===boxCode);
 if(!unit||!b)return fail('Единица уже упакована или короб отсутствует в плане.');
 const item=b.items.find(i=>i.skuId===unit.skuId);
 if(!item||packed(units,boxCode,unit.skuId).length>=item.quantity)fail('Этот товар не нужен в данном коробе. Сканируйте короб из подсказки.');
}
export function assertPlannedBoxComplete(plan:PackingPlan,units:any[],boxCode:string){
 const b=plan.boxes.find(b=>b.boxCode===boxCode);if(!b)return fail('Короба нет в плане Ozon.');
 const contents=packed(units,boxCode);
 if(contents.some(u=>!b.items.some(i=>i.skuId===u.skuId))||b.items.some(i=>contents.filter(u=>u.skuId===i.skuId).length!==i.quantity))fail('Наполнение короба не совпадает с планом Ozon.');
}
