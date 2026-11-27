from pathlib import Path
import re,sys,shutil,json
base,donor=map(Path,sys.argv[1:3]);version=int(sys.argv[3]);folder=base/'smali/pro/logoff/wms/tsd'
def methods(s):return {m.splitlines()[0]:m for m in re.findall(r'(?ms)^\.method .*?^\.end method',s)}
# FIX: apply the already-reviewed checkpoint/status delta first, then exact OEM methods.
exec((Path(__file__).parent.parent/'tsd-idle-update-271/overlay.py').read_text(encoding='utf-8-sig'))
guard=folder/'IdleUpdateGuard.smali';incoming=next(donor.rglob('IdleUpdateGuard.smali')).read_text(encoding='utf-8');s=guard.read_text(encoding='utf-8');a=methods(s);b=methods(incoming);key=next(k for k in a if ' hasReceiptDraft(' in k);s=s.replace(a[key],b[key]);guard.write_text(s,encoding='utf-8')
p=folder/'MainActivity.smali';s=p.read_text(encoding='utf-8');a=methods(s);b=methods(next(donor.rglob('MainActivity.smali')).read_text(encoding='utf-8'))
for name in ['installUpdateApk','managedUpdateStatus']:
 key=next(k for k in b if ' '+name+'(' in k)
 if key in a:s=s.replace(a[key],b[key])
 else:s+='\n'+b[key]+'\n'
# FIX: preserve the published lambda while delaying only its final focus check.
key=next(k for k in methods(s) if 'lambda$tryIdleUpdate$3(' in k)
m=methods(s)[key];call='invoke-virtual {v0, v1}, Landroid/os/Handler;->post(Ljava/lang/Runnable;)Z'
assert m.count(call)==1
s=s.replace(m,m.replace(call,'invoke-static {v0, v1}, Lpro/logoff/wms/tsd/ManagedApkInstaller;->afterBarrierFocus(Landroid/os/Handler;Ljava/lang/Runnable;)Z'))
s=s.replace('0.1.271-idle-checkpoint','0.1.'+str(version)+'-managed-update');p.write_text(s,encoding='utf-8')
for p in donor.rglob('ManagedApkInstaller*.smali'):shutil.copyfile(p,folder/p.name)
for p in donor.rglob('IAppCtrlAidl*.smali'):
 dest=base/'smali/com/unitech/appctrlapi/aidl'/p.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
p=folder/'BuildConfig.smali';s=p.read_text().replace('0.1.271-idle-checkpoint','0.1.'+str(version)+'-managed-update').replace('VERSION_CODE:I = 0x10f','VERSION_CODE:I = '+hex(version));p.write_text(s)
p=base/'apktool.yml';s=p.read_text().replace('versionCode: 271','versionCode: '+str(version)).replace('0.1.271-idle-checkpoint','0.1.'+str(version)+'-managed-update');p.write_text(s)
p=base/'AndroidManifest.xml';s=p.read_text(encoding='utf-8');assert 'unitech.appctrl.aidl' not in s;s=s.replace('<application','<uses-permission android:name="unitech.appctrl.aidl" /><application',1)
if '<queries>' in s:s=s.replace('<queries>','<queries><package android:name="com.unitech.appctrlservice" />',1)
else:s=s.replace('<application','<queries><package android:name="com.unitech.appctrlservice" /></queries><application',1)
p.write_text(s,encoding='utf-8');print(json.dumps({'version':version,'oemInstallers':True,'manifestPermission':'unitech.appctrl.aidl','otherPublishedMethodsPreserved':True}))
