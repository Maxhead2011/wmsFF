import React from 'react';
import { createRoot } from 'react-dom/client';
import { FreeLabelEditor } from '../src/components/print/FreeLabelEditor';
createRoot(document.getElementById('root')!).render(<FreeLabelEditor session={{accessToken:'fixture',user:{id:'test'}} as any}/>);
