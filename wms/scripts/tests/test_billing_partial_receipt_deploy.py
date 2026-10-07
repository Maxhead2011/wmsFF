"""TEST: reject unrelated runtime delta; publication must not alter compose."""
import ast,pathlib,unittest
source=pathlib.Path(__file__).parents[1]/'deploy-billing-partial-receipt.py'
tree=ast.parse(source.read_text(encoding='utf-8'))
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verify']
namespace={};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),namespace)
class ReleaseTests(unittest.TestCase):
    def test_delta_and_configuration_guards(self):
        namespace['verify']({'old':'a'},{'old':'a','new':'b'},{'new':'b'})
        for actual in ({'new':'b'},{'old':'wrong','new':'b'},{'old':'a','new':'wrong'}):
            with self.assertRaises(RuntimeError):namespace['verify']({'old':'a'},actual,{'new':'b'})
        self.assertFalse(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='CF' and n.func.attr=='write_text' for n in ast.walk(tree)))
if __name__=='__main__':unittest.main()
