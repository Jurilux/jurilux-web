import { useState, ReactNode } from 'react';

// Parcours de première connexion : 3 étapes, une seule fois (localStorage), skippable.
const KEY = 'jx_onboarded_v1';
export const shouldOnboard = () => {
  try { return !localStorage.getItem(KEY); } catch { return false; }
};
const markDone = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };

interface Step { eyebrow: string; title: string; body: ReactNode; visual: ReactNode; }

const STEPS: Step[] = [
  {
    eyebrow: 'Recherche juridique · Luxembourg',
    title: 'Posez votre question. Obtenez une réponse sourcée.',
    body: (
      <>Jurilux répond à vos questions de droit luxembourgeois <b>en langage naturel</b>, en s'appuyant sur
        la jurisprudence et la législation. Chaque source est <b>vérifiable</b>.</>
    ),
    visual: <div className="onb-mark">⚖</div>,
  },
  {
    eyebrow: 'Confiance',
    title: 'Chaque affirmation cite sa source',
    body: (
      <>Un clic ouvre la décision ou le texte de loi en <b>PDF</b>. Et si le corpus ne couvre pas votre
        question, Jurilux vous le dit franchement — <b>pas de réponse inventée</b>.</>
    ),
    visual: (
      <div className="onb-quote">
        <p>La durée du préavis dépend de l'ancienneté du salarié<sup>1</sup>.</p>
        <div className="onb-src"><span className="onb-n">1</span> Code du travail — L.124-3</div>
      </div>
    ),
  },
  {
    eyebrow: 'Vos outils',
    title: 'Plus qu’un moteur de recherche',
    body: (
      <ul className="onb-list">
        <li><span className="onb-ico">⚖</span><span><b>Insight</b> — qui a plaidé quoi : profils d'avocats et leurs décisions.</span></li>
        <li><span className="onb-ico">▤</span><span><b>Mon cabinet</b> — rangez et partagez vos réponses en dossiers.</span></li>
        <li><span className="onb-ico">◆</span><span><b>Alertes</b> — soyez averti des nouvelles décisions sur vos sujets.</span></li>
      </ul>
    ),
    visual: <div className="onb-mark">✦</div>,
  },
];

export function Onboarding({ onClose, onSignup }: { onClose: () => void; onSignup: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const done = () => { markDone(); onClose(); };

  return (
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="Bienvenue sur Jurilux">
      <div className="onb-card">
        <button className="onb-skip" onClick={done}>Passer</button>
        <div className="onb-visual" key={step}>{s.visual}</div>
        <div className="onb-eyebrow">{s.eyebrow}</div>
        <h2 className="onb-title">{s.title}</h2>
        <div className="onb-body">{s.body}</div>

        <div className="onb-dots" aria-hidden="true">
          {STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
        </div>

        <div className="onb-actions">
          {step > 0
            ? <button className="ghost" onClick={() => setStep(step - 1)}>Précédent</button>
            : <button className="ghost onb-second" onClick={() => { markDone(); onSignup(); }}>Créer un compte</button>}
          {last
            ? <button className="send" onClick={done}>Commencer</button>
            : <button className="send" onClick={() => setStep(step + 1)}>Suivant</button>}
        </div>
      </div>
    </div>
  );
}
