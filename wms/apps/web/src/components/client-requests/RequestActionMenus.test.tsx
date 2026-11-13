import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ClientRequestsTable} from './ClientRequestsTable';
const noop=()=>{};
function render(fbs=false, overrides:Record<string,unknown>={}) {
 const request={id:'r',number:1550,type:'OUTBOUND',status:'SUBMITTED',priority:'NORMAL',title:fbs?'FBS — 3 заказа':'ФБО Никольское',client:{id:'c',code:'CL-000001',name:'Тест'},clientId:'c',createdAt:'2026-09-29T09:00:00Z',items:[{id:'i',quantity:2}],packages:[],files:[]};
 const props:any={items:[request],modernActions:true,canManageRequestRecovery:true,canChangeStatus:true,canPickOutbound:true,canCancelRequests:true,canEditAnyRequest:true,canRefreshPickInstruction:true};
 for(const key of ['onOpenDocument','onDownloadRequestItems','onStatusChange','onCancelRequest','onEditRequest','onOpenOnlineExecution','onOpenFbsOrders','onOpenFbsRoute','onSelectManualBoxes','onOpenFbsBoxSearch','onOpenPickInstruction','onRefreshPickInstruction','onSyncTsd','onCheckSupplyConsistency','onDownloadPickInstruction','onUploadManualInstruction','onEmergencyPackedXlsx','onPickOutbound','onPackageOutbound','onShipOutbound'])props[key]=noop;
 return renderToStaticMarkup(<ClientRequestsTable {...props} {...overrides}/>);
}
// TEST: approved streamlined menus, with legacy layout opt-out unchanged.
it('keeps only approved FBO actions and documents',()=>{
 const html=render();expect(html).toContain('>Онлайн<');expect(html).toContain('Обновить план');expect(html).toContain('<summary>Документы</summary>');expect(html).toContain('Состав XLSX');
 for(const label of ['Администрирование','Аварийная упаковка','Ручные этапы заявки','Источники товара','>Инструкция<','>Редактировать заявку<','>Отменить заявку<','<span>Состав</span>'])expect(html).not.toContain(label);
});
it('replaces route with online and describes synchronization',()=>{const html=render(true);expect(html).not.toContain('>Маршрут<');expect(html.match(/>Онлайн</g)).toHaveLength(1);expect(html).toContain('К заказам FBS');expect(html).toContain('Остатки и короба');expect(html).toContain('Пересчитать подбор и маршрут');expect(html).toContain('Обновить данные WB / ТСД');expect(html).toContain('Лист подбора PDF');});
it('puts downloads inside Documents instead of composition',()=>{const html=render(true);const composition=html.split('data-label="Состав">')[1].split('</td>')[0];expect(composition).not.toContain('document-open-button');const docs=html.split('<summary>Документы</summary>')[1].split('</details>')[0];expect(docs).toContain('Состав XLSX');});
it('preserves legacy controls when modern workflow is disabled',()=>{const html=render(false,{modernActions:false});expect(html).toContain('>В ТСД<');expect(html).toContain('>Собрать<');expect(html).not.toContain('<summary>Ещё</summary>');});
it('offers WB handover and both supply label commands on a warehouse request', () => {
  const row = {
    id: 'r', number: 1550, type: 'OUTBOUND', status: 'IN_WORK', priority: 'NORMAL',
    title: 'FBS', client: { id: 'c', code: 'CL-1', name: 'Test' }, clientId: 'c', createdAt: '2026-11-11T09:00:00Z', items: [],
    packages: [], files: [], wbSupplyIds: ['WB-GI-100'],
    fbsCompletion: { totalOrders: 2, completedOrders: 2, percent: 100, completed: true },
  };
  const html = render(true, { items: [row] });
  for (const label of ['Передать на МП', 'Стикеры поставки', 'Скачать все ШК', 'Распечатать все ШК']) {
    expect(html).toContain(label);
  }
  expect(render()).not.toContain('Стикеры поставки');
});

// TEST: Ozon FBS has no WB supply IDs but must expose labels in Requests.
it('offers label download and print for Ozon without a WB handover button', () => {
 const html=render(true);
 expect(html).toContain('Стикеры поставки');
 expect(html).toContain('Скачать все ШК');
 expect(html).toContain('Распечатать все ШК');
 expect(html).not.toContain('Передать на МП');
});
