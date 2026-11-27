from pathlib import Path
import re,sys,json
base,donor=map(Path,sys.argv[1:3]);folder=base/'smali/pro/logoff/wms/tsd'
# FIX: preserve every published method except the checkpoint guard and two status callbacks.
guard=folder/'IdleUpdateGuard.smali';incoming=next(donor.rglob('IdleUpdateGuard.smali')).read_text(encoding='utf-8');old=guard.read_text(encoding='utf-8')
pattern=r'(?ms)^\.method .*?^\.end method'
def methods(s):return {m.splitlines()[0]:m for m in re.findall(pattern,s)}
a=methods(old);b=methods(incoming);key=next(k for k in a if ' hasFboScan(' in k);assert key in b
s=old.replace(a[key],b[key],1);guard.write_text(s,encoding='utf-8')
p=folder/'MainActivity.smali';s=p.read_text(encoding='utf-8');original=methods(s)
key=next(k for k,v in original.items() if 'lambda$startManagedApkUpdate$' in k and '->waitingUpdate:' in v)
m=original[key];assert '.locals 0' in m
m=m.replace('.locals 0','.locals 1').replace('    invoke-direct {p0}, Lpro/logoff/wms/tsd/MainActivity;->tryIdleUpdate()V','    const-string v0, "Обновление скачано и проверено. Ожидаю безопасной установки в главном меню."\n    invoke-direct {p0, v0, p1}, Lpro/logoff/wms/tsd/MainActivity;->showUpdateStatus(Ljava/lang/String;Z)V\n\n    invoke-direct {p0}, Lpro/logoff/wms/tsd/MainActivity;->tryIdleUpdate()V');s=s.replace(original[key],m,1)
key=next(k for k in original if 'lambda$tryIdleUpdate$0()' in k);m=original[key].replace('.locals 1','.locals 2');m=m.replace('    return-void','    const-string v1, "Обновление скачано. Установка ожидает подтверждения незавершённых операций или приёмки."\n    invoke-direct {p0, v1, v0}, Lpro/logoff/wms/tsd/MainActivity;->showUpdateStatus(Ljava/lang/String;Z)V\n\n    return-void');s=s.replace(original[key],m,1)
s=s.replace('0.1.270-ozon-plan','0.1.271-idle-checkpoint');p.write_text(s,encoding='utf-8')
p=folder/'BuildConfig.smali';s=p.read_text().replace('0.1.270-ozon-plan','0.1.271-idle-checkpoint').replace('VERSION_CODE:I = 0x10e','VERSION_CODE:I = 0x10f');p.write_text(s)
p=base/'apktool.yml';s=p.read_text().replace('versionCode: 270','versionCode: 271').replace('0.1.270-ozon-plan','0.1.271-idle-checkpoint');p.write_text(s)
print(json.dumps({'guardChanged':True,'statusCallbacks':2,'otherMethodsPreserved':True,'version':271}))
