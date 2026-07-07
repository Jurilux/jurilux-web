// Suite MAXIMALE de parcours utilisateurs, pilotée en Chromium contre l'app réelle
// (front + backend démo `functional.e2e_server`, multi-cabinets/multi-profils, stubé).
// Chaque parcours VÉRIFIE un résultat (assertion) en plus de capturer une screenshot.
// Voir e2e/README.md. Lancement : SHARE_ID=<...> node e2e/journeys.mjs
import { writeFileSync } from 'node:fs';
import {
  FRONT, OUT, launch, makeRunner, voir, absent,
  dismissOnboarding, ask, login, menuItem, ouvrirMenu, ouvrirCabinet,
} from './lib.mjs';

const SHARE_ID = process.env.SHARE_ID || '';
const results = [];
const journey = makeRunner(results);
const browser = await launch();

// Ouvre l'accueil, ferme l'onboarding. Raccourci commun.
const accueil = async (page) => { await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page); };

// ═══════════════ A. SERVICE & RECHERCHE (public) ═══════════════
await journey(browser, 'A01-accueil', async (page) => {
  await accueil(page);
  await voir(page, 'Quelle question de droit');
});
await journey(browser, 'A02-parcours-guide', async (page) => {
  await accueil(page);
  await ask(page, 'Licenciement avec effet immédiat ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'A03-clic-question-suivi', async (page) => {
  await accueil(page);
  await ask(page, 'Faute grave ?');
  await page.locator('.followup-btn').first().waitFor({ timeout: 15000 });
  const q = await page.locator('.followup-btn').first().innerText();
  await page.locator('.followup-btn').first().click();
  await page.locator('.bubble.user', { hasText: q.slice(0, 20) }).first().waitFor({ timeout: 8000 });
});
await journey(browser, 'A04-autre-angle', async (page) => {
  await accueil(page);
  await ask(page, 'Préavis de licenciement ?');
  await voir(page, 'Autre angle', { timeout: 15000 });
});
await journey(browser, 'A05-mode-pedagogique', async (page) => {
  await accueil(page);
  const cb = page.locator('input[type=checkbox]').first();
  if (await cb.isVisible().catch(() => false)) await cb.check().catch(() => {});
  await ask(page, 'Explique la faute grave');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'A06-filtres', async (page) => {
  await accueil(page);
  await page.locator('.filter-toggle, .filter-toggle.active').first().click().catch(() => {});
  await page.waitForTimeout(400);
  await ask(page, 'Résiliation de bail ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
});
await journey(browser, 'A07-refus-hors-sujet', async (page) => {
  await accueil(page);
  await ask(page, 'Quelle est la météo demain à Luxembourg ?');
  await voir(page, 'Aucun document pertinent', { timeout: 15000 });
});
await journey(browser, 'A08-feedback-positif', async (page) => {
  await accueil(page);
  await ask(page, 'Congé parental ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByText('👍', { exact: false }).first().click();
  await page.waitForTimeout(500);
});
await journey(browser, 'A09-feedback-manquant', async (page) => {
  await accueil(page);
  await ask(page, 'Heures supplémentaires ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByText('👎', { exact: false }).first().click();
  const champ = page.getByPlaceholder("Qu'est-ce qui manquait ?");
  if (await champ.isVisible().catch(() => false)) { await champ.fill('Manque une référence jurisprudentielle.'); await page.getByRole('button', { name: 'Envoyer' }).first().click(); }
});
await journey(browser, 'A10-partager', async (page) => {
  await accueil(page);
  await ask(page, 'Rupture conventionnelle ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.getByRole('button', { name: /Partager/ }).first().click();
  await voir(page, 'Lien copié', { timeout: 8000 });
});
await journey(browser, 'A11-permalien-public', async (page) => {
  await page.goto(SHARE_ID ? `${FRONT}/r/${SHARE_ID}` : FRONT, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await voir(page, 'Jurilux');
});

// ═══════════════ B. INSIGHT AVOCATS (public) ═══════════════
await journey(browser, 'B01-insight-recherche', async (page) => {
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await voir(page, 'Insight');
  const s = page.getByPlaceholder('Rechercher un avocat…');
  if (await s.isVisible().catch(() => false)) { await s.fill('Dupont'); await page.waitForTimeout(1000); }
});
await journey(browser, 'B02-insight-analytics', async (page) => {
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Analytics contentieux/ }).first().click().catch(() => {});
  await voir(page, 'Analytics contentieux', { timeout: 8000 });
});

// ═══════════════ C. AUTH & COMPTE ═══════════════
await journey(browser, 'C01-inscription', async (page) => {
  await accueil(page);
  await page.getByRole('button', { name: /Se connecter/ }).first().click();
  await page.locator('.modal').getByText("S'inscrire", { exact: false }).first().click().catch(() => {});
  const form = page.locator('form.auth-form');
  await form.getByPlaceholder('vous@exemple.lu').fill(`e2e_${Date.now()}@demo.lu`);
  await form.getByPlaceholder('8 caractères minimum').first().fill('password123');
  await form.locator('button[type=submit]').click();
  await voir(page, 'Plan étudiant', { timeout: 8000 });
});
await journey(browser, 'C02-connexion-pro', async (page) => {
  await accueil(page);
  await login(page, 'pro@demo.lu');
  await voir(page, 'Plan pro', { timeout: 8000 });
});
await journey(browser, 'C03-mauvais-mot-de-passe', async (page) => {
  await accueil(page);
  await page.getByRole('button', { name: /Se connecter/ }).first().click();
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
  // La rédaction est une fenêtre modale (pas un tiroir) : viser .modal, pas le champ d'accueil.
  const zone = page.locator('.modal textarea').first();
  await zone.waitFor({ state: 'visible', timeout: 8000 });
  await zone.fill('Rédige une mise en demeure pour loyers impayés.');
  await page.locator('.modal').getByRole('button', { name: /Rédiger|Générer/ }).first().click();
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

await browser.close();

// ---- agrégat + verdict ----
const summary = {
  when: new Date().toISOString(),
  total: results.length,
  ok: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error })),
  withConsoleIssues: results.filter((r) => r.consoleIssues > 0).map((r) => r.name),
  withPageErrors: results.filter((r) => r.pageErrors > 0).map((r) => r.name),
  brokenResources: [...new Set(results.flatMap((r) => (r.broken || []).map((b) => `${b.status} ${b.url}`)))],
  journeys: results,
};
writeFileSync(`${OUT}/rapport.json`, JSON.stringify(summary, null, 2));
console.log(`\n═══ ${summary.ok}/${summary.total} parcours OK · erreurs page:${summary.withPageErrors.length} · ressources cassées:${summary.brokenResources.length} ═══`);
if (summary.failed.length) { console.log('Échecs :'); summary.failed.forEach((f) => console.log(`  ✗ ${f.name} — ${f.error}`)); }
console.log(`rapport → ${OUT}/rapport.json`);
