"""Prepare an offline, exact runtime overlay. Never deploys or changes server data."""
from pathlib import Path
import argparse
import hashlib
import json

parser = argparse.ArgumentParser()
parser.add_argument('base', type=Path)
parser.add_argument('helper', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
source = args.base.read_text(encoding='utf-8')
old = "() => this.loadFbsOrders(id, undefined, { historyMode: 'active-only', readOnly: true, billingMode: 'skip' })"
new = """async () => {
                // FIX: reconcile cached active WB rows omitted by /orders/new.
                const refreshed = await this.loadFbsOrders(id, undefined, { historyMode: 'active-only', readOnly: true, billingMode: 'skip' });
                return require('./fbs-display-wb-reconcile').reconcileWbDisplay(value, refreshed,
                    async (connectionId, orderIds) => {
                        const connection = await this.prisma.clientMarketplaceConnection.findFirstOrThrow({
                            where: { id: connectionId, clientId: id, marketplace: 'WILDBERRIES', isActive: true },
                            select: { apiKey: true },
                        });
                        const response = await marketplaceJson('https://marketplace-api.wildberries.ru/api/v3/orders/status', {
                            method: 'POST',
                            headers: { Authorization: connection.apiKey, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ orders: orderIds }),
                        });
                        return asArray(response.orders);
                    }, fbsOrderCategory, fbsStatusLabel);
            }"""
if source.count(old) != 1:
    raise SystemExit('Published display entry point differs. Inspect the fresh baseline.')
candidate = source.replace(old, new)
args.output.mkdir(parents=True, exist_ok=True)
(args.output / 'marketplace-connections.service.js').write_text(candidate, encoding='utf-8')
(args.output / 'fbs-display-wb-reconcile.js').write_bytes(args.helper.read_bytes())
manifest = {
    'baseServiceSha256': hashlib.sha256(args.base.read_bytes()).hexdigest(),
    'candidateServiceSha256': hashlib.sha256((args.output / 'marketplace-connections.service.js').read_bytes()).hexdigest(),
    'files': ['marketplace-connections.service.js', 'fbs-display-wb-reconcile.js'],
    'published': False,
}
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest))
