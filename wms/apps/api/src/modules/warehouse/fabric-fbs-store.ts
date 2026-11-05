import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FabricLedger } from './fabric-fbs-ledger';

export interface FabricStoreTransaction {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  systemSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
    update(args: { where: { key: string }; data: { value: Prisma.InputJsonValue } }): Promise<unknown>;
  };
}

// FIX: caller owns the surrounding request-first transaction. All colours and
// branches share this existing lock because the entire client ledger is one JSON.
// Never perform an external marketplace request from the callback.
export async function withLockedFabricLedger<T>(
  tx: FabricStoreTransaction,
  clientId: string,
  operation: (ledger: FabricLedger) => Promise<{ ledger: FabricLedger; result: T }>,
): Promise<T> {
  if (!clientId.trim()) throw new ConflictException('Не указан клиент учёта ткани.');
  const key = `fabric.rolls.v1:${clientId}`;
  const locks = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked
  `;
  if (locks[0]?.locked !== true) {
    throw new ConflictException('Ткань сейчас обрабатывается другим сотрудником. Повторите операцию.');
  }
  const record = await tx.systemSetting.findUnique({ where: { key } });
  if (!record || !record.value || typeof record.value !== 'object' ||
      Array.isArray(record.value) || !Array.isArray((record.value as FabricLedger).rolls)) {
    throw new ConflictException('Учёт рулонов не заполнен или требует проверки.');
  }
  // Preserve every unrelated field, including historical shipment credits.
  const ledger = JSON.parse(JSON.stringify(record.value)) as FabricLedger;
  const outcome = await operation(ledger);
  await tx.systemSetting.update({
    where: { key }, data: { value: outcome.ledger as unknown as Prisma.InputJsonValue },
  });
  return outcome.result;
}
