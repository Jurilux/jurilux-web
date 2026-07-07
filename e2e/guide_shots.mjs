// Génère des CAPTURES propres pour le guide utilisateur (page Documentation du backoffice),
// en réutilisant le système de test Chromium + le backend de démo stubé. Sortie : public/guide/.
// Lancement : PW_CHROME=... SHARE_ID=... node e2e/guide_shots.mjs
import { mkdirSync } from 'node:fs';
import { launch, FRONT, login, dismissOnboarding, ask, voir } from './lib.mjs';

const OUT = new URL('../public/guide/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function shot(name, fn, { w = 1180, h = 860 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(9000);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  try {
    await fn(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${name}.png` });   // viewport (cadrage net)
    console.log('✓', name);
  } catch (e) { console.log('✗', name, '—', String(e.message || e).split('\n')[0]); }
  await ctx.close();
}

// Clic dans la barre latérale desktop (Vault/Rédiger/Mon compte/Cabinet/Alertes y sont).
const sidebar = (page, texte) => page.locator('aside.sidebar').getByText(texte, { exact: false }).first().click();

// 1 · Recherche sourcée + parcours guidé
await shot('recherche', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await ask(page, 'Dans quels cas un licenciement avec effet immédiat est-il justifié ?');
  await voir(page, 'parcours guidé', { timeout: 15000 });
  await page.waitForTimeout(500);
});

// 2 · Vault — analyse d'un document
await shot('vault', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await page.locator('table').getByRole('button', { name: 'Analyser' }).first().click();
  await page.getByRole('button', { name: 'Résumé' }).first().click();
  await voir(page, 'Résumé de test', { timeout: 8000 });
});

// 3 · Rédaction assistée (volet)
await shot('rediger', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page);
  await login(page, 'pro@demo.lu');
  await sidebar(page, 'Rédiger');
  const zone = page.locator('.modal textarea').first();
  await zone.waitFor({ state: 'visible', timeout: 8000 });
  await zone.fill('Rédige une mise en demeure pour loyers impayés (droit LU).');
  await page.locator('.modal').getByRole('button', { name: /Rédiger|Générer/ }).first().click();
  await voir(page, 'Document rédigé', { timeout: 12000 });
});

// 4 · Cabinet & cloisons (volet)
await shot('cabinet', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page);
  await login(page, 'dupont.owner@demo.lu');
  await sidebar(page, 'Mon cabinet');
  await page.locator('.drawer').getByText('Étude Dupont', { exact: false }).first().click();
  await voir(page, 'Affaire Étoile', { timeout: 8000 });
});

// 5 · Insight avocats (fiche)
await shot('insight', async (page) => {
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Rechercher un avocat…').fill('Dupont');
  await page.waitForTimeout(800);
  await page.locator('.lw-row').first().click();
  await voir(page, 'Décisions', { timeout: 8000 });
});

// 6 · Veille — alertes (volet)
await shot('alertes', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page);
  await login(page, 'dupont.owner@demo.lu');
  await sidebar(page, 'Alertes');
  await voir(page, 'bail commercial', { timeout: 8000 });
});

// 7 · Mon compte (clés d'API / prompts / RGPD)
await shot('compte', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page);
  await login(page, 'dupont.owner@demo.lu');
  await sidebar(page, 'Mon compte');
  await voir(page, "Clés d'API", { timeout: 8000 });
});

// 8 · Backoffice admin (tableau de bord)
await shot('admin', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' }); await dismissOnboarding(page);
  await login(page, 'admin@demo.lu');
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await voir(page, 'Tableau de bord', { timeout: 8000 });
});

await browser.close();
console.log('captures →', OUT);
