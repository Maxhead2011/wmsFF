from pathlib import Path
import re,sys,shutil
base,donor=map(Path,sys.argv[1:3]);folder=base/'smali/pro/logoff/wms/tsd'
assert base.resolve().is_relative_to(Path('D:/WMSFF/_Kof/work/returns-kiz-runtime').resolve())
# FIX: only replace our isolated activity family; preserve all other published code.
for old in folder.glob('ReturnsActivity*.smali'):old.unlink()
for src in donor.rglob('ReturnsActivity*.smali'):shutil.copyfile(src,folder/src.name)
pattern=re.compile(r'^\.method [^\n]+\n[\s\S]*?^\.end method',re.M)
api=folder/'network/WmsApi.smali';s=api.read_text(encoding='utf-8');new=next(donor.rglob('WmsApi.smali')).read_text(encoding='utf-8')
methods=[b for b in pattern.findall(new) if any(' '+name+'(' in b.splitlines()[0] for name in ['markReturn','findReturnBox','closeReturnBox'])];assert len(methods)==3
for m in methods:assert m.splitlines()[0] not in s
api.write_text(s+'\n'+'\n'.join(methods),encoding='utf-8')
main=folder/'MainActivity.smali';s=main.read_text(encoding='utf-8')
hook='    invoke-static {p0, v1}, Lpro/logoff/wms/tsd/ReturnsActivity;->addMenu(Landroid/app/Activity;Landroid/widget/LinearLayout;)V'
assert s.count(hook)==1;s=s.replace(hook,'')
# relocate within renderMainScreen, after main menu has been constructed
start=s.index('.method private renderMainScreen(');end=s.index('.end method',start)
body=s[start:end]
needle='    const-string v3, '+chr(34)+'Синхронизировать очередь'.encode('unicode_escape').decode()+chr(34)
assert body.count(needle)==1
body=body.replace(needle,hook+'\n\n'+needle)
s=s[:start]+body+s[end:];main.write_text(s,encoding='utf-8')
yml=base/'apktool.yml';s=yml.read_text();s=s.replace('versionCode: 268','versionCode: 269').replace('0.1.268-returns','0.1.269-returns-kiz');yml.write_text(s)
for p in [folder/'MainActivity.smali',folder/'BuildConfig.smali']:
 s=p.read_text(encoding='utf-8').replace('0.1.268-returns','0.1.269-returns-kiz').replace('VERSION_CODE:I = 0x10c','VERSION_CODE:I = 0x10d');p.write_text(s,encoding='utf-8')
print('Isolated KIZ release overlay applied')
