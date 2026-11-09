import React from 'react';
import { createRoot } from 'react-dom/client';
import { FbsProductReserve } from '../src/components/fbs/FbsProductReserve';
const session:any={accessToken:'fixture-only',user:{isDemo:false,roleCodes:['OWNER'],permissionCodes:['system:admin']}};
let saved=0;
createRoot(document.getElementById('root')!).render(<table><tbody>{['sku-one','sku-two'].map(skuId=><tr key={skuId}><td><strong>{skuId==='sku-one'?'Полузамок, 58–60':'Платье, 54'}</strong><p>Артикул · размер · цвет</p><FbsProductReserve session={session} clientId="client" connectionId="cab" skuId={skuId} onSaved={async()=>{document.getElementById('saved')!.textContent=String(++saved)}}/></td></tr>)}</tbody></table>);
