"""Apply the placement delta to the decoded public server-choice 275 package."""
from pathlib import Path
import re,sys
base,donor=map(Path,sys.argv[1:3])
def file(root,name):return next(root.rglob(name))
def methods(s):return re.findall(r'(?ms)^\.method .*?^\.end method',s)
def one(seq):
    a=list(seq)
    assert len(a)==1,len(a)
    return a[0]
p=file(base,'MainActivity.smali'); s=p.read_text(encoding='utf8')
d=file(donor,'MainActivity.smali').read_text(encoding='utf8')
def patch(name,old,new,count=1):
    global s
    m=one(m for m in methods(s) if ' '+name+'(' in m.splitlines()[0])
    assert m.count(old)==count,(name,old)
    s=s.replace(m,m.replace(old,new))
activity='Lpro/logoff/wms/tsd/MainActivity;'
s=s.replace('# instance fields','# instance fields\n.field private palletClients:Ljava/util/List;\n.field private palletClientLoad:I')
init='iput-object v0, p0, '+activity+'->clients:Ljava/util/List;'
patch('<init>',init,init+'\n    new-instance v0, Ljava/util/ArrayList;\n    invoke-direct {v0}, Ljava/util/ArrayList;-><init>()V\n    iput-object v0, p0, '+activity+'->palletClients:Ljava/util/List;')
patch('openStoragePalletAssembly','->renderStoragePalletAssemblyScreen()V','->loadPalletClients()V')
patch('renderStoragePalletAssemblyScreen','->clients:','->palletClients:')
patch('submitStoragePalletScan','->clients:','->palletClients:',2)
patch('lambda$renderStoragePalletAssemblyScreen$76','{p0, p1}, '+activity+'->loadClients(Z)V','{p0}, '+activity+'->loadPalletClients()V')
refresh=one(m for m in methods(d) if ' refreshClientOptions(' in m.splitlines()[0])
old=one(m for m in methods(s) if ' refreshClientOptions(' in m.splitlines()[0])
# Only the initial screen guard is new. Keep existing implementation intact.
locals_line=one(l for l in old.splitlines() if '.locals ' in l)
assert int(locals_line.split()[-1])>=2
patch('refreshClientOptions',locals_line,locals_line+'\n    iget-object v0, p0, '+activity+'->screen:Lpro/logoff/wms/tsd/MainActivity$Screen;\n    sget-object v1, Lpro/logoff/wms/tsd/MainActivity$Screen;->STORAGE_PALLET:Lpro/logoff/wms/tsd/MainActivity$Screen;\n    if-ne v0, v1, :placement_continue\n    return-void\n    :placement_continue')
extra=[m for m in methods(d) if 'loadPalletClients' in m.splitlines()[0] or '->lambda$loadPalletClients' in m]
assert len(extra)==5
extra='\n\n'.join(extra)
for n in set(re.findall(r'MainActivity\$\$ExternalSyntheticLambda\d+',extra)):
    src=file(donor,n+'.smali');name='Placement276'+n.split('Lambda')[-1];dest=p.parent/(name+'.smali')
    assert not dest.exists()
    dest.write_text(src.read_text(encoding='utf8').replace(n,name),encoding='utf8')
    extra=extra.replace(n,name)
for m in methods(extra):assert m.splitlines()[0] not in s
s+='\n'+extra+'\n';p.write_text(s.replace('0.1.275-managed-update','0.1.276-placement-clients'),encoding='utf8')
p=file(base,'WmsApi.smali');m=one(m for m in methods(file(donor,'WmsApi.smali').read_text()) if ' listPlacementClients(' in m.splitlines()[0]);p.write_text(p.read_text()+'\n'+m+'\n')
for p in [base/'apktool.yml',base/'AndroidManifest.xml',file(base,'BuildConfig.smali')]:
    s=p.read_text(encoding='utf8').replace('0.1.275-managed-update','0.1.276-placement-clients').replace('versionCode: 275','versionCode: 276').replace('VERSION_CODE:I = 0x113','VERSION_CODE:I = 0x114');p.write_text(s,encoding='utf8')
