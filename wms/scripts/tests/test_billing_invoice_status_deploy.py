"""TEST: unrelated assets, missing assets and wrong payload hashes abort deployment."""
import ast, pathlib, unittest
source=pathlib.Path(__file__).parents[1]/'deploy-billing-invoice-status.py'
nodes=[n for n in ast.parse(source.read_text(encoding='utf-8')).body if isinstance(n,ast.FunctionDef) and n.name=='verify']
namespace={};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),namespace)
class ReleaseTests(unittest.TestCase):
    def test_preserves_prior_assets_and_rejects_unreviewed_changes(self):
        namespace['verify']({'old':'a','index':'i'},{'old':'a','index':'j','new':'b'},{'index':'j','new':'b'})
        for after in ({'index':'j','new':'b'},{'old':'changed','index':'j','new':'b'},{'old':'a','index':'j','new':'wrong'}):
            with self.assertRaises(RuntimeError):namespace['verify']({'old':'a','index':'i'},after,{'index':'j','new':'b'})
if __name__=='__main__':unittest.main()
