"""Build the deficit release on the captured running files. Keep server-only handlers."""
import sys,json,re
from pathlib import Path
r=Path(sys.argv[1]);w=Path(__file__).resolve().parents[3]; compiled=w/'apps/api/dist'
def once(s,a,b):
 assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
def between(s,a,b):
 i=s.index(a);return s[i:s.index(b,i)]
def write(path,s):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(s.encode())
def get(rel):
 return (r/'api-live'/rel).read_text(encoding='utf8'),(compiled/rel).read_text(encoding='utf8')
def save(rel,s):write(r/'api-payload'/rel,s)
rel='modules/client-requests/client-requests.service.js';s,c=get(rel)
s=once(s,'const consumedBySku =',between(c,'const capacity = dto.fboExcel','const consumedBySku =').replace('(0, fbo_picking_capacity_1.fboPickingCapacity)','require("../tsd/fbo-picking-capacity").fboPickingCapacity')+'const consumedBySku =')
s=once(s,'Math.max(0, stockQuantity - reservedQuantity - consumed)','Math.max(0, Math.min(stockQuantity - reservedQuantity,capacity ? capacity.get(line.skuId) ?? 0 : Infinity) - consumed)')
a=s.index('    async create(dto, user)');b=s.index('return created;',a);part=s[a:b]
part=once(part,'const created = await this.prisma.$transaction(async (tx) => {',between(c,'const guard = (dto.fboExcel','            const request = await tx.clientRequest.create').replace('new ClientRequestsService_1(','new ClientRequestsService('))
part=once(part,'return request;\n        });',between(c,'if (availability)\n','        void this.telegram').strip())
s=s[:a]+part+s[b:];save(rel,s)
for rel,cls in [('modules/client-requests/dto/create-client-request.dto.js','CreateClientRequestDto'),('modules/client-requests/dto/preview-client-request-availability.dto.js','PreviewClientRequestAvailabilityDto')]:
 s,c=get(rel); extra=''
 if cls=='CreateClientRequestDto':extra=between(c,'class FboExcelDecisionDto','class CreateClientRequestDto')
 s=once(s,'class '+cls,extra+'class '+cls)
 for field in (['fboDecisions','fboExcel'] if extra else ['fboExcel']):
  end=c.index('], '+cls+'.prototype, "'+field+'", void 0);')+len('], '+cls+'.prototype, "'+field+'", void 0);')
  s+='\n'+c[c.rindex('__decorate([',0,end):end]
 save(rel,s.replace('class_validator_2.','class_validator_1.'))
rel='modules/tsd/dto/fbo-action.dto.js';s,c=get(rel)
s=once(s,"IsIn)(['RELABEL_UNIT'","IsIn)(['REPORT_MISSING_BOX', 'REPORT_MISSING', 'RELABEL_UNIT'")
end=c.index('], FboActionDto.prototype, "missingQuantity", void 0);')+len('], FboActionDto.prototype, "missingQuantity", void 0);')
save(rel,s+'\n'+c[c.rindex('__decorate([',0,end):end])
rel='modules/tsd/fbo-two-stage.service.js';s,c=get(rel)
s=once(s,'alternativePickingSupported:','missingStockReportingSupported:process.env.WMS_FBO_EXCEL_PICK_CHECK_ENABLED==="true", alternativePickingSupported:')
anchor='if (require("./fbo-unboxed-picking").unboxedFboEnabled() && r.client.storesWithoutBoxes && (dto.action'
s=once(s,anchor,between(c,"if (dto.action === 'REPORT_MISSING_BOX') {",'else if ((0, fbo_unboxed_picking_1.unboxedFboEnabled)').replace('client_1.InventorySessionStatus.', 'require("@prisma/client").InventorySessionStatus.').replace('client_2.InventorySessionStatus.', 'require("@prisma/client").InventorySessionStatus.').replace('fbo_missing_stock_1.', 'require("../../common/stock/fbo-missing-stock").')+'else '+anchor)
k=s.index('dto.action, dto.sourceBoxCode');s=s[:k]+s[k:].replace('dto.action, dto.sourceBoxCode',"dto.action, ...(dto.action==='REPORT_MISSING'?[dto.missingQuantity]:[]), dto.sourceBoxCode",1)
save(rel,s)
h=(r/'web-base/index.html').read_text(encoding='utf8');match=re.search(r'<script type="importmap">(.*?)</script>',h,re.S);m=json.loads(match[1]);old='/assets/compact-places-20261101.js';new='/assets/fbo-deficit-20261101.js'
s=(r/'web-base'/old[1:]).read_text(encoding='utf8')
s=once(s,'if(!ae||!G||j.length===0)','if(!ae||!G||j.length===0||j.length!==te.length)')
s=once(s,'title:y||G.title,comment:`Создано из Excel:', '''title:y||G.title,fboExcel:true,fboDecisions:G.lines.flatMap((l,i)=>{const key=`${l.barcode??l.originalName??l.internalSku??i}-${i}`;const n=j.find(x=>x.key===key)?.requestedQuantity??0;return n===l.requestedQuantity?[]:[{barcode:l.barcode??"",originalQuantity:l.requestedQuantity,finalQuantity:n}]}),comment:`Создано из Excel:''')
s=once(s,'e.jsx("small",{children:li(j)}),','e.jsx("small",{children:li(j)}),j.skuId&&j.requestedQuantity>j.availableQuantity&&e.jsxs("div",{children:[e.jsx("button",{type:"button",disabled:j.availableQuantity<=0,onClick:()=>T(w,j.availableQuantity),children:"Учесть по фактическому остатку"}),e.jsx("button",{type:"button",onClick:()=>We(w),children:"Исключить позицию"})]}),')
write(r/'web-payload'/new[1:],s)
for k,v in list(m['imports'].items()):
 if v==old:m['imports'][k]=new
m['imports'][old]=new;write(r/'web-payload/index.html',once(h,match[1],json.dumps(m,separators=(',',':'))))

rel='modules/inventory/inventory.service.js';s,c=get(rel)
method=between(c,'    async warehouseProblems(user)', '    async listSessions(')
save(rel,once(s,'    async listSessions(',method+'    async listSessions('))
rel='modules/inventory/inventory.controller.js';s,c=get(rel)
s=once(s,'    dashboard(',between(c,'    warehouseProblems(user)', '    dashboard(')+'    dashboard(')
end=c.index('], InventoryController.prototype, "warehouseProblems", null);')+len('], InventoryController.prototype, "warehouseProblems", null);')
s+='\n'+c[c.rindex('__decorate([',0,end):end];save(rel,s)
rel='modules/administration/administration-internal-api.service.js';s,c=get(rel)
save(rel,once(s,'routeCount: 32, // FIX: retain runtime-only routes','routeCount: 33, // FIX: retain runtime-only routes'))
