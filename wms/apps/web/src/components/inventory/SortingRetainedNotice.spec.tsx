import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SortingRetainedNotice } from './PalletSortingPanel';
it('explains retained stock instead of promising an archive or shortage write-off',()=>{
  // TEST: an administrator must see that PACKING remains untouched before confirming completion.
  const html=renderToStaticMarkup(<SortingRetainedNotice boxes={[{code:'BOX246',retainedReason:'Есть PACKING'}]} />);
  expect(html).toContain('BOX246');expect(html).toContain('Есть PACKING');expect(html).toContain('Без списания');
});
