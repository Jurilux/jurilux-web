import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// M11 — page publique du portail client : dépôt de pièces via lien magique,
// sans compte. Le consentement RGPD est explicite et obligatoire.

interface PortalInfo {
  firmName: string;
  clientDisplayName: string;
  expiresAt: string;
  accepts: string[];
}

export default function Portal(props: { entityId: string; token: string }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [docType, setDocType] = useState('id_card');
  const [file, setFile] = useState<File | null>(null);

  const qs = `e=${props.entityId}&t=${props.token}`;

  useEffect(() => {
    void fetch(`/api/v1/portal?${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('invalid');
        setInfo((await r.json()) as PortalInfo);
      })
      .catch(() => setError(t('portal.invalidLink')));
  }, [qs, t]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !consent) return;
    setError(null);
    const form = new FormData();
    form.append('docType', docType);
    form.append('consent', 'true');
    form.append('file', file);
    const res = await fetch(`/api/v1/portal/documents?${qs}`, { method: 'POST', body: form });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error === 'unsupported_file_type' ? t('portal.badFile') : (data.error ?? 'error'));
      return;
    }
    setSent([...sent, file.name]);
    setFile(null);
  };

  if (error && !info) {
    return (
      <div className="card">
        <p className="error" role="alert">{error}</p>
      </div>
    );
  }
  if (!info) return <p className="muted">…</p>;

  return (
    <div className="panel">
      <div className="card">
        <h2>{t('portal.title', { firm: info.firmName })}</h2>
        <p className="help">{t('portal.intro', { client: info.clientDisplayName })}</p>
        <p className="muted">{t('portal.expires', { date: info.expiresAt.slice(0, 10) })}</p>
      </div>

      <form className="card" onSubmit={upload}>
        <h2>{t('portal.uploadTitle')}</h2>
        <label>
          {t('portal.docType')}
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            {info.accepts.map((k) => (
              <option key={k} value={k}>
                {t(`portal.docTypes.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('portal.file')}
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="radio">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          {t('portal.consent')}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={!file || !consent}>
          {t('portal.send')}
        </button>
        {sent.length > 0 && (
          <p className="help" role="status">
            {t('portal.sent', { files: sent.join(', ') })}
          </p>
        )}
      </form>
    </div>
  );
}
