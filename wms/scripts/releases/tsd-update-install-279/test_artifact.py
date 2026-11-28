# TEST: test the compiled artifact, where an inlined action diverged from the receiver.
import os,re,unittest
from pathlib import Path
class UpdateArtifactTest(unittest.TestCase):
 def test_installer_callback_uses_same_runtime_action(self):
  s=(Path(os.environ['TSD_DECODED'])/'smali/pro/logoff/wms/tsd/MainActivity.smali').read_text(encoding='utf8')
  methods=re.findall(r'(?ms)^\.method .*?^\.end method',s)
  install=next(x for x in methods if ' installUpdateApk(' in x.splitlines()[0])
  self.assertNotIn('"pro.logoff.wms.tsd.UPDATE_INSTALL_STATUS"',install)
  self.assertIn('->updateInstallAction()',install)
  create=next(x for x in methods if ' onCreate(' in x.splitlines()[0])
  self.assertIn('->updateInstallAction()',create)
if __name__=='__main__':unittest.main()
