# FIX: exact updater delta over published278; no full local APK deployment.
from pathlib import Path
import re,sys,shutil
base,donor=map(Path,sys.argv[1:3]);folder=base/'smali/pro/logoff/wms/tsd'
def methods(s):return {m.splitlines()[0]:m for m in re.findall(r'(?ms)^\.method .*?^\.end method',s)}
p=folder/'MainActivity.smali';s=p.read_text(encoding='utf8');a=methods(s);b=methods(next(donor.rglob('MainActivity.smali')).read_text(encoding='utf8'))
for name in ['updateInstallAction','installUpdateApk','managedUpdateStatus']:
 key=next(k for k in b if ' '+name+'(' in k)
 if key in a:s=s.replace(a[key],b[key])
 else:s+='\n'+b[key]+'\n'
old='    const-string v1, "pro.logoff.wms.tsd.servers.UPDATE_INSTALL_STATUS"'
assert s.count(old)==1
s=s.replace(old,'    invoke-direct {p0}, Lpro/logoff/wms/tsd/MainActivity;->updateInstallAction()Ljava/lang/String;\n    move-result-object v1')
key=next(k for k in methods(s) if ' onDestroy(' in k)
m=methods(s)[key];s=s.replace(m,m.replace('    invoke-direct {p0}, Lpro/logoff/wms/tsd/MainActivity;->releaseUpdateBarrier()V','    invoke-static {p0}, Lpro/logoff/wms/tsd/UpdateInstallFeedback;->clear(Lpro/logoff/wms/tsd/MainActivity;)V\n    invoke-direct {p0}, Lpro/logoff/wms/tsd/MainActivity;->releaseUpdateBarrier()V',1))
s=s.replace('0.1.278-print-menu','0.1.279-update-install');p.write_text(s,encoding='utf8')
p=folder/'MainActivity$2.smali';s=p.read_text(encoding='utf8');anchor='    const-string p1, "android.content.pm.extra.STATUS"';assert s.count(anchor)==1
s=s.replace(anchor,'    iget-object p1, p0, Lpro/logoff/wms/tsd/MainActivity$2;->this$0:Lpro/logoff/wms/tsd/MainActivity;\n    invoke-static {p1}, Lpro/logoff/wms/tsd/UpdateInstallFeedback;->clear(Lpro/logoff/wms/tsd/MainActivity;)V\n'+anchor)
anchor='    invoke-virtual {p1, v1}, Lpro/logoff/wms/tsd/MainActivity;->startActivity(Landroid/content/Intent;)V';assert s.count(anchor)==1
s=s.replace(anchor,'    invoke-static {p1}, Lpro/logoff/wms/tsd/MainActivity;->-$$Nest$mreleaseUpdateBarrier(Lpro/logoff/wms/tsd/MainActivity;)V\n    invoke-static {p1, v2}, Lpro/logoff/wms/tsd/MainActivity;->-$$Nest$fputappUpdateBusy(Lpro/logoff/wms/tsd/MainActivity;Z)V\n'+anchor);p.write_text(s,encoding='utf8')
for p in donor.rglob('UpdateInstallFeedback*.smali'):shutil.copyfile(p,folder/p.name)
for p in [base/'apktool.yml',base/'AndroidManifest.xml',folder/'BuildConfig.smali']:
 s=p.read_text(encoding='utf8').replace('0.1.278-print-menu','0.1.279-update-install').replace('versionCode: 278','versionCode: 279').replace('VERSION_CODE:I = 0x116','VERSION_CODE:I = 0x117');p.write_text(s,encoding='utf8')
print('Runtime callback identity, confirmation barrier and bounded wait fixed')
