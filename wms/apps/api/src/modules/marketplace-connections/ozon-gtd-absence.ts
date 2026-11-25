import {BadRequestException,ConflictException} from '@nestjs/common';
type Json=(url:string,init:RequestInit)=>Promise<any>;
// FIX: user-authorized own-WMS policy: blank required GTD means absent; never replace an existing number or other exemplar fields.
export async function prepareMissingOzonGtd(posting:any,headers:Record<string,string>,json:Json,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<number[]> {
 const required=new Set((posting.requirements?.products_requiring_gtd??[]).map(String));if(!required.size)return [];
 const signal=AbortSignal.timeout(30000),call=(path:string,body:unknown)=>{signal.throwIfAborted();return json('https://api-seller.ozon.ru'+path,{method:'POST',headers,body:JSON.stringify(body),signal});};
 const current=await call('/v6/fbs/posting/product/exemplar/create-or-get',{posting_number:posting.posting_number});
 if(current.posting_number!==posting.posting_number||!Array.isArray(current.products))throw new BadRequestException('Ozon вернул другой состав экземпляров.');
 const products:any[]=[],changed:{productId:number;exemplarId:number}[]=[];
 for(const id of required){
  const line=posting.products.filter((p:any)=>String(p.sku)===id),matches=current.products.filter((p:any)=>String(p.product_id)===id);
  if(line.length!==1||matches.length!==1||!Array.isArray(matches[0].exemplars)||matches[0].exemplars.length!==line[0].quantity)throw new BadRequestException('Изменился состав экземпляров Ozon. Обновите отправление и повторите подготовку.');
  const product=matches[0],seen=new Set<number>();let dirty=false;
  const exemplars=product.exemplars.map((e:any)=>{if(!Number.isSafeInteger(e.exemplar_id)||e.exemplar_id<=0||seen.has(e.exemplar_id))throw new BadRequestException('Ozon вернул некорректный состав экземпляров.');seen.add(e.exemplar_id);
   if(String(e.gtd??'').trim()||e.is_gtd_absent===true)return {...e};
   dirty=true;changed.push({productId:product.product_id,exemplarId:e.exemplar_id});return {...e,gtd:e.gtd??'',is_gtd_absent:true};
  });
  if(dirty)products.push({product_id:product.product_id,exemplars});
 }
 if(!changed.length)return [];
 await call('/v6/fbs/posting/product/exemplar/set',{posting_number:posting.posting_number,multi_box_qty:current.multi_box_qty,products});
 for(let attempt=0;attempt<8;attempt++){
  if(attempt)await pause(500);const status=await call('/v5/fbs/posting/product/exemplar/status',{posting_number:posting.posting_number});
  const ready=changed.every(c=>{const rows=(status.products??[]).filter((p:any)=>p.product_id===c.productId).flatMap((p:any)=>p.exemplars??[]).filter((e:any)=>e.exemplar_id===c.exemplarId);if(rows.length!==1)return false;const e=rows[0];if(e.gtd_check_status==='failed'||e.gtd_error_codes?.length)throw new BadRequestException(`Ozon отклонил признак отсутствия ГТД для отправления ${posting.posting_number}. Проверьте сведения об экземплярах.`);return e.is_gtd_absent===true&&e.gtd_check_status==='passed';});
  if(ready)return changed.map(c=>c.exemplarId);
 }
 throw new ConflictException(`Ozon ещё проверяет отсутствие ГТД для отправления ${posting.posting_number}. Повторите подготовку через несколько секунд.`);
}
