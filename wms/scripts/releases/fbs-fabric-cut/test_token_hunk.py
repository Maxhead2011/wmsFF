import json
from pathlib import Path
import subprocess
import unittest

# FIX: dependencies belong to wms, not the repository parent.
ROOT=Path(__file__).resolve().parents[3]
HELPER=Path(__file__).with_name('token-hunk.cjs')

class TokenHunkTests(unittest.TestCase):
    def apply(self,text,before,after):
        return subprocess.run(['node',str(HELPER),str(ROOT/'node_modules/typescript')],
            input=json.dumps(dict(text=text,before=before,after=after)),
            capture_output=True,text=True,encoding='utf8')

    # TEST: formatting is tolerated, surrounding live behavior is preserved.
    def test_formatting_and_async_context(self):
        result=self.apply('async function f(){guard(); await work(); return 1;}',
                          'await work();\nreturn 1;', 'await work(); await extra(); return 1;')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('guard(); await work(); await extra();',json.loads(result.stdout))

    def test_different_behavior_rejected(self):
        result=self.apply('async function f(){await other();return 1;}',
                          'await work();return 1;','await extra();return 1;')
        self.assertNotEqual(result.returncode,0)

    def test_ambiguous_match_rejected(self):
        result=self.apply('function f(){work();} function g(){work();}', 'work();','extra();')
        self.assertNotEqual(result.returncode,0)

if __name__=='__main__':unittest.main()
