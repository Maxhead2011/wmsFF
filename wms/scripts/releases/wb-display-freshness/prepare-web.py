from pathlib import Path
import sys
source,index,out=map(Path,sys.argv[1:])
s=source.read_text(encoding='utf-8')
a='const result=await __downloadWbAllLabels(s.accessToken,'
assert s.count(a)==1 and '==="reship"?Fr:en)(s.accessToken' in s
patch='''const pending=o.filter(order=>order.marketplace==="OZON"&&order.supplierStatus==="awaiting_packaging");
if(all==="print"&&pending.length){
 if(!window.confirm("Подтвердить сборку в Ozon и распечатать стикеры?"+String.fromCharCode(10)+pending.map(order=>order.id).join(", ")))return;
 await en(s.accessToken,{clientId:f,orders:pending.map(order=>({connectionId:order.connectionId,id:order.id}))});
}
'''
name='fbs-wb-refresh-ozon-confirm-20261122.js'
(out/'assets').mkdir(parents=True,exist_ok=True)
(out/'assets'/name).write_bytes(s.replace(a,patch+a).encode())
i=index.read_text(encoding='utf-8');old=':"/assets/request-supply-fbs-20261111-stay-ozon.js"'
assert old in i
(out/'index.html').write_bytes(i.replace(old,':"/assets/'+name+'"').encode())
