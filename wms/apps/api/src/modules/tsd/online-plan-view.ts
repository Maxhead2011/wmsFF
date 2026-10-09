// FIX: opt-in browser projection; legacy terminals and write responses stay complete.
export function onlinePlanView<T extends object>(plan:T,view?:string,offset?:string):T {
 if(process.env.WMS_MENU_READS_ENABLED!=='true'||!['summary','history'].includes(view??''))return plan;
 const value=plan as T & {fbo?:object;pickedUnits?:unknown[]};
 if(value.fbo)return {...plan,fbo:onlinePlanView(value.fbo,view,offset)};
 if(!Array.isArray(value.pickedUnits))return plan;
 const units=value.pickedUnits;
 if(view==='summary')return {...plan,pickedUnits:[],pickedUnitsCount:units.length};
 const parsed=Number(offset??0),start=Number.isSafeInteger(parsed)&&parsed>=0?parsed:0;
 return {pickedUnits:units.slice(start,start+100),total:units.length,offset:start} as unknown as T;
}
