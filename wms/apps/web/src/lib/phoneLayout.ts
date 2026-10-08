// FIX: automatic browser layout on our host; browser pinch zoom stays native.
export function installPhoneLayout(hostname = window.location.hostname) {
  if (['wms.logoff.pro', 'localhost', '127.0.0.1'].includes(hostname)) {
    document.documentElement.dataset.wmsPhoneLayout = 'true';
    // FIX: keep navigation available without consuming the phone's first screen.
    const installMenu=()=> {
      const sidebar=document.querySelector<HTMLElement>('.app-sidebar');
      if(!sidebar||sidebar.querySelector('.phone-menu-toggle'))return;
      const button=document.createElement('button');
      button.type='button';button.className='phone-menu-toggle';button.textContent='☰ Меню';
      button.setAttribute('aria-expanded','false');
      button.addEventListener('click',()=> {
        const open=sidebar.dataset.phoneMenuOpen!=='true';
        sidebar.dataset.phoneMenuOpen=String(open);button.setAttribute('aria-expanded',String(open));
        button.textContent=open?'✕ Закрыть меню':'☰ Меню';
      });
      sidebar.addEventListener('click',e=>{
        const target=e.target as HTMLElement;
        if(target.closest('.workspace-nav button, .panthera-nav button') && !target.closest('.phone-menu-toggle')){
          sidebar.dataset.phoneMenuOpen='false';button.setAttribute('aria-expanded','false');button.textContent='☰ Меню';
        }
      });
      sidebar.prepend(button);
    };
    installMenu();
    const observer=new MutationObserver(installMenu);
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
}
