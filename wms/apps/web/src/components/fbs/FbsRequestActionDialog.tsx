import React,{useEffect,useRef,useState} from 'react';

// FIX: explain legacy/raw marketplace failures too, including replies from older sessions.
export function requestActionExplanation(error:string) {
 if(error.includes('EXEMPLAR_INFO_NOT_FILLED_COMPLETELY'))return {
  title:'Ozon требует сведения об экземплярах товара',
  detail:error.startsWith('Отправление ')?error.replace(/ Код: EXEMPLAR_INFO_NOT_FILLED_COMPLETELY\.?$/,''):'Ozon не разрешил подготовить стикеры: сведения об экземплярах заполнены не полностью. Проверьте требования к выбранному отправлению.',
  next:'Если ГТД есть — укажите номер. Если ГТД отсутствует — в Ozon нужно явно отметить её отсутствие. Пустое поле не заменяет этот признак. После исправления повторите печать.',
 };
 return {title:'Не удалось выполнить действие',detail:error,next:'Проверьте причину выше. Повторяйте действие после её устранения; при неизвестном результате отправки сначала проверьте очередь печати.'};
}

// FIX: top-layer dialog keeps progress/errors visible even on long request lists.
export function FbsRequestActionDialog({requestNumber,error,message,onClose}:{requestNumber:number;error:string;message:string;onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null),[elapsed,setElapsed]=useState(0),explanation=error?requestActionExplanation(error):null;
 useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>{if(dialog.open)dialog.close();};},[]);
 useEffect(()=>{if(error)return;const timer=window.setInterval(()=>setElapsed(s=>s+1),1000);return()=>window.clearInterval(timer);},[error]);
 return <dialog ref={ref} aria-labelledby="fbs-request-action-title" onCancel={event=>{event.preventDefault();onClose();}} style={{border:'1px solid #d6e2e7',borderRadius:20,padding:24,width:'min(620px, calc(100vw - 32px))',maxHeight:'85vh',overflow:'auto',color:'#263b49',background:'#fff',boxShadow:'0 18px 65px #0004'}}>
  <h2 id="fbs-request-action-title">Стикеры заявки №{String(requestNumber).padStart(6,'0')}</h2>
  {explanation?<div role="alert"><h3>{explanation.title}</h3><p style={{whiteSpace:'pre-wrap'}}>{explanation.detail}</p><p>{explanation.next}</p><details><summary>Технические сведения</summary><p style={{overflowWrap:'anywhere'}}>{error}</p></details></div>:<div role="status" aria-live="polite"><p>{message||'Загружаю состав заявки и проверяю доступность стикеров…'}</p><p>Прошло {elapsed} сек.</p>{elapsed>=30&&<p>Ответ занимает дольше обычного. Повторно нажимать печать пока не нужно.</p>}</div>}
  {!error&&<p>Если закрыть окно, уже отправленный запрос продолжит выполняться.</p>}
  <button type="button" className="icon-text-button" onClick={onClose}>Закрыть</button>
 </dialog>;
}
