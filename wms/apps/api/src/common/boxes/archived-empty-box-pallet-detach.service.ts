import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DETACH_AUDIT_MESSAGE = 'Пустой архивный короб автоматически удалён с паллетсорта';

type DetachDb = Pick<
  Prisma.TransactionClient,
  'box' | 'stockBalance' | 'storagePalletBox' | 'auditLog'
>;

export type ArchivedEmptyBoxDetachInput = {
  boxId: string;
  userId?: string;
  reason?: string;
};

@Injectable()
export class ArchivedEmptyBoxPalletDetachService {
  constructor(private readonly prisma: PrismaService) {}

  async previewIfArchivedAndEmpty(input: ArchivedEmptyBoxDetachInput, db?: DetachDb) {
    // FIX: reconciliation can perform the exact canonical check without mutating the placement.
    if (db) return this.evaluateInDatabase(input, db);
    return this.prisma.$transaction(
      (tx) => this.evaluateInDatabase(input, tx),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async detachIfArchivedAndEmpty(input: ArchivedEmptyBoxDetachInput, db?: DetachDb) {
    // FIX: callers already inside a stock transaction reuse it; standalone callers get one atomic transaction.
    if (db) return this.detachInTransaction(input, db);
    return this.prisma.$transaction(
      (tx) => this.detachInTransaction(input, tx),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async detachInTransaction(input: ArchivedEmptyBoxDetachInput, db: DetachDb) {
    const candidate = await this.evaluateInDatabase(input, db);
    if (!candidate.eligible || !candidate.placementId) {
      return { detached: false, boxId: candidate.boxId, quantity: candidate.quantity };
    }

    const removed = await db.storagePalletBox.deleteMany({
      // FIX: re-check both predicates in the DELETE statement to close the check/delete race.
      where: {
        id: candidate.placementId,
        boxId: candidate.boxId,
        box: {
          status: 'archived',
          balances: { none: { quantity: { gt: 0 } } },
        },
      },
    });
    if (removed.count === 0) {
      return { detached: false, boxId: candidate.boxId, quantity: candidate.quantity };
    }

    // FIX: audit is written only for the transaction that actually removed the active relation.
    await db.auditLog.create({
      data: {
        userId: input.userId,
        action: 'EMPTY_ARCHIVED_BOX_AUTO_DETACHED',
        entity: 'Box',
        entityId: candidate.boxId,
        payload: {
          message: DETACH_AUDIT_MESSAGE,
          boxCode: candidate.boxCode,
          clientId: candidate.clientId,
          warehouseId: candidate.warehouseId,
          palletId: candidate.palletId,
          reason: input.reason ?? null,
        },
      },
    });

    return {
      detached: true,
      boxId: candidate.boxId,
      palletId: candidate.palletId,
      quantity: candidate.quantity,
    };
  }

  private async evaluateInDatabase(input: ArchivedEmptyBoxDetachInput, db: DetachDb) {
    const box = await db.box.findUnique({
      where: { id: input.boxId },
      select: {
        id: true,
        code: true,
        clientId: true,
        warehouseId: true,
        status: true,
        storagePlacement: {
          select: { id: true, palletId: true, boxCode: true },
        },
      },
    });
    if (!box || box.status !== 'archived') {
      return { eligible: false, boxId: input.boxId, quantity: null };
    }

    // FIX: NULL is zero only when the aggregate confirms that no balance rows exist.
    const balance = await db.stockBalance.aggregate({
      // FIX: canonical factual stock is the sum of positive balance rows across statuses.
      where: { boxId: box.id, quantity: { gt: 0 } },
      _count: { _all: true },
      _sum: { quantity: true },
    });
    const rowCount = balance._count._all;
    if (rowCount > 0 && balance._sum.quantity == null) {
      throw new Error(`Не удалось определить фактический остаток короба ${box.code}.`);
    }
    const quantity = rowCount === 0 ? 0 : balance._sum.quantity!;
    if (quantity !== 0 || !box.storagePlacement) {
      return { eligible: false, boxId: box.id, quantity };
    }
    return {
      eligible: true,
      boxId: box.id,
      boxCode: box.code,
      clientId: box.clientId,
      warehouseId: box.warehouseId,
      palletId: box.storagePlacement.palletId,
      placementId: box.storagePlacement.id,
      quantity,
    };
  }
}
