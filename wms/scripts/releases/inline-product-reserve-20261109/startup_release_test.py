"""TEST: Docker environment order is irrelevant; changed values remain rejected."""
import ast,json,unittest
from pathlib import Path
class EnvironmentProof(unittest.TestCase):
 def test_environment_order_and_values(self):
  tree=ast.parse(Path(__file__).with_name('startup-release.py').read_text())
  fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='environment')
  current=['A=one','B=two'];scope={'json':json,'inspect':lambda *_:json.dumps(current)}
  exec(compile(ast.Module(body=[fn],type_ignores=[]),'<environment>','exec'),scope)
  before=scope['environment']();current.reverse();self.assertEqual(before,scope['environment']())
  current[0]='B=changed';self.assertNotEqual(before,scope['environment']())
if __name__=='__main__':unittest.main()
