"""FIX: reviewed method overlay; retain published legacy flows and resources."""
from pathlib import Path
import re,sys,json,shutil
base,old,new=map(Path,sys.argv[1:4]);folder=base/'smali/pro/logoff/wms/tsd'
assert base.resolve().is_relative_to(Path('D:/WMSFF/_Kof/work/ozon-planned-packing').resolve())
pattern=re.compile(r'^\.method [^\n]+\n[\s\S]*?^\.end method',re.M)
def methods(s):return {m.splitlines()[0]:m for m in pattern.findall(s)}
def read(root,name):return next(root.rglob(name+'.smali')).read_text(encoding='utf-8')
def name(m):return m.splitlines()[0].split()[-1].split('(')[0]
def norm(s):return re.sub(r'(?m)^\s*\.(?:line|local|end local|restart local|source|param|end param)[^\n]*\n','',s)
# Only these source methods change. Legacy render, location, recovery, voice and send stay byte-identical.
changed={'showWholePicking','productOnly','resumeProductOnly','productSuggestion','scanProduct','resolvePacking','productInstructions'}
screen=folder/'FboTwoStageScreen.smali';s=screen.read_text(encoding='utf-8');incoming=read(new,'FboTwoStageScreen');nm=methods(incoming)
synthetics={name(m) for m in nm.values() if ' synthetic ' in m.splitlines()[0]}
def rewrite(v):
 v=v.replace('FboTwoStageScreen$$ExternalSynthetic','FboTwoStageScreen$Planned$ExternalSynthetic')
 for n in sorted(synthetics,key=len,reverse=True):
  v=v.replace('->'+n+'(','->planned$'+n+'(')
  v=re.sub(r'(?m)^(\.method [^\n]* )'+re.escape(n)+r'\(',lambda m:m[1]+'planned$'+n+'(',v)
 return v
original=methods(s);replaced=[]
for signature,m in nm.items():
 if name(m) in changed:
  value=rewrite(m)
  if signature in original:s=s.replace(original[signature],value,1)
  else:s+='\n'+value+'\n'
  replaced.append(name(m))
assert set(replaced)==changed
for m in nm.values():
 if name(m) in synthetics:s+='\n'+rewrite(m)+'\n'
field='.field private resolvedPacking:Lpro/logoff/wms/tsd/network/TsdFboPlan$PackingSuggestion;'
assert field in incoming and field not in s;s=s.replace('# instance fields','# instance fields\n'+field,1)
screen.write_text(s,encoding='utf-8')
for p in new.rglob('FboTwoStageScreen$$ExternalSynthetic*.smali'):
 (folder/p.name.replace('$$ExternalSynthetic','$Planned$ExternalSynthetic')).write_text(rewrite(p.read_text(encoding='utf-8')),encoding='utf-8')
# State has no synthetic closures. Apply only changed methods, retain published scanLocation.
state=folder/'FboScanState.smali';s=state.read_text(encoding='utf-8');a=methods(read(old,'FboScanState'));b=methods(read(new,'FboScanState'));current=methods(s)
for signature,m in b.items():
 if signature not in a or norm(a[signature])!=norm(m):
  if signature in current:s=s.replace(current[signature],m,1)
  else:s+='\n'+m+'\n'
assert '.field packingUnitId:Ljava/lang/String;' not in s
s=s.replace('# instance fields','# instance fields\n.field packingUnitId:Ljava/lang/String;',1);state.write_text(s,encoding='utf-8')
for n in ['TsdFboPlan','TsdFboPlan$PackingSuggestion']:
 p=folder/'network'/(n+'.smali');a=read(old,n);b=read(new,n);s=p.read_text(encoding='utf-8')
 assert norm(s)==norm(a),n+' baseline drift'
 p.write_text(b,encoding='utf-8')
api=folder/'network/WmsApi.smali';s=api.read_text(encoding='utf-8');m=[v for v in methods(read(new,'WmsApi')).values() if name(v)=='resolvePlannedPacking'];assert len(m)==1 and ' resolvePlannedPacking(' not in s
api.write_text(s+'\n'+m[0]+'\n',encoding='utf-8')
yml=base/'apktool.yml';s=yml.read_text().replace('versionCode: 269','versionCode: 270').replace('0.1.269-returns-kiz','0.1.270-ozon-plan');yml.write_text(s)
for p in [folder/'MainActivity.smali',folder/'BuildConfig.smali']:
 s=p.read_text(encoding='utf-8').replace('0.1.269-returns-kiz','0.1.270-ozon-plan').replace('VERSION_CODE:I = 0x10d','VERSION_CODE:I = 0x10e');p.write_text(s,encoding='utf-8')
print(json.dumps({'changedScreenMethods':sorted(changed),'publishedLegacyMethodsPreserved':True,'version':270}))
