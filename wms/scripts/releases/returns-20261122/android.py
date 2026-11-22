from pathlib import Path
import re,sys,shutil,json
base,donor=map(Path,sys.argv[1:3]);folder=base/'smali/pro/logoff/wms/tsd'
pattern=re.compile(r'^\.method [^\n]+\n[\s\S]*?^\.end method',re.M)
main=folder/'MainActivity.smali';original=main.read_text(encoding='utf-8')
method=next(b for b in pattern.findall(original) if ' renderMainScreen()V' in b.splitlines()[0])
anchor='invoke-virtual {v1, v2}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V'
pos=method.index(anchor,method.index('Tovarni qabul qilish'))+len(anchor)
changed=method[:pos]+'\n\n    invoke-static {p0, v1}, Lpro/logoff/wms/tsd/ReturnsActivity;->addMenu(Landroid/app/Activity;Landroid/widget/LinearLayout;)V\n'+method[pos:]
main.write_text(original.replace(method,changed),encoding='utf-8')
for src in donor.rglob('ReturnsActivity*.smali'):
 dest=folder/src.name;assert not dest.exists();shutil.copyfile(src,dest)
api=folder/'network/WmsApi.smali';s=api.read_text(encoding='utf-8');new=next(donor.rglob('WmsApi.smali')).read_text(encoding='utf-8')
methods=[b for b in pattern.findall(new) if b.splitlines()[0].split()[-1].split('(')[0] in ['listReturns','createReturns','scanReturn','finishReturns']]
assert len(methods)==4
api.write_text(s+'\n'+'\n'.join(methods),encoding='utf-8')
manifest=base/'AndroidManifest.xml';s=manifest.read_text(encoding='utf-8');anchor='<activity android:exported="false" android:name="pro.logoff.wms.tsd.StorageBoxTransferActivity"/>'
assert s.count(anchor)==1
manifest.write_text(s.replace(anchor,'<activity android:exported="false" android:name="pro.logoff.wms.tsd.ReturnsActivity"/>'+anchor),encoding='utf-8')
yml=base/'apktool.yml';s=yml.read_text();s=re.sub(r'  versionCode: \d+', '  versionCode: 268',s);s=re.sub(r'  versionName: [^\n]+','  versionName: 0.1.268-returns',s);yml.write_text(s)
for p in [main,folder/'BuildConfig.smali']:
 s=p.read_text(encoding='utf-8');s=re.sub(r'0\.1\.(267-idle-update|264-box-direct-v1)','0.1.268-returns',s);s=re.sub(r'VERSION_CODE:I = 0x[0-9a-f]+','VERSION_CODE:I = 0x10c',s);p.write_text(s,encoding='utf-8')
print('Isolated return classes and menu hook applied')
