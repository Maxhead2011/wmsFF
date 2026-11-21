"""Package the updated DEX with the published resources and identical release signer."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile

BASE_SHA = "66c6be59323a9a98a2d7d40870ac431915b5780bcc060f9a6e241f25a0aed7be"
CERT = "70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da"
FILE = "logoff-tsd-servers-idle-267.apk"

def run(*args):
    return subprocess.check_output([str(a) for a in args], text=True)

def signature(name):
    return name.startswith("META-INF/") and name.upper().endswith((".SF", ".RSA", ".DSA", ".EC", "MANIFEST.MF"))

def package(base, compiled, donor, out, signing):
    tools = Path(os.environ["ANDROID_HOME"]) / "build-tools/35.0.0"
    def xml(apk):
        text = run(tools / "aapt.exe", "dump", "xmltree", apk, "AndroidManifest.xml")
        return re.sub(r" \(line=\d+\)", "", text)
    old, new = xml(base), xml(donor)
    permission = 'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION'
    new = re.sub(r'    E: uses-permission\n      A: android:name[^\n]+' + permission + r'[^\n]*\n', '', new)
    if new != old.replace("0.1.266-ozon-voice-v1", "0.1.267-idle-update").replace("0x10a\n", "0x10b\n"):
        raise ValueError("Unexpected manifest change")
    if hashlib.sha256(base.read_bytes()).hexdigest() != BASE_SHA:
        raise ValueError("Release base changed")
    out.mkdir(exist_ok=True)
    unsigned = out / "unsigned.apk"
    with zipfile.ZipFile(base) as original, zipfile.ZipFile(compiled) as patched, zipfile.ZipFile(donor) as gradle, zipfile.ZipFile(unsigned, "w") as result:
        for entry in original.infolist():
            if signature(entry.filename):
                continue
            src = {"classes.dex": patched, "AndroidManifest.xml": gradle}.get(entry.filename, original)
            result.writestr(entry, src.read(entry.filename))
    aligned = out / "aligned.apk"
    run(tools / "zipalign.exe", "-f", "-p", "4", unsigned, aligned)
    key = json.loads(signing.read_text("utf-8-sig"))
    store = Path(key["keystore"])
    if not store.exists():
        store = signing.parent / store.name
    os.environ["TSD_RELEASE_SIGN"] = key["password"]
    apk = out / FILE
    run(tools / "apksigner.bat", "sign", "--ks", store, "--ks-key-alias", key["alias"],
        "--ks-pass", "env:TSD_RELEASE_SIGN", "--key-pass", "env:TSD_RELEASE_SIGN", "--out", apk, aligned)
    if CERT not in run(tools / "apksigner.bat", "verify", "--print-certs", apk):
        raise ValueError("Release signer changed")
    proof = dict(packageId="pro.logoff.wms.tsd.servers", versionCode=267, baselineSha256=BASE_SHA,
                 certificateSha256=CERT, resourcesPreserved=True, apkSize=apk.stat().st_size,
                 apkSha256=hashlib.sha256(apk.read_bytes()).hexdigest())
    (out / "proof.json").write_text(json.dumps(proof, indent=2))
    print(apk, proof["apkSha256"])

if __name__ == "__main__":
    package(*map(Path,sys.argv[1:]))
