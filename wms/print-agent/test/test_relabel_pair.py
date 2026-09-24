"""Execute the real agent's job block with a fake printer and API, without printing."""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class RelabelPairTest(unittest.TestCase):
    def run_agent_job(self, scenario):
        harness = r'''
$ErrorActionPreference = 'Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:TEST_AGENT_PATH,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'PowerShell syntax errors' }
$branch=$ast.Find({param($node) $node -is [System.Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -eq '$job'},$true)
if (-not $branch) { throw 'Missing actual job handler' }
$body=($branch.Clauses[0].Item2.Statements | ForEach-Object {$_.Extent.Text}) -join "`n"
$script:printed=[Collections.Generic.List[string]]::new()
$script:acks=[Collections.Generic.List[bool]]::new()
$cfg=@{printerName='FAKE';labelWidthMm=58;labelHeightMm=40}
$job=@{id='test';source='TSD_RELABEL';stickerBase64='AQID';sortingLabel=@{imageBase64='AQID';contentType='image/png';widthMm=58;heightMm=40}}
switch($env:TEST_SCENARIO) {
 'missing' {$job.sortingLabel=$null}
 'different' {$job.sortingLabel.imageBase64='BAUG'}
 'invalid' {$job.sortingLabel.imageBase64='not-base64!'}
 'ordinary' {$job.source='TSD_FBS_ASSEMBLY';$job.sortingLabel.imageBase64='U09SVA=='}
 'ordinary-missing' {$job.source='TSD_FBS_ASSEMBLY';$job.sortingLabel=$null}
}
function Print-OneLabel([byte[]]$bytes,[string]$printer,[int]$width,[int]$height) {
 if($env:TEST_SCENARIO -eq 'second-fails' -and $script:printed.Count -eq 1){throw 'second print failed'}
 $script:printed.Add([Convert]::ToBase64String($bytes))
}
$sorting=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Print-SortingLabel'},$true)
. ([scriptblock]::Create($sorting.Extent.Text))
function Invoke-WmsApi($method,$url,$body) {
 if(-not $url.EndsWith('/result')){throw 'Unexpected API call'}
 if($body.success -and $script:printed.Count -ne 2){throw 'Premature ACK'}
 $script:acks.Add([bool]$body.success)
}
& ([scriptblock]::Create($body))
if($script:acks.Count -ne 1){throw 'Expected exactly one result'}
switch($env:TEST_SCENARIO) {
 'ordinary' {if(($script:printed -join ',') -ne 'AQID,U09SVA==' -or -not $script:acks[0]){throw 'Server-rendered service label was not printed'}}
 'pair' {if(($script:printed -join ',') -ne 'AQID,AQID' -or -not $script:acks[0]){throw 'Expected two identical target labels'}}
 'second-fails' {if($script:printed.Count -ne 1 -or $script:acks[0]){throw 'Failed second print reported as success'}}
 default {if($script:printed.Count -ne 0 -or $script:acks[0]){throw 'Invalid pair printed or acknowledged'}}
}
'''
        with tempfile.TemporaryDirectory(dir=ROOT.parents[1]) as directory:
            path = pathlib.Path(directory) / 'check.ps1'
            path.write_text(harness, encoding='utf-8-sig')
            env = dict(os.environ, TEST_AGENT_PATH=str(ROOT / 'LOGOFF-FBS-Print-Agent.ps1'), TEST_SCENARIO=scenario)
            result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(path)], env=env, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    # TEST: exercise the actual printing/acknowledgement block, not text matching.
    def test_two_identical_target_labels(self): self.run_agent_job('pair')
    def test_missing_pair_is_rejected_before_printing(self): self.run_agent_job('missing')
    def test_wrong_second_image_is_rejected_before_printing(self): self.run_agent_job('different')
    def test_invalid_second_image_is_rejected_before_printing(self): self.run_agent_job('invalid')
    def test_second_print_failure_cannot_ack_success(self): self.run_agent_job('second-fails')
    def test_sos_prints_the_agreed_server_rendered_service_label(self): self.run_agent_job('ordinary')
    def test_missing_service_label_cannot_print_half_a_pair(self): self.run_agent_job('ordinary-missing')


if __name__ == '__main__':
    unittest.main()
