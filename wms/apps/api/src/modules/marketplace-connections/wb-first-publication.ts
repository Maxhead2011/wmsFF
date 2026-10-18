type Stock = { chrtId: number; amount: number };
type Identity = { skuId: string; productId: string; barcodes: string[] };
type Card = { productId: string; barcodes: string[] };

// FIX: an omitted stock row is unknown. Only a fresh, unique barcode identity can initialize it.
export function verifyFirstPublication(ids: number[], identities: Identity[], cards: Card[]) {
  return ids.map(chrtId => {
    const matches = identities.filter(s => Number(s.productId.split(':')[1]) === chrtId);
    if (matches.length !== 1) throw new Error('Неоднозначная привязка размера WB.');
    const identity = matches[0];
    const candidates = cards.filter(c => c.productId === identity.productId);
    if (candidates.length !== 1 || !candidates[0].barcodes.some(b => identity.barcodes.includes(b)))
      throw new Error('Штрихкод не подтверждён свежим каталогом WB.');
    const shared = candidates[0].barcodes.filter(b => identity.barcodes.includes(b));
    if (cards.filter(c => c.barcodes.some(b => shared.includes(b))).length !== 1)
      throw new Error('Штрихкод относится к нескольким размерам WB.');
    return { chrtId, skuId: identity.skuId, productId: identity.productId, barcodes: shared };
  });
}

// FIX: zero is actually sent and verified, never synthesized from a missing response.
// Called only by explicit publication, under the existing account lock and fresh-plan guard.
export async function initializeFirstPublication(stocks: Stock[], io: {
  read: () => Promise<Map<number, number>>;
  verify: (ids: number[]) => Promise<unknown>;
  record: (phase: string, details: unknown) => Promise<unknown>;
  sendZeros: (stocks: Stock[], ids: number[]) => Promise<unknown>;
}) {
  if (new Set(stocks.map(s => s.chrtId)).size !== stocks.length || stocks.some(s =>
    !Number.isSafeInteger(s.chrtId) || s.chrtId <= 0 || !Number.isSafeInteger(s.amount) || s.amount < 0))
    throw new Error('Некорректный план первой публикации WB.');
  const before = await io.read();
  if (stocks.some(s => before.has(s.chrtId) && (!Number.isSafeInteger(before.get(s.chrtId)) || before.get(s.chrtId)! < 0)))
    throw new Error('WB вернул некорректный остаток.');
  const missing = stocks.filter(s => !before.has(s.chrtId));
  if (!missing.length) return;
  const ids = missing.map(s => s.chrtId);
  const proof = await io.verify(ids);
  await io.record('INITIALIZATION_PLANNED', { proof, unknownBefore: ids, targets: missing });
  // No retry: a transport failure remains uncertain and requires a fresh explicit command.
  await io.sendZeros(missing.map(s => ({ chrtId: s.chrtId, amount: 0 })), ids);
  const after = await io.read();
  if (!ids.every(id => after.get(id) === 0)) {
    await io.record('INITIALIZATION_UNCONFIRMED', { ids });
    throw new Error('WB не подтвердил создание нулевого остатка. Увеличение не отправлено.');
  }
  await io.record('INITIALIZATION_CONFIRMED', { ids });
}
