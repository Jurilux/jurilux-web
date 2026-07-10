import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  api,
  type ClientSummary,
  type MatterSummary,
  type ScopingAnswers,
  type UserEntity,
} from './api';

// Espace de travail par entité (Sprints 1-2) : clients (M3) et dossiers (M4)
// avec le flux « Nouveau dossier » du § D.7 : qualification par questions fermées
// → verdict expliqué en langage clair.

const CATEGORIES = [
  'real_estate',
  'company_formation',
  'pssf',
  'family_office',
  'tax_advice',
  'asset_management',
  'funds_of_third_parties',
  'litigation',
  'consultation',
  'other',
] as const;

export default function Workspace(props: { entities: UserEntity[]; onLogout: () => void }) {
  const { t } = useTranslation();
  const [entityId, setEntityId] = useState(props.entities[0]?.entityId ?? '');
  const [tab, setTab] = useState<'clients' | 'matters'>('matters');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!entityId) return;
    try {
      setError(null);
      const [c, m] = await Promise.all([api.listClients(entityId), api.listMatters(entityId)]);
      setClients(c);
      setMatters(m);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : String(e));
    }
  }, [entityId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="workspace">
      <div className="workspace-bar">
        {props.entities.length > 1 ? (
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)} aria-label={t('dashboard.entity')}>
            {props.entities.map((e) => (
              <option key={e.entityId} value={e.entityId}>
                {e.entityName}
              </option>
            ))}
          </select>
        ) : (
          <strong>{props.entities[0]?.entityName}</strong>
        )}
        <nav>
          <button className={tab === 'matters' ? '' : 'secondary'} onClick={() => setTab('matters')}>
            {t('matters.title')}
          </button>
          <button className={tab === 'clients' ? '' : 'secondary'} onClick={() => setTab('clients')}>
            {t('clients.title')}
          </button>
          <button className="secondary" onClick={() => void api.logout().finally(props.onLogout)}>
            {t('dashboard.logout')}
          </button>
        </nav>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {tab === 'clients' && <ClientsPanel entityId={entityId} clients={clients} onChanged={reload} />}
      {tab === 'matters' && (
        <MattersPanel entityId={entityId} clients={clients} matters={matters} onChanged={reload} />
      )}
    </div>
  );
}

function ClientsPanel(props: { entityId: string; clients: ClientSummary[]; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'natural' | 'legal'>('natural');
  const [firstNames, setFirstNames] = useState('');
  const [lastName, setLastName] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('LU');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (kind === 'natural') {
        await api.createNaturalClient(props.entityId, { firstNames, lastName });
        setFirstNames('');
        setLastName('');
      } else {
        await api.createLegalClient(props.entityId, { name, country });
        setName('');
      }
      await props.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : String(err));
    }
  };

  return (
    <div className="panel">
      <form className="card" onSubmit={submit}>
        <h2>{t('clients.new')}</h2>
        <div className="row">
          <label className="radio">
            <input type="radio" checked={kind === 'natural'} onChange={() => setKind('natural')} />
            {t('clients.natural')}
          </label>
          <label className="radio">
            <input type="radio" checked={kind === 'legal'} onChange={() => setKind('legal')} />
            {t('clients.legal')}
          </label>
        </div>
        {kind === 'natural' ? (
          <div className="row">
            <label>
              {t('clients.lastName')}
              <input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
            <label>
              {t('clients.firstNames')}
              <input required value={firstNames} onChange={(e) => setFirstNames(e.target.value)} />
            </label>
          </div>
        ) : (
          <div className="row">
            <label>
              {t('clients.companyName')}
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t('clients.country')}
              <input required maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
            </label>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit">{t('clients.create')}</button>
      </form>

      <ul className="list">
        {props.clients.map((c) => (
          <li key={c.id} className="card">
            <strong>{c.displayName}</strong>
            <span className="pill">{t(`clients.kind.${c.kind}`)}</span>
            <span className="muted">
              {t('clients.mattersCount', { count: c.mattersCount })}
            </span>
          </li>
        ))}
        {props.clients.length === 0 && <li className="muted">{t('clients.empty')}</li>}
      </ul>
    </div>
  );
}

function MattersPanel(props: {
  entityId: string;
  clients: ClientSummary[];
  matters: MatterSummary[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [verdict, setVerdict] = useState<{ verdict: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await props.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ? `${err.code} — ${err.detail}` : err.code) : String(err));
    }
  };

  return (
    <div className="panel">
      {verdict && (
        <div className={`card verdict verdict-${verdict.verdict}`}>
          <strong>{t(`matters.verdict.${verdict.verdict}`)}</strong>
          <p className="help">{verdict.reason}</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {showForm ? (
        <NewMatterForm
          entityId={props.entityId}
          clients={props.clients}
          onDone={async (v) => {
            setVerdict(v);
            setShowForm(false);
            await props.onChanged();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button onClick={() => setShowForm(true)}>{t('matters.new')}</button>
      )}

      <ul className="list">
        {props.matters.map((m) => (
          <li key={m.id} className="card">
            <div>
              <strong>{m.title}</strong> — {m.client.displayName}
            </div>
            <div className="row">
              <span className={`pill verdict-${m.scopingVerdict}`}>{t(`matters.verdict.${m.scopingVerdict}`)}</span>
              <span className="pill">{t(`matters.status.${m.status}`)}</span>
              {m.pssf && <span className="pill">PSSF</span>}
            </div>
            <div className="row">
              {(m.status === 'draft' || m.status === 'pending_cdd') && (
                <button className="secondary" onClick={() => void act(() => api.activateMatter(props.entityId, m.id))}>
                  {t('matters.activate')}
                </button>
              )}
              {m.status !== 'closed' && (
                <button className="secondary" onClick={() => void act(() => api.closeMatter(props.entityId, m.id))}>
                  {t('matters.close')}
                </button>
              )}
            </div>
          </li>
        ))}
        {props.matters.length === 0 && <li className="muted">{t('matters.empty')}</li>}
      </ul>
    </div>
  );
}

function NewMatterForm(props: {
  entityId: string;
  clients: ClientSummary[];
  onDone: (verdict: { verdict: string; reason: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState(props.clients[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('consultation');
  const [defense, setDefense] = useState(false);
  const [pureConsultation, setPureConsultation] = useState(false);
  const [assists, setAssists] = useState(false);
  const [funds, setFunds] = useState(false);
  const [fundsOrigin, setFundsOrigin] = useState('');
  const [countries, setCountries] = useState('LU');
  const [estVolume, setEstVolume] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const answers: ScopingAnswers = {
      category,
      isDefenseOrJudicialProceedings: defense,
      isPureLegalConsultation: pureConsultation,
      assistsInTransaction: assists,
      handlesClientFunds: funds,
    };
    try {
      const result = await api.createMatter(props.entityId, {
        clientId,
        title,
        category,
        answers,
        ...(fundsOrigin ? { fundsOrigin } : {}),
        ...(countries ? { countries: countries.split(',').map((c) => c.trim().toUpperCase()) } : {}),
        ...(estVolume ? { estVolume } : {}),
      });
      await props.onDone({ verdict: result.verdict, reason: result.reason });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : String(err));
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('matters.new')}</h2>
      <label>
        {t('matters.client')}
        <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {props.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('matters.matterTitle')}
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {t('matters.category')}
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`matters.categories.${c}`)}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>{t('matters.scopingTitle')}</legend>
        <label className="radio">
          <input type="checkbox" checked={defense} onChange={(e) => setDefense(e.target.checked)} />
          {t('matters.q.defense')}
        </label>
        <label className="radio">
          <input type="checkbox" checked={assists} onChange={(e) => setAssists(e.target.checked)} />
          {t('matters.q.assists')}
        </label>
        <label className="radio">
          <input type="checkbox" checked={funds} onChange={(e) => setFunds(e.target.checked)} />
          {t('matters.q.funds')}
        </label>
        <label className="radio">
          <input
            type="checkbox"
            checked={pureConsultation}
            onChange={(e) => setPureConsultation(e.target.checked)}
          />
          {t('matters.q.pureConsultation')}
        </label>
      </fieldset>

      <fieldset>
        <legend>{t('matters.cddTitle')}</legend>
        <div className="row">
          <label>
            {t('matters.fundsOrigin')}
            <input value={fundsOrigin} onChange={(e) => setFundsOrigin(e.target.value)} />
          </label>
          <label>
            {t('matters.countries')}
            <input value={countries} onChange={(e) => setCountries(e.target.value)} />
          </label>
          <label>
            {t('matters.estVolume')}
            <input value={estVolume} onChange={(e) => setEstVolume(e.target.value)} placeholder="100k-500k" />
          </label>
        </div>
      </fieldset>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="submit">{t('matters.create')}</button>
        <button type="button" className="secondary" onClick={props.onCancel}>
          {t('matters.cancel')}
        </button>
      </div>
    </form>
  );
}
