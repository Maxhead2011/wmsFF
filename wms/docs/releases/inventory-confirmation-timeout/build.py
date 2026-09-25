"""FIX: exact, reviewed transaction-boundary delta over the pinned production runtime."""
from pathlib import Path
import hashlib
import json
import sys
import tarfile

here = Path(__file__).resolve().parent
product = here.parents[2]
baseline = product / 'baselines/our-wms/2026-09-25-cancelled-kiz'
candidate = Path(sys.argv[1])
manifest = json.loads((baseline / 'manifest.json').read_text(encoding='utf8'))
name = 'modules/inventory/inventory.service.js'
target = candidate / name
assert hashlib.sha256(target.read_bytes()).hexdigest() == manifest['artifacts']['api-runtime.tar.gz']['files'][name]
runtime = target.read_text(encoding='utf8')
start = runtime.index('    async runSerializableInventoryDecision(operation) {')
end = runtime.index('    async resolveBox(', start)
old = runtime[start:end]
new = old.replace('isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,',
    "isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,\n                // FIX: preserve one atomic box decision while allowing serial KIZ checks to finish.\n                ...(process.env.WMS_INVENTORY_DECISION_TIMEOUT_ENABLED === 'true' ? { timeout: 30000, maxWait: 5000 } : {}),")
new = new.replace('        catch (error) {', """        catch (error) {
            // FIX: a rolled-back timeout is actionable; never retry side effects automatically.
            if (process.env.WMS_INVENTORY_DECISION_TIMEOUT_ENABLED === 'true' &&
                error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2028' &&
                /expired|timeout|timed out/i.test(error.message)) {
                throw new common_1.ServiceUnavailableException('Не удалось подтвердить актуализацию вовремя. Сохранённые сканы доступны; повторите подтверждение, не пересчитывая короб.');
            }""")
assert new != old
target.write_bytes((runtime[:start] + new + runtime[end:]).encode('utf8'))

with tarfile.open(baseline / 'api-source-reference.tar.gz', 'r:gz') as archive:
    source = archive.extractfile('src/modules/inventory/inventory.service.ts').read().decode('utf8')
start = source.index('  private async runSerializableInventoryDecision<T>(')
end = source.index('  async resolveBox(', start)
old = source[start:end]
new = old.replace('isolationLevel: Prisma.TransactionIsolationLevel.Serializable,',
    "isolationLevel: Prisma.TransactionIsolationLevel.Serializable,\n        // FIX: opt-in bounded budget for our WMS, same outer transaction for every line.\n        ...(process.env.WMS_INVENTORY_DECISION_TIMEOUT_ENABLED === 'true' ? { timeout: 30_000, maxWait: 5_000 } : {}),")
new = new.replace('    } catch (error) {', """    } catch (error) {
      // FIX: return a retryable error without retrying uncertain work automatically.
      if (process.env.WMS_INVENTORY_DECISION_TIMEOUT_ENABLED === 'true' &&
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028' &&
        /expired|timeout|timed out/i.test(error.message)) {
        throw new ServiceUnavailableException('Не удалось подтвердить актуализацию вовремя. Сохранённые сканы доступны; повторите подтверждение, не пересчитывая короб.');
      }""")
assert new != old
source = (source[:start] + new + source[end:]).replace('Injectable, NotFoundException }', 'Injectable, NotFoundException, ServiceUnavailableException }', 1)
(here / 'inventory.service.ts').write_bytes(source.encode('utf8'))
print(json.dumps({'changedRuntime': name, 'source': str(here / 'inventory.service.ts')}))
