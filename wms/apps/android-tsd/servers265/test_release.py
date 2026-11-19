import unittest
from publish import validate,patch,wait_hash,sha,verify_health,BASE,MAIN,PACKAGE,FILE
from build import verify_classes,verify_scan_delta
class ReleaseTests(unittest.TestCase):
    # TEST: queue/checkpoint/pending-command methods must not change with box-first navigation.
    def test_only_location_method_changes(self):
        old=b'.method scanLocation(Ljava/util/List;Ljava/lang/String;)Z\nold\n.end method\n.method checkpoint()V\nkeep\n.end method'
        verify_scan_delta(old,old.replace(b'old',b'new'))
        with self.assertRaises(AssertionError):verify_scan_delta(old,old.replace(b'keep',b'changed'))
    # TEST: reject an HTML fallback or wrong health route before any publication.
    def test_health_route(self):
        def fetch(path):
            self.assertEqual(path,'/api/v1/health');return b'{"status":"ok","service":"logoff-wms-api"}'
        verify_health(fetch)
    def test_health_failure(self):
        with self.assertRaises(AssertionError):verify_health(lambda p:b'{"status":"error"}')
    # TEST: old nginx worker during graceful reload must not falsely fail release.
    def test_reload_converges(self):
        responses=iter([b'old',b'new']);wait_hash(lambda p:next(responses),'apk',sha(b'new'),lambda n:None)
    def test_wrong_hash_still_fails(self):
        with self.assertRaises(AssertionError):wait_hash(lambda p:b'wrong','apk',sha(b'new'),lambda n:None)
    # TEST: installed261 must receive a newer APK from its own package channel.
    def fixture(self):
        return dict(packageId=PACKAGE,versionCode=264,sha256=BASE),dict(packageId=PACKAGE,versionCode=265,baselineSha256=BASE,mainSha256=MAIN,storageAndUpdateCodePreserved=True,resourcesPreserved=True,certificateSha256='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da')
    def test_update(self):
        old,new=self.fixture();validate(old,new);self.assertGreater(new['versionCode'],old['versionCode'])
    def test_stale_channel_regression(self):
        old,new=self.fixture();new['versionCode']=264
        with self.assertRaises(AssertionError):validate(old,new)
    def test_wrong_package(self):
        old,new=self.fixture();new['packageId']='pro.logoff.wms.tsd'
        with self.assertRaises(AssertionError):validate(old,new)
    def test_code_preservation_required(self):
        old,new=self.fixture();new['storageAndUpdateCodePreserved']=False
        with self.assertRaises(AssertionError):validate(old,new)
    def test_signature(self):
        old,new=self.fixture();new['certificateSha256']='other'
        with self.assertRaises(AssertionError):validate(old,new)
    def test_routes(self):
        route='location = /downloads/logoff-tsd-servers-packing-modes-264.apk { }\nlocation = /downloads/logoff-tsd-server-choice.apk { alias /var/www/wms-updates/logoff-tsd-servers-packing-modes-264.apk; }\n'
        result=patch(route*2+'main-channel-untouched')
        self.assertEqual(result.count(FILE),6);self.assertTrue(result.endswith('main-channel-untouched'))
    def test_drift(self):
        with self.assertRaises(AssertionError):patch('unexpected config')
    def test_dex_scope(self):
        screen='pro/logoff/wms/tsd/FboScanState.smali';config='pro/logoff/wms/tsd/BuildConfig.smali'
        activity='pro/logoff/wms/tsd/MainActivity.smali'
        old={screen:b'old',config:b'0x108 0.1.264-packing-modes',activity:b'0.1.264-packing-modes','Outbox':b'preserve'};main={screen:b'new'};new={**old,**main,config:b'0x109 0.1.265-box-direct-v1',activity:b'0.1.265-box-direct-v1'}
        verify_classes(old,main,new);new['Outbox']=b'changed'
        with self.assertRaises(AssertionError):verify_classes(old,main,new)
if __name__=='__main__':unittest.main()
