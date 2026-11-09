import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FbsProductReserve } from './FbsProductReserve';
// TEST: each product exposes its own reserve editor with the SKU in the action label.
it('exposes individual reserve controls for each product and respects write access', () => {
 const props:any={session:{accessToken:'test',user:{isDemo:false,roleCodes:['OWNER'],permissionCodes:['system:admin']}},clientId:'client',connectionId:'cab',skuId:'sku-one',onSaved:async()=>{}};
 expect(renderToStaticMarkup(<FbsProductReserve {...props}/>)).toContain('Страховой резерв товара');
 expect(renderToStaticMarkup(<FbsProductReserve {...props}/>)).toContain('sku-one');
 expect(renderToStaticMarkup(<FbsProductReserve {...props} session={{accessToken:'test',user:{isDemo:true,roleCodes:[],permissionCodes:[]}}}/>)).toBe('');
});
import { validProductReserve } from './FbsProductReserve';
// TEST: invalid quantities/low-stock rules cannot be submitted.
it('validates percentage and low-stock replacement boundaries',()=>{
 expect(validProductReserve('PERCENT',101)).toBe(false);
 expect(validProductReserve('UNITS',-1)).toBe(false);
 expect(validProductReserve('UNITS',2,{threshold:0,reserveUnits:1})).toBe(false);
 expect(validProductReserve('PERCENT',25,{threshold:5,reserveUnits:1})).toBe(true);
});
