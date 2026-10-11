"""Apply only manual FBS additions to a freshly materialized production baseline.

Does not connect to production or publish. Run release_baseline.py check-candidate
afterwards. Full local compiled services must never replace the runtime baseline.
"""
import argparse
from pathlib import Path


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Runtime patch anchor missing or ambiguous: ' + old)
    return text.replace(old, new, 1)


parser = argparse.ArgumentParser()
parser.add_argument('--compiled', type=Path, required=True)
parser.add_argument('--candidate', type=Path, required=True)
args = parser.parse_args()
base = 'modules/marketplace-connections/'
additions = ['fbs-manual-assembly.js', 'fbs-manual-assembly.service.js',
             'fbs-manual-assembly.controller.js', 'dto/fbs-manual-assembly.dto.js']
pending = {}
for name in additions:
    destination = args.candidate / base / name
    if destination.exists():
        raise ValueError('Refusing to overwrite existing module: ' + str(destination))
    pending[destination] = (args.compiled / base / name).read_text(encoding='utf8')

module = args.candidate / base / 'marketplace-connections.module.js'
text = module.read_text(encoding='utf8')
text = replace_once(text, 'let MarketplaceConnectionsModule =',
    'const fbs_manual_assembly_controller_1 = require("./fbs-manual-assembly.controller");\n'
    'const fbs_manual_assembly_service_1 = require("./fbs-manual-assembly.service");\n'
    'let MarketplaceConnectionsModule =')
text = replace_once(text, 'controllers: [', 'controllers: [fbs_manual_assembly_controller_1.FbsManualAssemblyController, ')
text = replace_once(text, 'providers: [', 'providers: [fbs_manual_assembly_service_1.FbsManualAssemblyService, ')
pending[module] = text

# Expose the existing raw HTTP helper without replacing the deployed marketplace service.
gateway = args.candidate / base / 'marketplace-connections.service.js'
pending[gateway] = replace_once(gateway.read_text(encoding='utf8'),
    'exports.marketplaceJson = marketplaceJson;',
    'exports.marketplaceJson = marketplaceJson;\nexports.marketplaceFetch = marketplaceFetch;')

registry = args.candidate / 'modules/administration/administration-internal-api.service.js'
text = registry.read_text(encoding='utf8')
text = replace_once(text, "'/marketplace-connection/fbs/reshipment',", "'/marketplace-connection/fbs/reshipment', '/service/fbs-manual-assembly',")
# This is the verified PR559 runtime count, intentionally different from source.
text = replace_once(text, 'routeCount: 129,', 'routeCount: 133,')
text = replace_once(text, "'Синхронизирует кабинеты, склады и заказы.',",
    "'Синхронизирует кабинеты, склады и заказы.', 'Сборка ФБС по номерам: администратор или собственник проверяет WB и доступные короба, создаёт одну обычную заявку в выбранном филиале с сохранением поставок WB; повторный запрос не дублирует заявку.',")
pending[registry] = text

for destination, text in pending.items():
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(text, encoding='utf8')
print('\n'.join(str(path.relative_to(args.candidate)).replace('\\', '/') for path in pending))
