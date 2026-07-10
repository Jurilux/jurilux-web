import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api, type UserEntity } from './api';
import Workspace from './Workspace';
import i18n from './i18n';

// Sprint 0 : parcours connexion (MFA obligatoire), enrôlement, onboarding de
// l'étude (US-2.1) et coquille de tableau de bord. UI sobre, sans framework (§ D.6).

type Screen =
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'mfa'; email: string; password: string; otpauthUrl: string }
  | { name: 'onboarding' }
  | { name: 'dashboard'; entities: UserEntity[] };

export default function App() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>({ name: 'login' });

  const toggleLang = () => {
    const next = i18n.language === 'fr' ? 'en' : 'fr';
    localStorage.setItem('lexkyc.lang', next);
    void i18n.changeLanguage(next);
  };

  const afterLogin = async () => {
    const entities = await api.myEntities();
    setScreen(entities.length === 0 ? { name: 'onboarding' } : { name: 'dashboard', entities });
  };

  return (
    <div className="shell">
      <header>
        <h1>{t('appName')}</h1>
        <p className="tagline">{t('tagline')}</p>
        <button className="lang" onClick={toggleLang} aria-label="Changer de langue">
          {i18n.language === 'fr' ? 'EN' : 'FR'}
        </button>
      </header>
      <main>
        {screen.name === 'login' && (
          <LoginForm onDone={afterLogin} onRegister={() => setScreen({ name: 'register' })} />
        )}
        {screen.name === 'register' && (
          <RegisterForm onEnroll={(email, password, otpauthUrl) => setScreen({ name: 'mfa', email, password, otpauthUrl })} />
        )}
        {screen.name === 'mfa' && (
          <MfaEnrollForm
            email={screen.email}
            password={screen.password}
            otpauthUrl={screen.otpauthUrl}
            onDone={afterLogin}
          />
        )}
        {screen.name === 'onboarding' && <OnboardingWizard onDone={afterLogin} />}
        {screen.name === 'dashboard' && (
          <Workspace entities={screen.entities} onLogout={() => setScreen({ name: 'login' })} />
        )}
      </main>
    </div>
  );
}

function useApiError() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const wrap = async (fn: () => Promise<void>, i18nPrefix: string) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) setError(t(`${i18nPrefix}.errors.${e.code}`, e.code));
      else setError(String(e));
    }
  };
  return { error, wrap };
}

function LoginForm(props: { onDone: () => Promise<void>; onRegister: () => void }) {
  const { t } = useTranslation();
  const { error, wrap } = useApiError();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void wrap(async () => {
          await api.login(email, password, code);
          await props.onDone();
        }, 'login');
      }}
    >
      <h2>{t('login.title')}</h2>
      <label>
        {t('login.email')}
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        {t('login.password')}
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        {t('login.totp')}
        <input
          inputMode="numeric"
          pattern="[0-9]{6,8}"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit">{t('login.submit')}</button>
      <button type="button" className="secondary" onClick={props.onRegister}>
        {t('login.register')}
      </button>
    </form>
  );
}

function RegisterForm(props: { onEnroll: (email: string, password: string, otpauthUrl: string) => void }) {
  const { t } = useTranslation();
  const { error, wrap } = useApiError();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void wrap(async () => {
          const result = await api.register(email, password);
          props.onEnroll(email, password, result.otpauthUrl);
        }, 'register');
      }}
    >
      <h2>{t('register.title')}</h2>
      <label>
        {t('login.email')}
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        {t('login.password')}
        <input
          type="password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="help">{t('register.passwordHelp')}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit">{t('register.submit')}</button>
    </form>
  );
}

function MfaEnrollForm(props: {
  email: string;
  password: string;
  otpauthUrl: string;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { error, wrap } = useApiError();
  const [code, setCode] = useState('');

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void wrap(async () => {
          await api.activateMfa(props.email, props.password, code);
          await api.login(props.email, props.password, code);
          await props.onDone();
        }, 'register');
      }}
    >
      <h2>{t('register.mfaTitle')}</h2>
      <p className="help">{t('register.mfaHelp')}</p>
      <p className="otpauth">
        <a href={props.otpauthUrl}>{props.otpauthUrl}</a>
      </p>
      <label>
        {t('register.mfaCode')}
        <input
          inputMode="numeric"
          pattern="[0-9]{6,8}"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit">{t('register.activate')}</button>
    </form>
  );
}

function OnboardingWizard(props: { onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const { error, wrap } = useApiError();
  const [mode, setMode] = useState('individual');
  const [name, setName] = useState('');
  const [partners, setPartners] = useState<string[]>(['', '']);

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void wrap(async () => {
          await api.createOrg({
            name,
            practiceMode: mode,
            ...(mode === 'shared_costs'
              ? { partnerEntityNames: partners.filter((p) => p.trim() !== '') }
              : {}),
          });
          await props.onDone();
        }, 'onboarding');
      }}
    >
      <h2>{t('onboarding.title')}</h2>
      <p className="help">{t('onboarding.step', { n: 1 })}</p>
      <fieldset>
        <legend>{t('onboarding.practiceMode')}</legend>
        {(['individual', 'integrated_association', 'company', 'shared_costs'] as const).map((m) => (
          <label key={m} className="radio">
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
            {t(`onboarding.modes.${m}`)}
          </label>
        ))}
      </fieldset>
      {mode === 'shared_costs' && <p className="help">{t('onboarding.sharedCostsHelp')}</p>}
      <label>
        {t('onboarding.orgName')}
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {mode === 'shared_costs' && (
        <fieldset>
          <legend>{t('onboarding.partnerNames')}</legend>
          {partners.map((p, i) => (
            <input
              key={i}
              required
              value={p}
              onChange={(e) => setPartners(partners.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          <button type="button" className="secondary" onClick={() => setPartners([...partners, ''])}>
            {t('onboarding.addPartner')}
          </button>
        </fieldset>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit">{t('onboarding.create')}</button>
    </form>
  );
}

