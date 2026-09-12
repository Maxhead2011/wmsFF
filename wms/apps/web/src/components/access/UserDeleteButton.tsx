import { useState } from 'react';
import { deleteUser, type AuthSession, type UserSummary } from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';

// FIX: visibility is a server-provided capability; confirmation identifies the exact target.
export function UserDeleteButton({ session, user, onDeleted, disabled = false }: {
  session: AuthSession; user: UserSummary; onDeleted: (id: string) => void; disabled?: boolean;
}) {
  const [pending, setPending] = useState<UserSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      const result = await deleteUser(session.accessToken, pending.id);
      setPending(null); onDeleted(result.id);
      if (result.id === session.user.id) window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось удалить пользователя.'); }
    finally { setBusy(false); }
  }
  if (!user.canDelete) return null;
  return <>
    <button className="primary-button" type="button" disabled={disabled || busy} onClick={() => { setPending(user); setError(''); }}>Удалить пользователя</button>
    {error && !pending ? <p role="alert">{error}</p> : null}
    {pending ? <ConfirmDialog title="Удалить пользователя?"
      message={`${pending.name} (${pending.email}) потеряет доступ и исчезнет из рабочего списка. История операций сохранится.`}
      details={[...(pending.id === session.user.id ? ['Вы удаляете свою учётную запись и потеряете доступ к ВМС.'] : []), ...(error ? [error] : [])]}
      confirmLabel="Удалить пользователя" isBusy={busy} onCancel={() => setPending(null)} onConfirm={() => void confirm()} /> : null}
  </>;
}
