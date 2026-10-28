# FIX: only change the current SKU printing function, preserving all three layouts/printer paths.
from pathlib import Path
import sys
source=Path(sys.argv[1]);target=Path(sys.argv[2]);s=source.read_text(encoding='utf-8')
start=s.index('function rF({session:t,initialSearch:n=""})')
end=s.index('function iF(',start)
chunk=s[start:end]
for old,new in [
 ('{clientId:f,search:n.trim()}','{clientId:f,search:n.trim(),forPrint:true}'),
 ('{clientId:f,search:v.trim()}','{clientId:f,search:v.trim(),forPrint:true}'),
 ('se.isPrimary?" · основной":""','se.source==="LAMODA"?" · Lamoda":se.isPrimary?" · основной":""'),
 ('((de=Z.barcodes[0])==null?void 0:de.value)||"не указан"','(((de=Z.barcodes[0])==null?void 0:de.value)||"не указан")+(Z.barcodes[0]?.source==="LAMODA"?" · Lamoda":"")'),
]:
 assert chunk.count(old)==1,old
 chunk=chunk.replace(old,new,1)
target.parent.mkdir(parents=True,exist_ok=True)
target.write_bytes((s[:start]+chunk+s[end:]).encode('utf-8'))
print('Prepared exact print lookup/barcode-label delta')
