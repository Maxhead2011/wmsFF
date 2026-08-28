import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  fbsBoxClaimInput,
  runFbsBoxClaimTransaction,
} from '../src/modules/marketplace-connections/fbs-box-claim-retry';

function writeConflict() {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock.',
    { code: 'P2034', clientVersion: 'test' },
  );
}

describe('MarketplaceConnectionsService FBS box claim synchronization', () => {
  // TEST: A background route refresh can collide with the only active picker.
  // The same physical scan must be retried instead of being reported as another request.
  it('retries a serializable write conflict and keeps the box for the current picker', async () => {
    const claimed = { id: 'task-382', boxId: 'box-07' };
    const transaction = vi.fn()
      .mockRejectedValueOnce(writeConflict())
      .mockResolvedValueOnce(claimed);

    await expect(runFbsBoxClaimTransaction(transaction))
      .resolves.toEqual(claimed);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  // TEST: Every retry must recompute the route from the freshly loaded task,
  // never reuse the SKU or quantity that lost the serialization race.
  it('recomputes SKU and quantity after a background refresh wins the first attempt', async () => {
    let currentTask = {
      skuId: 'sku-old',
      sourceSkuId: null,
      relabelRequired: false,
      itemCount: 1,
    };
    const observedInputs: Array<ReturnType<typeof fbsBoxClaimInput>> = [];
    const transaction = vi.fn(async () => {
      observedInputs.push(fbsBoxClaimInput(currentTask));
      if (observedInputs.length === 1) {
        currentTask = {
          skuId: 'sku-new',
          sourceSkuId: 'sku-source-new',
          relabelRequired: true,
          itemCount: 3,
        };
        throw writeConflict();
      }
      return fbsBoxClaimInput(currentTask);
    });

    await expect(runFbsBoxClaimTransaction(transaction)).resolves.toEqual({
      stockSkuId: 'sku-source-new',
      requiredQuantity: 3,
    });
    expect(observedInputs).toEqual([
      { stockSkuId: 'sku-old', requiredQuantity: 1 },
      { stockSkuId: 'sku-source-new', requiredQuantity: 3 },
    ]);
  });

  // TEST: A persistent technical collision must never accuse another request.
  it('returns a retryable technical conflict after bounded transaction retries', async () => {
    const transaction = vi.fn().mockRejectedValue(writeConflict());

    const result = runFbsBoxClaimTransaction(transaction);
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'FBS_BOX_CLAIM_BUSY',
      }),
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  // TEST: A real stock/reservation rejection remains a business result and is not retried.
  it('does not retry a confirmed unavailable-box decision', async () => {
    const transaction = vi.fn().mockResolvedValue(null);

    await expect(runFbsBoxClaimTransaction(transaction))
      .resolves.toBeNull();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  // TEST: Only PostgreSQL serialization conflicts are safe to repeat.
  it('does not retry or mask an unrelated transaction failure', async () => {
    const databaseFailure = new Error('database unavailable');
    const transaction = vi.fn().mockRejectedValue(databaseFailure);

    await expect(runFbsBoxClaimTransaction(transaction))
      .rejects.toBe(databaseFailure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
