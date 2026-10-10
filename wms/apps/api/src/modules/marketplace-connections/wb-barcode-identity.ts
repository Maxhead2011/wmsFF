import { AsyncLocalStorage } from 'node:async_hooks';
type SkuIdentity = { id: string; marketplaceProductId?: string | null; marketplaceOfferId?: string | null; article?: string | null; size?: string | null; barcodes?: { value: string }[] };
type ProductIdentity = { productId: string; article?: string | null; size?: string | null; barcodes?: string[] };
const verifiedUpdate = new AsyncLocalStorage<{ skuId: string; product: ProductIdentity }>();
// FIX: only the complete, account-scoped catalog review can authorize a description update.
export function withVerifiedBarcodeUpdate<T>(skuId: string, product: ProductIdentity, action: () => T): T {
  return verifiedUpdate.run({ skuId, product }, action);
}
export function isVerifiedBarcodeUpdate(sku: SkuIdentity, product: ProductIdentity) {
  const proof = verifiedUpdate.getStore();
  return proof?.skuId === sku.id && proof.product === product;
}
const codes = (sku: SkuIdentity) => [...new Set([sku.marketplaceOfferId, ...(sku.barcodes ?? []).map(x => x.value)].filter((s): s is string => Boolean(s)))];
const descriptionMatches = (sku: SkuIdentity, product: ProductIdentity) =>
  (sku.article ?? '').trim().toLowerCase() === (product.article ?? '').trim().toLowerCase() &&
  (sku.size ?? '').trim().toLowerCase() === (product.size ?? '').trim().toLowerCase();

function identityIndex(owners: SkuIdentity[], products: ProductIdentity[]) {
  const skuByCode = new Map<string, Set<string>>(), productByCode = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, code: string, id: string) => {
    if (!code) return;
    if (!map.has(code)) map.set(code, new Set());
    map.get(code)!.add(id);
  };
  for (const sku of owners) for (const code of codes(sku)) add(skuByCode, code, sku.id);
  for (const product of products) for (const code of product.barcodes ?? []) add(productByCode, code, product.productId);
  return (sku: SkuIdentity, product: ProductIdentity) => {
    if (sku.marketplaceProductId !== product.productId) return false;
    const shared = codes(sku).filter(code => product.barcodes?.includes(code));
    const candidateOwners = new Set((product.barcodes ?? []).flatMap(code => [...(skuByCode.get(code) ?? [])]));
    return candidateOwners.size === 1 && candidateOwners.has(sku.id) && shared.length > 0 && shared.every(code =>
      skuByCode.get(code)?.size === 1 && productByCode.get(code)?.size === 1);
  };
}

// FIX: descriptions do not identify physical goods. A barcode must be unique in
// both this client's WMS catalog and this connection's complete WB catalog.
export function barcodeIdentityMatches(sku: SkuIdentity, product: ProductIdentity, owners: SkuIdentity[], products: ProductIdentity[]) {
  return identityIndex(owners, products)(sku, product);
}

// FIX: classify changed descriptions as warnings only with unambiguous barcode proof.
// The caller may update descriptions only through the verified upsert context.
export function barcodeCatalogReview(skus: SkuIdentity[], products: ProductIdentity[], owners: SkuIdentity[], legacy: (s: SkuIdentity, p: ProductIdentity) => boolean) {
  if (!products.length || new Set(products.map(p => p.productId)).size !== products.length) throw new Error('Каталог WB пуст или содержит повторные размеры.');
  const excluded: { skuId: string; chrtId: number; reason: string; article?: string | null; size?: string | null; wbArticle: string | null; wbSize: string | null }[] = [];
  const warnings: typeof excluded = [];
  const matchesBarcode = identityIndex(owners, products);
  const productsById = new Map(products.map(product => [product.productId, product]));
  for (const sku of skus) {
    const chrtId = Number(sku.marketplaceProductId?.split(':')[1]);
    if (!Number.isSafeInteger(chrtId) || chrtId <= 0) continue;
    const product = productsById.get(sku.marketplaceProductId!);
    const proof = product && matchesBarcode(sku, product);
    const hasCodes = codes(sku).length > 0 && Boolean(product?.barcodes?.length);
    if (product && (proof || (!hasCodes && legacy(sku, product)))) {
      if (proof && !descriptionMatches(sku, product)) warnings.push({skuId:sku.id,chrtId,reason:'BARCODE_MATCH_DESCRIPTION_CHANGED',article:sku.article,size:sku.size,wbArticle:product.article??null,wbSize:product.size??null});
      continue;
    }
    excluded.push({skuId:sku.id,chrtId,reason:product?'IDENTITY_CHANGED':'MISSING',article:sku.article,size:sku.size,wbArticle:product?.article??null,wbSize:product?.size??null});
  }
  return { excluded, warnings };
}
