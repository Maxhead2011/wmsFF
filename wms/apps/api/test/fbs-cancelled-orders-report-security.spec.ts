import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FbsCancelledOrdersReportDto } from '../src/modules/marketplace-connections/dto/fbs-cancelled-orders-report.dto';

describe('FBS cancelled-orders report boundary', () => {
  // TEST: read-only history larger than the 5,000 write-operation limit remains exportable.
  it('accepts a 5,001-order report payload', async () => {
    const dto = plainToInstance(FbsCancelledOrdersReportDto, {
      clientId: 'client-1',
      orders: Array.from({ length: 5_001 }, (_, index) => ({
        connectionId: 'connection-1',
        id: String(5_500_000_000 + index),
      })),
    });

    expect(await validate(dto)).toEqual([]);
  });

  // TEST: the method-level decorator must not override class access with an empty permission list.
  it('explicitly requires clients:read on the export route', () => {
    const source = readFileSync(
      new URL('../src/modules/marketplace-connections/marketplace-connections.controller.ts', import.meta.url),
      'utf8',
    );
    const route = source.slice(source.indexOf("@Post('fbs/orders/cancelled-report.xlsx')"));

    expect(route.slice(0, 220)).toContain("@RequirePermissions('clients:read')");
  });
});
