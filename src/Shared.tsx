import { useEffect, useState } from 'react';
import { getShare, SharedResponse } from './api';
import { renderAnswer, Sources } from './App';

// Vue publique en lecture seule d'une réponse partagée (route /r/<id>).
// Sert de vitrine : un juriste partage une réponse sourcée à un confrère → démo gratuite.
export function SharedView({ id }: { id: string }) {
  const [data, setData] = useState<SharedResponse | 'loading' | 'notfound'>('loading');

  useEffect(() => {
    getShare(id).then((d) => setData(d || 'notfound')).catch(() => setData('notfound'));
  }, [id]);

  return (
    <div className="shared-app">
      <header className="shared-head">
        <a className="brand-btn" href="/"><span className="logo">⚖</span><strong>Jurilux</strong></a>
        <span className="muted">Réponse partagée</span>
        <div className="header-actions">
          <a className="send account-btn" href="/">Poser ma question</a>
        </div>
      </header>

      <main className="shared-main">
        <div className="thread shared-thread">
          {data === 'loading' && <p className="muted">Chargement…</p>}
          {data === 'notfound' && <p className="warn">⚠ Ce lien est introuvable ou a expiré.</p>}
          {typeof data === 'object' && (
            <>
              <div className="bubble user"><p>{data.question}</p></div>
              <div className="bubble assistant">
                <div className="bubble-tag">
                  Jurilux {data.status === 'partial' && <span className="badge badge-partial">Réponse partielle</span>}
                </div>
                {data.answer
                  ? <div className="answer" dangerouslySetInnerHTML={{ __html: renderAnswer(data.answer, data.citations || []) }} />
                  : <p className="muted">Réponse indisponible.</p>}
                {data.citations && data.citations.length > 0 && <Sources citations={data.citations} />}
              </div>

              <div className="share-cta">
                <p><strong>Posez vos propres questions juridiques.</strong> Des réponses sourcées sur la
                  jurisprudence et la législation luxembourgeoises, avec chaque décision vérifiable.</p>
                <a className="send" href="/">Essayer Jurilux</a>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
