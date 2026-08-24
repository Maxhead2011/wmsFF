import { createHash } from 'node:crypto';
import { ArchivedEmptyBoxPalletDetachService } from '../common/boxes/archived-empty-box-pallet-detach.service';
import { PrismaService } from '../common/prisma/prisma.service';

type ReconcileArguments = {
  apply: boolean;
  expectedCount: number | undefined;
  expectedDigest: string | undefined;
};

export function parseReconcileArguments(args: string[]): ReconcileArguments {
  const apply = args.includes('--apply');
  const expectedValue = args.find((value) => value.startsWith('--expected-count='))?.split('=', 2)[1];
  const expectedDigest = args
    .find((value) => value.startsWith('--expected-digest='))
    ?.split('=', 2)[1]
    ?.toLowerCase();
  const expectedCount = expectedValue === undefined ? undefined : Number(expectedValue);
  if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 0)) {
    throw new Error('--expected-count должен быть целым неотрицательным числом.');
  }
  if (apply && expectedCount === undefined) {
    throw new Error('Для --apply обязательно укажите --expected-count=N из предыдущего dry-run.');
  }
  if (expectedDigest !== undefined && !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error('--expected-digest должен быть SHA-256 из предыдущего dry-run.');
  }
  if (apply && expectedDigest === undefined) {
    throw new Error('Для --apply обязательно укажите --expected-digest=SHA256 из предыдущего dry-run.');
  }
  return { apply, expectedCount, expectedDigest };
}

export async function collectCandidateSnapshot(
  prisma: Pick<PrismaService, 'box'>,
  lifecycle: ArchivedEmptyBoxPalletDetachService,
) {
  let cursorId: string | undefined;
  let checked = 0;
  const boxIds: string[] = [];

  for (;;) {
    // FIX: page by persistent Box ids; no candidate list is accumulated in memory.
    const boxes = await prisma.box.findMany({
      where: { status: 'archived', storagePlacement: { isNot: null } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    if (boxes.length === 0) break;

    for (const box of boxes) {
      checked += 1;
      const preview = await lifecycle.previewIfArchivedAndEmpty({ boxId: box.id });
      if (!preview.eligible) continue;
      boxIds.push(box.id);
    }
    cursorId = boxes[boxes.length - 1]!.id;
  }

  const digest = createHash('sha256').update(boxIds.join('\n'), 'utf8').digest('hex');
  return { checked, count: boxIds.length, digest, boxIds };
}

export async function applyCandidateSnapshot(
  lifecycle: ArchivedEmptyBoxPalletDetachService,
  boxIds: string[],
) {
  let detached = 0;
  // FIX: only IDs frozen by the matching dry-run snapshot may be mutated.
  for (const boxId of boxIds) {
    const result = await lifecycle.detachIfArchivedAndEmpty({
      boxId,
      reason: 'background-reconciliation',
    });
    if (result.detached) detached += 1;
  }
  return { approved: boxIds.length, detached };
}

async function main() {
  const options = parseReconcileArguments(process.argv.slice(2));
  const prisma = new PrismaService();
  const lifecycle = new ArchivedEmptyBoxPalletDetachService(prisma);
  await prisma.$connect();
  try {
    const preview = await collectCandidateSnapshot(prisma, lifecycle);
    console.log(
      `DRY-RUN: проверено связей ${preview.checked}; найдено ${preview.count}; digest ${preview.digest}.`,
    );
    if (!options.apply) return;
    if (preview.count !== options.expectedCount || preview.digest !== options.expectedDigest) {
      throw new Error(
        'Набор кандидатов изменился. Повторите dry-run и используйте новые count/digest.',
      );
    }
    const applied = await applyCandidateSnapshot(lifecycle, preview.boxIds);
    console.log(
      `APPLY: утверждено ${applied.approved}; отвязано после повторной проверки ${applied.detached}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Сверка не выполнена: ${message}`);
    process.exitCode = 1;
  });
}
