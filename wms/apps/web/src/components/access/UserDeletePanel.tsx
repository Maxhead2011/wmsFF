import { useEffect, useState } from 'react';
import { fetchUsers, type AuthSession, type UserSummary } from '../../lib/api';
import { UserDeleteButton } from './UserDeleteButton';

export function UserDeletePanel({ session }: { session: AuthSession }) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    fetchUsers(session.accessToken).then(rows => { if (active) setUsers(rows); })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить пользователей.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.accessToken]);
  const selected = users.find(user => user.id === selectedId);
  return <div className="access-form">
    <h3>Пользователи</h3>
    <p>Удаление закрывает доступ и убирает пользователя из рабочего списка. История складских операций сохраняется.</p>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="access-fields access-fields--editor"><label><span>Пользователь</span><select value={selectedId} disabled={loading} onChange={event => { setSelectedId(event.target.value); setNotice(''); }}>
      <option value="">{loading ? 'Загрузка…' : 'Выберите пользователя'}</option>
      {users.map(user => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
    </select></label></div>
    {selected ? <>
      <p>{selected.roles.map(row => row.role.name).join(', ')} · {selected.warehouseScopes?.map(row => row.warehouse.name).join(', ') || 'Филиал не закреплён'}</p>
      {selected.canDelete ? <UserDeleteButton key={selected.id} session={session} user={selected} onDeleted={id => {
        setUsers(rows => rows.filter(user => user.id !== id)); setSelectedId(''); setNotice('Пользователь удалён. Доступ закрыт, история сохранена.');
      }} /> : <p>Удаление недоступно. Администратор может удалять сотрудников своего закреплённого филиала, кроме администраторов и владельцев. Owner может удалять любого пользователя.</p>}
    </> : null}
  </div>;
}
