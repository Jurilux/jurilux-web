// Badge d'auto-vérification d'une sortie LLM : « n/n citations vérifiées au corpus ».
// Vert = tout vérifié · ambre = écarts à contrôler · rien à vérifier = mention discrète.
import { Verification } from './api';

export function VerifBadge({ v }: { v?: Verification | null }) {
  if (!v) return null;   // vérificateur indisponible : on n'affiche rien (best-effort)
  if (v.total === 0) {
    return <p className="verif-badge verif-neutre" title="La sortie ne cite aucune référence vérifiable.">
      ◦ Aucune référence à vérifier</p>;
  }
  const ok = v.verified === v.total;
  return (
    <p className={`verif-badge ${ok ? 'verif-ok' : 'verif-warn'}`}
      title={ok ? 'Chaque référence citée par le modèle a été retrouvée dans le corpus officiel (vérification locale, déterministe).'
        : 'Certaines références citées n\'ont pas été retrouvées dans le corpus — à contrôler avant usage.'}>
      {ok ? '✓' : '⚠'} {v.verified}/{v.total} citation{v.total > 1 ? 's' : ''} vérifiée{v.total > 1 ? 's' : ''} au corpus
      {!ok && <> — <b>{v.total - v.verified} à contrôler</b></>}
    </p>
  );
}
