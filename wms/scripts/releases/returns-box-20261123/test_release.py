"""TEST: exercise the exact deploy environment comparator without running deployment."""
import ast,json,unittest
from pathlib import Path

class ReleaseEnvironmentTest(unittest.TestCase):
 def test_order_is_ignored_but_values_and_keys_are_not(self):
  tree=ast.parse(Path(__file__).with_name('release.py').read_text())
  function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='env')
  current=['A=one','B=two=three']
  scope={'json':json,'run':lambda *args:json.dumps(current)}
  exec(compile(ast.Module(body=[function],type_ignores=[]),'release-env','exec'),scope)
  before=scope['env']()
  current.reverse();self.assertEqual(before,scope['env']())
  current[0]='B=changed';self.assertNotEqual(before,scope['env']())
  current.pop();self.assertNotEqual(before,scope['env']())

if __name__=='__main__':unittest.main()
