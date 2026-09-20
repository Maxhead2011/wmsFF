import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { historicalPackingEnabled, reconcileHistoricalPacking } from '../common/stock/historical-packing';

// FIX: explicit Moscow cutoff, saved preview, per-balance compare-and-apply.
// No automatic status changes or reclassification of active/cancelled stock.
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (args.some(a => a !== '--apply' && !a.startsWith('--before=') && !a.startsWith('--plan='))) throw new Error('Use --before=ISO --plan=file.json [--apply]');
  const cutoff = new Date(args.find(a => a.startsWith('--before='))?.slice(9) ?? 'invalid');
  const path = args.find(a => a.startsWith('--plan='))?.slice(7);
  if (!path || !Number.isFinite(cutoff.getTime()) || cutoff > new Date()) throw new Error('Explicit past cutoff and plan path required');
  if (apply && !historicalPackingEnabled()) throw new Error('Historical repair flag is disabled');
  const db = new PrismaClient();
  try {
    const plans: Awaited<ReturnType<typeof reconcileHistoricalPacking>>[] = [];
    const rejected: { balanceId: string; error: string }[] = [];
    if (!apply) {
      const clients = await db.client.findMany({ where: { isDemo: false }, select: { id: true } });
      const balances = await db.stockBalance.findMany({ where: { clientId: { in: clients.map(c => c.id) }, status: 'PACKING', quantity: { gt: 0 } }, select: { id: true }, orderBy: { id: 'asc' } });
      for (const balance of balances) try {
        const plan = await db.$transaction(async tx => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          return reconcileHistoricalPacking(tx, balance.id, cutoff);
        }, { timeout: 30000, isolationLevel: 'RepeatableRead' });
        if (plan.quantity) plans.push(plan);
      } catch (e) { rejected.push({ balanceId: balance.id, error: e instanceof Error ? e.message : String(e) }); }
      writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), cutoff: cutoff.toISOString(), plans, rejected }, null, 2), { flag: 'wx' });
    } else {
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      if (manifest.cutoff !== cutoff.toISOString() || !Array.isArray(manifest.plans)) throw new Error('Manifest cutoff does not match');
      for (const plan of manifest.plans) try {
        const result = await db.$transaction(tx => reconcileHistoricalPacking(tx, plan.balanceId, cutoff, plan.fingerprint), { timeout: 30000 });
        plans.push(result);
        console.log(JSON.stringify({ mode: 'applied', ...result }));
      } catch (e) { rejected.push({ balanceId: plan.balanceId, error: e instanceof Error ? e.message : String(e) }); }
    }
    console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', balances: plans.length, units: plans.reduce((s, p) => s + p.quantity, 0), rejected }));
    if (rejected.length) process.exitCode = 2;
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
