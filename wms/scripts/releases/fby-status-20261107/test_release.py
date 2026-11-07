"""TEST: environment order is irrelevant, values and duplicate keys are not."""
import ast, hashlib, json, unittest
from pathlib import Path

tree=ast.parse(Path(__file__).with_name('release.py').read_text())
scope={'hashlib':hashlib,'json':json}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['sha','env_hash']],type_ignores=[]),'release-functions','exec'),scope)

class EnvironmentTest(unittest.TestCase):
 def test_reordered(self):
  self.assertEqual(scope['env_hash']('["A=1","B=2"]'),scope['env_hash']('["B=2","A=1"]'))
 def test_changed(self):
  self.assertNotEqual(scope['env_hash']('["A=1"]'),scope['env_hash']('["A=2"]'))
 def test_duplicate(self):
  with self.assertRaises(AssertionError):scope['env_hash']('["A=1","A=2"]')

if __name__=='__main__':unittest.main()
