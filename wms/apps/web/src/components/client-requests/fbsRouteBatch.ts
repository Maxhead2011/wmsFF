export type FbsRouteBatchRequest = {
  id: string;
  number: number;
};

export type FbsRouteBatchProgress = {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  currentRequestNumber: number;
};

export type FbsRouteBatchFailure = {
  requestId: string;
  requestNumber: number;
  message: string;
};

export type FbsRouteBatchResult = {
  total: number;
  succeeded: number;
  failed: number;
  failures: FbsRouteBatchFailure[];
};

// ADDED: Rebuild requests one by one so parallel route repairs cannot compete for stock.
export async function rebuildFbsRoutesBatch(
  requests: FbsRouteBatchRequest[],
  rebuildOne: (requestId: string) => Promise<unknown>,
  onProgress?: (progress: FbsRouteBatchProgress) => void,
): Promise<FbsRouteBatchResult> {
  let succeeded = 0;
  const failures: FbsRouteBatchFailure[] = [];

  for (const request of requests) {
    try {
      await rebuildOne(request.id);
      succeeded += 1;
    } catch (caught) {
      failures.push({
        requestId: request.id,
        requestNumber: request.number,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }

    onProgress?.({
      completed: succeeded + failures.length,
      total: requests.length,
      succeeded,
      failed: failures.length,
      currentRequestNumber: request.number,
    });
  }

  return {
    total: requests.length,
    succeeded,
    failed: failures.length,
    failures,
  };
}
