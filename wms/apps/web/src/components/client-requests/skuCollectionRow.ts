export function isSkuCollectionRequest(request: { type: string }) {
  // FIX: visual classification is independent from mutable request status.
  return request.type === 'SKU_COLLECTION';
}
