import pathlib,subprocess,sys,time,json,sqlite3,hashlib,xml.etree.ElementTree as ET
r=pathlib.Path(__file__).resolve().parent
cmd=['D:/WMSFF/_Kof/wms/.runtime/android-sdk/platform-tools/adb.exe','-s','emulator-5554']
package='pro.logoff.wms.tsd';data='/data/user/0/'+package
def adb(*args):return subprocess.check_output(cmd+list(args),stderr=subprocess.STDOUT,timeout=60)
assert adb('shell','getprop','ro.kernel.qemu').strip()==b'1'
assert adb('shell','id','-u').strip()==b'0'
installed=subprocess.run(cmd+['shell','pm','path',package],capture_output=True)
if installed.returncode==0 and b'package:' in installed.stdout:
    adb('uninstall',package) # Isolated emulator: replace the debug-signed instrumented-test app.
assert b'Success' in adb('install',str(r/'previous.apk'))
adb('shell','am','start','-n',package+'/.MainActivity');time.sleep(4)
assert adb('shell','pidof',package).strip()
adb('shell','am','force-stop',package)
uid=adb('shell','stat','-c','%u:%g',data).decode().strip()
prefs=r/'upgrade-preferences.xml'
prefs.write_text('<?xml version="1.0" encoding="utf-8"?><map><string name="language">uz</string><string name="upgrade_test_marker">preserve-existing-device-settings</string><boolean name="phone_mode" value="false" /></map>',encoding='utf8')
adb('push',str(prefs),data+'/shared_prefs/tsd_ui_preferences.xml')
adb('shell','chown',uid,data+'/shared_prefs/tsd_ui_preferences.xml')
dbdir=r/'upgrade-db-before';dbdir.mkdir(exist_ok=True)
adb('pull',data+'/databases/.',str(dbdir))
db=dbdir/'logoff_wms_tsd.db'
row=('emulator-only-upgrade-marker','RECEIPT','{"emulatorTest":true}',1,'PENDING',0,None,None,None)
with sqlite3.connect(db) as c:
    c.execute('INSERT INTO tsd_operations (operationKey,operationType,payloadJson,createdAt,status,attempts,lastMessage,lastTriedAt,syncedAt) VALUES (?,?,?,?,?,?,?,?,?)',row)
    c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
adb('push',str(db),data+'/databases/logoff_wms_tsd.db')
for suffix in ['-wal','-shm']:
    adb('shell','rm','-f',data+'/databases/logoff_wms_tsd.db'+suffix)
adb('shell','chown',uid,data+'/databases/logoff_wms_tsd.db')
# TEST: adb push may retain the previous emulator app UID's SELinux category.
adb('shell','restorecon','-RF',data)
check=r.parent/'sos-wb2-kiz-duplicate/wms/apps/android-tsd/scripts/verify_tsd_startup.py'
subprocess.run([sys.executable,str(check),'--adb',cmd[0],'--serial','emulator-5554','--apk',str(r/'signed.apk'),'--version','208','--output',str(r/'smoke-upgrade')],check=True)
visible=ET.parse(r/'smoke-upgrade/screen.xml').getroot()
captions=[n.get('text','') for n in visible.iter('node')]
assert any('Sozlamalar' in text for text in captions),captions
adb('shell','am','force-stop',package)
stored=ET.fromstring(adb('shell','cat',data+'/shared_prefs/tsd_ui_preferences.xml'))
assert stored.find("string[@name='language']").text=='uz'
assert stored.find("string[@name='upgrade_test_marker']").text=='preserve-existing-device-settings'
after=r/'upgrade-db-after';after.mkdir(exist_ok=True)
adb('pull',data+'/databases/.',str(after))
with sqlite3.connect(after/'logoff_wms_tsd.db') as c:
    actual=c.execute('SELECT operationKey,operationType,payloadJson,createdAt,status,attempts,lastMessage,lastTriedAt,syncedAt FROM tsd_operations WHERE operationKey=?',(row[0],)).fetchone()
    assert actual==row,actual
result={'passed':True,'path':[207,208],'signedApkStarts':True,'languagePreserved':'uz','preferencesPreserved':True,'pendingOperationPreserved':True,'apkSha256':hashlib.sha256((r/'signed.apk').read_bytes()).hexdigest()}
(r/'upgrade-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))


