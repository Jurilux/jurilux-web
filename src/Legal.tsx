import { useEffect } from 'react';

// Page « Mentions légales & confidentialité ».
// Contenu volontairement explicite : premier jet à faire relire par un juriste avant
// lancement payant. Les champs entre [crochets] sont à compléter par l'éditeur.
// Hébergeur = fait public (OVH). Sous-traitants IA = réels (Anthropic, OpenAI).

// Éditeur : Soloji S.à r.l., RCS Luxembourg B281612 (données publiques RCS/LBR).
// Directeur de la publication et e-mail de contact restent à confirmer par l’éditeur.
const EDITEUR = 'Soloji S.à r.l.';
const EDITEUR_ADRESSE = '5, rue Glesener, L-1631 Luxembourg';
const EDITEUR_RCS = 'RCS Luxembourg B281612';
const DIRECTEUR_PUBLICATION = 'Abdelha Tayeb';
const CONTACT = 'contact@jurilux.lu';

export function LegalPage({ onClose }: { onClose: () => void }) {
  // Fermeture au clavier (Échap) + verrou du scroll de fond.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="legal-overlay" onClick={onClose}>
      <div className="legal-page" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Mentions légales et confidentialité">
        <header className="legal-head">
          <div className="brand"><span className="logo">⚖</span><strong>Jurilux</strong></div>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕ Fermer</button>
        </header>

        <div className="legal-body">
          <p className="legal-eyebrow">Informations légales</p>
          <h1>Mentions légales &amp; confidentialité</h1>
          <p className="legal-lead">
            Jurilux est un assistant de recherche juridique. Il aide à retrouver et comprendre la jurisprudence
            et la législation luxembourgeoises. Il ne remplace pas la consultation d’un professionnel du droit.
          </p>

          <section>
            <h2>Éditeur &amp; hébergement</h2>
            <dl className="legal-dl">
              <div><dt>Éditeur</dt><dd>{EDITEUR}, société à responsabilité limitée<br />{EDITEUR_ADRESSE}<br />{EDITEUR_RCS}</dd></div>
              <div><dt>Contact</dt><dd><a href={`mailto:${CONTACT}`}>{CONTACT}</a></dd></div>
              <div><dt>Directeur de la publication</dt><dd>{DIRECTEUR_PUBLICATION}</dd></div>
              <div><dt>Hébergeur</dt><dd>OVH SAS — 2 rue Kellermann, 59100 Roubaix, France</dd></div>
            </dl>
          </section>

          <section>
            <h2>Sources &amp; licence de réutilisation</h2>
            <p>
              Jurilux s’appuie exclusivement sur des données publiques, réutilisées dans le respect de leur licence :
            </p>
            <ul>
              <li>
                <strong>Jurisprudence</strong> — décisions publiées par l’Administration judiciaire via{' '}
                <a href="https://data.public.lu/fr/organizations/administration-judiciaire/" target="_blank" rel="noopener noreferrer">data.public.lu</a>,
                sous licence ouverte. Les décisions sont <strong>pseudonymisées à la source</strong> et
                reproduites <strong>sans modification</strong>.
              </li>
              <li>
                <strong>Textes de loi &amp; projets</strong> — législation consolidée de{' '}
                <a href="https://legilux.public.lu" target="_blank" rel="noopener noreferrer">Legilux</a>{' '}
                et dossiers de la Chambre des Députés.
              </li>
            </ul>
            <p className="muted">
              L’attribution des sources est conservée et les documents ne sont ni altérés ni présentés comme
              une source officielle. Les PDF d’origine restent accessibles depuis chaque réponse.
            </p>
          </section>

          <section>
            <h2>Protection des données personnelles (RGPD)</h2>
            <p>
              L’éditeur est responsable du traitement. Nous appliquons le Règlement (UE) 2016/679 (RGPD) et
              la loi luxembourgeoise du 1<sup>er</sup> août 2018.
            </p>

            <h3>Données que nous traitons</h3>
            <ul>
              <li><strong>Compte</strong> (facultatif) : adresse e-mail et mot de passe (stocké sous forme chiffrée / haché).</li>
              <li><strong>Historique</strong> : les questions posées lorsque vous êtes connecté, pour vous permettre de les retrouver.</li>
              <li><strong>Aucune</strong> publicité, aucun traceur tiers, aucune revente de données.</li>
            </ul>

            <h3>Finalité &amp; base légale</h3>
            <p>
              Fournir le service de recherche et l’espace personnel (exécution du contrat) et en assurer la
              sécurité et l’amélioration (intérêt légitime). La création de compte est facultative : Jurilux
              s’utilise aussi sans compte.
            </p>

            <h3>Jurisprudence &amp; personnes citées</h3>
            <p>
              Les décisions proviennent de sources <strong>déjà pseudonymisées</strong> par l’Administration
              judiciaire. Jurilux ne cherche pas à ré-identifier les personnes et n’enrichit pas ces documents.
              Si vous estimez qu’une décision vous concernant permet votre identification, vous pouvez demander
              son <strong>déréférencement</strong> à <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            </p>

            <h3>Sous-traitants</h3>
            <p>Pour générer une réponse, votre question est transmise à des prestataires techniques :</p>
            <ul>
              <li><strong>OVH</strong> (UE) — hébergement.</li>
              <li><strong>Anthropic</strong> (modèle Claude) — rédaction de la réponse à partir des extraits.</li>
              <li><strong>OpenAI</strong> — calcul de similarité sémantique pour la recherche.</li>
            </ul>
            <p className="muted">
              Ne saisissez pas d’informations confidentielles ou de données personnelles sensibles dans vos questions.
            </p>

            <h3>Conservation</h3>
            <p>
              Compte et historique sont conservés tant que le compte est actif. Vous pouvez supprimer votre
              compte à tout moment ; les données associées sont alors effacées.
            </p>

            <h3>Vos droits</h3>
            <p>
              Vous disposez des droits d’accès, de rectification, d’effacement, de limitation, d’opposition et
              de portabilité. Pour les exercer : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Vous pouvez aussi
              introduire une réclamation auprès de la <strong>CNPD</strong> (Commission nationale pour la
              protection des données, Luxembourg) —{' '}
              <a href="https://cnpd.public.lu" target="_blank" rel="noopener noreferrer">cnpd.public.lu</a>.
            </p>
          </section>

          <section>
            <h2>Avertissement</h2>
            <p>
              Les réponses sont générées automatiquement par une intelligence artificielle à partir des sources
              du corpus. Elles peuvent comporter des erreurs, des omissions ou être obsolètes.{' '}
              <strong>Elles ne constituent pas un avis juridique</strong> et ne sauraient engager la
              responsabilité de l’éditeur. Vérifiez toujours l’information dans les sources citées et consultez
              un avocat pour toute décision.
            </p>
          </section>

          <p className="legal-updated muted">Dernière mise à jour : juillet 2026.</p>
        </div>
      </div>
    </div>
  );
}
