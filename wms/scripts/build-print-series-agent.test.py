"""TEST: package upgrades explicitly install the required companion module."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

class AgentPackageTest(unittest.TestCase):
    def test_existing_station_instructions_and_config_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.zip'
            output=Path(directory)/'updated.zip'
            with zipfile.ZipFile(source,'w') as z:
                z.writestr('LOGOFF-FBS-Print-Agent.ps1','Add-Type -AssemblyName System.Drawing\n  Start-Sleep -Seconds 2\n')
                z.writestr('README.txt','На уже подключённой станции замените файл LOGOFF-FBS-Print-Agent.ps1 обновлённым из архива и перезапустите агент.')
                z.writestr('config.example.json','{}')
            subprocess.run([sys.executable,str(Path(__file__).with_name('build-print-series-agent.py')),str(source),str(output)],check=True,capture_output=True)
            with zipfile.ZipFile(output) as z:
                text=z.read('README.txt').decode('utf-8-sig')
                self.assertIn('PrintSeries.ps1',text)
                self.assertIn('Сохраните существующий config.json',text)
                self.assertIn('PrintSeries.ps1',z.namelist())
                self.assertNotIn('config.json',z.namelist())
                self.assertEqual(z.read('config.example.json'),b'{}')

if __name__=='__main__':unittest.main()
