"""Regression checks: a registered printer is not ready until its agent heartbeats."""

import pathlib
import json
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class StartupStatusTest(unittest.TestCase):
    # TEST: Setup must wait for a fresh heartbeat instead of treating task launch as success.
    def test_setup_confirms_station_online_after_starting_task(self):
        source = (ROOT / 'Setup-Agent.ps1').read_text(encoding='utf-8-sig')
        start = source.index("Start-ScheduledTask -TaskName 'LOGOFF FBS Print Agent'")
        ready = source.index("$status.Text = 'Ready. The print station is connected.'")
        between = source[start:ready]
        self.assertIn('Wait-StationOnline', between)
        self.assertIn('lastSeenAt', source)
        self.assertIn('Get-ScheduledTaskInfo', source)

    # TEST: startup and polling errors must be recorded for the operator.
    def test_agent_records_startup_and_loop_errors(self):
        source = (ROOT / 'LOGOFF-FBS-Print-Agent.ps1').read_text(encoding='utf-8-sig')
        self.assertIn('function Write-AgentError', source)
        self.assertIn('Write-AgentError', source[source.index('$cfg = Read-Config'):])
        self.assertNotIn('catch { $script:token = $null }', source)

    # TEST: a missing Windows printer aborts startup and leaves a readable local error.
    def test_missing_printer_writes_startup_log(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parents[2]) as folder:
            directory = pathlib.Path(folder)
            script = directory / 'LOGOFF-FBS-Print-Agent.ps1'
            shutil.copyfile(ROOT / script.name, script)
            config = directory / 'config.json'
            config.write_text(json.dumps({'printerName': 'LOGOFF TEST PRINTER THAT DOES NOT EXIST'}), encoding='utf-8')
            result = subprocess.run(
                ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script),
                 '-ConfigPath', str(config)], capture_output=True, text=True, timeout=15,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('is not installed', (directory / 'agent.log').read_text(encoding='utf-8-sig'))


if __name__ == '__main__':
    unittest.main()
