"""Build the five API changes and two browser modules against verified production files."""
from pathlib import Path
import sys
base,web,out,compiled=map(Path,sys.argv[1:])
def read(p):return p.read_text(encoding='utf-8')
def save(kind,name,s):
 p=out/(kind+'-payload')/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(s.encode())
def once(s,a,b):
 assert s.count(a)==1,a
 return s.replace(a,b,1)
for n in ['tsd/ozon-box-zones','tsd/ozon-packing-suggestion','client-requests/ozon-print-labels']:
 name='modules/'+n+'.js';save('api',name,read(compiled/name))
name='modules/client-requests/ozon-assembly-supply.service.js';s=read(base/name);donor=read(compiled/name)
marker="if (process.env.WMS_OZON_BOX_LABEL_ENABLED";part=donor[donor.index(marker):].split('\n    }')[0]
s=once(s,'return { url: url.href };',part)
s=once(s,'(buffer, direction.cargoIds);','(await (0, ozon_print_labels_1.annotateOzonLabels)(buffer, op.cargoes ?? [], s.request.fboAssembly?.boxes ?? []), direction.cargoIds);')
s=once(s,'quant: Number(i.quant) || 1,','quant: Number(i.quant) || 1, ...(typeof i.placement_zone==="string"?{placementZone:i.placement_zone}:{}),')
save('api',name,s)
name='modules/tsd/fbo-two-stage.service.js';s=read(base/name);flag="process.env.WMS_OZON_BOX_ZONES_ENABLED==='true'"
s=once(s,'ozonPackingSuggestions(ozonShipment.directions,assembly?.boxes??[],units)','ozonPackingSuggestions(ozonShipment.directions,assembly?.boxes??[],units,'+flag+'?{integration:ozonShipment.integration}:undefined)')
guard="if(ozonShipment&&"+flag+")require('./ozon-box-zones').assertOzonBoxZones(ozonShipment.integration,parcel.direction,directions??[],units.filter(u=>u.state==='PACKED'&&u.targetBoxId===target.id).map(u=>u.skuId),unit.skuId);"
for anchor in ["(directions, directionBoxes, units, parcel.direction, [unit]);","(directions,directionBoxes,units,parcel.direction,[unit]);"]:
 s=once(s,anchor,anchor+'\n'+guard)
save('api',name,s)
browser="function ozonWmsLabel(data){if(!data.pdfBase64)return data;const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(data.pdfBase64),c=>c.charCodeAt(0))],{type:'application/pdf'}));setTimeout(()=>URL.revokeObjectURL(url),300000);return {url}}\n"
index=read(web/'index.html')
for old,new in [('wb-client-plan-20261118','ozon-zone-label-requests-266'),('ozon-print-all-workspace-20261108','ozon-zone-label-workspace-266')]:
 s=read(web/(old+'.js'))
 if 'workspace' in old:
  for end in ['",o,{supplyId:s})','",r,{supplyId:l})']:
   anchor='/supply/label-download'+end;s=once(s,anchor,anchor+'.then(ozonWmsLabel)')
 else:
  anchor='/supply/label-download`, { accessToken, method: "POST", body: { supplyId } })';s=once(s,anchor,anchor+'.then(ozonWmsLabel)')
 save('web','assets/'+new+'.js',browser+s)
 anchor=':"/assets/'+old+'.js"';assert anchor in index;index=index.replace(anchor,':"/assets/'+new+'.js"')
save('web','index.html',index)
