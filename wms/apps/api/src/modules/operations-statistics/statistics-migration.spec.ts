import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
describe('statistics migration // TEST', () => {
  it('adds only a separate cache with an order identity constraint; never rewrites stock or requests', () => {
    const sql = readFileSync(resolve(__dirname, '../../../prisma/migrations/20260913000000_statistics_acceptance_facts/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE "OperationsStatisticsFact"');
    expect(sql).toContain('("marketplace", "connectionId", "orderId")');
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER)\b/i);
    expect(sql).not.toContain('"StockBalance"'); expect(sql).not.toContain('"FbsOrderRequestLink"');
  });
});
