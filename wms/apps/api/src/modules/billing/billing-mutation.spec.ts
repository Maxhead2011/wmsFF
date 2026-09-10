import { describe, expect, it, vi } from 'vitest';
import { afterBillingCommit, isBillingMutationClient, isOwnedUnpaidDraft, runBillingMutation, withBillingDb } from './billing-mutation';

// TEST: lock before business reads, nested calls share transaction, no notification on rollback.
describe('billing mutation boundary', () => {
  // TEST: only the automation's own unpaid source draft can follow tariff recalculation.
  it('freezes source charges in period, manual, merged, or paid drafts', () => {
    const own = { sourceKey: 'fbs-invoice:c:s', status: 'DRAFT', paidRub: 0, _count: { payments: 0 } };
    expect(isOwnedUnpaidDraft(own, own.sourceKey)).toBe(true);
    for (const invoice of [
      { ...own, sourceKey: 'billing-period:c:month' },
      { ...own, sourceKey: null },
      { ...own, paidRub: 1 },
      { ...own, _count: { payments: 1 } },
      { ...own, status: 'ISSUED' },
    ]) expect(isOwnedUnpaidDraft(invoice, own.sourceKey)).toBe(false);
  });
  function database() {
    const events: string[] = [];
    const tx: any = { $queryRaw: vi.fn(async () => { events.push('lock'); return []; }),
      billingInvoice: { count: vi.fn(async () => { events.push('read'); return 2; }) } };
    const db: any = { $transaction: vi.fn(async (callback: any) => {
      events.push('begin');
      const result = await callback(tx);
      events.push('commit');
      return result;
    }) };
    return { events, tx, db };
  }
  it('uses one global financial DB lock, then commits before notifications', async () => {
    const { db, events, tx } = database();
    const result = await runBillingMutation(db, async scoped => {
      expect(isBillingMutationClient(scoped)).toBe(true);
      afterBillingCommit(() => { events.push('notify'); });
      return scoped.billingInvoice.count();
    });
    expect(result).toBe(2);
    expect(events).toEqual(['begin', 'lock', 'read', 'commit', 'notify']);
    expect(tx.$queryRaw.mock.calls[0].join('')).toContain('pg_advisory_xact_lock');
  });
  it('reuses the transaction from both a nested root call and legacy transaction callback', async () => {
    const { db, events } = database();
    await runBillingMutation(db, async scoped => {
      await runBillingMutation(db, nested => nested.billingInvoice.count());
      await scoped.$transaction(nested => nested.billingInvoice.count());
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'lock', 'read', 'read', 'commit']);
  });
  it('never swaps the shared service singleton DB or sends a rollback notification', async () => {
    const { db } = database();
    const notify = vi.fn();
    class Service { constructor(readonly prisma: any) {} async read() { return this.prisma.billingInvoice.count(); } }
    const original = new Service(db);
    await expect(runBillingMutation(db, async scoped => {
      const isolated = withBillingDb(original, scoped);
      expect(original.prisma).toBe(db);
      expect(await isolated.read()).toBe(2);
      afterBillingCommit(notify);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(notify).not.toHaveBeenCalled();
    expect(original.prisma).toBe(db);
  });
  it('fails closed if the transaction or lock cannot start', async () => {
    const operation = vi.fn();
    await expect(runBillingMutation({} as any, operation)).rejects.toThrow();
    const { db, tx } = database();
    tx.$queryRaw.mockRejectedValue(new Error('lock failed'));
    await expect(runBillingMutation(db, operation)).rejects.toThrow('lock failed');
    expect(operation).not.toHaveBeenCalled();
  });
});
