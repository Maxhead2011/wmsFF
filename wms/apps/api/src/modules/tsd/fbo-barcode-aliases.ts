type Line = { skuId: string | null; barcode: string | null; sku?: { barcodes?: { value: string }[] } | null };
// FIX: resolve only registered identities, never article/name or an ambiguous request barcode.
export function fboBarcodeMatches(skuId: string, barcode: string | undefined, lines: Line[]) {
 if (!barcode) return false;
 const owners = new Set(lines.filter(l => l.barcode === barcode || l.sku?.barcodes?.some(b => b.value === barcode)).map(l => l.skuId));
 return owners.size === 1 && owners.has(skuId);
}
export function fboBarcodeAliases(line: Line, lines: Line[]) {
 return [...new Set([line.barcode, ...(line.sku?.barcodes?.map(b => b.value) ?? [])])]
  .filter((b): b is string => !!b && !!line.skuId && fboBarcodeMatches(line.skuId, b, lines));
}
