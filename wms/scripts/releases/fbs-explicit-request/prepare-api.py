"""Prepare one FBS queue guard over the verified published PR765 runtime.

No connection, deployment, business data changes or flag updates are performed.
Usage: python prepare-api.py --target <new-directory> --base-image <live-api-image>
"""
import argparse
import json
from pathlib import Path
import runpy

WMS = Path(__file__).resolve().parents[3]
BASELINE = WMS / 'baselines/our-wms/2026-10-29-kiz-client-guard'
MODULE = 'modules/marketplace-connections/marketplace-connections.service.js'
BASE_MODULE_SHA256 = 'e0df618eea68f7cd062cecec43ec4b63652e5e6d6b9998ff0728adc63fc3d6cf'
BASELINE_TOOLS = runpy.run_path(str(WMS / 'scripts/release_baseline.py'))


def prepare(target, base_image):
    manifest = BASELINE_TOOLS['verify'](BASELINE)
    if base_image != manifest['containers']['infra-api-1']['image']:
        raise ValueError('Production image changed; review the newer baseline before preparing')
    # FIX: preserve every other deployed module, including the latest KIZ receipt guard.
    BASELINE_TOOLS['materialize'](BASELINE, target)
    path = target / MODULE
    original = path.read_bytes()
    if BASELINE_TOOLS['sha'](original) != BASE_MODULE_SHA256:
        raise ValueError('Unexpected marketplace module; refusing a fuzzy patch')
    text = original.decode('utf-8')
    method = text.index('    async getNextFbsTsdAssemblyUnlocked(')
    anchor = """        if (current) {
            return this.formatFbsTsdAssembly(current, user, 'Продолжите начатый заказ.');
        }
        const previousBatch = await this.prisma.fbsTsdAssembly.findFirst({"""
    location = text.index(anchor, method)
    if text.count(anchor) != 1:
        raise ValueError('Expected exactly one queue allocation boundary')
    guard = """        // FIX: an unscoped refresh may resume an owned task, never allocate another request.
        if (process.env.WMS_FBS_EXPLICIT_REQUEST_ENABLED === 'true' && !selectedRequestId) {
            return this.emptyFbsTsdAssembly(deviceCode, user,
                'Выберите FBS-заявку. После завершения сборки следующая заявка выбирается вручную.');
        }

"""
    allocation = location + anchor.index('        const previousBatch')
    path.write_bytes((text[:allocation] + guard + text[allocation:]).encode('utf-8'))
    return BASELINE_TOOLS['check_candidate'](BASELINE, target, base_image, [MODULE])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--base-image', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.target, args.base_image)))
