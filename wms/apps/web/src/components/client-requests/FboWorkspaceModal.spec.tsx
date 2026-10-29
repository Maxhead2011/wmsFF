import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {FboWorkspaceModal} from './FboWorkspaceModal';

// TEST: cargo has an accessible close control; assembly keeps the child's busy guard.
it('opens cargo in a WB-style operational dialog',()=>{
 const html=renderToStaticMarkup(<FboWorkspaceModal title="Поставка и грузоместа Ozon" onClose={()=>{}}>Состав</FboWorkspaceModal>);
 expect(html).toContain('online-execution-modal fbo-workspace-modal');expect(html).toContain('role="dialog"');
 expect(html).toContain('aria-modal="true"');expect(html).toContain('aria-label="Закрыть"');
});
it('does not introduce an unguarded close button over embedded assembly operations',()=>{
 const html=renderToStaticMarkup(<FboWorkspaceModal><button disabled>Закрыть сборку</button></FboWorkspaceModal>);
 expect(html.match(/<button/g)).toHaveLength(1);expect(html).toContain('disabled=""');
});
