import type {LamodaBatchData,LamodaLabelDraft} from '../../lib/lamodaLabelPrint';
export const batchKeys=['composition','manufacturer','origin','manufacturedAt'] as const;
const titles={composition:'Состав, %',manufacturer:'Изготовитель',origin:'Сделано в — страна и адрес',manufacturedAt:'Дата производства'};
// FIX: sizes with different source data remain separate; editing one model never changes another.
export function groupLamodaDrafts(drafts:LamodaLabelDraft[]){
 const groups=new Map<string,LamodaLabelDraft[]>();for(const d of drafts){const key=JSON.stringify([d.model,...batchKeys.map(k=>d[k])]);groups.set(key,[...(groups.get(key)||[]),d]);}return [...groups.values()];
}
export function LamodaBatchFields({drafts,values,onChange,confirmed,onConfirm,disabled}:{drafts:LamodaLabelDraft[];values:Record<string,LamodaBatchData>;onChange:(v:Record<string,LamodaBatchData>)=>void;confirmed:boolean;onConfirm:(v:boolean)=>void;disabled:boolean}){
 return <fieldset disabled={disabled} className="lamoda-card"><legend>Данные для переклейки Lamoda · 58 × 40 мм</legend>
 <p>Проверьте сведения на стикерах этих костюмов. Сохраняем их для переклейки этой заявки; другие заявки не изменяются.</p>
 {groupLamodaDrafts(drafts).map(group=><section key={group[0].skuId} className="lamoda-card"><h4>{group[0].model}</h4><p>Размеры: {group.map(d=>d.size).join(', ')}</p>
 {batchKeys.map(key=><label key={key} style={{display:'grid',gap:6,marginBottom:12}}>{titles[key]}
 <input maxLength={key==='manufacturedAt'?10:600} placeholder={key==='manufacturedAt'?'ДД.ММ.ГГГГ':titles[key]} value={values[group[0].skuId]?.[key]??''} onChange={e=>{const next={...values};for(const d of group)next[d.skuId]={...next[d.skuId],skuId:d.skuId,[key]:e.target.value};onChange(next);onConfirm(false);}}/></label>)}
 </section>)}
 <label><input type="checkbox" checked={confirmed} onChange={e=>onConfirm(e.target.checked)}/>Данные состава, изготовителя, страны и даты проверены для этой партии</label>
 </fieldset>;
}
