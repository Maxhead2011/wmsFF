import { describe, expect, it } from 'vitest';
import { isSkuCollectionRequest } from './skuCollectionRow';

describe('isSkuCollectionRequest', () => {
  it('marks only internal SKU collection requests for orange highlighting', () => {
    // TEST: the highlight is type-based and cannot recolor ordinary FBS requests.
    expect(isSkuCollectionRequest({ type: 'SKU_COLLECTION' })).toBe(true);
    expect(isSkuCollectionRequest({ type: 'OUTBOUND' })).toBe(false);
  });
});
