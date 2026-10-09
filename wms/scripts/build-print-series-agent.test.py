"""TEST: the historical overlay must not publish a package missing durable journal dependencies."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class AgentPackageTest(unittest.TestCase):
    def test_legacy_overlay_requires_complete_package_builder(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'updated.zip'
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('build-print-series-agent.py')),'old.zip',str(output)],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('Build-Package.ps1',result.stderr)
            self.assertFalse(output.exists())

if __name__=='__main__':unittest.main()
