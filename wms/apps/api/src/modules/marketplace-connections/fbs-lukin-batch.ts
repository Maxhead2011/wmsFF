// FIX: only the verified Moscow Lukin client uses a fixed, oldest-first TSD queue.
export const LUKIN_FBS_BATCH_CLIENT_ID = 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9';
export const LUKIN_FBS_BATCH_SETTING_KEY = 'tsd:fbs:lukin:batch:v1:' + LUKIN_FBS_BATCH_CLIENT_ID;

export function selectLukinFbsBatch<T extends { requestId: string; requestNumber: number }>(
  openRequests: T[], savedIds: string[],
): { requestIds: string[]; visible: T[]; rotated: boolean } {
  const byId = new Map(openRequests.map((request) => [request.requestId, request]));
  const retained = [...new Set(savedIds)].filter((id) => byId.has(id));
  if (retained.length > 0) {
    return { requestIds: savedIds, visible: retained.map((id) => byId.get(id)!), rotated: false };
  }
  const next = [...openRequests]
    .sort((left, right) => left.requestNumber - right.requestNumber || left.requestId.localeCompare(right.requestId))
    .slice(0, 5);
  return { requestIds: next.map((request) => request.requestId), visible: next, rotated: true };
}

export function savedLukinFbsBatchIds(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('requestIds' in value) || !Array.isArray(value.requestIds)) return [];
  return value.requestIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
}
