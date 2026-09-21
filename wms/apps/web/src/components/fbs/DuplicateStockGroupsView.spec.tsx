import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDuplicateGroup, fetchDuplicateCatalog, previewDuplicateGroup, saveDuplicateGroup } from '../../lib/api';
import { duplicateArticleOptions, duplicateGroupReady, effectiveDuplicateShares, matchesRelabelArticle, suggestDuplicateTarget, withDuplicateException, type DuplicateGroup } from '../../lib/duplicateStockGroups';
const group = (): DuplicateGroup => ({ id: 'g', name: 'Группа', connectionId: 'wb', reserve: { mode: 'PERCENT', value: 10 },
  shares: [{ targetKey: 'original', label: 'Основная', percent: 75 }, { targetKey: 'duplicate', label: 'Дубль', percent: 25 }],
  variants: [{ sourceSkuId: 's', targets: [{ targetKey: 'original', targetId: 's', confirmed: true, requiresRelabel: false }, { targetKey: 'duplicate', targetId: 't', confirmed: true, requiresRelabel: true }] }], overrides: [] });
afterEach(() => vi.unstubAllGlobals());
describe('duplicate groups editor', () => {
  // TEST: article aliases must match relabeling, without accepting arbitrary name matches.
  it('recognizes client and internal article aliases with source-only suffixes', () => {
    const card = { id: 's', article: 'WB-123', clientSku: 'Корея', internalSku: 'KOREA-M', name: 'name', size: 'M', color: '', barcodes: [] };
    expect(matchesRelabelArticle(card, ' корея ')).toBe(true);
    expect(matchesRelabelArticle(card, 'korea', true)).toBe(true);
    expect(matchesRelabelArticle(card, 'korea')).toBe(false);
    expect(matchesRelabelArticle(card, 'name', true)).toBe(false);
    expect(matchesRelabelArticle(card, '', true)).toBe(false);
  });
  // TEST: changing common percentages updates every size without a saved override.
  it('inherits new common shares and restores them when exception is removed', () => {
    let g = withDuplicateException(group(), 's', true);
    g.shares[0].percent = 0; g.shares[1].percent = 100;
    expect(effectiveDuplicateShares(g, 's').map(s => s.percent)).toEqual([75, 25]);
    expect(effectiveDuplicateShares(g, 'another-size').map(s => s.percent)).toEqual([0, 100]);
    g = withDuplicateException(g, 's', false);
    expect(effectiveDuplicateShares(g, 's').map(s => s.percent)).toEqual([0, 100]);
  });
  it('requires confirmation even for one matching size and does not guess ambiguous variants', () => {
    const card = (id: string) => ({ id, article: id, name: id, size: 'M', color: '', barcodes: [{ value: '001' }] });
    expect(suggestDuplicateTarget(card('s'), [card('t')])).toMatchObject({ targetId: 't', confirmed: false });
    expect(suggestDuplicateTarget(card('s'), [card('t'), card('u')]).targetId).toBe('');
    const g = group(); g.variants[0].targets[1].confirmed = false; expect(duplicateGroupReady(g)).toBe(false);
  });
  it('uses draft-only endpoints with revision and unchanged barcode text', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetch);
    await fetchDuplicateCatalog('token', 'client/1', { search: '001' });
    await saveDuplicateGroup('token', 'client/1', { group: group(), revision: 'v1' });
    await previewDuplicateGroup('token', 'client/1', group());
    expect(fetch.mock.calls[0][0]).toContain('client%2F1/catalog');
    expect(JSON.parse(fetch.mock.calls[0][1].body).search).toBe('001');
    expect(JSON.parse(fetch.mock.calls[1][1].body).revision).toBe('v1');
    expect(fetch.mock.calls.some(([url]) => url.includes('/sync'))).toBe(false);
  });
});

// TEST: barcode matches select an article across sizes, then apply a reviewed rule.
it('selects articles across sizes and sends an explicit reviewed apply request',async()=>{
  const cards=['M','L'].map(size=>({id:size,article:'Корея',name:'Костюм',size,color:'',barcodes:[{value:'001'}]}));
  expect(duplicateArticleOptions(cards)).toEqual(['Корея']);
  const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch);
  await applyDuplicateGroup('token','client/1',{group:group(),revision:'v1',previewKey:'reviewed'});
  expect(fetch.mock.calls[0][0]).toContain('client%2F1/apply');expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({revision:'v1',previewKey:'reviewed'});
});
