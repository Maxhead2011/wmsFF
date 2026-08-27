export type FbsSyncConflictBatchResult = {
  completed: number;
  total: number;
};

export class FbsSyncConflictBatchError extends Error {
  readonly completed: number;
  readonly total: number;

  constructor(completed: number, total: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Обработано ${completed} из ${total}. ${reason}`);
    this.name = 'FbsSyncConflictBatchError';
    this.completed = completed;
    this.total = total;
  }
}

// ADDED: run conflict resolutions one by one to avoid a burst of WB API calls.
export async function resolveFbsSyncConflictBatch(
  assemblyIds: string[],
  resolveOne: (assemblyId: string) => Promise<unknown>,
): Promise<FbsSyncConflictBatchResult> {
  const uniqueIds = [...new Set(assemblyIds.map((id) => id.trim()).filter(Boolean))];
  let completed = 0;
  for (const assemblyId of uniqueIds) {
    try {
      await resolveOne(assemblyId);
      completed += 1;
    } catch (caught) {
      throw new FbsSyncConflictBatchError(completed, uniqueIds.length, caught);
    }
  }
  return { completed, total: uniqueIds.length };
}
