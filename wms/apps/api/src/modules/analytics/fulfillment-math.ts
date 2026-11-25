const DAY=86_400_000;
export type ProductFact={skuId:string;name:string;article:string|null;size:string|null;color:string|null;receivedUnits:number;returnedUnits:number;currentUnits:number;availableUnits:number;allocatedUnits:number;openDemandUnits:number;firstReceiptAt:string|null;ageUnitDays:number;ageKnownUnits:number;shippedAgeUnitDays:number;shippedAgeKnownUnits:number;ledgerUnits:number};
export type DailyFact={skuId:string;date:string;units:number;requests:number};
export type StockDelta={skuId:string;date:string;quantity:number};
export type FulfillmentOptions={dateFrom:string;dateTo:string;leadDays:number;reviewDays:number;safetyDays:number;channel:'FBS'|'FBO';asOf:string};
export function moscowDate(value:string|Date){return new Date(new Date(value).getTime()+3*3_600_000).toISOString().slice(0,10);}
function day(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Некорректная дата.');const d=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(d)||new Date(d).toISOString().slice(0,10)!==value)throw Error('Некорректная дата.');return d;}
export function validateFulfillmentOptions(o:FulfillmentOptions){
 const from=day(o.dateFrom),to=day(o.dateTo);if(to<from||(to-from)/DAY>=366)throw Error('Выберите период от 1 до 366 дней.');
 if(o.dateTo>=moscowDate(o.asOf))throw Error('Для сравнения используются только завершённые дни, по вчера включительно.');
 for(const n of [o.leadDays,o.reviewDays,o.safetyDays])if(!Number.isInteger(n)||n<0||n>90)throw Error('Сроки запаса должны быть целыми числами от 0 до 90 дней.');
 if(o.leadDays+o.reviewDays<1)throw Error('Горизонт пополнения должен быть не меньше дня.');
 if(!['FBS','FBO'].includes(o.channel))throw Error('Выберите ФБС или ФБО.');return {from,to,days:Math.round((to-from)/DAY)+1};
}
const rounded=(n:number)=>Math.round(n*100)/100;
// FIX: one client/warehouse population; ABC denominator never depends on table search or pagination.
export function analyzeFulfillment(products:ProductFact[],daily:DailyFact[],deltas:StockDelta[],o:FulfillmentOptions){
 const period=validateFulfillmentOptions(o);const dates=Array.from({length:period.days},(_,i)=>new Date(period.from+i*DAY).toISOString().slice(0,10));
 const bySku=new Map<string,DailyFact[]>(),deltaBySku=new Map<string,StockDelta[]>();
 for(const row of daily){if(row.date<o.dateFrom||row.date>o.dateTo)continue;if(!Number.isSafeInteger(row.units)||row.units<0)throw Error('Некорректное количество отгрузок.');const a=bySku.get(row.skuId)??[];a.push(row);bySku.set(row.skuId,a);}
 for(const row of deltas){const a=deltaBySku.get(row.skuId)??[];a.push(row);deltaBySku.set(row.skuId,a);}
 const items=products.map(p=>{
  const own=bySku.get(p.skuId)??[],series=new Map<string,number>();for(const r of own)series.set(r.date,(series.get(r.date)??0)+r.units);
  const units=own.reduce((s,r)=>s+r.units,0),requests=own.reduce((s,r)=>s+r.requests,0);
  const first=p.firstReceiptAt?moscowDate(p.firstReceiptAt):null;
  const observationStart=first&&first>o.dateFrom?first:o.dateFrom;
  const observed=dates.filter(d=>d>=observationStart),values=observed.map(d=>series.get(d)??0);
  const mean=values.length?values.reduce((s,n)=>s+n,0)/values.length:0;
  const variance=values.length?values.reduce((s,n)=>s+(n-mean)**2,0)/values.length:0;
  const weekStarts=observed.filter(d=>new Date(d+'T00:00:00Z').getUTCDay()===1&&day(d)+6*DAY<=period.to);
  const weeks=weekStarts.map(d=>Array.from({length:7},(_,i)=>series.get(new Date(day(d)+i*DAY).toISOString().slice(0,10))??0).reduce((s,n)=>s+n,0));
  const wm=weeks.length?weeks.reduce((s,n)=>s+n,0)/weeks.length:0;
  const cv=wm>0?Math.sqrt(weeks.reduce((s,n)=>s+(n-wm)**2,0)/weeks.length)/wm:null;
  const xyz=weeks.length<8?null:wm===0?'N':cv!<=.1?'X':cv!<=.25?'Y':'Z';
  // FIX: reconstruct historical end-of-day stock only when the complete ledger reconciles to current balances.
  const reliable=p.ledgerUnits===p.currentUnits;let stockoutDays:number|null=null;
  if(reliable&&first){let current=p.currentUnits;const grouped=new Map<string,number>();for(const d of deltaBySku.get(p.skuId)??[])grouped.set(d.date,(grouped.get(d.date)??0)+d.quantity);
   for(const [date,quantity] of grouped)if(date>o.dateTo)current-=quantity;
   stockoutDays=0;for(const date of [...dates].reverse()){if(current<0){stockoutDays=null;break;}if(date>=first&&current===0)stockoutDays++;current-=grouped.get(date)??0;}
  }
  const committedAvailable=Math.max(0,p.openDemandUnits-p.allocatedUnits),freeUnits=Math.max(0,p.availableUnits-committedAvailable);
  const horizon=o.leadDays+o.reviewDays,safety=Math.max(mean*o.safetyDays,1.65*Math.sqrt(variance*horizon));
  const enoughHistory=!!first&&observed.length>=28;
  const invalidStock=p.currentUnits<0||p.availableUnits<0||p.allocatedUnits<0||p.ageKnownUnits>p.currentUnits;
  const unobservedDemand=stockoutDays!==null&&stockoutDays>0&&units===0;
  const recommendedUnits=o.channel==='FBS'&&enoughHistory&&!invalidStock&&!unobservedDemand?Math.ceil(mean*horizon+safety):null;
  const warnings:string[]=[];if(!enoughHistory)warnings.push('SHORT_HISTORY');if(!reliable||stockoutDays===null)warnings.push('STOCK_HISTORY_UNRELIABLE');if(stockoutDays)warnings.push('STOCKOUT_DEMAND_UNDERESTIMATED');if(!units)warnings.push('NO_SHIPMENTS');
  if(invalidStock)warnings.push('INVALID_STOCK');
  return {...p,shippedUnits:units,shipmentRequests:requests,shippingDays:own.filter(r=>r.units>0).length,averageDaily:rounded(mean),observationDays:observed.length,fullWeeks:weeks.length,weeklyUnits:weeks,xyz,cvPercent:cv===null?null:rounded(cv*100),abc:'N',sharePercent:0,
   currentStorageDays:p.ageKnownUnits&&!invalidStock?rounded(p.ageUnitDays/p.ageKnownUnits):null,currentAgeCoveragePercent:p.currentUnits>0&&!invalidStock?rounded(100*p.ageKnownUnits/p.currentUnits):null,
   shippedStorageDays:p.shippedAgeKnownUnits?rounded(p.shippedAgeUnitDays/p.shippedAgeKnownUnits):null,shippedAgeCoveragePercent:units?rounded(Math.min(100,100*p.shippedAgeKnownUnits/units)):null,
   freeUnits,daysOfStock:mean>0?rounded(freeUnits/mean):null,recommendedUnits,toReplenish:recommendedUnits===null?null:Math.max(0,recommendedUnits-freeUnits),surplusUnits:recommendedUnits===null?null:Math.max(0,freeUnits-recommendedUnits),stockoutDays,warnings};
 }).sort((a,b)=>b.shippedUnits-a.shippedUnits||a.skuId.localeCompare(b.skuId));
 const total=items.reduce((s,p)=>s+p.shippedUnits,0);let cumulative=0;
 // Equal-volume products stay in the same ABC class rather than depending on a name/ID tie-break.
 for(let i=0;i<items.length;){let end=i;while(end<items.length&&items[end].shippedUnits===items[i].shippedUnits)end++;const abc=!items[i].shippedUnits?'N':cumulative<total*.8?'A':cumulative<total*.95?'B':'C';for(let j=i;j<end;j++){items[j].abc=abc;items[j].sharePercent=total?rounded(items[j].shippedUnits/total*100):0;cumulative+=items[j].shippedUnits;}i=end;}
 return {generatedAt:o.asOf,period:{from:o.dateFrom,to:o.dateTo,days:period.days},settings:{leadDays:o.leadDays,reviewDays:o.reviewDays,safetyDays:o.safetyDays},channel:o.channel,
  summary:{products:items.length,shippedUnits:total,receivedUnits:items.reduce((s,p)=>s+p.receivedUnits,0),currentUnits:items.reduce((s,p)=>s+p.currentUnits,0),freeUnits:items.reduce((s,p)=>s+p.freeUnits,0)},items};
}
