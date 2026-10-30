"""Build a two-file overlay over the verified running artifact; never rebuild legacy dist."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

IMAGE = 'sha256:5c9b375d8ccbad42664bfe34dbfd909bbb5f35c6a367ce9b797265c0f664ce70'
SERVICE = 'modules/tsd/fbo-two-stage.service.js'
HELPER = 'modules/tsd/fbo-video-caption.js'
SERVICE_HASH = '619439abded8c265324fc5a3412dbb27699797754b507684e648b0fe89f298fb'


def replace_exact(text, old, new, expected=1):
    actual = text.count(old)
    if actual != expected:
        raise ValueError(f'Unsafe runtime anchor: expected {expected}, found {actual}: {old[:70]}')
    return text.replace(old, new)


def patch_service(text):
    # FIX: capture returned physical unit in both normal branches and both manual paths.
    text = replace_exact(text, 'const clientKizReview=', "const {createFboVideoCaption} = require('./fbo-video-caption');\nconst clientKizReview=")
    text = replace_exact(text, "                require('../client-requests/ozon-supply-policy').assertSupplyMutable(shipment?.integration,dto.action);",
                         "                let contourUnit; // FIX: accepted unit stays in the stock transaction.\n                require('../client-requests/ozon-supply-policy').assertSupplyMutable(shipment?.integration,dto.action);")
    text = replace_exact(text, 'await fbo_packing_undo_1.rememberPackedUnit(tx, packedUnit, user.id, key);',
                         'contourUnit = packedUnit;\nawait fbo_packing_undo_1.rememberPackedUnit(tx, packedUnit, user.id, key);', 2)
    text = replace_exact(text, 'await this.manualPack(tx, r, dto, user, key);', 'contourUnit = await this.manualPack(tx, r, dto, user, key);', 2)
    anchor = '                await tx.auditLog.create({ data: { userId: user.id, action: `FBO_${dto.action}`'
    text = replace_exact(text, anchor, "                const contourScan = await createFboVideoCaption(tx, {requestId:id, operationId:dto.operationId, action:dto.action, user, unit:contourUnit, barcode:dto.barcode, kiz:dto.kiz, boxNumber:dto.sourceBoxCode});\n" + anchor)
    text = replace_exact(text, "entityId: id, payload: { ...(dto.undoOperationId ?", "entityId: id, payload: { ...(contourScan ? {contourScan} : {}), ...(dto.undoOperationId ?")
    text = replace_exact(text, "        const packed = { state: 'PACKED',", "        let contourPackedUnit;\n        const packed = { state: 'PACKED',")
    text = replace_exact(text, '            await tx.fboAssemblyUnit.update({ where: { id: existing.id }, data: packed });',
                         '            contourPackedUnit = await tx.fboAssemblyUnit.update({ where: { id: existing.id }, data: packed });')
    text = replace_exact(text, '            await tx.fboAssemblyUnit.create({ data: { requestId: r.id, requestItemId: line.id, skuId: sku.id, barcode: line.barcode,',
                         '            contourPackedUnit = await tx.fboAssemblyUnit.create({ data: { requestId: r.id, requestItemId: line.id, skuId: sku.id, barcode: line.barcode,')
    text = replace_exact(text, '    }\n    // FIX: change packing representation of already picked stock, atomically with the first unit scan.',
                         '        return contourPackedUnit;\n    }\n    // FIX: change packing representation of already picked stock, atomically with the first unit scan.')
    return text


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True, help='Directory containing manifest.json and dist/')
    parser.add_argument('--output', type=Path, required=True, help='New, non-existing candidate directory')
    parser.add_argument('--node', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    if args.output.resolve().is_relative_to(args.baseline.resolve()):
        raise ValueError('Candidate must be outside the immutable baseline directory')
    manifest = json.loads((args.baseline / 'manifest.json').read_text(encoding='utf-8-sig'))
    baseline = args.baseline / 'dist'
    if manifest['image'] != IMAGE or manifest['files'].get(SERVICE) != SERVICE_HASH:
        raise ValueError('Unsupported running image or service hash: recapture and review a fresh baseline')
    actual = {p.relative_to(baseline).as_posix(): digest(p) for p in baseline.rglob('*') if p.is_file()}
    if actual != manifest['files']:
        raise ValueError('The captured baseline inventory has changed')
    if args.output.exists():
        raise ValueError('Candidate directory must be new; never overwrite another release')
    # No package-manager/build scripts: transpile only the new dependency-free helper.
    compile_js = "const fs=require('fs'),ts=require(process.argv[1]);const result=ts.transpileModule(fs.readFileSync(process.argv[2],'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,strict:true},reportDiagnostics:true});if(result.diagnostics?.length)throw new Error(JSON.stringify(result.diagnostics));process.stdout.write(result.outputText);"
    helper = subprocess.check_output([args.node, '-e', compile_js, str(root / 'node_modules/typescript'),
                                     str(root / 'apps/api/src/modules/tsd/fbo-video-caption.ts')])
    patched = patch_service((baseline / SERVICE).read_text(encoding='utf-8'))
    shutil.copytree(baseline, args.output / 'dist')
    (args.output / 'dist' / SERVICE).write_text(patched, encoding='utf-8', newline='\n')
    (args.output / 'dist' / HELPER).write_bytes(helper)
    after = {p.relative_to(args.output / 'dist').as_posix(): digest(p) for p in (args.output / 'dist').rglob('*') if p.is_file()}
    changed = sorted(path for path in set(actual) | set(after) if actual.get(path) != after.get(path))
    if changed != sorted([SERVICE, HELPER]):
        raise ValueError(f'Unexpected runtime changes: {changed}')
    payload = args.output / 'payload'
    for path in changed:
        (payload / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.output / 'dist' / path, payload / path)
    proof = {'baselineImage': IMAGE, 'sourceParityVerified': False, 'sourceRef': 'ab4c8550a567d0fe02ef9b33f1b07a5e4c745743',
             'baselineFileCount': len(actual), 'candidateFileCount': len(after),
             'changed': {path: {'before': actual.get(path), 'after': after[path]} for path in changed}}
    (args.output / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(proof, indent=2))


if __name__ == '__main__':
    main()
