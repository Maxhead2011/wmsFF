"""Prepare an exact runtime overlay; ambiguous/drifted source hunks abort.

Arguments: published-dist compiled-base compiled-candidate NEW-output-dist
This script does not connect to or deploy a server.
"""
from pathlib import Path
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import sys

def main():
    live, base, compiled, target = map(Path, sys.argv[1:])
    if target.exists():
        raise ValueError('Output must be a new directory')
    names = [
        'client-requests/client-requests.service',
        'marketplace-connections/marketplace-connections.service',
        'marketplace-connections/ozon-fbs-pick-workflow',
        'stock/fbs-picked-stock-proof', 'stock/stock-operations.service',
    ]
    names += ['warehouse/' + p.stem for p in (compiled/'modules/warehouse').glob('fabric-fbs-*.js') if '.spec.' not in p.name]
    names += ['marketplace-connections/fbs-fabric-queue']
    output, changes = {}, []
    for name in names:
        relative = 'modules/' + name + '.js'
        new = (compiled/relative).read_text(encoding='utf8')
        old_path = base/relative
        live_path = live/relative
        if not old_path.exists():
            if live_path.exists():
                raise ValueError('Unexpected existing runtime module: ' + relative)
            patched = new
        else:
            old = old_path.read_text(encoding='utf8')
            if old == new:
                continue
            runtime = live_path.read_text(encoding='utf8')
            a, b = old.splitlines(True), new.splitlines(True)
            # FIX: preserve all runtime-only code. Never replace an entire service.
            matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
            patched = runtime
            for group in matcher.get_grouped_opcodes(1 if name=='marketplace-connections/ozon-fbs-pick-workflow' else 3):
                edits=[op for op in group if op[0]!='equal']
                changed_lines=[line for _,i,j,k,l in edits for line in a[i:j]+b[k:l]]
                if changed_lines and all(re.match(r'^const \w+ = require\(',line) for line in changed_lines):
                    for _,i,j,k,l in edits:
                        for line in b[k:l]:
                            if line not in a and line not in patched:
                                patched=line+patched
                    continue
                before = ''.join(a[group[0][1]:group[-1][2]])
                after = ''.join(b[group[0][3]:group[-1][4]])
                if name=='marketplace-connections/marketplace-connections.service' and len(edits)==1 and edits[0][0]=='insert' and 'const fabricAssignment =' in after:
                    # Manually verified: published queue retains the same source
                    # resolver but omits the source comment above it.
                    anchor='                    const stockSource = await this.resolveDovoz1049TsdStockSource(existing) ?? await this.resolveFbsTsdStockSource(clientId, product, order.storageBoxes, existing?.id);\n'
                    if patched.count(anchor)!=1:
                        raise ValueError('Published FBS queue anchor changed')
                    op=edits[0]
                    patched=patched.replace(anchor,''.join(b[op[3]:op[4]])+anchor,1)
                    continue
                if name=='client-requests/client-requests.service':
                    # The published removal guard uses this verified alias.
                    source_guard='await (0, request_removal_policy_1.lockRequestNotRemoved)(tx, id);'
                    runtime_guard='await removal.lockRequestNotRemoved(tx,id);'
                    before=before.replace(source_guard,runtime_guard)
                    after=after.replace(source_guard,runtime_guard)
                if name=='marketplace-connections/marketplace-connections.service':
                    if 'const fabricProduced =' in after:
                        # Preserve published manager-accounting guard at loop start.
                        loop='            for (const link of liveLinks) {\n'
                        before=before.replace(loop,'')
                        after=after.replace(loop,'')
                    if "'fbs_complete'" in before:
                        declaration='const task = await this.loadOwnedFbsTsdAssembly(taskId, user);'
                        retained='let task = await this.loadOwnedFbsTsdAssembly(taskId, user);\n        const physicalPick = (0, fbs_physical_pick_1.physicalPickConfirmationEnabled)(task, user);'
                        before=before.replace(declaration,retained)
                        after=after.replace(declaration,retained)
                    for operation in ['fbs_scan','fbs_complete','fbs_response']:
                        source_call="(0, operation_timing_1.measureOperation)('"+operation+"', async () => {"
                        live_call="require('../../common/diagnostics/operation-timing').measureOperation('"+operation+"',async()=>{"
                        before=before.replace(source_call,live_call)
                        after=after.replace(source_call,live_call)
                if not before or patched.count(before) != 1:
                    # Runtime hotfixes may indent context differently; match only
                    # leading whitespace, never normalize tokens or expressions.
                    pattern=''.join(r'^[ \t]*'+re.escape(line.lstrip(' \t')) for line in before.splitlines(True))
                    matches=list(re.finditer(pattern,patched,re.MULTILINE))
                    if not before or len(matches)!=1:
                        helper=Path(__file__).with_name('token-hunk.cjs')
                        typescript=compiled.parents[2]/'node_modules/typescript'
                        result=subprocess.run(['node',str(helper),str(typescript)],input=json.dumps({'text':patched,'before':before,'after':after}),text=True,encoding='utf8',capture_output=True)
                        if result.returncode:
                            raise ValueError('Runtime hunk differs in '+relative+'\n'+before[:700]+'\n'+result.stderr[:1100])
                        patched=json.loads(result.stdout)
                        continue
                    before=matches[0].group(0)
                patched = patched.replace(before, after, 1)
        output[relative] = patched.encode('utf8')
        changes.append({'path': relative, 'sha256': hashlib.sha256(output[relative]).hexdigest()})
    shutil.copytree(live, target)
    for name, content in output.items():
        (target/name).parent.mkdir(parents=True, exist_ok=True)
        (target/name).write_bytes(content)
    print(json.dumps(changes, indent=2))

if __name__ == '__main__':
    main()




