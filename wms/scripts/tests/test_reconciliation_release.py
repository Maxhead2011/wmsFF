import ast
from pathlib import Path
import unittest


class MigrationRuntimeTest(unittest.TestCase):
    def test_mounted_migration_can_resolve_prisma(self):
        # TEST: /test/migrate.cjs has no local node_modules; working directory is insufficient.
        source = Path(__file__).parents[1] / 'releases/reconciliation-tools-20261015/publish.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        node = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == 'command' for t in n.targets))
        command = eval(compile(ast.Expression(node.value), '<command-test>', 'eval'), {
            'network': 'isolated', 'app': Path('/app'), 'r': Path('/test'),
            'v': {'candidate': 'test-image'},
        })
        env = 'NODE_PATH=/app/node_modules:/app/apps/api/node_modules'
        self.assertIn(env, command)
        self.assertEqual(command[command.index(env)-1], '-e')
        self.assertEqual(command[-2:], ['test-image', '/test/migrate.cjs'])
