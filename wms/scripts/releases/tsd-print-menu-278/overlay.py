from pathlib import Path
import re,sys,hashlib,json
b=Path(sys.argv[1]);p=b/'smali/pro/logoff/wms/tsd/MainActivity.smali';s=p.read_text(encoding='utf8');before=s
m=next(m for m in re.findall(r'(?ms)^\.method .*?^\.end method',s) if ' renderMainScreen(' in m.splitlines()[0]);n=m
start=n.index('    iget-boolean v2, p0, Lpro/logoff/wms/tsd/MainActivity;->phoneMode:Z');end=n.index('    :goto_4',start)
n=n[:start]+n[end:]
call='    invoke-static {p0, v1}, Lpro/logoff/wms/tsd/KizBoxPrintActivity;->addMenu(Landroid/app/Activity;Landroid/widget/LinearLayout;)V'
assert n.count(call)==1;n=n.replace(call,'')
anchor='    invoke-static {p0, v1}, Lpro/logoff/wms/tsd/ReturnsActivity;->addMenu(Landroid/app/Activity;Landroid/widget/LinearLayout;)V';assert n.count(anchor)==1;n=n.replace(anchor,call+'\n'+anchor)
assert n.count('KizBoxPrintActivity;->addMenu')==1 and '->phoneMode:' not in n
p.write_text(s.replace(m,n).replace('0.1.277-kiz-box-print','0.1.278-print-menu'),encoding='utf8')
for p in [b/'apktool.yml',b/'AndroidManifest.xml',b/'smali/pro/logoff/wms/tsd/BuildConfig.smali']:
 s=p.read_text(encoding='utf8').replace('0.1.277-kiz-box-print','0.1.278-print-menu').replace('versionCode: 277','versionCode: 278').replace('VERSION_CODE:I = 0x115','VERSION_CODE:I = 0x116');p.write_text(s,encoding='utf8')
print('Phone removed; one Print before utilities')
