import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {FbsLabelActions} from './FbsLabelActions';
// TEST: each modern action dispatches a distinct mode, without submitting a form.
describe('FBS label actions',()=>{
 it('offers three styled, accessible actions and dispatches cargo separately',()=>{
  const onAction=vi.fn(),element=FbsLabelActions({onAction});
  const html=renderToStaticMarkup(element);
  expect(html).toContain('Печать грузомест');expect(html).toContain('Скачать все ШК');expect(html).toContain('Распечатать все ШК');
  const buttons=element.props.children.filter((c:any)=>c?.type==='button');
  expect(buttons).toHaveLength(3);
  buttons.forEach((b:any)=>{expect(b.props.type).toBe('button');expect(b.props.className).toContain('fbs-label-action');b.props.onClick();});
  expect(onAction.mock.calls).toEqual([['download'],['print'],['cargo']]);
 });
});
