import {afterEach,expect,it,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {PDFParse} from 'pdf-parse';
import {buildLamodaLabelPdf,validateLamodaLabel} from '../src/modules/print/lamoda-label';
import {readLamodaLabel,lamodaLabelKey} from '../src/modules/print/lamoda-label.service';
import {freezeLamodaBatchLabels,lamodaLabelDrafts} from '../src/modules/print/lamoda-batch-label';
const label={barcode:'4640684268387',article:'MP002XW1PSO1R460',brand:'LOOK(IN)',name:'Костюм зимний',size:'L',color:'бежевый',composition:'Хлопок 80%, полиэстер 20%',importer:'ИП Лукин И.И., РФ, г. Курган, ул. К.Маркса, 139',manufacturer:'ИП Айдарбеков Чынгыз',origin:'Кыргызстан, г. Бишкек',manufacturedAt:'01.10.2026',care:['wash30','tumbleLow','ironLow','noBleach'],eac:true};
afterEach(()=>vi.unstubAllEnvs());
// TEST: each request keeps its own production data even after another batch/profile changes.
it('freezes changed batch fields without changing defaults or previous requests',async()=>{
 const {db,profile}=fixture();const drafts=await lamodaLabelDrafts(db,'c',[{id:'s',name:'Костюм_46'}],[{skuId:'s',barcode:label.barcode,remoteSku:label.article,isPresent:true,linkState:'CONFIRMED'}]);
 const input={skuId:'s',composition:'Хлопок 100%',manufacturer:'Новый изготовитель',origin:'РФ, Москва',manufacturedAt:'20.11.2026'};
 const first=JSON.parse(JSON.stringify(freezeLamodaBatchLabels(drafts,[input],true)));
 const second=freezeLamodaBatchLabels(drafts,[{...input,manufacturedAt:'25.11.2026'}],true)!;
 expect(first[0].fullLabel.manufacturedAt).toBe('20.11.2026');expect(second[0].fullLabel.manufacturedAt).toBe('25.11.2026');expect(profile.records[label.barcode].manufacturedAt).toBe('01.10.2026');
 db.systemSetting.findUnique.mockRejectedValueOnce(Error('profile is not needed for snapshot'));
 expect((await readLamodaLabel(db,'c','s',label.barcode,label.article,first[0].fullLabel))?.composition).toBe('Хлопок 100%');
});
it('requires explicit batch confirmation and exact SKU coverage',()=>{const drafts=[{...label,skuId:'s',model:'Костюм'}];const input={...label,skuId:'s'};expect(()=>freezeLamodaBatchLabels(drafts,[input],false)).toThrow('подтвердите');expect(()=>freezeLamodaBatchLabels(drafts,[{...input,skuId:'foreign'}],true)).toThrow('Нет данных');expect(()=>freezeLamodaBatchLabels(drafts,[input,input],true)).toThrow();});
function fixture(){vi.stubEnv('WMS_LAMODA_ENABLED','true');const profile={enabled:true,clientId:'c',records:{[label.barcode]:label}};const db={systemSetting:{findUnique:vi.fn(async()=>({value:profile}))},lamodaProduct:{findMany:vi.fn(async()=>[{barcode:label.barcode,remoteSku:label.article}])}};return {db,profile};}
// TEST: the former short label lacks these required fields and cannot masquerade as the full template.
it.each(['composition','manufacturer','origin','importer','manufacturedAt','color'])('requires %s',key=>{expect(()=>validateLamodaLabel({...label,[key]:''})).toThrow('заполните');});
it('rejects impossible dates and unknown symbols',()=>{expect(()=>validateLamodaLabel({...label,manufacturedAt:'31.02.2026'})).toThrow();expect(()=>validateLamodaLabel({...label,care:['unknown']})).toThrow();});
it('resolves only exact confirmed client-scoped barcode/article',async()=>{const {db}=fixture();expect(await readLamodaLabel(db,'c','sku',label.barcode,label.article)).toEqual(label);expect(db.systemSetting.findUnique).toHaveBeenCalledWith({where:{key:lamodaLabelKey('c')}});expect(db.lamodaProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{skuId:'sku',isPresent:true,linkState:'CONFIRMED',barcode:label.barcode,account:{clientId:'c',isActive:true}}}));});
it('keeps sold and unconfigured clients unchanged',async()=>{const {db}=fixture();vi.stubEnv('WMS_LAMODA_ENABLED','false');expect(await readLamodaLabel(db,'c','s')).toBeNull();expect(db.systemSetting.findUnique).not.toHaveBeenCalled();vi.stubEnv('WMS_LAMODA_ENABLED','true');db.systemSetting.findUnique.mockResolvedValueOnce({value:{enabled:false} as any});expect(await readLamodaLabel(db,'c','s')).toBeNull();expect(db.lamodaProduct.findMany).not.toHaveBeenCalled();});
it('rejects foreign profiles, stale articles and ambiguous links',async()=>{const {db,profile}=fixture();profile.clientId='other';await expect(readLamodaLabel(db,'c','s')).rejects.toThrow('другому');profile.clientId='c';await expect(readLamodaLabel(db,'c','s',label.barcode,'wrong')).rejects.toThrow('расходятся');db.lamodaProduct.findMany.mockResolvedValueOnce([{barcode:label.barcode,remoteSku:label.article},{barcode:label.barcode,remoteSku:label.article}]);await expect(readLamodaLabel(db,'c','s')).rejects.toThrow('однозначную');});
it('rejects missing full metadata instead of falling back to WB',async()=>{const {db,profile}=fixture();delete (profile.records as any)[label.barcode];await expect(readLamodaLabel(db,'c','s')).rejects.toThrow('нет полных данных');});
it('renders one 58x40 page retaining all business fields',async()=>{const pdf=await buildLamodaLabelPdf(label);const doc=await PDFDocument.load(pdf);expect(doc.getPageCount()).toBe(1);expect(doc.getPage(0).getWidth()).toBeCloseTo(58*72/25.4,2);expect(doc.getPage(0).getHeight()).toBeCloseTo(40*72/25.4,2);const parser=new PDFParse({data:pdf});try {const text=(await parser.getText()).text.replace(/\s+/g,'');for(const key of ['barcode','article','composition','importer','manufacturer','origin','manufacturedAt'] as const)expect(text).toContain(label[key].replace(/\s+/g,''));}finally{await parser.destroy();}},30000);
it('fails visibly instead of truncating oversized text',async()=>{await expect(buildLamodaLabelPdf({...label,composition:'Состав '.repeat(80),origin:'Адрес '.repeat(80),importer:'Импортёр '.repeat(60)})).rejects.toThrow('не помещаются');},30000);
