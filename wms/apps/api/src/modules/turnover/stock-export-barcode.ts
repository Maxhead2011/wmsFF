type Barcode = {value:string;isPrimary:boolean};
export function stockExportBarcode(clientId:string, barcodes:Barcode[]):string|null {
  // FIX: Lukin's marking GTIN and product label coexist on one SKU; export only an unambiguous label.
  if(clientId==='c76b78f9-1b83-4e9b-bee3-bc28336ee1c9') {
    const labels=barcodes.filter(b=>/^\d{13}$/.test(b.value));
    const primary=[...new Set(labels.filter(b=>b.isPrimary).map(b=>b.value))];
    const unique=[...new Set(labels.map(b=>b.value))];
    return primary.length===1?primary[0]:unique.length===1?unique[0]:null;
  }
  return barcodes.find(b=>b.isPrimary)?.value ?? barcodes[0]?.value ?? null;
}
