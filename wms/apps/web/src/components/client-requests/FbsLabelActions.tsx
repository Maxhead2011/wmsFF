import React from 'react';
import {Download,Printer,Boxes} from 'lucide-react';
import type {RequestSupplyAction} from '../fbs/requestSupplyAction';
// FIX: scoped modern controls; full and cargo-only sets stay separate.
export function FbsLabelActions({onAction}:{onAction:(action:RequestSupplyAction)=>void}) {
 return <div className="fbs-label-actions">
  <style>{`.fbs-label-actions{display:grid;gap:8px;width:100%;min-width:0}.fbs-label-actions .fbs-label-action{display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;border:1px solid #dce3ec;border-radius:12px;background:#fff;color:#334155;cursor:pointer;text-align:left;font:inherit;font-size:14px;font-weight:600;line-height:1.3;transition:background .15s,border-color .15s,box-shadow .15s}.fbs-label-actions .fbs-label-action svg{flex-shrink:0}.fbs-label-actions .fbs-label-action:hover{background:#f5f3ff;border-color:#c4b5fd;box-shadow:0 3px 10px #49338712}.fbs-label-actions .fbs-label-action:focus-visible{outline:3px solid #a78bfa;outline-offset:2px}.fbs-label-actions .fbs-label-action--primary{background:#6d4bc3;border-color:#6d4bc3;color:#fff}.fbs-label-actions .fbs-label-action--primary:hover{background:#5b3ba9;border-color:#5b3ba9}.fbs-label-actions .fbs-label-action--cargo{background:#f0fdfa;border-color:#bce5dc;color:#16665b}`}</style>
  <style>{`.fbs-label-actions .fbs-label-action span{color:inherit!important}`}</style>
  <button type="button" className="fbs-label-action" onClick={()=>onAction('download')} title="Полный комплект: товарные этикетки и стикеры маркетплейса"><Download size={18} aria-hidden="true"/><span>Скачать все ШК</span></button>
  <button type="button" className="fbs-label-action fbs-label-action--primary" onClick={()=>onAction('print')} title="Распечатать полный комплект этикеток"><Printer size={18} aria-hidden="true"/><span>Распечатать все ШК</span></button>
  <button type="button" className="fbs-label-action fbs-label-action--cargo" onClick={()=>onAction('cargo')} title="Для собранных заказов: WB — грузоместа и поставка; Ozon — только стикеры заказов. Без этикеток товара."><Boxes size={18} aria-hidden="true"/><span>Печать грузомест</span></button>
 </div>;
}
