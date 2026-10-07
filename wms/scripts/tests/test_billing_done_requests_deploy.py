"""TEST: financial release configuration checks without Docker, network or credentials."""
import ast, pathlib, re, unittest

source = pathlib.Path(__file__).parents[1] / 'deploy-billing-done-requests.py'
nodes = [n for n in ast.parse(source.read_text(encoding='utf-8')).body if isinstance(n, ast.FunctionDef) and n.name in ('enable', 'verify')]
namespace = {'re': re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)

class ReleaseTests(unittest.TestCase):
    def test_flag_keeps_existing_settings(self):
        before = 'services:\n  api:\n    environment:\n      OLD_FLAG: "true"\n    restart: unless-stopped\n  web:\n    environment:\n      WEB_FLAG: "true"\n'
        after = namespace['enable'](before)
        self.assertEqual(after.replace('      WMS_BILLING_DONE_REQUESTS_ENABLED: "true"\n', ''), before)
        with self.assertRaises(RuntimeError): namespace['enable'](after)

    def test_ambiguous_configuration_is_rejected(self):
        with self.assertRaises(RuntimeError): namespace['enable']('services:\n  api:\n    restart: unless-stopped\n')

    def test_only_declared_delta_allowed(self):
        namespace['verify']({'old':'a'}, {'old':'a','new':'b'}, {'new':'b'})
        for actual in ({'new':'b'}, {'old':'changed','new':'b'}, {'old':'a','new':'wrong'}):
            with self.assertRaises(RuntimeError): namespace['verify']({'old':'a'}, actual, {'new':'b'})

if __name__ == '__main__': unittest.main()
