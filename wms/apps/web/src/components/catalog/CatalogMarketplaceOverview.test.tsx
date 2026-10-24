import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CatalogMarketplaceCell, type CatalogLink } from './CatalogMarketplaceOverview';
// TEST: the visible table must show both account-specific barcode sets, not the legacy source only.
it('renders WB and Ozon identities side by side without losing leading zeros',()=>{
 const rows=[{id:'w',connectionId:'wc',account:'WB shop',marketplace:'WILDBERRIES',skuId:'s',status:'LINKED',offerId:'wb-art',productId:'11',barcodes:['001']},{id:'o',connectionId:'oc',account:'Ozon shop',marketplace:'OZON',skuId:'s',status:'LINKED',offerId:'oz-art',productId:'22',barcodes:['002','003']}];
 const html=renderToStaticMarkup(<CatalogMarketplaceCell rows={rows as CatalogLink[]} skuId="s"/>);
 for(const text of ['WB shop','Ozon shop','001','002, 003','wb-art','oz-art'])expect(html).toContain(text);
 expect(html).not.toContain('Продаётся');
 expect(html.match(/display:block/g)).toHaveLength(4);
});
it('does not display unresolved or other-product links as a confirmed marketplace',()=>{
 const rows=[{id:'w',connectionId:'wc',marketplace:'WILDBERRIES',skuId:'s',status:'REVIEW'},{id:'o',connectionId:'oc',marketplace:'OZON',skuId:'other',status:'LINKED'}];
 expect(renderToStaticMarkup(<CatalogMarketplaceCell rows={rows as CatalogLink[]} skuId="s"/>)).toBe('');
});
