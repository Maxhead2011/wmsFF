import {analyzeFulfillment,type ProductFact,type DailyFact,type StockDelta,type FulfillmentOptions} from './fulfillment-math';

type CatalogProduct=ProductFact&{category?:string|null;brand?:string|null;marketplacePayload?:unknown};
const norm=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').trim().replace(/\s+/g,' ');
const colors:Record<string,string>={black:'черный',white:'белый',blue:'синий',red:'красный',green:'зеленый',grey:'серый',gray:'серый',ivory:'молочный',беж:'бежевый',бежев:'бежевый',чер:'черный',черн:'черный',корич:'коричневый',син:'синий',голуб:'голубой',зелен:'зеленый',розов:'розовый',бордо:'бордовый',бирюза:'бирюзовый',олива:'оливковый',бел:'белый','свет-бежев':'светло-бежевый',сливочмасло:'сливочный',молочнокоричневый:'молочно-коричневый',голубойкоричневый:'голубой-коричневый',синебордовый:'сине-бордовый'};
const colorNames=['черный','белый','синий','голубой','красный','зеленый','серый','коричневый','молочный','бежевый','бордовый','розовый','оливковый','фиолетовый','желтый','оранжевый','сливочный','темно-зеленый','светло-бежевый'];
function colorToken(s:string){const n=norm(s);return colors[n]??(colorNames.includes(n)?n:null);}
function cleanSize(s:string|null){if(!s||s==='0')return null;const parts=s.split(' / ').map(x=>x.trim());return parts.length===2&&parts[0]===parts[1]?parts[0]:s;}
const garmentKinds:Record<string,string>={брюки:'Брюки',штаны:'Брюки',плат:'Платья',платье:'Платья',кост:'Костюмы',костюм:'Костюмы',джинсы:'Джинсы',блузка:'Блузки',боди:'Блузки-боди',свитшот:'Свитшоты',бюстгальтер:'Бюстгальтеры',жакет:'Жакеты',костсжилетом:'Костюмы с жилетом',курткаджинс:'Куртки джинсовые',курткаджинскулис:'Куртки джинсовые на кулиске',пидж:'Пиджаки',бомб:'Бомберы',жилет:'Жилеты',пал:'Пальто','плат-рубаш':'Платья-рубашки'};

// FIX: deterministic, inspectable catalog rules. Unknown models remain separate; no fuzzy title matching.
export function identifyFulfillmentProduct(p:CatalogProduct){
 const article=norm(p.article??''),name=norm(p.name),warnings:string[]=[];
 let kind=p.category&&!/^\d+$/.test(p.category)?p.category:'Вид не определён';
 let model=article||'sku:'+p.skuId,color=p.color?norm(p.color):null,size=cleanSize(p.size),lengthMetres:number|null=null,source='Артикул';
 if(!article){warnings.push('GROUP_MODEL_UNKNOWN');source='Отдельная карточка';}
 const payload=p.marketplacePayload as {attributes?:{attributes?:{id:number;values?:{value?:string}[]}[]};fabricRollBinding?:{material?:string;colorName?:string;lengthMm?:number}}|null;
 const binding=payload?.fabricRollBinding;
 const fabric=/^(gab|gabardine|satin|sat)_([^_]+)_(\d+(?:[.,]\d+)?)$/i.exec(article);
 if(binding&&['SATIN','GABARDINE'].includes(binding.material??'')&&Number.isFinite(binding.lengthMm)&&binding.lengthMm!>0){
  kind='Ткани';model=binding.material==='SATIN'?'Сатин':'Габардин';color=binding.colorName??color;lengthMetres=binding.lengthMm!/1000;size=lengthMetres+' м';source='Привязка ткани';
 }else if(fabric&&/(ткан|габардин|сатин)/.test(name)){
  kind='Ткани';model=/^gab/.test(fabric[1])?'Габардин':'Сатин';color=colorToken(fabric[2])??fabric[2];lengthMetres=Number(fabric[3].replace(',','.'));size=lengthMetres+' м';source='Артикул ткани';
 }else{
  const slash=article.split('/');
  if(slash.length===4&&garmentKinds[slash[0]]&&slash[1]&&slash[2]&&/^\d{2}(?:\d{2}|-\d{2})?$/.test(slash[3])){
   kind=garmentKinds[slash[0]];model=slash[1];color=colorToken(slash[2])??slash[2];source='Структура артикула (цвет / рисунок)';
   if(!size&&/^\d{2}(?:-\d{2})?$/.test(slash[3])){size=slash[3];warnings.push('GROUP_SIZE_INFERRED');}
  }else if(/^(?:костюм_)?ностальд?жи_/.test(article)){
   kind='Костюмы';model='Ностальжи';color=colorToken(article.split('_').at(-1)!)??color;source='Семейство Ностальжи';
  }else if(/\bfms-x\d+\b/i.test(name)){
   kind='Системы приготовления еды';
   const match=/\bfms-x\d+(?:\s+pro)?\b/i.exec(name)!;model=match[0].toUpperCase();source='Код модели в названии';
   const explicitColor=colorToken(name.split(' ').at(-1)!);
   if(explicitColor){if(color&&!color.split(',').includes(explicitColor))warnings.push('GROUP_COLOR_CONFLICT');color=explicitColor;}
  }else{
   let variantArticle=article;
   const apparelSize=/^(брюки|джинсы|рубашка|костюм)(.+)-(\d{2})$/.exec(article);
   if(apparelSize&&Number(apparelSize[3])>=36&&Number(apparelSize[3])<=74){variantArticle=apparelSize[1]+apparelSize[2];if(!size){size=apparelSize[3];warnings.push('GROUP_SIZE_INFERRED');}model=variantArticle;}
   const compactColor=/^(брюки|джинсы|рубашка|бомбер|кардиган|джинскуртка)(беж|черн|син|бел|олива)(жен|муж)?$/.exec(variantArticle);
   const parts=variantArticle.split('_');const removed=parts.filter(x=>colorToken(x));
   if(compactColor){model=compactColor[1]+(compactColor[3]??'');color=colorToken(compactColor[2]);source='Цвет в артикуле';}
   else if(parts.length>1&&removed.length&&parts.length>removed.length){model=parts.filter(x=>!colorToken(x)).join('_');color=removed.map(x=>colorToken(x)).join(',');source='Цвет в артикуле';}
   else{
    // Only full color words/English tokens may be removed as suffixes; model numbers remain intact.
    const suffix=[...colorNames,...Object.keys(colors).filter(x=>/^[a-z]+$/.test(x))].sort((a,b)=>b.length-a.length).find(x=>article.endsWith(x)&&article.length>x.length);
    if(suffix){model=article.slice(0,-suffix.length).replace(/[ _-]+$/,'');color=colorToken(suffix);source='Цвет в артикуле';}
   }
   const garment=Object.keys(garmentKinds).find(x=>article.startsWith(x+'_')||name.startsWith(x+' '));if(garment)kind=garmentKinds[garment];
   if(/аккумулятор|батарея/.test(name)&&!/заряд|тестер|контейнер|держатель|отсек/.test(name))kind='Аккумуляторы';
  }
 }
 if(kind==='Костюмы спортивные'||kind==='Спортивные костюмы')kind='Костюмы';
 const kindKey=norm(kind),modelKey=JSON.stringify([kindKey,norm(p.brand??''),norm(model)]);
 if(/^\d+$/.test(model)||model.startsWith('sku:'))model=p.name;
 // Unknown color/size stays separate per SKU instead of inventing an interchangeable variant.
 const colorKey=JSON.stringify([modelKey,color?norm(color):'unknown:'+p.skuId]);
 const sizeKey=JSON.stringify([colorKey,size?norm(size):'unknown:'+p.skuId]);
 return {kind,kindKey,model,modelKey,color,colorKey,size,sizeKey,lengthMetres,source,warnings};
}

type AnalysisItem=ReturnType<typeof analyzeFulfillment>['items'][number];
export type GroupItem=Omit<AnalysisItem,'shipmentRequests'>&{shipmentRequests:number|null;level:string;children:string[];skuCount:number;searchText:string;recommendationKnownSkus:number;shippedMetres:number|null;currentMetres:number|null;groupingSources:string[]};
export function groupFulfillment(products:CatalogProduct[],daily:DailyFact[],deltas:StockDelta[],o:FulfillmentOptions,items:AnalysisItem[]){
 const identities=new Map(products.map(p=>[p.skuId,identifyFulfillmentProduct(p)])),itemById=new Map(items.map(p=>[p.skuId,p]));
 const levels=['kind','model','color','size'] as const;
 const output={} as Record<typeof levels[number],GroupItem[]>;
 for(const level of levels){
  const key=(id:string)=>{const identity=identities.get(id)!;return identity[(level+'Key') as 'kindKey'|'modelKey'|'colorKey'|'sizeKey'];};
  const groups=new Map<string,CatalogProduct[]>();for(const p of products){const k=key(p.skuId),list=groups.get(k)??[];list.push(p);groups.set(k,list);}
  const groupedProducts:ProductFact[]=[],groupedDaily:DailyFact[]=[];
  for(const [k,members] of groups){
   const first=members[0],identity=identities.get(first.skuId)!;
   const sum=(field:keyof ProductFact)=>members.reduce((n,p)=>n+Number(p[field]??0),0);
   const dates=members.map(p=>p.firstReceiptAt).filter((x):x is string=>!!x).sort();
   const {category,brand,marketplacePayload,...fact}=first;
   groupedProducts.push({...fact,skuId:k,name:level==='kind'?identity.kind:identity.model,article:null,color:level==='color'||level==='size'?identity.color:null,size:level==='size'?identity.size:null,
    receivedUnits:sum('receivedUnits'),returnedUnits:sum('returnedUnits'),currentUnits:sum('currentUnits'),availableUnits:sum('availableUnits'),allocatedUnits:sum('allocatedUnits'),openDemandUnits:sum('openDemandUnits'),
    ageUnitDays:sum('ageUnitDays'),ageKnownUnits:sum('ageKnownUnits'),shippedAgeUnitDays:sum('shippedAgeUnitDays'),shippedAgeKnownUnits:sum('shippedAgeKnownUnits'),ledgerUnits:sum('ledgerUnits'),firstReceiptAt:dates.length===members.length?dates[0]:null});
  }
  const byDate=new Map<string,{skuId:string;date:string;units:number;ids:Set<string>;unknown:boolean}>();
  for(const d of daily){if(!identities.has(d.skuId))continue;const id=key(d.skuId),k=JSON.stringify([id,d.date]),row=byDate.get(k)??{skuId:id,date:d.date,units:0,ids:new Set<string>(),unknown:false};row.units+=d.units;
   if(d.requestIds)for(const request of d.requestIds)row.ids.add(request);else if(d.requests)row.unknown=true;byDate.set(k,row);}
  const unknownRequestGroups=new Set<string>();
  for(const row of byDate.values()){if(row.unknown)unknownRequestGroups.add(row.skuId);groupedDaily.push({skuId:row.skuId,date:row.date,units:row.units,requests:row.unknown?0:row.ids.size});}
  const base=analyzeFulfillment(groupedProducts,groupedDaily,[],o).items;
  output[level]=base.map(p=>{
   const members=groups.get(p.skuId)!,children=members.map(m=>itemById.get(m.skuId)!),sum=(f:'recommendedUnits'|'toReplenish'|'surplusUnits'|'freeUnits')=>children.reduce((n,x)=>n+(x[f]??0),0);
   const known=children.filter(x=>x.recommendedUnits!==null).length,allKnown=known===members.length;
   let next:typeof levels[number]|undefined=levels[levels.indexOf(level)+1];
   // FIX: non-sized products do not acquire a fake size level; missing values in mixed groups remain explicit.
   if(next==='color'&&!members.some(m=>identities.get(m.skuId)!.color))next='size';
   if(next==='size'&&!members.some(m=>identities.get(m.skuId)!.size))next=undefined;
   const warnings=[...new Set([...children.flatMap(x=>x.warnings),...members.flatMap(m=>identities.get(m.skuId)!.warnings)])];
   if(!allKnown&&known)warnings.push('GROUP_PARTIAL_RECOMMENDATION');
   const metres=(field:'shippedUnits'|'currentUnits')=>members.every(m=>identities.get(m.skuId)!.lengthMetres!==null)?Math.round(members.reduce((n,m)=>n+itemById.get(m.skuId)![field]*identities.get(m.skuId)!.lengthMetres!,0)*100)/100:null;
   const unknownRequests=unknownRequestGroups.has(p.skuId);
   return {...p,shipmentRequests:unknownRequests?null:p.shipmentRequests,level,children:[...new Set(members.map(m=>next?identities.get(m.skuId)![(next+'Key') as 'modelKey'|'colorKey'|'sizeKey']:m.skuId))],skuCount:members.length,
    searchText:members.map(m=>[m.name,m.article,m.size,m.color,identities.get(m.skuId)!.model].join(' ')).join(' '),
    freeUnits:sum('freeUnits'),recommendedUnits:known?sum('recommendedUnits'):null,toReplenish:known?sum('toReplenish'):null,surplusUnits:known?sum('surplusUnits'):null,
    daysOfStock:null,stockoutDays:null,warnings,recommendationKnownSkus:known,shippedMetres:metres('shippedUnits'),currentMetres:metres('currentUnits'),groupingSources:[...new Set(members.map(m=>identities.get(m.skuId)!.source))]};
  });
 }
 return output;
}
