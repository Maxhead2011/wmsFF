import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const FBS_BOX_CLAIM_ATTEMPTS = 3;

type FbsBoxClaimTaskInput = {
  skuId: string;
  sourceSkuId: string | null;
  relabelRequired: boolean;
  itemCount: number;
};

export function fbsBoxClaimInput(task: FbsBoxClaimTaskInput) {
  return {
    stockSkuId: task.relabelRequired && task.sourceSkuId
      ? task.sourceSkuId
      : task.skuId,
    requiredQuantity: Math.max(1, task.itemCount),
  };
}

export function sameFbsBoxClaimInput(
  left: ReturnType<typeof fbsBoxClaimInput>,
  right: ReturnType<typeof fbsBoxClaimInput>,
) {
  return left.stockSkuId === right.stockSkuId &&
    left.requiredQuantity === right.requiredQuantity;
}

export async function runFbsBoxClaimTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= FBS_BOX_CLAIM_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (caught) {
      const isWriteConflict =
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === 'P2034';
      if (!isWriteConflict) throw caught;
      if (attempt === FBS_BOX_CLAIM_ATTEMPTS) {
        // FIX: A background reservation refresh is not another picker. Keep
        // the response retryable and never accuse a different request.
        throw new ConflictException({
          code: 'FBS_BOX_CLAIM_BUSY',
          message: 'Маршрут одновременно обновился фоновым процессом. Повторите сканирование этого же короба.',
        });
      }
    }
  }

  throw new Error('FBS box claim retry loop exhausted unexpectedly.');
}
