import pathlib,sys,json
R=pathlib.Path(__file__).resolve().parent
import zipfile,hashlib,xml.etree.ElementTree as ET,shutil,tarfile
sys.path.insert(0,str(R.parent/'ozon-apk-content-fix/wms/apps/android-tsd/scripts'))
from verify_ozon_apk import verify,Dex
root=R/'android-candidate/wms/apps/android-tsd';apk=root/'app/build/outputs/apk/logoff/release/app-logoff-release-unsigned.apk'
v=verify(apk,R.parent.parent/'wms/.runtime/android-sdk/build-tools/35.0.0/aapt2.exe',208)
assert v['versionName']=='0.1.208-sequential-picking'
with zipfile.ZipFile(apk) as z:
    ds=[Dex(z.read(n)) for n in z.namelist() if n.endswith('.dex')]
    assert any(('Lpro/logoff/wms/tsd/FboScanState;','screenPhase') in d.code for d in ds)
    assert any(('Lpro/logoff/wms/tsd/InventoryScanCorrection;','confirmed') in d.code for d in ds)
    # TEST: the actual release contains deferred scanner focus, not only the source test.
    assert any(d.calls(('Lpro/logoff/wms/tsd/FboTwoStageScreen;','render'),('Landroid/os/Handler;','post')) for d in ds)
    # TEST: the actual release must contain the new receipt/status implementation.
    for method in ['sendAcknowledged','checkPending','acceptReceipt','validReceipt','choosePackingMode','packingAccepted','packingCompleteButton','unconfirmedBoxes','cancelPackingScan','manualPackingKiz','packingScanRecovery']:
        assert any(('Lpro/logoff/wms/tsd/FboTwoStageScreen;',method) in d.code for d in ds),method
    for caller,callee in [
        (('FboTwoStageScreen','submit'),('FboTwoStageScreen','speakScan')),
        (('MainActivity','executeFbsAction'),('FbsPendingAction','save')),
        (('MainActivity','retryFbsAction'),('MainActivity','executeFbsAction')),
        (('MainActivity','buildMonitorPayload'),('FboTwoStageScreen','monitorPayload')),
    ]:
        assert any(d.calls(('Lpro/logoff/wms/tsd/'+caller[0]+';',caller[1]),('Lpro/logoff/wms/tsd/'+callee[0]+';',callee[1])) for d in ds),(caller,callee)
    assert any(d.calls(m,('Lpro/logoff/wms/tsd/MainActivity;','speakFbsScan')) for d in ds for m in d.code)
    # TEST: sequential picking and current-location requests exist in the actual release DEX.
    assert any(('Lpro/logoff/wms/tsd/FbsSequentialPick;','continueBox') in d.code for d in ds)
    assert any(d.calls(m,('Lpro/logoff/wms/tsd/network/WmsApi;','getFboPlanAtLocation')) for d in ds for m in d.code if m[0]=='Lpro/logoff/wms/tsd/FboTwoStageScreen;')
    # TEST: release contains account selection and repeated-error state, not just audio assets.
    assert any(('Lpro/logoff/wms/tsd/PersonalScanVoice;','repeated') in d.code for d in ds)
    assert any(('Lpro/logoff/wms/tsd/PersonalEventVoice;','fbs') in d.code for d in ds)
    for method in ['renderFbsAssemblyScreen','openKizLocation','openStoragePalletAssembly','openInventoryMode']:
        # Async entry callbacks may compile into synthetic methods; all actual APK call sites must be present.
        assert any(('Lpro/logoff/wms/tsd/MainActivity;',method) in d.code for d in ds)
    assert any(d.calls(m,('Lpro/logoff/wms/tsd/FboScanFeedback;','event')) for d in ds for m in d.code)
    hashes={hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}
    for asset in (root/'app/src/main/res/raw').glob('eleonora_*.wav'):
        assert hashlib.sha256(asset.read_bytes()).hexdigest() in hashes,asset.name
    assert any(d.calls(('Lpro/logoff/wms/tsd/MainActivity;','renderFbsAssemblyScreen'),('Lpro/logoff/wms/tsd/FbsStepVoice;','step')) for d in ds)
    assert hashlib.sha256((root/'app/src/main/res/raw/fbs_new_barcode.wav').read_bytes()).hexdigest() in hashes
    assert any(('Lpro/logoff/wms/tsd/KizLocationPolicy;','describe') in d.code for d in ds)
    assert any('Lpro/logoff/wms/tsd/network/TsdKizLocationResponse$Reuse;' in d.types for d in ds)
    for f in ['tsd-translations.tsv','tsd-templates.tsv']:assert z.read('assets/'+f)==(root/'app/src/main/assets'/f).read_bytes()
    assert any(('Lpro/logoff/wms/tsd/KizReviewPolicy;','canDecide') in d.code for d in ds)
    assert any('КИЗ НЕОБХОДИМО ЗАМЕНИТЬ' in d.strings for d in ds)
    assert not any('Для решения нужно обращение из текущей сборки. Попросите сборщика отсканировать этот КИЗ в задании.' in d.strings for d in ds)
    assert any(('Lpro/logoff/wms/tsd/FboScanState;','wholePickTitle') in d.code for d in ds)
    assert any(('Lpro/logoff/wms/tsd/FboScanState;','reusableBin') in d.code for d in ds)
    assert any(d.calls(('Lpro/logoff/wms/tsd/FboTwoStageScreen;','packingAccepted'),('Lpro/logoff/wms/tsd/FboPackingVoice;','boxAccepted')) for d in ds)
    assert any(d.calls(('Lpro/logoff/wms/tsd/FboTwoStageScreen;','render'),('Lpro/logoff/wms/tsd/AssemblyAutoFocus;','request')) for d in ds)
    assert any('Данный короб уже упакован в поставку' in d.strings for d in ds)
    for cls,method in [('FboPackingProgress','total'),('AssemblyScreenFeedback','background'),('FboTwoStageScreen','cartonList')]:
        assert any(('Lpro/logoff/wms/tsd/'+cls+';',method) in d.code for d in ds)
    for cls,method in [('MainActivity','renderFbsMenu'),('MainActivity','renderFboPickingMenu'),('FbsMarketplaceFilter','select')]:
        assert any(('Lpro/logoff/wms/tsd/'+cls+';',method) in d.code for d in ds)
changed=set(json.loads((R/'changed.json').read_text()))

with tarfile.open(R/'published-android-source.tar.gz') as t:
    for member in t.getmembers():
        if member.isfile() and member.name not in changed:assert t.extractfile(member).read()==(R/'android-candidate'/member.name).read_bytes(),member.name
assert 'BUILD SUCCESSFUL' in (R/'android-tests.log').read_text(encoding='utf8')
results={}
for suite in (root/'app/build/test-results').glob('test*UnitTest'):
    totals={k:0 for k in ['tests','failures','errors','skipped']}
    for file in suite.glob('TEST-*.xml'):
        x=ET.parse(file).getroot()
        for k in totals:totals[k]+=int(x.attrib.get(k,0))
    assert totals['tests'] and not any(totals[k] for k in ['failures','errors','skipped']),totals
    results[suite.name]=totals
assert len(results)==6
for suite in (root/'app/build/test-results').glob('test*UnitTest'):
    report=ET.parse(suite/'TEST-pro.logoff.wms.tsd.FboTwoStageScreenTest.xml').getroot()
    assert any(case.get('name')=='fbsRequestsCanRenderBeforeFirstResponse' and not list(case) for case in report.findall('testcase'))

v.update({'tests':results,'apkSha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'publishedSourcePreserved':True,'voicePreserved':True})
(R/'verification.json').write_text(json.dumps(v,indent=2));shutil.copy2(apk,R/'unsigned.apk');print(json.dumps(v))
