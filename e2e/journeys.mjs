// Harnais E2E Chromium : pilote TOUS les parcours utilisateurs contre l'app réelle
// (front Vite + backend `functional.e2e_server` stubé). Pour chaque parcours : capture
// une screenshot, le temps de rendu, les erreurs console/page, et un résumé réseau.
//
// Prérequis : backend démo sur :8088 + `vite` sur :5173 (cf. e2e/README.md).
// Lancement :  node e2e/journeys.mjs   (variables : FRONT_URL, OUT_DIR, HEADFUL=1, ONLY=nom)
//
// Sortie : e2e/artifacts/<parcours>.png + e2e/artifacts/rapport.json (agrégat exploitable).
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = pw;

const FRONT = process.env.FRONT_URL || 'http://127.0.0.1:5173';
const OUT = process.env.OUT_DIR || new URL('./artifacts', import.meta.url).pathname;
const ONLY = process.env.ONLY || '';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const MDP = 'password123';
const results = [];

// ---- capteurs par page : console, erreurs, réseau ----
function instrument(page) {
  const bag = { console: [], errors: [], requests: [], slow: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      bag.console.push({ type: msg.type(), text: msg.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => bag.errors.push(String(e).slice(0, 300)));
  bag.broken = [];
  page.on('requestfinished', async (req) => {
    try {
      const resp = await req.response();
      const t = req.timing();
      const dur = t ? Math.round(t.responseEnd - t.startTime) : 0;
      const rec = { url: req.url().replace(FRONT, ''), method: req.method(), status: resp?.status(), dur };
      bag.requests.push(rec);
      if (dur > 400) bag.slow.push(rec);
      if (resp && resp.status() >= 400) bag.broken.push({ url: rec.url, status: resp.status() });
    } catch { /* requête annulée */ }
  });
  return bag;
}

// ---- métriques de perf lues dans la page (navigation + ressources + LCP) ----
async function perf(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource');
    const js = res.filter((r) => r.name.endsWith('.js'));
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0);
    const lcp = performance.getEntriesByType('largest-contentful-paint').pop();
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      fcp: paint ? Math.round(paint.startTime) : null,
      lcp: lcp ? Math.round(lcp.startTime) : null,
      requests: res.length,
      jsRequests: js.length,
      transferKB: Math.round(bytes / 1024),
    };
  });
}

async function dismissOnboarding(page) {
  try { await page.getByText('Passer', { exact: false }).first().click({ timeout: 2500 }); } catch {}
}

async function askQuestion(page, q) {
  const input = page.locator('textarea, input[type=text]')
    .filter({ hasNot: page.locator('[type=checkbox]') }).first();
  await input.waitFor({ timeout: 8000 });
  await input.fill(q);
  // bouton Envoyer si présent, sinon Entrée
  const send = page.getByRole('button', { name: 'Envoyer' }).first();
  if (await send.isVisible().catch(() => false)) await send.click();
  else await input.press('Enter');
}

async function login(page, email) {
  await page.getByRole('button', { name: /Se connecter/ }).first().click();
  const form = page.locator('form.auth-form');
  await form.getByPlaceholder('vous@exemple.lu').fill(email);
  await form.getByPlaceholder('8 caractères minimum').first().fill(MDP);
  await form.locator('button[type=submit]').click();  // scopé au formulaire (évite l'ambiguïté)
  await page.waitForTimeout(700);
}

async function openMenu(page) {
  const b = page.getByRole('button', { name: 'Ouvrir le menu' });
  if (await b.isVisible().catch(() => false)) await b.click();
}

// ---- moteur d'un parcours : instrumente, chronomètre, capture, tolère l'échec ----
async function journey(browser, name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1120, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);  // borne dure : un sélecteur absent échoue vite (pas de hang 30s)
  const bag = instrument(page);
  const t0 = Date.now();
  const rec = { name, ok: true, ms: 0 };
  try {
    await fn(page, bag);
    await page.waitForTimeout(250);
  } catch (e) {
    rec.ok = false;
    rec.error = String(e).split('\n')[0].slice(0, 200);
  }
  rec.ms = Date.now() - t0;
  try { rec.perf = await perf(page); } catch {}
  rec.consoleIssues = bag.console.length;
  rec.pageErrors = bag.errors.length;
  rec.errorsSample = bag.errors.slice(0, 3);
  rec.consoleSample = bag.console.slice(0, 4);
  rec.slowRequests = bag.slow.slice(0, 6);
  rec.brokenResources = bag.broken || [];
  rec.requestCount = bag.requests.length;
  try { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); } catch {}
  results.push(rec);
  console.log(`${rec.ok ? '✓' : '✗'} ${name} (${rec.ms}ms, ${rec.requestCount} req, ${rec.consoleIssues} console, ${rec.pageErrors} err)`);
  await ctx.close();
}

// ============================ PARCOURS ============================
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// 1. Accueil anonyme (perf de première charge)
await journey(browser, '01-accueil', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
});

// 2. Question → parcours guidé (follow_ups) + autre angle
await journey(browser, '02-question-parcours-guide', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await askQuestion(page, 'Dans quels cas un licenciement avec effet immédiat est-il justifié ?');
  await page.getByText('parcours guidé', { exact: false }).first().waitFor({ timeout: 15000 });
});

// 3. Clic sur une question de suivi → nouvelle réponse
await journey(browser, '03-clic-suivi', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await askQuestion(page, 'Licenciement avec effet immédiat ?');
  await page.locator('.followup-btn').first().waitFor({ timeout: 15000 });
  await page.locator('.followup-btn').first().click();
  await page.waitForTimeout(1500);
});

// 4. Mode pédagogique
await journey(browser, '04-pedagogique', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  const cb = page.locator('input[type=checkbox]').first();
  if (await cb.isVisible().catch(() => false)) await cb.check().catch(() => {});
  await askQuestion(page, 'Explique la faute grave en droit du travail');
  await page.waitForTimeout(1500);
});

// 5. Feedback 👍
await journey(browser, '05-feedback', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await askQuestion(page, 'Préavis de licenciement ?');
  await page.getByText('parcours guidé', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByText('👍', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(600);
});

// 6. Partage → permalien public
await journey(browser, '06-partage', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await askQuestion(page, 'Congé parental conditions ?');
  await page.getByText('parcours guidé', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Partager/ }).first().click().catch(() => {});
  await page.waitForTimeout(1000);
});

// 7. Insight avocats + analytics
await journey(browser, '07-insight', async (page) => {
  await page.goto(`${FRONT}/insight`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
});

// 8. Inscription (nouveau compte)
await journey(browser, '08-inscription', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await page.getByRole('button', { name: /Se connecter/ }).first().click();
  const form = page.locator('form.auth-form');
  // basculer en mode inscription (lien hors formulaire)
  await page.locator('.modal').getByText("S'inscrire", { exact: false }).first().click().catch(() => {});
  await form.getByPlaceholder('vous@exemple.lu').fill(`e2e_${Date.now()}@demo.lu`);
  await form.getByPlaceholder('8 caractères minimum').first().fill(MDP);
  await form.locator('button[type=submit]').click().catch(() => {});
  await page.waitForTimeout(900);
});

// 9. Connexion (pro) + historique + compte
await journey(browser, '09-connexion-compte', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await login(page, 'etudiant@demo.lu');
  await openMenu(page);
  await page.getByText('Historique', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(900);
});

// 10. Vault (pro) — documents privés
await journey(browser, '10-vault', async (page) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await login(page, 'pro@demo.lu');
  await page.goto(`${FRONT}/vault`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
});

// 11. Rédaction assistée (pro) — viewport mobile : Rédiger n'est QUE dans le tiroir ☰
//     (constat produit : entrée absente de la barre latérale desktop, cf. rapport).
await journey(browser, '11-rediger', async (page) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await login(page, 'pro@demo.lu');
  await openMenu(page);
  await page.getByText('Rédiger', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(900);
});

// 12. Mon compte (clés d'API / prompts / données) — idem, tiroir ☰ mobile uniquement
await journey(browser, '12-mon-compte', async (page) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await login(page, 'pro@demo.lu');
  await openMenu(page);
  await page.getByText('Mon compte', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(900);
});

// 13. Backoffice admin — balayage des onglets
await journey(browser, '13-admin', async (page, bag) => {
  await page.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(page);
  await login(page, 'admin@demo.lu');
  await page.goto(`${FRONT}/admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const onglets = ['Tableau de bord', 'Inspecteur', 'Banc de test', 'Utilisateurs', 'Questions',
                   'Retours', 'Corpus', 'Santé', 'Paramétrage', 'Audit', 'Documentation'];
  for (const o of onglets) {
    const tab = page.getByRole('button', { name: new RegExp(o, 'i') }).first();
    if (await tab.isVisible().catch(() => false)) { await tab.click().catch(() => {}); await page.waitForTimeout(500); }
  }
});

// 14. Permalien partagé (vue publique /r/<id>)
await journey(browser, '14-permalien', async (page) => {
  const shareId = process.env.SHARE_ID;
  const url = shareId ? `${FRONT}/r/${shareId}` : FRONT;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
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
  brokenResources: [...new Set(results.flatMap((r) => (r.brokenResources || []).map((b) => `${b.status} ${b.url}`)))],
  journeys: results,
};
writeFileSync(`${OUT}/rapport.json`, JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.ok}/${summary.total} parcours OK · console:${summary.withConsoleIssues.length} · erreurs:${summary.withPageErrors.length} ===`);
console.log(`rapport → ${OUT}/rapport.json`);
