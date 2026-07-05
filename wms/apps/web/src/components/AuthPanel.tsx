import { Download, KeyRound, LogIn, ShieldPlus, Smartphone } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { bootstrapAdmin, login, type AuthSession } from '../lib/api';

type AuthPanelProps = {
  onSession: (session: AuthSession) => void;
};

type Mode = 'login' | 'bootstrap';

export function AuthPanel({ onSession }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const session =
        mode === 'login'
          ? await login({ email, password })
          : await bootstrapAdmin({
              email,
              name,
              password,
              bootstrapSecret,
            });

      onSession(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выполнить вход.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-label="Вход в LOGOFF WMS">
        <div className="auth-panel__brand">
          <p className="eyebrow">Фулфилмент LOGOFF</p>
          <h1>WMS Фулфилмент LOGOff</h1>
        </div>

        <div className="segmented-control" role="tablist" aria-label="Режим входа">
          <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')}>
            <LogIn size={16} aria-hidden="true" />
            <span>Вход</span>
          </button>
          <button className={mode === 'bootstrap' ? 'active' : ''} type="button" onClick={() => setMode('bootstrap')}>
            <ShieldPlus size={16} aria-hidden="true" />
            <span>Первый админ</span>
          </button>
        </div>

        <a className="auth-tsd-download" href="/downloads/logoff-tsd.apk" download>
          <Smartphone size={18} aria-hidden="true" />
          <span>
            <strong>Скачать приложение ТСД</strong>
            <small>APK для приемки, сборки и инвентаризации</small>
          </span>
          <Download size={18} aria-hidden="true" />
        </a>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'bootstrap' ? (
            <label>
              <span>Имя администратора</span>
              <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
          ) : null}

          <label>
            <span>{mode === 'login' ? 'Логин или email' : 'Email'}</span>
            <input
              autoComplete={mode === 'login' ? 'username' : 'email'}
              inputMode={mode === 'login' ? 'text' : 'email'}
              type={mode === 'login' ? 'text' : 'email'}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label>
            <span>Пароль</span>
            <input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={mode === 'bootstrap' ? 10 : 1}
              required
            />
          </label>

          {mode === 'bootstrap' ? (
            <label>
              <span>Секрет настройки</span>
              <input
                autoComplete="off"
                type="password"
                value={bootstrapSecret}
                onChange={(event) => setBootstrapSecret(event.target.value)}
                minLength={16}
                required
              />
            </label>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
            <KeyRound size={16} aria-hidden="true" />
            <span>{isSubmitting ? 'Проверка' : mode === 'login' ? 'Войти' : 'Создать администратора'}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
