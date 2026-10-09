// FIX: retained windows keep their state but stop background plan requests.
export function startVisiblePolling(refresh:()=>void, element:()=>Element|null, interval=5000) {
 const visible=()=>{
  let node=element();if(document.visibilityState!=='visible'||!node?.isConnected)return false;
  for(;node;node=node.parentElement)if(node.hasAttribute('hidden')||node.classList.contains('panthera-window-minimized')||getComputedStyle(node).display==='none')return false;
  return true;
 };
 let wasVisible=visible();
 const check=()=>{const now=visible();if(now&&!wasVisible)refresh();wasVisible=now;};
 const observer=new MutationObserver(check);
 for(let node=element();node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['hidden','class','style']});
 document.addEventListener('visibilitychange',check);
 const timer=setInterval(()=>{const now=visible();wasVisible=now;if(now)refresh();},interval);
 return ()=>{clearInterval(timer);observer.disconnect();document.removeEventListener('visibilitychange',check);};
}
