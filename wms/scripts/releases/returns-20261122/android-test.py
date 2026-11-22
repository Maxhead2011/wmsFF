from pathlib import Path
import subprocess,os,json,zipfile,sys
src=Path(__file__).parent/'android-test';out=Path(sys.argv[1]);out.mkdir(exist_ok=True);(out/'classes').mkdir(exist_ok=True)
jdk=Path(os.environ['JAVA_HOME']);sdk=Path(os.environ['ANDROID_HOME']);tools=sdk/'build-tools/35.0.0';android=sdk/'platforms/android-35/android.jar'
def run(args):subprocess.run(list(map(str,args)),check=True)
run([jdk/'bin/javac.exe','-source','8','-target','8','-encoding','UTF-8','-classpath',android,'-d',out/'classes',src/'Probe.java'])
run([jdk/'bin/jar.exe','cf',out/'probe.jar','-C',out/'classes','.'])
run([tools/'d8.bat','--min-api','24','--lib',android,'--output',out,out/'probe.jar'])
run([tools/'aapt.exe','package','-f','-M',src/'AndroidManifest.xml','-I',android,'-F',out/'unsigned.apk'])
with zipfile.ZipFile(out/'unsigned.apk','a') as z:z.write(out/'classes.dex','classes.dex')
run([tools/'zipalign.exe','-f','4',out/'unsigned.apk',out/'aligned.apk'])
kfile=Path(sys.argv[2]);k=json.loads(kfile.read_text(encoding='utf-8-sig'));store=Path(k['keystore']);store=store if store.exists() else kfile.parent/store.name;os.environ['RETURNS_SIGN_PASSWORD']=k['password']
run([tools/'apksigner.bat','sign','--ks',store,'--ks-key-alias',k['alias'],'--ks-pass','env:RETURNS_SIGN_PASSWORD','--key-pass','env:RETURNS_SIGN_PASSWORD','--out',out/'test.apk',out/'aligned.apk'])
run([sdk/'platform-tools/adb.exe','-s',sys.argv[3],'install','-r',out/'test.apk'])
r=subprocess.check_output(list(map(str,[sdk/'platform-tools/adb.exe','-s',sys.argv[3],'shell','am','instrument','-w','pro.logoff.test.returns268/pro.logoff.test.returns268.Probe'])),text=True)
(out/'proof.txt').write_text(r,encoding='utf-8');print(r);assert 'INSTRUMENTATION_RESULT: verified=' in r and 'INSTRUMENTATION_CODE: -1' in r
