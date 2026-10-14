// TEST: actual appearance components with production CSS, without business API writes.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeStyleSwitcher} from '../src/components/layout/ThemeStyleSwitcher';
import {MagicWelcome} from '../src/components/layout/MagicWelcome';
import '../src/styles.css';
import '../src/components/layout/la-panthera-theme.css';
import '../src/components/layout/la-panthera-light.css';
import '../src/components/layout/la-panthera-light-tuning.css';
function Fixture(){
 const [menu,setMenu]=useState('Товары'),[user,setUser]=useState('one'),[mounted,setMounted]=useState(true),[loading,setLoading]=useState(false);
 return <div className="app-layout"><aside className="app-sidebar"><h2>LOGOFF</h2>{['Товары','Сборка','Остатки'].map(m=><button key={m} onClick={()=>setMenu(m)}>{m}</button>)}</aside>
 <main className="workspace-shell"><header className="workspace-header">{mounted&&<ThemeStyleSwitcher key={user} userId={user} workspaceId={menu}/>}</header>
 <section className="workspace-content"><section className="panel"><h2>{menu}</h2><input aria-label="Поиск"/><button onClick={()=>setUser(user==='one'?'two':'one')}>Другой пользователь</button><button onClick={()=>setMounted(!mounted)}>Сменить тему</button><button onClick={()=>setLoading(!loading)}>Загрузка</button></section>
 {loading&&<MagicWelcome user={{id:'f89c0efe-dcd2-4dfa-9cea-e35c0c492f83',name:'Соня'}}/>}</section></main></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>);
