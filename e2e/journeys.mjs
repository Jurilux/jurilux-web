// Suite MAXIMALE de parcours utilisateurs, pilotée en Chromium contre l'app réelle
// (front + backend démo `functional.e2e_server`, multi-cabinets/multi-profils, stubé).
// Chaque parcours VÉRIFIE un résultat (assertion) en plus de capturer une screenshot.
// Voir e2e/README.md. Lancement : SHARE_ID=<...> node e2e/journeys.mjs
import { writeFileSync } from 'node:fs';
import {
  FRONT, OUT, launch, makeRunner, voir, absent,
  dismissOnboarding, ask, login, register, entrer, menuItem, ouvrirMenu, ouvrirCabinet, acteur,
} from './lib.mjs';
import { INTENTIONS } from './intentions.mjs';

const SHARE_ID = process.env.SHARE_ID || '';
const results = [];
const journey = makeRunner(results, INTENTIONS);   // chaque parcours : intention + attendu + final
const browser = await launch();

// Ouvre l'accueil, ferme l'onboarding. Raccourci commun.
const accueil = async (page) => { await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page); };

// ═══════════════ A. SERVICE & RECHERCHE (public) ═══════════════
await journey(browser, 'A01-accueil', async (page) => {
  await entrer(page);
  await voir(page, 'Quelle question de droit');
});
await journey(browser, 'A02-parcours-guide', async (page) => {
  await entrer(page);
  await ask(page, 'Licenciement avec effet immédiat ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'A03-clic-question-suivi', async (page) => {
  await entrer(page);
  await ask(page, 'Faute grave ?');
  await page.locator('.followup-btn').first().waitFor({ timeout: 15000 });
  const q = await page.locator('.followup-btn').first().innerText();
  await page.locator('.followup-btn').first().click();
  await page.locator('.bubble.user', { hasText: q.slice(0, 20) }).first().waitFor({ timeout: 8000 });
});
await journey(browser, 'A04-autre-angle', async (page) => {
  await entrer(page);
  await ask(page, 'Préavis de licenciement ?');
  await voir(page, 'Autre angle', { timeout: 15000 });
});
await journey(browser, 'A05-mode-pedagogique', async (page) => {
  await entrer(page);
  const cb = page.locator('input[type=checkbox]').first();
  if (await cb.isVisible().catch(() => false)) await cb.check().catch(() => {});
  await ask(page, 'Explique la faute grave');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'A06-filtres', async (page) => {
  await entrer(page);
  await page.locator('.filter-toggle, .filter-toggle.active').first().click().catch(() => {});
  await page.waitForTimeout(400);
  await ask(page, 'Résiliation de bail ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'A07-refus-hors-sujet', async (page) => {
  await entrer(page);
  await ask(page, 'Quelle est la météo demain à Luxembourg ?');
  await voir(page, 'Aucun document pertinent', { timeout: 15000 });
});
await journey(browser, 'A08-feedback-positif', async (page) => {
  await entrer(page);
  await ask(page, 'Congé parental ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByText('👍', { exact: false }).first().click();
  await page.waitForTimeout(500);
});
await journey(browser, 'A09-feedback-manquant', async (page) => {
  await entrer(page);
  await ask(page, 'Heures supplémentaires ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByText('👎', { exact: false }).first().click();
  const champ = page.getByPlaceholder("Qu'est-ce qui manquait ?");
  if (await champ.isVisible().catch(() => false)) { await champ.fill('Manque une référence jurisprudentielle.'); await page.getByRole('button', { name: 'Envoyer' }).first().click(); }
});
await journey(browser, 'A10-partager', async (page) => {
  await entrer(page);
  await ask(page, 'Rupture conventionnelle ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByRole('button', { name: /Partager/ }).first().click();
  await voir(page, 'Lien copié', { timeout: 8000 });
});
await journey(browser, 'A11-permalien-public', async (page) => {
  await entrer(page);   // site privé : les permaliens exigent aussi une connexion
  await page.goto(SHARE_ID ? `${FRONT}/r/${SHARE_ID}` : FRONT, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await voir(page, 'Jurilux');
});

// ═══════════════ B. INSIGHT AVOCATS (public) ═══════════════
await journey(browser, 'B01-insight-recherche', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await voir(page, 'Insight');
  const s = page.getByPlaceholder('Rechercher un avocat…');
  if (await s.isVisible().catch(() => false)) { await s.fill('Dupont'); await page.waitForTimeout(1000); }
});
await journey(browser, 'B02-insight-analytics', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Analytics contentieux/ }).first().click().catch(() => {});
  await voir(page, 'Analytics contentieux', { timeout: 8000 });
});

// ═══════════════ C. AUTH & COMPTE ═══════════════
await journey(browser, 'C01-inscription', async (page) => {
  await accueil(page);
  await register(page, `e2e_${Date.now()}@demo.lu`);   // inscription depuis le mur
  await voir(page, 'Plan étudiant', { timeout: 8000 });
});
await journey(browser, 'C02-connexion-pro', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await voir(page, 'Plan pro', { timeout: 8000 });
});
await journey(browser, 'C03-mauvais-mot-de-passe', async (page) => {
  await accueil(page);   // le mur d'authentification est déjà affiché
  const form = page.locator('form.auth-form');
  await form.getByPlaceholder('vous@exemple.lu').fill('pro@demo.lu');
  await form.getByPlaceholder('8 caractères minimum').first().fill('mauvais_mdp');
  await form.locator('button[type=submit]').click();
  await page.waitForTimeout(800);
  // échec attendu : la connexion ne passe pas → le formulaire reste affiché (non fermé)
  await page.locator('form.auth-form').waitFor({ state: 'visible', timeout: 5000 });
  await absent(page, 'Plan pro');
});
await journey(browser, 'C04-deconnexion', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await ouvrirMenu(page);
  const bye = page.locator('.nav-drawer').getByRole('button', { name: 'Déconnexion' });
  await bye.waitFor({ state: 'visible', timeout: 8000 });
  await bye.click();
  await page.waitForTimeout(700);
  // déconnecté : l'affordance de connexion réapparaît (attente explicite)
  await page.getByRole('button', { name: /Se connecter/ }).first().waitFor({ state: 'visible', timeout: 10000 });
});
await journey(browser, 'C05-changer-mot-de-passe', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon compte');
  await voir(page, "Clés d'API");   // section unique et visible du volet « Mon compte »
  const old = page.getByPlaceholder('Mot de passe actuel');
  if (await old.isVisible().catch(() => false)) {
    await old.fill('password123');
    await page.getByPlaceholder('Nouveau mot de passe (≥ 8 caractères)').fill('password123');
    await page.getByRole('button', { name: 'Changer' }).first().click().catch(() => {});
  }
});
await journey(browser, 'C06-quota-etudiant', async (page) => {
  await accueil(page);
  await login(page, 'etudiant@demo.lu');
  // 2 questions restantes (5 - 3 déjà consommées) → la 3e franchit le quota
  for (const q of ['Question 1 ?', 'Question 2 ?', 'Question 3 ?', 'Question 4 ?']) {
    await ask(page, q);
    await page.waitForTimeout(1400);
    if (await page.getByText('Quota mensuel atteint', { exact: false }).first().isVisible().catch(() => false)) break;
  }
  await voir(page, 'Quota mensuel atteint');
});

// ═══════════════ D. CABINET, RÔLES & CLOISONS DÉONTOLOGIQUES ═══════════════
await journey(browser, 'D01-cabinet-ouvrir', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Mon cabinet');
  await voir(page, 'Étude Dupont');
});
await journey(browser, 'D02-cabinet-membres', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await ouvrirCabinet(page, 'Étude Dupont');
  await voir(page, 'dupont.associe@demo.lu', { timeout: 8000 });
});
await journey(browser, 'D03-cloison-owner-voit', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await ouvrirCabinet(page, 'Étude Dupont');
  await voir(page, 'Affaire Étoile', { timeout: 8000 });
});
await journey(browser, 'D04-cloison-collaborateur-404', async (page) => {
  await accueil(page);
  await login(page, 'dupont.collab@demo.lu');
  await ouvrirCabinet(page, 'Étude Dupont');
  await voir(page, 'Dossier Martin', { timeout: 8000 });   // le dossier ouvert est visible
  await absent(page, 'Affaire Étoile');                    // le dossier restreint est masqué
});
await journey(browser, 'D05-cloison-associe-autorise', async (page) => {
  await accueil(page);
  await login(page, 'dupont.associe@demo.lu');
  await ouvrirCabinet(page, 'Étude Dupont');
  await voir(page, 'Affaire Étoile', { timeout: 8000 });   // autorisé nommément → visible
});
await journey(browser, 'D06-isolation-inter-cabinet', async (page) => {
  await accueil(page);
  await login(page, 'weber.owner@demo.lu');
  await menuItem(page, 'Mon cabinet');
  await voir(page, 'Cabinet Weber', { timeout: 8000 });
  await absent(page, 'Étude Dupont');                      // cabinet d'un autre → invisible
});

// ═══════════════ E. VEILLE (alertes) ═══════════════
await journey(browser, 'E01-alertes-liste', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Alertes');
  await voir(page, 'bail commercial', { timeout: 8000 });
});
await journey(browser, 'E02-creer-alerte', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Alertes');
  const champ = page.locator('.drawer input[type=text], .drawer input').first();
  if (await champ.isVisible().catch(() => false)) {
    await champ.fill('congé parental');
    await page.locator('.drawer').getByRole('button', { name: /Créer|Ajouter|Suivre/ }).first().click().catch(() => {});
    await page.waitForTimeout(600);
  }
  await voir(page, 'congé parental', { timeout: 8000 });
});

// ═══════════════ F. VAULT (documents privés, isolation) ═══════════════
await journey(browser, 'F01-vault-liste', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await voir(page, 'contrat_bail', { timeout: 8000 });
});
await journey(browser, 'F02-vault-upload', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  const nom = `piece_${Date.now()}.txt`;
  await page.locator('input[type=file]').first().setInputFiles({
    name: nom, mimeType: 'text/plain', buffer: Buffer.from('Nouvelle piece deposee pour test.') });
  await page.waitForTimeout(1200);
  await voir(page, nom.slice(0, 12), { timeout: 8000 });
});
await journey(browser, 'F03-vault-question-isolee', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  const q = page.getByPlaceholder(/quels sont les délais/);
  await q.fill('Quel préavis mentionnent mes documents ?');
  await page.getByRole('button', { name: 'Demander' }).first().click();
  await page.waitForTimeout(1500);
});
await journey(browser, 'F04-vault-analyse-resume', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Analyser' }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Résumé' }).first().click().catch(() => {});
  await voir(page, 'Résumé de test', { timeout: 10000 });
});
await journey(browser, 'F05-vault-isolation', async (page) => {
  await accueil(page);
  await login(page, 'dupont.associe@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await voir(page, 'nda_client', { timeout: 8000 });   // son doc
  await absent(page, 'contrat_bail');                  // doc d'un autre propriétaire → invisible
});

// ═══════════════ G. COMPTE PRO / ENTREPRISE ═══════════════
await journey(browser, 'G01-cles-api', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Mon compte');
  await voir(page, "Clés d'API", { timeout: 8000 });
  await voir(page, 'Intégration compta');
});
await journey(browser, 'G02-creer-cle-api', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Mon compte');
  await page.getByPlaceholder('Nom de la clé (ex. Intégration compta)').fill('Clé E2E');
  await page.locator('form').filter({ has: page.getByPlaceholder('Nom de la clé (ex. Intégration compta)') })
    .getByRole('button', { name: 'Créer' }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await voir(page, 'Clé E2E', { timeout: 8000 });
});
await journey(browser, 'G03-prompts', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Mon compte');
  await voir(page, "Résumé d'arrêt", { timeout: 8000 });
});
await journey(browser, 'G04-export-rgpd', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon compte');
  await voir(page, 'Mes données (RGPD)', { timeout: 8000 });
  await page.getByRole('button', { name: /Exporter mes données/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
});
await journey(browser, 'G05-rediger', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Rédiger');
  // La rédaction est une vue interne pleine page (plus un modal) : viser .draft-setup.
  const zone = page.locator('.draft-setup textarea').first();
  await zone.waitFor({ state: 'visible', timeout: 8000 });
  await zone.fill('Rédige une mise en demeure pour loyers impayés.');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé', { timeout: 12000 });
});

// ═══════════════ H. BACKOFFICE ADMIN ═══════════════
const ADMIN_ONGLETS = ['Tableau de bord', 'Inspecteur', 'Banc de test', 'Utilisateurs',
  'Questions', 'Retours', 'Corpus', 'Santé', 'Paramétrage', 'Audit', 'Documentation'];
await journey(browser, 'H01-admin-balayage', async (page) => {
  await accueil(page);
  await login(page, 'admin@demo.lu');
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await voir(page, 'Tableau de bord', { timeout: 8000 });
  for (const o of ADMIN_ONGLETS) {
    const tab = page.getByRole('button', { name: new RegExp(o, 'i') }).first();
    if (await tab.isVisible().catch(() => false)) { await tab.click().catch(() => {}); await page.waitForTimeout(450); }
  }
});
await journey(browser, 'H02-admin-utilisateurs', async (page) => {
  await accueil(page);
  await login(page, 'admin@demo.lu');
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Utilisateurs/ }).first().click().catch(() => {});
  await voir(page, 'etudiant@demo.lu', { timeout: 8000 });
});
await journey(browser, 'H03-admin-sante', async (page) => {
  await accueil(page);
  await login(page, 'admin@demo.lu');
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Santé/ }).first().click().catch(() => {});
  await page.waitForTimeout(700);
});
await journey(browser, 'H04-admin-audit', async (page) => {
  await accueil(page);
  await login(page, 'admin@demo.lu');
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Audit/ }).first().click().catch(() => {});
  await page.waitForTimeout(700);
});

// ═══════════════ VAGUE 2 — PERMISSIONS (gating) & CRUD COMPLET ═══════════════
// Les parcours CRUD sont AUTO-CONTENUS (ils créent leurs propres entités jetables) pour ne
// pas altérer les données seedées dont dépendent les autres parcours.

// -- Gating / permissions --
await journey(browser, 'W2-01-admin-refus-pro', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');            // pro = pas admin
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await voir(page, "n'a pas les droits administrateur", { timeout: 8000 });
});
await journey(browser, 'W2-02-admin-refus-anonyme', async (page) => {
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await voir(page, 'accès réservé', { timeout: 8000 });   // site privé : renvoyé au mur d'authentification
});
await journey(browser, 'W2-03-vault-refus-anonyme', async (page) => {
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await voir(page, 'accès réservé', { timeout: 8000 });   // idem : le mur bloque l'accès anonyme
});
await journey(browser, 'W2-04-cabinet-member-sans-gestion', async (page) => {
  await accueil(page);
  await login(page, 'dupont.collab@demo.lu');  // membre simple
  await ouvrirCabinet(page, 'Étude Dupont');
  await voir(page, 'Quitter', { timeout: 8000 });          // membre : peut quitter
  await absent(page, 'Supprimer le cabinet');              // mais pas supprimer
});
await journey(browser, 'W2-05-cabinet-owner-gestion', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await ouvrirCabinet(page, 'Étude Dupont');
  await voir(page, 'Supprimer le cabinet', { timeout: 8000 });
});

// -- CRUD auto-contenu : cabinet créé puis supprimé --
await journey(browser, 'W2-06-workspace-crud', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon cabinet');
  const nom = `Cabinet CRUD ${Date.now()}`;
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await voir(page, nom, { timeout: 8000 });
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();  // ouvrir
  await page.getByRole('button', { name: /Supprimer le cabinet/ }).first().click(); // confirm auto-accepté
  await page.waitForTimeout(800);
  await absent(page, nom);
});

// -- CRUD membre : créer cabinet, inviter, changer rôle, retirer --
await journey(browser, 'W2-07-membre-invite-role-retrait', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon cabinet');
  const nom = `Cab Membres ${Date.now()}`;
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  // inviter un compte existant
  await page.getByPlaceholder('email d\'un membre inscrit').fill('weber.owner@demo.lu');
  await page.getByRole('button', { name: 'Inviter' }).first().click();
  await voir(page, 'weber.owner@demo.lu', { timeout: 8000 });
  // changer son rôle en admin
  await page.locator('select.cell-select').first().selectOption('admin').catch(() => {});
  await page.waitForTimeout(500);
  // le retirer (confirm auto-accepté)
  await page.getByRole('button', { name: 'Retirer' }).first().click();
  await page.waitForTimeout(700);
  await absent(page, 'weber.owner@demo.lu');
});

// -- CRUD alerte : créer puis supprimer --
await journey(browser, 'W2-08-alerte-crud', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Alertes');
  const sujet = `veille ${Date.now()}`;
  await page.getByPlaceholder(/Sujet à suivre/).fill(sujet);
  await page.getByRole('button', { name: 'Suivre' }).first().click();
  await voir(page, sujet, { timeout: 8000 });
  await page.locator('.drawer').getByText(sujet, { exact: false }).first().click();  // ouvrir l'alerte
  await page.getByRole('button', { name: /Supprimer l'alerte/ }).first().click();     // confirm auto
  await page.waitForTimeout(700);
});

// -- CRUD clé d'API : créer puis révoquer --
await journey(browser, 'W2-09-cle-api-crud', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon compte');
  const nom = `Clé ${Date.now()}`;
  await page.getByPlaceholder('Nom de la clé (ex. Intégration compta)').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await voir(page, nom, { timeout: 8000 });
  await page.locator('.drawer').getByRole('button', { name: 'Révoquer' }).first().click();
  await page.waitForTimeout(700);
});

// -- CRUD prompt : créer puis supprimer --
await journey(browser, 'W2-10-prompt-crud', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon compte');
  const titre = `Prompt ${Date.now()}`;
  await page.getByPlaceholder('Titre du prompt').fill(titre);
  await page.getByPlaceholder('Corps du prompt…').fill('Analyse ce contrat clause par clause.');
  await page.locator('.drawer').getByRole('button', { name: 'Ajouter' }).first().click();
  await voir(page, titre, { timeout: 8000 });
  await page.locator('.drawer').getByRole('button', { name: 'Supprimer' }).first().click();
  await page.waitForTimeout(700);
});

// -- Validation : inscription avec mot de passe trop court --
await journey(browser, 'W2-11-inscription-mdp-court', async (page) => {
  await accueil(page);
  await page.locator('.authwall').getByText('Créer un compte', { exact: false }).first().click().catch(() => {});
  const form = page.locator('form.auth-form');
  await form.getByPlaceholder('vous@exemple.lu').fill(`court_${Date.now()}@demo.lu`);
  await form.getByPlaceholder('8 caractères minimum').first().fill('123');
  await form.locator('button[type=submit]').click();
  await page.waitForTimeout(700);
  // refus attendu : le formulaire (mur) reste affiché
  await page.locator('form.auth-form').waitFor({ state: 'visible', timeout: 5000 });
});

// -- Changement de mot de passe avec mauvais ancien --
await journey(browser, 'W2-12-changer-mdp-mauvais-ancien', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon compte');
  const old = page.getByPlaceholder('Mot de passe actuel');
  await old.waitFor({ state: 'visible', timeout: 8000 });
  await old.fill('mauvais_ancien');
  await page.getByPlaceholder('Nouveau mot de passe (≥ 8 caractères)').fill('nouveaumotdepasse');
  await page.getByRole('button', { name: 'Changer' }).first().click();
  await page.waitForTimeout(800);
  // échec attendu : on reste sur le volet compte (pas de crash, mot de passe inchangé)
  await voir(page, "Clés d'API", { timeout: 8000 });
});

// ═══════════════ VAGUE 3 — VAULT COMPLET (analyses, hybride, comparaison, revue contrat) ═══════════════
// Ouvre le Vault du « pro » (2 docs seedés) et clique le premier « Analyser ».
const vaultPro = async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await voir(page, 'Mes documents', { timeout: 8000 });
};
const ouvrirAnalyse = async (page) => {
  await page.locator('table').getByRole('button', { name: 'Analyser' }).first().click();
  await voir(page, 'Analyses —', { timeout: 8000 });
};

await journey(browser, 'W3-01-vault-citations', async (page) => {
  await vaultPro(page); await ouvrirAnalyse(page);
  await page.getByRole('button', { name: 'Vérifier les citations' }).first().click();
  await voir(page, 'vérifiée', { timeout: 10000 });   // « X / Y référence(s) vérifiée(s) »
});
await journey(browser, 'W3-02-vault-extraire', async (page) => {
  await vaultPro(page); await ouvrirAnalyse(page);
  await page.getByRole('button', { name: 'Extraire' }).first().click();
  await voir(page, 'Matière', { timeout: 10000 });
});
await journey(browser, 'W3-03-vault-contre-argumentaire', async (page) => {
  await vaultPro(page); await ouvrirAnalyse(page);
  await page.getByRole('button', { name: 'Contre-argumentaire' }).first().click();
  await voir(page, 'Contre-argumentaire de test', { timeout: 12000 });
});
await journey(browser, 'W3-04-vault-chronologie', async (page) => {
  await vaultPro(page); await ouvrirAnalyse(page);
  await page.getByRole('button', { name: 'Chronologie' }).first().click();
  await page.waitForTimeout(1200);   // chronologie déterministe (peut être vide)
});
await journey(browser, 'W3-05-vault-hybride', async (page) => {
  await vaultPro(page);
  await page.getByText('Inclure le corpus public', { exact: false }).first().click().catch(() => {});
  await page.getByPlaceholder(/quels sont les délais/).fill('Préavis dans mes documents et le Code du travail ?');
  await page.getByRole('button', { name: 'Demander' }).first().click();
  await page.waitForTimeout(1800);
});
await journey(browser, 'W3-06-vault-comparer', async (page) => {
  await vaultPro(page);
  const cases = page.locator('table input[type=checkbox]');
  await cases.nth(0).check().catch(() => {});
  await cases.nth(1).check().catch(() => {});
  await page.getByRole('button', { name: /Comparer en tableau/ }).first().click();
  await voir(page, 'Comparaison', { timeout: 8000 });
});
await journey(browser, 'W3-07-vault-playbook-creer', async (page) => {
  await vaultPro(page);
  const nom = `Playbook ${Date.now()}`;
  await page.getByPlaceholder('Nom du playbook (ex : NDA standard)').fill(nom);
  await page.getByPlaceholder('Intitulé (ex : clause de confidentialité)').first().fill('Clause de résiliation');
  await page.getByPlaceholder('Ce qui doit être vérifié').first().fill('Vérifier la présence d’une clause de résiliation.');
  await page.getByRole('button', { name: /Créer le playbook/ }).first().click();
  await page.locator('.cab-row').filter({ hasText: nom }).first().waitFor({ state: 'visible', timeout: 12000 });
});
await journey(browser, 'W3-08-vault-revue-contrat', async (page) => {
  await vaultPro(page);
  // créer un playbook dédié puis lancer la revue de contrat (doc + playbook du même user)
  const nom = `PB Revue ${Date.now()}`;
  await page.getByPlaceholder('Nom du playbook (ex : NDA standard)').fill(nom);
  await page.getByPlaceholder('Intitulé (ex : clause de confidentialité)').first().fill('Clause de confidentialité');
  await page.getByPlaceholder('Ce qui doit être vérifié').first().fill('Vérifier la confidentialité.');
  await page.getByRole('button', { name: /Créer le playbook/ }).first().click();
  await page.locator('.cab-row').filter({ hasText: nom }).first().waitFor({ state: 'visible', timeout: 12000 });
  // sélectionner document + playbook puis analyser
  const selects = page.locator('select');
  await selects.nth(0).selectOption({ index: 1 }).catch(() => {});
  await selects.nth(1).selectOption({ index: 1 }).catch(() => {});
  await page.getByRole('button', { name: 'Analyser' }).last().click();
  await voir(page, /conforme|à revoir|absent/, { timeout: 12000 });
});

// ═══════════════ VAGUE 4 — RECHERCHE (filtres/refus), SAUVEGARDE, HISTORIQUE, INSIGHT ═══════════════
const ouvrirFiltres = async (page) => {
  await page.locator('.filter-toggle').first().click().catch(() => {});
  await page.waitForTimeout(300);
};

await journey(browser, 'W4-01-filtre-type', async (page) => {
  await entrer(page);
  await ouvrirFiltres(page);
  await page.getByLabel('Type').selectOption('jurisprudence').catch(() => {});
  await ask(page, 'Faute grave et licenciement ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'W4-02-filtre-annee', async (page) => {
  await entrer(page);
  await ouvrirFiltres(page);
  await page.getByLabel('Année min').fill('2018').catch(() => {});
  await page.getByLabel('Année max').fill('2024').catch(() => {});
  await ask(page, 'Préavis de licenciement ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'W4-03-filtre-juridiction', async (page) => {
  await entrer(page);
  await ouvrirFiltres(page);
  await page.getByLabel('Juridiction').fill('csj_ch08').catch(() => {});
  await ask(page, 'Bail commercial ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'W4-04-refus-avec-filtre-elargir', async (page) => {
  await entrer(page);
  await ouvrirFiltres(page);
  await page.getByLabel('Année min').fill('2020').catch(() => {});
  await ask(page, 'Quelle est la météo demain ?');   // hors droit → refus
  await voir(page, 'Aucun document pertinent', { timeout: 15000 });
  // le bouton « Élargir — retirer les filtres » doit être proposé (des filtres sont actifs)
  await voir(page, 'Élargir', { timeout: 5000 });
});
await journey(browser, 'W4-05-sauver-dans-dossier', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await ask(page, 'Faute grave ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByTitle('Ranger dans un dossier').first().click();
  await voir(page, 'Enregistrer dans un dossier', { timeout: 8000 });
});
await journey(browser, 'W4-06-historique-detail', async (page) => {
  await accueil(page);
  await login(page, 'etudiant@demo.lu');   // 3 questions seedées
  await menuItem(page, 'Historique');
  await voir(page, 'faute grave', { timeout: 8000 });
});
await journey(browser, 'W4-07-insight-profil-avocat', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Dupont');
  await page.waitForTimeout(900);
  await page.locator('.lw-row').first().click();
  await voir(page, 'Décisions', { timeout: 8000 });   // fiche avocat ouverte
});
await journey(browser, 'W4-08-insight-analytics-matiere', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Analytics contentieux/ }).first().click();
  await voir(page, 'Droit du travail', { timeout: 8000 });  // matière issue des données seedées
});

// ═══════════════ VAGUE 5 — PARCOURS MULTI-ACTEURS BOUT-EN-BOUT ═══════════════

// Nouveau client : inscription → question → feedback → partage, d'un seul tenant.
await journey(browser, 'W5-01-nouveau-client-bout-en-bout', async (page) => {
  await accueil(page);
  await register(page, `client_${Date.now()}@demo.lu`);   // inscription depuis le mur
  await voir(page, 'Plan étudiant', { timeout: 8000 });
  await ask(page, 'Dans quels cas un licenciement immédiat est-il justifié ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByText('👍', { exact: false }).first().click();
  await page.getByRole('button', { name: /Partager/ }).first().click();
  await voir(page, 'Lien copié', { timeout: 8000 });
});

// Collaboration : l'owner crée un cabinet et invite un membre ; le membre (autre session) le voit.
await journey(browser, 'W5-02-collaboration-cabinet', async (page) => {
  const nom = `Collab ${Date.now()}`;
  await accueil(page);
  await login(page, 'weber.owner@demo.lu');
  await menuItem(page, 'Mon cabinet');
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  await page.getByPlaceholder("email d'un membre inscrit").fill('etudiant@demo.lu');
  await page.getByRole('button', { name: 'Inviter' }).first().click();
  await voir(page, 'etudiant@demo.lu', { timeout: 8000 });
  // acteur B : l'étudiant, dans SA session, voit le cabinet partagé
  const { ctx, p } = await acteur(page.context().browser(), 'etudiant@demo.lu');
  try {
    await ouvrirCabinet(p, nom);
    await voir(p, nom, { timeout: 8000 });
  } finally { await ctx.close(); }
});

// Cloison déontologique bout-en-bout : owner restreint + autorise un seul membre ;
// le collaborateur non autorisé NE voit PAS le dossier, l'associé autorisé LE voit.
await journey(browser, 'W5-03-cloison-bout-en-bout', async (page) => {
  const nom = `Cloison ${Date.now()}`;
  const secret = `Secret ${Date.now()}`;
  await accueil(page);
  await login(page, 'weber.owner@demo.lu');
  await menuItem(page, 'Mon cabinet');
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  for (const em of ['dupont.collab@demo.lu', 'dupont.associe@demo.lu']) {
    await page.getByPlaceholder("email d'un membre inscrit").fill(em);
    await page.getByRole('button', { name: 'Inviter' }).first().click();
    await page.waitForTimeout(400);
  }
  await page.getByPlaceholder(/Nouveau dossier/).fill(secret);
  await page.getByRole('button', { name: 'Créer', exact: true }).last().click();
  await voir(page, secret, { timeout: 8000 });
  // restreindre + autoriser uniquement l'associé
  await page.getByRole('button', { name: 'Restreindre' }).first().click();
  await page.getByPlaceholder('Autoriser un membre (email)').fill('dupont.associe@demo.lu');
  await page.getByRole('button', { name: 'Autoriser' }).first().click();
  await page.waitForTimeout(600);
  // acteur B : le collaborateur NON autorisé ne voit pas le dossier secret
  const collab = await acteur(page.context().browser(), 'dupont.collab@demo.lu');
  try {
    await ouvrirCabinet(collab.p, nom);
    await absent(collab.p, secret);
  } finally { await collab.ctx.close(); }
  // acteur C : l'associé autorisé le voit
  const asso = await acteur(page.context().browser(), 'dupont.associe@demo.lu');
  try {
    await ouvrirCabinet(asso.p, nom);
    await voir(asso.p, secret, { timeout: 8000 });
  } finally { await asso.ctx.close(); }
});

// ═══════════════ VAGUE 6 — SOUS-ACTIONS BACKOFFICE ADMIN ═══════════════
const admin = async (page, onglet) => {
  await accueil(page);
  await login(page, 'admin@demo.lu');
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  if (onglet) { await page.getByRole('button', { name: new RegExp(onglet, 'i') }).first().click(); await page.waitForTimeout(500); }
};

await journey(browser, 'W6-01-admin-changer-plan', async (page) => {
  await admin(page, 'Utilisateurs');
  const sel = page.locator('tr', { hasText: 'dupont.collab@demo.lu' }).locator('select.cell-select');
  await sel.selectOption('pro');
  await page.waitForTimeout(500);
  if ((await sel.inputValue()) !== 'pro') throw new Error('plan non appliqué');
  await sel.selectOption('student');   // on remet en état
});
await journey(browser, 'W6-02-admin-toggle-admin', async (page) => {
  await admin(page, 'Utilisateurs');
  const row = page.locator('tr', { hasText: 'dupont.collab@demo.lu' });
  const cb = row.locator('input[type=checkbox]');
  const avant = await cb.isChecked();
  await cb.click();
  await page.waitForTimeout(500);
  if ((await cb.isChecked()) === avant) throw new Error('bascule admin sans effet');
  await cb.click();   // remettre en état
});
await journey(browser, 'W6-03-admin-inspecteur-probe', async (page) => {
  await admin(page, 'Inspecteur');
  await page.getByPlaceholder(/Ex : conséquences/).fill('faute grave licenciement');
  await page.getByRole('button', { name: 'Inspecter' }).first().click();
  await voir(page, 'CSJ', { timeout: 10000 });   // extraits stubés remontés
});
await journey(browser, 'W6-04-admin-banc-eval', async (page) => {
  await admin(page, 'Banc de test');
  await page.getByRole('button', { name: /Lancer le banc de test/ }).first().click();
  await voir(page, 'Question de référence', { timeout: 12000 });
});
await journey(browser, 'W6-05-admin-config-patch', async (page) => {
  await admin(page, 'Paramétrage');
  const row = page.locator('.bar-row').first();
  await row.locator('input').first().fill('42');
  await row.getByRole('button').first().click();
  await voir(page, 'appliqué', { timeout: 8000 });
});
await journey(browser, 'W6-06-admin-supprimer-user', async (page) => {
  // compte jetable créé via une requête navigateur (proxy Vite → backend)
  const email = `jetable_${Date.now()}@demo.lu`;
  await page.request.post(`${FRONT}/api/auth/register`, { data: { email, password: 'password123' } });
  await admin(page, 'Utilisateurs');
  await voir(page, email, { timeout: 8000 });
  await page.locator('tr', { hasText: email }).getByRole('button', { name: 'Supprimer' }).click();
  await page.waitForTimeout(700);
  await absent(page, email);
});

// ═══════════════ VAGUE 7 — DESTRUCTIFS CONFIRMÉS & BRANCHES D'ERREUR ═══════════════

// Créer un cabinet jetable, y ajouter un dossier, puis SUPPRIMER le dossier.
await journey(browser, 'W7-01-supprimer-dossier', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon cabinet');
  const nom = `Espace ${Date.now()}`, doss = `Pièce ${Date.now()}`;   // noms non chevauchants
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  await page.getByPlaceholder(/Nouveau dossier/).fill(doss);
  await page.getByRole('button', { name: 'Créer', exact: true }).last().click();
  await voir(page, doss, { timeout: 8000 });
  await page.getByTitle('Supprimer le dossier').first().click();   // confirm auto-accepté
  await page.locator('.cab-row, .dossier-row').filter({ hasText: doss }).first()
    .waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  await absent(page, doss);
});

// Un membre QUITTE un cabinet (autre session) → il disparaît de sa liste.
await journey(browser, 'W7-02-quitter-cabinet', async (page) => {
  const nom = `Quit ${Date.now()}`;
  await accueil(page);
  await login(page, 'weber.owner@demo.lu');
  await menuItem(page, 'Mon cabinet');
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  await page.getByPlaceholder("email d'un membre inscrit").fill('etudiant@demo.lu');
  await page.getByRole('button', { name: 'Inviter' }).first().click();
  await voir(page, 'etudiant@demo.lu', { timeout: 8000 });
  const { ctx, p } = await acteur(page.context().browser(), 'etudiant@demo.lu');
  try {
    await ouvrirCabinet(p, nom);
    await p.getByRole('button', { name: 'Quitter' }).first().click();   // confirm auto
    await p.waitForTimeout(700);
    await absent(p, nom);   // le cabinet a disparu de sa liste
  } finally { await ctx.close(); }
});

// Révocation d'accès : après avoir autorisé puis RÉVOQUÉ, l'associé ne voit plus le dossier.
await journey(browser, 'W7-03-revoquer-acces', async (page) => {
  const nom = `Rev ${Date.now()}`, sec = `Sec ${Date.now()}`;
  await accueil(page);
  await login(page, 'weber.owner@demo.lu');
  await menuItem(page, 'Mon cabinet');
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  await page.getByPlaceholder("email d'un membre inscrit").fill('dupont.associe@demo.lu');
  await page.getByRole('button', { name: 'Inviter' }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Nouveau dossier/).fill(sec);
  await page.getByRole('button', { name: 'Créer', exact: true }).last().click();
  await voir(page, sec, { timeout: 8000 });
  await page.getByRole('button', { name: 'Restreindre' }).first().click();
  await page.getByPlaceholder('Autoriser un membre (email)').fill('dupont.associe@demo.lu');
  await page.getByRole('button', { name: 'Autoriser' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Révoquer' }).first().click();   // révocation
  await page.waitForTimeout(600);
  // vérif : l'associé (autre session) ne voit plus le dossier
  const { ctx, p } = await acteur(page.context().browser(), 'dupont.associe@demo.lu');
  try {
    await ouvrirCabinet(p, nom);
    await absent(p, sec);
  } finally { await ctx.close(); }
});

// Upload d'un fichier trop volumineux → 413 remonté à l'utilisateur.
await journey(browser, 'W7-04-upload-trop-gros-413', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await voir(page, 'Mes documents', { timeout: 8000 });
  const gros = Buffer.alloc(26 * 1024 * 1024, 97);   // 26 Mo > limite 25 Mo
  await page.locator('input[type=file]').first().setInputFiles(
    { name: 'enorme.txt', mimeType: 'text/plain', buffer: gros }, { timeout: 30000 });
  // dépôt rejeté (413 côté backend ; le proxy Vite le remonte en 500 en dev — Caddy renvoie
  // bien 413 en prod). Dans les deux cas, une erreur de dépôt s'affiche.
  await voir(page, /trop volumineux|dépôt a échoué/, { timeout: 15000 });
});

// ═══════════════ VAGUE 8 — INSIGHT AVANCÉ + ONGLETS ADMIN RESTANTS + CORPUS ═══════════════
await journey(browser, 'W8-01-insight-comparer', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Dupont');
  await page.waitForTimeout(800);
  await page.locator('.lw-row').first().click();
  await voir(page, 'Décisions', { timeout: 8000 });
  await page.getByRole('button', { name: /Comparer/ }).first().click();
  const pick = page.locator('.insight-picker .lw-row-simple, .insight-picker .lw-row').first();
  await pick.waitFor({ state: 'visible', timeout: 8000 });
  await pick.click();
  await voir(page, 'Comparaison', { timeout: 8000 });
});
await journey(browser, 'W8-02-insight-filtre-matiere', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByTitle('Filtrer par domaine').selectOption({ label: /Droit du travail/ }).catch(() => {});
  await page.waitForTimeout(800);
  await voir(page, 'Dupont', { timeout: 8000 });   // avocat de la matière reste listé
});
await journey(browser, 'W8-03-admin-questions', async (page) => {
  await admin(page, 'Questions');
  await voir(page, 'faute grave', { timeout: 8000 });   // question seedée de l'étudiant
});
await journey(browser, 'W8-04-admin-retours', async (page) => {
  await admin(page, 'Retours');
  await voir(page, 'Retours des utilisateurs', { timeout: 8000 });
});
await journey(browser, 'W8-05-admin-corpus', async (page) => {
  await admin(page, 'Corpus');
  await voir(page, 'Corpus indexé', { timeout: 8000 });
});
await journey(browser, 'W8-06-admin-activite', async (page) => {
  await admin(page, 'Tableau de bord');   // le graphe d'activité est sur le tableau de bord
  await voir(page, 'questions par jour', { timeout: 8000 });
});
await journey(browser, 'W8-07-admin-routage-llm', async (page) => {
  await admin(page, 'Santé');
  await voir(page, 'Routage LLM', { timeout: 8000 });
});
await journey(browser, 'W8-08-corpus-info-menu', async (page) => {
  await entrer(page);
  await ouvrirMenu(page);   // la volumétrie du corpus est dans le tiroir « Le corpus »
  await voir(page, 'décisions', { timeout: 8000 });
});

// ═══════════════ VAGUE 9 — VARIANTES DE PROFIL & COMPLÉMENTS ═══════════════
await journey(browser, 'W9-01-anonyme-mur', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await voir(page, 'accès réservé', { timeout: 8000 });   // anonyme → mur d'authentification
  await absent(page, 'Mon cabinet');                       // aucune fonction de l'app n'est exposée
  await absent(page, 'Quelle question de droit');
});
await journey(browser, 'W9-02-vault-supprimer-doc', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  const nom = `asupprimer_${Date.now()}.txt`;   // nom complet unique (évite les collisions inter-runs)
  await page.locator('input[type=file]').first().setInputFiles({
    name: nom, mimeType: 'text/plain', buffer: Buffer.from('doc a supprimer') });
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });      // liste fraîche : le doc y figure
  const ligne = page.locator('tr', { hasText: nom });
  await ligne.getByRole('button', { name: 'Supprimer' }).click();
  await ligne.first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await page.reload({ waitUntil: 'networkidle' });      // reconfirme sur une liste fraîche
  await absent(page, nom);
});
await journey(browser, 'W9-03-alerte-verifier', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Alertes');
  await voir(page, 'bail commercial', { timeout: 8000 });
  await page.locator('.hist-item').filter({ hasText: 'bail commercial' }).first().click();
  await page.waitForTimeout(1000);   // ouverture = check + hits + marquage lu
});
await journey(browser, 'W9-04-alerte-verifier-toutes', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Alertes');
  await page.getByRole('button', { name: /Vérifier toutes/ }).first().click();
  await page.waitForTimeout(1000);
  await voir(page, 'bail commercial', { timeout: 8000 });
});
await journey(browser, 'W9-05-permalien-contenu', async (page) => {
  await entrer(page);   // site privé : les permaliens exigent aussi une connexion
  await page.goto(SHARE_ID ? `${FRONT}/r/${SHARE_ID}` : FRONT, { waitUntil: 'networkidle' });
  await voir(page, 'Réponse partagée', { timeout: 8000 });
});
await journey(browser, 'W9-06-changer-mdp-succes', async (page) => {
  await accueil(page);
  const email = `switch_${Date.now()}@demo.lu`;
  await register(page, email);   // inscription depuis le mur
  await voir(page, 'Plan étudiant', { timeout: 8000 });
  // changement réussi de mot de passe
  await menuItem(page, 'Mon compte');
  await page.getByPlaceholder('Mot de passe actuel').fill('password123');
  await page.getByPlaceholder('Nouveau mot de passe (≥ 8 caractères)').fill('nouveaumotdepasse');
  await page.getByRole('button', { name: 'Changer' }).first().click();
  await voir(page, 'Mot de passe modifié', { timeout: 8000 });   // confirmation du succès
});

// ═══════════════ VAGUE 10 — BRANCHES D'ERREUR ATTEIGNABLES + VARIANTES ═══════════════
await journey(browser, 'W10-01-inscription-email-existant', async (page) => {
  await accueil(page);
  await page.locator('.authwall').getByText('Créer un compte', { exact: false }).first().click().catch(() => {});
  const form = page.locator('form.auth-form');
  await form.getByPlaceholder('vous@exemple.lu').fill('pro@demo.lu');   // déjà pris
  await form.getByPlaceholder('8 caractères minimum').first().fill('password123');
  await form.locator('button[type=submit]').click();
  await page.waitForTimeout(700);
  await page.locator('form.auth-form').waitFor({ state: 'visible', timeout: 5000 });   // refus → reste sur le mur
  await absent(page, 'Plan pro');
});
await journey(browser, 'W10-02-connexion-email-inconnu', async (page) => {
  await accueil(page);
  const form = page.locator('form.auth-form');
  await form.getByPlaceholder('vous@exemple.lu').fill(`inconnu_${Date.now()}@nowhere.lu`);
  await form.getByPlaceholder('8 caractères minimum').first().fill('password123');
  await form.locator('button[type=submit]').click();
  await page.waitForTimeout(700);
  await page.locator('form.auth-form').waitFor({ state: 'visible', timeout: 5000 });
});
await journey(browser, 'W10-03-inviter-non-inscrit', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon cabinet');
  const nom = `CabInvErr ${Date.now()}`;
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  await page.getByPlaceholder("email d'un membre inscrit").fill('pasla@nowhere.lu');   // non inscrit
  await page.getByRole('button', { name: 'Inviter' }).first().click();
  await page.waitForTimeout(700);
  await absent(page, 'pasla@nowhere.lu');   // invitation rejetée → pas ajouté
});
await journey(browser, 'W10-04-autoriser-non-membre', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await menuItem(page, 'Mon cabinet');
  const nom = `CabAccErr ${Date.now()}`, doss = `PièceX ${Date.now()}`;
  await page.getByPlaceholder('Nom du cabinet').fill(nom);
  await page.locator('.drawer').getByRole('button', { name: 'Créer', exact: true }).first().click();
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  await page.getByPlaceholder(/Nouveau dossier/).fill(doss);
  await page.getByRole('button', { name: 'Créer', exact: true }).last().click();
  await voir(page, doss, { timeout: 8000 });
  await page.getByRole('button', { name: 'Restreindre' }).first().click();
  await page.getByPlaceholder('Autoriser un membre (email)').fill('etudiant@demo.lu');   // pas membre de CE cabinet
  await page.getByRole('button', { name: 'Autoriser' }).first().click();
  await page.waitForTimeout(700);
  await absent(page, 'etudiant@demo.lu');   // refus → non autorisé
});
await journey(browser, 'W10-05-vault-vide', async (page) => {
  await accueil(page);
  await register(page, `vide_${Date.now()}@demo.lu`);   // nouveau compte → Vault vide
  await voir(page, 'Plan étudiant', { timeout: 8000 });
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await voir(page, 'Aucun document déposé', { timeout: 8000 });
});
await journey(browser, 'W10-06-insight-sans-resultat', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Zzzxxqqnobody');
  await page.waitForTimeout(900);
  await voir(page, '0 résultat', { timeout: 8000 });
});
await journey(browser, 'W10-07-insight-tri-recent', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByTitle('Trier').selectOption('recent');
  await voir(page, 'triés par activité récente', { timeout: 8000 });   // ligne de résultats (pas l'option)
});
await journey(browser, 'W10-08-insight-tri-taux', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByTitle('Trier').selectOption('winrate');
  await voir(page, 'triés par taux estimé favorable', { timeout: 8000 });
});
await journey(browser, 'W10-09-filtre-source-loi', async (page) => {
  await entrer(page);
  await page.locator('.filter-toggle').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByLabel('Type').selectOption('law');
  await ask(page, 'Que dit le Code du travail sur le préavis ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'W10-10-filtres-combines', async (page) => {
  await entrer(page);
  await page.locator('.filter-toggle').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByLabel('Type').selectOption('jurisprudence');
  await page.getByLabel('Année min').fill('2018');
  await page.getByLabel('Année max').fill('2024');
  await page.getByLabel('Juridiction').fill('csj_ch08');
  await ask(page, 'Licenciement pour faute grave ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});

// ═══════════════ VAGUE 11 — VARIANTES RECHERCHE / RÉPONSE / DIVERS ═══════════════
await journey(browser, 'W11-01-exemple-preset', async (page) => {
  await entrer(page);
  await page.locator('.sugg').first().click();   // clic sur une question d'exemple
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'W11-02-conversation-multitours', async (page) => {
  await entrer(page);
  await ask(page, 'Faute grave ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await ask(page, 'Et le préavis alors ?');   // 2e tour (contexte conversationnel)
  await page.waitForTimeout(1500);
  const bulles = await page.locator('.bubble.user').count();
  if (bulles < 2) throw new Error('2e tour non enregistré');
});
await journey(browser, 'W11-03-nouvelle-recherche-reset', async (page) => {
  await entrer(page);
  await ask(page, 'Congé parental ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.locator('.side-cta').first().click();   // « + Nouvelle recherche »
  await voir(page, 'Quelle question de droit', { timeout: 8000 });   // fil réinitialisé
});
await journey(browser, 'W11-04-filtre-projet-loi', async (page) => {
  await entrer(page);
  await page.locator('.filter-toggle').first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByLabel('Type').selectOption('projet_loi');
  await ask(page, 'Projets de loi sur le travail ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'W11-05-feedback-pouce-bas-champ', async (page) => {
  await entrer(page);
  await ask(page, 'Heures supplémentaires ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByText('👎', { exact: false }).first().click();
  // le champ de précision (placeholder, pas du texte) apparaît
  await page.getByPlaceholder("Qu'est-ce qui manquait ?").waitFor({ state: 'visible', timeout: 5000 });
});
await journey(browser, 'W11-06-mentions-legales', async (page) => {
  await entrer(page);
  await page.locator('.side-legal').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await voir(page, /Mentions|confidentialité|données/, { timeout: 8000 });
});

// ═══════════════ VAGUE 12 — VAULT EN PROFONDEUR ═══════════════
const vaultPro2 = async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await voir(page, 'Mes documents', { timeout: 8000 });
};
await journey(browser, 'W12-01-chronologie-datee', async (page) => {
  await vaultPro2(page);
  const nom = `chrono_${Date.now()}.txt`;
  await page.locator('input[type=file]').first().setInputFiles({ name: nom, mimeType: 'text/plain',
    buffer: Buffer.from('Le 12 mars 2019, signature du contrat. Le 5 avril 2020, résiliation notifiée.') });
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: nom }).getByRole('button', { name: 'Analyser' }).click();
  await page.getByRole('button', { name: 'Chronologie' }).first().click();
  await voir(page, '2019', { timeout: 10000 });   // chronologie déterministe non vide
});
await journey(browser, 'W12-02-supprimer-playbook', async (page) => {
  await vaultPro2(page);
  const nom = `PBsuppr ${Date.now()}`;
  await page.getByPlaceholder('Nom du playbook (ex : NDA standard)').fill(nom);
  await page.getByPlaceholder('Intitulé (ex : clause de confidentialité)').first().fill('Règle');
  await page.getByPlaceholder('Ce qui doit être vérifié').first().fill('Vérifier la règle.');
  await page.getByRole('button', { name: /Créer le playbook/ }).first().click();
  const ligne = page.locator('.cab-row').filter({ hasText: nom });
  await ligne.first().waitFor({ state: 'visible', timeout: 12000 });
  await ligne.getByRole('button', { name: 'Supprimer' }).click();   // confirm auto
  await ligne.first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await absent(page, nom);
});
await journey(browser, 'W12-03-comparer-3-docs', async (page) => {
  await vaultPro2(page);
  const cases = page.locator('table input[type=checkbox]');
  for (let i = 0; i < 3; i++) await cases.nth(i).check().catch(() => {});
  await page.getByRole('button', { name: /Comparer en tableau/ }).first().click();
  await voir(page, 'Comparaison', { timeout: 8000 });
});
await journey(browser, 'W12-04-vault-ask-hybride-suite', async (page) => {
  await vaultPro2(page);
  await page.getByText('Inclure le corpus public', { exact: false }).first().click().catch(() => {});
  await page.getByPlaceholder(/quels sont les délais/).fill('Quel est le préavis selon mes docs et la loi ?');
  await page.getByRole('button', { name: 'Demander' }).first().click();
  await page.waitForTimeout(1800);   // réponse hybride (docs privés + corpus public)
});

// ═══════════════ VAGUE 13 — INSIGHT EN PROFONDEUR ═══════════════
const ouvrirProfil = async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Dupont');
  await page.waitForTimeout(800);
  await page.locator('.lw-row').first().click();
  await voir(page, 'Décisions', { timeout: 8000 });
};
await journey(browser, 'W13-01-profil-issue-estimee', async (page) => {
  await ouvrirProfil(page);
  await voir(page, 'Issue estimée', { timeout: 8000 });
});
await journey(browser, 'W13-02-profil-confreres', async (page) => {
  await ouvrirProfil(page);
  await voir(page, 'Confrères', { timeout: 8000 });
});
await journey(browser, 'W13-03-profil-annees', async (page) => {
  await ouvrirProfil(page);
  await voir(page, 'Activité par année', { timeout: 8000 });
});
await journey(browser, 'W13-04-profil-juridiction', async (page) => {
  await ouvrirProfil(page);
  await voir(page, 'Répartition par juridiction', { timeout: 8000 });
});
await journey(browser, 'W13-05-analytics-taux', async (page) => {
  await entrer(page);   // site privé : entrer avant d'accéder à Insight
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Analytics contentieux/ }).first().click();
  await voir(page, 'Taux', { timeout: 8000 });   // colonne taux de succès estimé
});

// ═══════════════ VAGUE 14 — ADMIN EN PROFONDEUR ═══════════════
await journey(browser, 'W14-01-audit-entrees', async (page) => {
  await admin(page, 'Audit');
  await voir(page, '2026', { timeout: 8000 });   // des entrées d'audit horodatées existent
});
await journey(browser, 'W14-02-audit-filtre', async (page) => {
  await admin(page, 'Audit');
  await page.getByPlaceholder(/Filtrer par action/).fill('apikey');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);   // filtre appliqué (pas de crash)
});
await journey(browser, 'W14-03-eval-detail', async (page) => {
  await admin(page, 'Banc de test');
  await page.getByRole('button', { name: /Lancer le banc de test/ }).first().click();
  await voir(page, 'Textes remontés', { timeout: 12000 });   // en-tête du rapport d'éval
});
await journey(browser, 'W14-04-questions-2e', async (page) => {
  await admin(page, 'Questions');
  await voir(page, 'préavis', { timeout: 8000 });   // 2e question seedée
});
await journey(browser, 'W14-05-probe-topk', async (page) => {
  await admin(page, 'Inspecteur');
  await page.getByPlaceholder(/Ex : conséquences/).fill('préavis licenciement');
  await page.locator('form.probe-form select, form select').first().selectOption('30').catch(() => {});
  await page.getByRole('button', { name: 'Inspecter' }).first().click();
  await voir(page, 'CSJ', { timeout: 10000 });
});

// ═══════════════ VAGUE 15 — CABINET EN PROFONDEUR ═══════════════
await journey(browser, 'W15-01-ranger-dans-dossier-existant', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await ask(page, 'Licenciement pour faute grave ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByTitle('Ranger dans un dossier').first().click();
  await voir(page, 'Enregistrer dans un dossier', { timeout: 8000 });
  await page.locator('.modal .hist-item').filter({ hasText: 'Dossier Martin' }).first().click();
  await voir(page, 'rangée dans le dossier', { timeout: 8000 });   // ✓ confirmation
});
await journey(browser, 'W15-02-ranger-dans-nouveau-dossier', async (page) => {
  await accueil(page);
  await login(page, 'dupont.owner@demo.lu');
  await ask(page, 'Préavis légal ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByTitle('Ranger dans un dossier').first().click();
  await voir(page, 'Enregistrer dans un dossier', { timeout: 8000 });
  await page.getByPlaceholder('…ou nouveau dossier').fill(`Dossier E2E ${Date.now()}`);
  await page.getByRole('button', { name: /Créer .* ranger/ }).first().click();
  await voir(page, 'rangée dans le dossier', { timeout: 8000 });
});
await journey(browser, 'W15-03-membre-sans-restreindre', async (page) => {
  await accueil(page);
  await login(page, 'dupont.collab@demo.lu');   // simple membre
  await ouvrirCabinet(page, 'Étude Dupont');
  await voir(page, 'Dossier Martin', { timeout: 8000 });   // voit les dossiers ouverts
  await absent(page, 'Restreindre');                       // mais pas les contrôles de cloison
});

// ═══════════ V16. INSIGHT PROFOND — tous les cas d'usage de la page Insight ═══════════
// La page a 4 vues (Avocats / Cabinets / Analytics / Méthodo & RGPD) + un parcours de
// découverte (profil → matière → confrères) : chaque interaction est exercée ici.

await journey(browser, 'W16-01-liste-et-recherche', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await voir(page, 'avocats indexés');                       // ligne de stats
  await page.getByPlaceholder('Rechercher un avocat…').fill('Schmit');
  await voir(page, 'Pierre SCHMIT');
  await absent(page, 'Sophie WAGNER');                       // la recherche filtre bien
});

await journey(browser, 'W16-02-tri-taux-estime', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.locator('select').nth(1).selectOption({ label: 'Tri : taux estimé favorable' });
  await page.waitForTimeout(600);
  // seuil de significativité : seuls les avocats à ≥10 issues estimables apparaissent
  await voir(page, 'Pierre SCHMIT');
  await absent(page, 'Sophie WAGNER');
});

await journey(browser, 'W16-03-filtre-matiere-et-vide', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.locator('select').first().selectOption('Famille');
  await page.waitForTimeout(600);
  await voir(page, 'Sophie WAGNER');
  await absent(page, 'Paul KIEFFER');                        // pas de commercial en Famille
  // recherche sans résultat → état vide propre
  await page.getByPlaceholder('Rechercher un avocat…').fill('Zzzzinconnu');
  await voir(page, 'Aucun avocat');
});

await journey(browser, 'W16-04-profil-complet', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Schmit');
  await page.getByText('Pierre SCHMIT').first().click();
  await voir(page, 'Cabinet :');                             // rattachement au cabinet
  await voir(page, 'ÉTUDE SCHMIT & FABER');
  await voir(page, 'Issue estimée');
  await voir(page, 'favorables');                            // barre gagné/perdu + légende
  await voir(page, 'montant médian');                        // KPI montants
  await voir(page, 'Positions :');                           // demandeur/défendeur
  await voir(page, 'Activité par année');
  await voir(page, 'Répartition par juridiction');
  await voir(page, 'PDF ↗');                                 // décisions ouvrables
});

await journey(browser, 'W16-05-confrere-adversaire', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Schmit');
  await page.getByText('Pierre SCHMIT').first().click();
  await voir(page, 'Confrères récurrents');
  await page.locator('.cochip').filter({ hasText: 'Marc MULLER' }).first().click();  // adversaire
  await voir(page, 'ÉTUDE MULLER');                          // on est sur le profil MULLER
  await voir(page, 'Bail / logement');
  // fil d'Ariane : SCHMIT est une étape cliquable, retour à la liste par « Avocats »
  await page.locator('.crumbs').getByText('Pierre SCHMIT').click();
  await voir(page, 'Confrères récurrents');
  await page.locator('.crumbs').getByRole('button', { name: 'Avocats' }).click();
  await voir(page, 'avocats indexés');
});

await journey(browser, 'W16-06-parcours-matiere', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Schmit');
  await page.getByText('Pierre SCHMIT').first().click();
  await page.locator('.matter-link').filter({ hasText: 'Droit du travail' }).first().click();
  await voir(page, 'tendances de la matière');
  await voir(page, 'dans cette matière');                    // note « position de l'avocat d'origine »
  await voir(page, 'Avocats liés à cette matière');
  await voir(page, 'vous y êtes');                           // l'avocat d'origine est marqué
  // rebond sur un confrère de la matière → son profil s'ouvre
  await page.locator('.matter-journey .lw-row:not(.lw-row-from)').first().click();
  await voir(page, 'Issue estimée');
});

await journey(browser, 'W16-07-comparateur', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Schmit');
  await page.getByText('Pierre SCHMIT').first().click();
  await page.getByRole('button', { name: /Comparer/ }).click();
  await voir(page, 'Comparer à…');
  await page.getByPlaceholder('Rechercher le 2ᵉ avocat…').fill('Muller');
  await page.waitForTimeout(500);
  await page.locator('.insight-picker .lw-row-simple').first().click();
  await voir(page, 'Comparaison');
  await voir(page, 'Issue estimée favorable');
  await voir(page, 'Marc MULLER');
  // retour au profil d'origine
  await page.getByRole('button', { name: /Retour au profil/ }).click();
  await voir(page, 'Pierre SCHMIT');
});

await journey(browser, 'W16-08-export-csv-profil', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Schmit');
  await page.getByText('Pierre SCHMIT').first().click();
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.getByRole('button', { name: /Export CSV/ }).click();
  const f = await dl;                                        // le téléchargement démarre
  if (!f.suggestedFilename().includes('SCHMIT')) throw new Error('nom de fichier CSV inattendu');
});

await journey(browser, 'W16-09-cabinets-liste-et-fiche', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Cabinets' }).click();
  await voir(page, 'Cabinets explicitement nommés');
  await voir(page, 'ÉTUDE SCHMIT & FABER');
  await page.locator('tr', { hasText: 'ÉTUDE SCHMIT & FABER' }).getByText('ouvrir').click();
  await voir(page, 'Avocats du cabinet');
  await voir(page, 'Claire FABER');                          // les 2 avocats du cabinet
  await voir(page, 'Pierre SCHMIT');
  // clic sur un avocat du cabinet → bascule sur son profil (vue Avocats)
  await page.locator('.lw-row-simple').filter({ hasText: 'Claire FABER' }).click();
  await voir(page, 'Issue estimée');
});

await journey(browser, 'W16-10-cabinets-recherche-vide', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Cabinets' }).click();
  await page.getByPlaceholder('Rechercher un cabinet…').fill('Zzzz');
  await voir(page, 'Aucun cabinet');
});

await journey(browser, 'W16-11-analytics-complet', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Analytics contentieux' }).click();
  await voir(page, 'issues estimables');
  await voir(page, 'montant médian');
  await voir(page, 'délai médian');
  await voir(page, 'Par matière');
  await voir(page, 'Par juridiction');
  await voir(page, 'Par année');
  await voir(page, 'Articles les plus visés');
  await voir(page, 'L.124-10');                              // extraction des articles visés
});

await journey(browser, 'W16-12-methodo-rgpd', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Méthodologie/ }).click();
  await voir(page, 'Jurimétrie, pas justice prédictive');
  await voir(page, 'Jamais de magistrats');
  // soumission d'une demande d'opposition
  await page.getByPlaceholder('Maître Prénom NOM').fill('Maître Pierre SCHMIT');
  await page.locator('.rgpd-form select').selectOption('opposition');
  await page.locator('.rgpd-form button.send').click();
  await voir(page, 'Demande enregistrée');
});

await journey(browser, 'W16-13-question-nominative-court-circuit', async (page) => {
  await entrer(page);
  await ask(page, 'Quelles décisions de Maître Pierre Schmit ?');
  // lawyer_lookup court-circuite le RAG : profil + volume de décisions, sans réponse LLM
  await voir(page, 'apparaît dans');
  await voir(page, 'décision');
});


await journey(browser, 'W16-14-profil-en-echec-message', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  // simule une panne de l'API profil (500) : le clic doit produire un MESSAGE, jamais un
  // échec silencieux (« je clique et rien ne se passe »).
  await page.route('**/api/insight/lawyers/**', (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"panne simulée"}' }));
  await page.getByPlaceholder('Rechercher un avocat…').fill('Schmit');
  await page.getByText('Pierre SCHMIT').first().click();
  await voir(page, "Impossible d'ouvrir ce profil");
  await page.unroute('**/api/insight/lawyers/**');
});

await journey(browser, 'W16-15-cabinet-en-echec-message', async (page) => {
  await entrer(page);
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Cabinets' }).click();
  await voir(page, 'ÉTUDE SCHMIT & FABER');
  await page.route('**/api/insight/firms/**', (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"panne simulée"}' }));
  await page.locator('tr', { hasText: 'ÉTUDE SCHMIT & FABER' }).getByText('ouvrir').click();
  await voir(page, "Impossible d'ouvrir cette fiche");
  await page.unroute('**/api/insight/firms/**');
});


await journey(browser, 'W17-01-deconnexion-desktop', async (page) => {
  // Régression signalée : « sur ordi je ne vois pas de bouton se déconnecter » — le bouton
  // n'existait QUE dans le tiroir mobile ☰ (tous nos parcours navigant par lui, rien ne le voyait).
  await entrer(page);
  await page.setViewportSize({ width: 1280, height: 900 });   // vue DESKTOP explicite
  const btn = page.locator('aside').getByRole('button', { name: 'Se déconnecter' });
  await btn.waitFor({ state: 'visible', timeout: 8000 });     // visible SANS ouvrir de menu
  await btn.click();
  await voir(page, 'accès réservé');                          // retour au mur (site privé)
});

// ═══════════ V18. RÉDACTION V2 — modèles, brouillons, versions, raffinement ═══════════

await journey(browser, 'W18-01-generer-depuis-modele', async (page) => {
  await entrer(page);
  await menuItem(page, 'Rédiger');
  await page.locator('.draft-setup select').first().selectOption('i:mise-en-demeure');
  await voir(page, 'Courrier formel exigeant');                 // description du modèle
  await page.getByPlaceholder('SARL Exemple, 12 rue X, Luxembourg').fill('SARL Test');
  await page.locator('.draft-setup textarea').fill('Mise en demeure pour loyers impayés');
  await page.locator('.draft-style select').first().selectOption('ferme');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test). [squelette suivi]'); // squelette transmis
  await voir(page, 'Fondements · 1 document');
});

await journey(browser, 'W18-02-raffiner-et-versions', async (page) => {
  await entrer(page);
  await menuItem(page, 'Rédiger');
  await page.locator('.draft-setup textarea').fill('Avis sur le préavis de licenciement');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test).');
  await page.getByPlaceholder(/Raffiner :/).fill('ajoute un paragraphe sur la prescription');
  await page.getByRole('button', { name: 'Raffiner' }).click();
  await voir(page, '[Révisé : ajoute un paragraphe');            // contenu révisé
  await voir(page, 'Historique — 2 versions');
});

await journey(browser, 'W18-03-brouillon-persistant-reouverture', async (page) => {
  await entrer(page);
  await menuItem(page, 'Rédiger');
  await page.locator('.draft-setup textarea').fill('Note interne clause de non-concurrence');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test).');
  // renommer puis fermer/rouvrir : le brouillon persiste
  await page.locator('.draft-title').fill('Note NC — dossier X');
  await page.locator('.draft-title').blur();
  await page.waitForTimeout(400);
  // RECHARGEMENT complet de la page /redaction : le brouillon doit persister côté serveur
  await page.goto(`${FRONT}/redaction`, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await page.locator('.draft-open').selectOption({ index: 1 }); // brouillon le plus récent
  await voir(page, 'Document rédigé (test).');
  const titre = await page.locator('.draft-title').inputValue();  // le titre vit dans un <input>
  if (titre !== 'Note NC — dossier X') throw new Error('titre non persisté : ' + titre);
});

await journey(browser, 'W18-04-restaurer-version', async (page) => {
  await entrer(page);
  await menuItem(page, 'Rédiger');
  await page.setViewportSize({ width: 1280, height: 1600 });   // desktop haut : l'historique tient à l'écran
  await page.locator('.draft-setup textarea').fill('Conclusions licenciement abusif');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test).');
  await page.getByPlaceholder(/Raffiner :/).fill('raccourcis la discussion');
  await page.getByRole('button', { name: 'Raffiner' }).click();
  await voir(page, 'Historique — 2 versions');
  await page.locator('.draft-versions summary').click();      // ouvrir l'historique
  await page.locator('.draft-versions').getByRole('button', { name: /restaurer/ }).first().click();
  await voir(page, 'Historique — 3 versions');                  // restauration = nouvelle version
});

await journey(browser, 'W18-05-enregistrer-comme-modele', async (page) => {
  await entrer(page);
  await menuItem(page, 'Rédiger');
  await page.locator('.draft-setup textarea').fill('Trame de courrier type');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test).');
  await page.getByRole('button', { name: 'Enregistrer comme modèle' }).click();
  await page.locator('.draft-tplform input').fill('Ma trame courrier');
  await page.locator('.draft-tplform').getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(500);
  // le modèle personnel apparaît dans le sélecteur et peut être supprimé
  const sel = page.locator('.draft-setup select').first();
  await sel.selectOption({ label: 'Ma trame courrier' });
  await page.getByRole('button', { name: 'Supprimer ce modèle' }).click();
  await page.waitForTimeout(400);
  await absent(page, 'Ma trame courrier');
});

await journey(browser, 'W18-06-modele-cabinet-partage', async (page, bag) => {
  // l'owner du cabinet Dupont publie un modèle partagé…
  await entrer(page, 'dupont.owner@demo.lu');
  await menuItem(page, 'Rédiger');
  await page.locator('.draft-setup textarea').fill('Trame partagée du cabinet');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test).');
  await page.getByRole('button', { name: 'Enregistrer comme modèle' }).click();
  await page.locator('.draft-tplform input').fill('Trame Dupont partagée');
  await page.locator('.draft-tplform select').selectOption({ index: 1 });   // Cabinet : Étude Dupont
  await page.locator('.draft-tplform').getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(500);
  // … et l'associé du même cabinet le voit dans son propre sélecteur
  const a = await acteur(browser, 'dupont.associe@demo.lu');
  try {
    await menuItem(a.p, 'Rédiger');
    await a.p.locator('.draft-setup select').first()
      .selectOption({ label: 'Trame Dupont partagée · cabinet' });
  } finally { await a.ctx.close(); }
});

await journey(browser, 'W18-07-refus-gracieux', async (page) => {
  await entrer(page);
  await menuItem(page, 'Rédiger');
  await page.locator('.draft-setup textarea').fill('recette de cuisine luxembourgeoise');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Aucun fondement');                           // refus, pas de document
  await absent(page, 'Historique —');
});

await journey(browser, 'W18-08-suppression-brouillon', async (page) => {
  await entrer(page);
  await menuItem(page, 'Rédiger');
  await page.locator('.draft-setup textarea').fill('Document à jeter');
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test).');
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click(); // confirm() auto-accepté
  await page.waitForTimeout(500);
  await voir(page, 'Exemples — cliquez pour pré-remplir');      // retour à l'état vide (exemples)
});


await journey(browser, 'W18-09-exemples-et-route', async (page) => {
  // accès direct à la vue interne par l'URL (comme /insight), pas de modale
  await entrer(page);
  await page.goto(`${FRONT}/redaction`, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await voir(page, 'Rédaction assistée');                        // en-tête de la vue pleine page
  await voir(page, 'Exemples — cliquez pour pré-remplir');
  // cliquer un exemple pré-remplit modèle + variables + instruction
  await page.locator('.draft-ex').filter({ hasText: 'Loyers commerciaux impayés' }).click();
  const instr = await page.locator('.draft-setup textarea').inputValue();
  if (!instr.includes('loyers commerciaux')) throw new Error('exemple non chargé : ' + instr);
  const dest = await page.getByPlaceholder('SARL Exemple, 12 rue X, Luxembourg').inputValue();
  if (!dest.includes('Bail Center')) throw new Error('variable non préremplie');
  // il ne reste qu'à lancer
  await page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  await voir(page, 'Document rédigé (test). [squelette suivi]');
});

// ═══════════════ W19. CARTE THÉMATIQUE SUR LES RÉPONSES DE SUIVI ═══════════════
// Régression : les réponses aux questions connexes/de suivi doivent recevoir la MÊME
// carte thématique (constellation) que la 1re réponse, et non un simple texte brut.
await journey(browser, 'W19-01-carte-sur-reponse-suivi', async (page) => {
  await entrer(page);
  await ask(page, 'Licenciement avec effet immédiat ?');
  // 1re réponse → carte thématique
  await page.locator('.tmap').first().waitFor({ timeout: 15000 });
  // approfondir via une question de suivi
  await page.locator('.followup-btn').first().waitFor({ timeout: 8000 });
  await page.locator('.followup-btn').first().click();
  // la réponse de SUIVI est elle aussi présentée en carte (≥ 2 constellations au total)
  await page.locator('.tmap').nth(1).waitFor({ timeout: 15000 });
});

await browser.close();

// ---- agrégat + verdict ----
const summary = {
  when: new Date().toISOString(),
  total: results.length,
  conformes: results.filter((r) => r.final === 'CONFORME').length,
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).map((r) => ({ name: r.name, intention: r.intention, attendu: r.attendu, error: r.error })),
  sansIntention: results.filter((r) => !r.intention).map((r) => r.name),   // parcours sans intention déclarée
  withConsoleIssues: results.filter((r) => r.consoleIssues > 0).map((r) => r.name),
  withPageErrors: results.filter((r) => r.pageErrors > 0).map((r) => r.name),
  brokenResources: [...new Set(results.flatMap((r) => (r.broken || []).map((b) => `${b.status} ${b.url}`)))],
  // Tableau intention → attendu → final, exploitable comme documentation vivante.
  journeys: results.map((r) => ({ name: r.name, intention: r.intention, attendu: r.attendu, final: r.final, resultat: r.resultat_final, ms: r.ms })),
};
writeFileSync(`${OUT}/rapport.json`, JSON.stringify(summary, null, 2));
if (summary.sansIntention.length) console.log(`⚠ parcours sans intention déclarée : ${summary.sansIntention.join(', ')}`);
console.log(`\n═══ ${summary.conformes}/${summary.total} CONFORMES · erreurs page:${summary.withPageErrors.length} · ressources cassées:${summary.brokenResources.length} ═══`);
if (summary.failed.length) { console.log('Échecs :'); summary.failed.forEach((f) => console.log(`  ✗ ${f.name} — ${f.error}`)); }
console.log(`rapport → ${OUT}/rapport.json`);
// Code de sortie non nul si un parcours échoue ou si une page plante → utilisable en gate CI.
process.exitCode = (summary.ok === summary.total && summary.withPageErrors.length === 0) ? 0 : 1;
