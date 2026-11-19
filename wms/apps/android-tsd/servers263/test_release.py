import unittest
from publish import validate,patch,wait_hash,sha,BASE,MAIN,PACKAGE,FILE
from build import verify_classes
class ReleaseTests(unittest.TestCase):
    # TEST: old nginx worker during graceful reload must not falsely fail release.
    def test_reload_converges(self):
        responses=iter([b'old',b'new']);wait_hash(lambda p:next(responses),'apk',sha(b'new'),lambda n:None)
    def test_wrong_hash_still_fails(self):
        with self.assertRaises(AssertionError):wait_hash(lambda p:b'wrong','apk',sha(b'new'),lambda n:None)
    # TEST: installed261 must receive a newer APK from its own package channel.
    def fixture(self):
        return dict(packageId=PACKAGE,versionCode=261,sha256=BASE),dict(packageId=PACKAGE,versionCode=263,baselineSha256=BASE,mainSha256=MAIN,storageAndUpdateCodePreserved=True,resourcesPreserved=True,certificateSha256='70715af4c2ea269d393f9cfb15806aeee920445a22aac16248e76d621bede5da')
    def test_update(self):
        old,new=self.fixture();validate(old,new);self.assertGreater(new['versionCode'],old['versionCode'])
    def test_stale_channel_regression(self):
        old,new=self.fixture();new['versionCode']=261
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
        route='location = /downloads/logoff-tsd-servers-receipt-draft-261.apk { }\nlocation = /downloads/logoff-tsd-server-choice.apk { alias /var/www/wms-updates/logoff-tsd-servers-receipt-draft-261.apk; }\n'
        result=patch(route*2+'main-channel-untouched')
        self.assertEqual(result.count(FILE),6);self.assertTrue(result.endswith('main-channel-untouched'))
    def test_drift(self):
        with self.assertRaises(AssertionError):patch('unexpected config')
    def test_dex_scope(self):
        screen='pro/logoff/wms/tsd/FboTwoStageScreen.smali';helper=screen.replace('.smali','$$ExternalSyntheticBackport0.smali');config='pro/logoff/wms/tsd/BuildConfig.smali'
        old={screen:b'old',config:b'0x105 0.1.261-receipt-draft','Outbox':b'preserve'};main={screen:b'new',helper:b'helper'};new={**old,**main,config:b'0x107 0.1.263-packing-modes'}
        verify_classes(old,main,new);new['Outbox']=b'changed'
        with self.assertRaises(AssertionError):verify_classes(old,main,new)
if __name__=='__main__':unittest.main()
