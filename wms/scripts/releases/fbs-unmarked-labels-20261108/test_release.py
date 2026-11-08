"""TEST: release may change only its explicit printing flag."""
import ast,hashlib,json,unittest
from pathlib import Path

class EnvironmentGuardTest(unittest.TestCase):
 def fingerprint(self,entries):
  tree=ast.parse(Path(__file__).with_name('release.py').read_text())
  function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='envhash')
  scope={'json':json,'FLAG':'WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED',
   'sha':lambda b:hashlib.sha256(b).hexdigest(),'d':lambda *a:json.dumps(entries)}
  exec(compile(ast.Module(body=[function],type_ignores=[]),'<release guard>','exec'),scope)
  return scope['envhash']()
 def test_only_new_flag_may_differ(self):
  self.assertEqual(self.fingerprint(['A=1','B=2']),self.fingerprint(['B=2','WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED=true','A=1']))
 def test_fabric_setting_change_is_rejected(self):
  self.assertNotEqual(self.fingerprint(['WMS_FBS_FABRIC_CUT_ENABLED=false']),self.fingerprint(['WMS_FBS_FABRIC_CUT_ENABLED=true']))
 def test_other_removed_changed_or_duplicated_setting_is_rejected(self):
  base=self.fingerprint(['A=1','B=2'])
  for changed in [['A=2','B=2'],['A=1'],['A=1','B=2','B=2']]:self.assertNotEqual(base,self.fingerprint(changed))

if __name__=='__main__':unittest.main()
