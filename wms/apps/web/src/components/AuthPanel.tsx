import { Crown, Download, Eye, KeyRound, LogIn, ScanBarcode, ShieldPlus, Smartphone } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { bootstrapAdmin, login, type AuthSession } from '../lib/api';

type AuthPanelProps = {
  onSession: (session: AuthSession) => void;
  onBack?: () => void;
};

type Mode = 'login' | 'bootstrap';

export function AuthPanel({ onSession, onBack }: AuthPanelProps) {
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

  async function enterDemo(kind: 'standard' | 'plus') {
    setError('');
    setSubmitting(true);

    try {
      const credentials =
        kind === 'plus'
          ? { email: 'demo-plus', password: 'demo-plus' }
          : { email: 'demo', password: 'demo' };
      onSession(await login(credentials));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось открыть демонстрационный режим.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-label="Вход в LOGOFF WMS">
        <div className="auth-panel__brand">
          <p className="eyebrow">LOGOff WMS</p>
          <h1>Фулфилмент LOGOff</h1>
          {onBack ? <button className="auth-panel__back" type="button" onClick={onBack}>← На главную</button> : null}
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

        {mode === 'login' ? (
          <div className="demo-login-actions">
            <button className="demo-login-button" type="button" disabled={isSubmitting} onClick={() => void enterDemo('standard')}>
              <Eye size={18} aria-hidden="true" />
              <span>
                <strong>Открыть демо-кабинет</strong>
                <small>Клиентский режим · демонстрационные данные изолированы от рабочих</small>
              </span>
            </button>
            <button
              className="demo-login-button demo-login-button--plus"
              type="button"
              disabled={isSubmitting}
              onClick={() => void enterDemo('plus')}
            >
              <Crown size={18} aria-hidden="true" />
              <span>
                <strong>Демо плюс</strong>
                <small>Расширенное управление · все виды и статусы заказов</small>
              </span>
            </button>
          </div>
        ) : null}

        <div className="auth-downloads">
          <a className="mobile-app-download" href="/downloads/logoff-tsd.apk" download>
            <ScanBarcode size={20} aria-hidden="true" />
            <span>
              <strong>Скачать LOGOff ТСД</strong>
              <small>Приёмка, сборка, перемещения и контроль коробов</small>
            </span>
            <Download size={18} aria-hidden="true" />
          </a>

          <a className="mobile-app-download" href="/downloads/logoff-wms-mobile.apk" download>
            <Smartphone size={20} aria-hidden="true" />
            <span>
              <strong>LOGOff WMS для Android</strong>
              <small>Кабинет клиента и мобильное управление</small>
            </span>
            <Download size={18} aria-hidden="true" />
          </a>
        </div>
      </section>
    </main>
  );
}
