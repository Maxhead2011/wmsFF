import { PrismaClient } from '@prisma/client';
import { doneRequestPackingEnabled, reconcileDoneRequestPacking } from '../common/stock/done-request-packing';

// FIX: preview is read-only by default; --apply additionally requires our rollout flag.
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || args.length > 1) throw new Error('Use --dry-run (default) or --apply');
  const apply = args.includes('--apply');
  if (apply && !doneRequestPackingEnabled()) throw new Error('WMS_DONE_PACKING_RECONCILIATION_ENABLED must be true');
  const db = new PrismaClient();
  let corrected = 0, units = 0, unresolved = 0;
  try {
    const requests = await db.clientRequest.findMany({ where: { status: 'DONE', type: { in: ['OUTBOUND', 'DELIVERY'] } },
      select: { id: true, number: true, clientId: true }, orderBy: { id: 'asc' },
    });
    for (const request of requests) {
      try {
        const quantity = await db.$transaction(async tx => {
          if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          return reconcileDoneRequestPacking(tx, request.id, !apply);
        }, { timeout: 30_000, isolationLevel: apply ? 'ReadCommitted' : 'RepeatableRead' });
        if (quantity) { corrected++; units += quantity; console.log(JSON.stringify({ ...request, quantity, mode: apply ? 'applied' : 'preview' })); }
      } catch (error) {
        unresolved++;
        console.log(JSON.stringify({ ...request, mode: 'requires-review', error: error instanceof Error ? error.message : String(error) }));
      }
    }
    console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', corrected, units, unresolved }));
    if (unresolved) process.exitCode = 2;
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
