"""FIX: reviewed recovery methods only, over signed public279; isolate donor lambdas."""
from pathlib import Path
import re,sys,json
base,donor=map(Path,sys.argv[1:3]);folder=base/'smali/pro/logoff/wms/tsd';p=folder/'MainActivity.smali';original=p.read_text(encoding='utf8');src=next(donor.rglob('MainActivity.smali')).read_text(encoding='utf8')
def methods(s):return {re.search(r'([^\s]+\(.*)',m.splitlines()[0])[1]:m for m in re.findall(r'(?ms)^\.method .*?^\.end method',s)}
a,b=methods(original),methods(src)
roots=['recoveryPairs','renderStoragePalletRecovery','scanStoragePalletRecoveryItem','completeStoragePalletRecovery','prepareStoragePalletRecovery','clearStoragePalletRecovery']
chosen={k:v for k,v in b.items() if k.split('(')[0] in roots};assert len(chosen)==6
classes={};pending=list(chosen.values());main='Lpro/logoff/wms/tsd/MainActivity;'
while pending:
 body=pending.pop()
 for name in set(re.findall(r'Lpro/logoff/wms/tsd/(MainActivity\$\$ExternalSyntheticLambda\d+);',body)):
  if name not in classes:
   text=next(donor.rglob(name+'.smali')).read_text(encoding='utf8');classes[name]=text;pending.append(text)
 for sig in re.findall(re.escape(main)+r'->([^\s]+\([^\s]*)',body):
  if sig in chosen:continue
  if sig.startswith(('lambda$','$r8$','-$$Nest')):
   if sig not in b:raise Exception('Missing donor '+sig)
   chosen[sig]=b[sig];pending.append(b[sig])
  elif sig not in a and sig not in b:raise Exception('Unknown MainActivity method '+sig)
  elif sig not in a:raise Exception('Unreviewed new helper '+sig)
names={k.split('(')[0]:'pairs$'+k.split('(')[0] for k in chosen if k.split('(')[0] not in roots}
classmap={n:n.replace('$$ExternalSyntheticLambda','$$PalletPairsLambda') for n in classes}
def rename(text):
 for old,new in classmap.items():text=text.replace('/'+old+';','/'+new+';')
 for old,new in names.items():
  text=text.replace('->'+old+'(','->'+new+'(')
  text=re.sub(r'(?m)^(\.method [^\n]* )'+re.escape(old)+r'\(',lambda m:m[1]+new+'(',text)
 return text
s=original
for k,m in chosen.items():
 if k.split('(')[0] in roots and k in a:s=s.replace(a[k],rename(m))
 else:s+='\n'+rename(m)+'\n'
assert '.field private recoveryPairs:' not in s
s=s.replace('# instance fields','# instance fields\n.field private recoveryPairs:Lpro/logoff/wms/tsd/PalletRecoveryPairs;',1)
assert '.field private recoveryPairs:' in s
s=s.replace('0.1.279-update-install','0.1.280-pallet-pairs');p.write_text(s,encoding='utf8')
for n,t in classes.items():(folder/(classmap[n]+'.smali')).write_text(rename(t),encoding='utf8')
for q in donor.rglob('PalletRecoveryPairs*.smali'):(folder/q.name).write_bytes(q.read_bytes())
for q in [base/'apktool.yml',base/'AndroidManifest.xml',folder/'BuildConfig.smali']:
 t=q.read_text(encoding='utf8').replace('0.1.279-update-install','0.1.280-pallet-pairs').replace('versionCode: 279','versionCode: 280').replace('VERSION_CODE:I = 0x117','VERSION_CODE:I = 0x118');q.write_text(t,encoding='utf8')
after=methods(s)
unchanged=[k for k,v in a.items() if k.split('(')[0] not in roots and '0.1.279-update-install' not in v]
assert all(after[k]==a[k] for k in unchanged)
proof={'baseline':279,'target':280,'methods':list(chosen),'lambdaClasses':list(classmap.values()),'unrelatedMethodsPreserved':len(unchanged)}
(base.parent/'overlay-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
