import React from 'react';
import {createRoot} from 'react-dom/client';
import {OzonStockAdjustment} from '../src/components/client-requests/OzonStockAdjustment';
// TEST: the real panel, with API intercepted by the browser test.
createRoot(document.getElementById('root')!).render(<OzonStockAdjustment requestId="r" accessToken="synthetic" disabled={false} onLockChange={()=>{}} onChanged={()=>{}}/>);
