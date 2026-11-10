"""Build the minimal LOGOFF-only adapter over the pinned production APK260.

Private signing JSON: {keystore, alias, password}. Never commit that file.
Requires Android SDK cmdline-tools (dexlib2), build-tools 35.0.0 and JDK17.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import zipfile

BASE_SHA = 'bb86b6a078e8760a412d54ef5e0c023e7ef85e26d4f45ba58223a3dc68446c87'
AUX_SHA = '44f28e701c6dfcbe9208e9ced90dc31ee62656a1b5083e4e0b9a62f6e059079c'
CERT = '70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da'
OLD, NEW = b'0.1.260-receipt-voice', b'0.1.261-receipt-draft'

def variant_settings(variant):
    # FIX: the server-choice installation is a separate Android package, not main.
    return {'main':(BASE_SHA,'logoff-tsd-receipt-draft-261.apk','pro.logoff.wms.tsd'),
            'servers':('0115239cb0abb26c33b37a06fadfd1d6409213fa32ee9aad8a1c99b684f8ac98',
                       'logoff-tsd-servers-receipt-draft-261.apk','pro.logoff.wms.tsd.servers')}[variant]

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def require_hash(path, expected):
    if sha(path) != expected:
        raise ValueError('Unreviewed APK input: ' + str(path))

def manifest(data):
    # FIX: identify android:versionCode by resource ID, never by numeric byte search.
    out = bytearray(data)
    old_name,new_name=OLD,NEW
    if out.count(old_name)==0:
        old_name,new_name=OLD.decode().encode('utf-16le'),NEW.decode().encode('utf-16le')
    if out.count(old_name) != 1 or len(old_name) != len(new_name):
        raise ValueError('Unexpected manifest version name')
    resources, offset, changes = [], 8, 0
    while offset < len(out):
        kind, header, size = struct.unpack_from('<HHI', out, offset)
        if size < header or offset + size > len(out):
            raise ValueError('Invalid binary XML chunk')
        if kind == 0x180:
            resources = list(struct.unpack_from('<' + 'I' * ((size-header)//4), out, offset+header))
        if kind == 0x102:
            ext = offset + 16
            start, stride, count = struct.unpack_from('<HHH', out, ext+8)
            for n in range(count):
                pos = ext + start + n*stride
                name = struct.unpack_from('<I', out, pos+4)[0]
                if name < len(resources) and resources[name] == 0x0101021b:
                    if out[pos+15] != 0x10 or struct.unpack_from('<I', out, pos+16)[0] != 260:
                        raise ValueError('Unexpected versionCode')
                    struct.pack_into('<I', out, pos+16, 261)
                    changes += 1
        offset += size
    if changes != 1:
        raise ValueError('Expected exactly one versionCode')
    return bytes(out).replace(old_name, new_name)

def verify_classes(before, after):
    allowed = {'pro/logoff/wms/tsd/' + n + '.smali' for n in
               ('MainActivity','BuildConfig','data/ReceiptCloseBatch','data/OperationOutbox')}
    baseline = {str(p.relative_to(before)).replace('\\','/'): p for p in before.rglob('*.smali')}
    candidate = {str(p.relative_to(after)).replace('\\','/'): p for p in after.rglob('*.smali')}
    added = set(candidate)-set(baseline)
    if added != {'pro/logoff/wms/tsd/' + n + '.smali' for n in
                  ('ReceiptDraftHooks','ReceiptDraftHooks$Open','data/ReceiptBoxDraft','data/ReceiptBoxDraft$Snapshot')}:
        raise ValueError('Unexpected new classes')
    changed = {n for n,p in baseline.items() if p.read_bytes() != candidate[n].read_bytes()}
    if changed != allowed:
        raise ValueError('Unexpected changed classes: ' + str(changed))
    # Every existing method body survives, including all 260 voice/caption/network logic.
    for name in allowed:
        old = baseline[name].read_text(encoding='utf-8')
        new = candidate[name].read_text(encoding='utf-8')
        def methods(txt):
            return {m.group(1).split()[-1]:m.group(2) for m in
                    re.finditer(r'^\.method ([^\n]+)\n(.*?)^\.end method', txt, re.M|re.S)}
        original, patched = methods(old), methods(new)
        for signature, body in original.items():
            renamed = signature.replace('(', '$receiptDraftOriginal(', 1)
            actual = patched.get(renamed, patched.get(signature))
            if actual != body.replace(OLD.decode(), NEW.decode()):
                raise ValueError('Original method changed: '+name+' '+signature)
    return {'baselineClasses':len(baseline),'candidateClasses':len(candidate),
            'changedClasses':sorted(changed),'addedClasses':sorted(added),'originalMethodsPreserved':True}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--variant',choices=('main','servers'),default='main')
    for arg in ('baseline','reviewed-apk','reviewed-classes','sdk','jdk','signing','out'):
        p.add_argument('--'+arg,required=True,type=Path)
    a=p.parse_args();baseline_sha,filename,package=variant_settings(a.variant)
    require_hash(a.baseline,baseline_sha); require_hash(a.reviewed_apk,AUX_SHA)
    out=a.out; out.mkdir(parents=True,exist_ok=True); here=Path(__file__).parent
    java=a.jdk/'bin/java.exe'; javac=a.jdk/'bin/javac.exe'
    bt=a.sdk/'build-tools/35.0.0'; android=a.sdk/'platforms/android-35/android.jar'
    cp=os.pathsep.join(str(f) for f in (a.sdk/'cmdline-tools').rglob('*.jar'))
    env=dict(os.environ,JAVA_HOME=str(a.jdk)); env['PATH']=str(a.jdk/'bin')+os.pathsep+env['PATH']
    def run(*args):
        return subprocess.check_output([str(x) for x in args],stderr=subprocess.STDOUT,env=env,text=True)
    for apk,target in ((a.baseline,'base.dex'),(a.reviewed_apk,'aux.dex')):
        with zipfile.ZipFile(apk) as z: (out/target).write_bytes(z.read('classes.dex'))
    for n in ('hook-classes','host-classes','hookdex'): (out/n).mkdir(exist_ok=True)
    run(javac,'-encoding','UTF-8','-source','8','-target','8','-cp',str(android)+os.pathsep+str(a.reviewed_classes),'-d',out/'hook-classes',here/'ReceiptDraftHooks.java')
    run(bt/'d8.bat','--min-api','26','--lib',android,'--output',out/'hookdex',*[str(f) for f in (out/'hook-classes').rglob('*.class')])
    run(javac,'-encoding','UTF-8','-cp',cp,'-d',out/'host-classes',here/'PatchReceiptDraft.java')
    print(run(java,'-cp',str(out/'host-classes')+os.pathsep+cp,'PatchReceiptDraft',out/'base.dex',out/'aux.dex',out/'hookdex/classes.dex',out/'patched.dex',out/'before',out/'after'))
    proof=verify_classes(out/'before',out/'after')
    unsigned=out/'unsigned.apk'
    with zipfile.ZipFile(a.baseline) as src,zipfile.ZipFile(unsigned,'w') as dst:
        for entry in src.infolist():
            if entry.filename.startswith('META-INF/') and entry.filename.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF')): continue
            data=src.read(entry)
            if entry.filename=='classes.dex': data=(out/'patched.dex').read_bytes()
            if entry.filename=='AndroidManifest.xml': data=manifest(data)
            dst.writestr(entry,data)
    run(bt/'zipalign.exe','-f','-p','4',unsigned,out/'aligned.apk')
    config=json.loads(a.signing.read_text()); env['TSD261_SIGNING_PASS']=config['password']
    apk=out/filename
    key=Path(config['keystore']); key=key if key.exists() else a.signing.parent/key.name
    run(bt/'apksigner.bat','sign','--ks',key,'--ks-key-alias',config['alias'],'--ks-pass','env:TSD261_SIGNING_PASS','--key-pass','env:TSD261_SIGNING_PASS','--out',apk,out/'aligned.apk')
    cert=run(bt/'apksigner.bat','verify','--print-certs',apk)
    if CERT not in cert: raise ValueError('Production certificate mismatch')
    with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(apk) as new:
        for entry in old.namelist():
            if entry not in ('classes.dex','AndroidManifest.xml') and not entry.startswith('META-INF/'):
                if old.read(entry)!=new.read(entry): raise ValueError('Resource changed: '+entry)
    proof.update(versionCode=261,apkSha256=sha(apk),apkSize=apk.stat().st_size,
                 baselineApkSha256=baseline_sha,packageId=package,reviewedAuxApkSha256=AUX_SHA,certificateSha256=CERT,
                 sourceParityVerified=False,allOtherResourcesPreserved=True)
    (out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
    print(json.dumps(proof,indent=2))

if __name__=='__main__': main()
