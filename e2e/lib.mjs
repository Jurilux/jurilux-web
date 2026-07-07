// Bibliothèque du harnais E2E : lancement du navigateur, instrumentation (console/erreurs/
// réseau), métriques de perf, assertions, et actions réutilisables (login, ask, navigation).
// Les parcours (journeys.mjs) importent d'ici pour rester lisibles.
import { mkdirSync } from 'node:fs';

// Résolution portable de Playwright : d'abord le module local/installé (`npm i -D playwright`
// en CI), sinon repli sur l'installation globale du conteneur de dev. Aucun chemin codé en dur
// obligatoire — le binaire Chromium est choisi par Playwright, sauf si PW_CHROME est fourni.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = (await import('/opt/node22/lib/node_modules/playwright/index.js')).default);
}

export const FRONT = process.env.FRONT_URL || 'http://127.0.0.1:5173';
export const OUT = process.env.OUT_DIR || new URL('./artifacts', import.meta.url).pathname;
export const MDP = 'password123';
const ONLY = process.env.ONLY || '';
mkdirSync(OUT, { recursive: true });

export async function launch() {
  const opts = { args: ['--no-sandbox'] };
  if (process.env.PW_CHROME) opts.executablePath = process.env.PW_CHROME;  // conteneur de dev
  return chromium.launch(opts);
}

// ---- instrumentation par page ----
function instrument(page) {
  const bag = { console: [], errors: [], requests: [], slow: [], broken: [] };
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      bag.console.push({ type: m.type(), text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => bag.errors.push(String(e).slice(0, 300)));
  page.on('requestfinished', async (req) => {
    try {
      const resp = await req.response();
      const t = req.timing();
      const dur = t ? Math.round(t.responseEnd - t.startTime) : 0;
      const rec = { url: req.url().replace(FRONT, ''), status: resp?.status(), dur };
      bag.requests.push(rec);
      if (dur > 500) bag.slow.push(rec);
      if (resp && resp.status() >= 400 && !rec.url.includes('/favicon')) bag.broken.push({ url: rec.url, status: resp.status() });
    } catch { /* annulée */ }
  });
  return bag;
}

async function perf(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return { fcp: paint ? Math.round(paint.startTime) : null,
             dcl: Math.round(nav.domContentLoadedEventEnd || 0) };
  });
}

// ---- assertions : chaque parcours DOIT vérifier un résultat, pas juste screenshoter ----
export class Attendu extends Error {}
// Auto-attend l'apparition (waitFor), pas un isVisible() instantané : indispensable pour les
// contenus chargés en asynchrone (onglets, tables, cartes de cabinet, résultats d'analyse).
export async function voir(page, texte, opts = {}) {
  const loc = page.getByText(texte, { exact: false }).first();
  try { await loc.waitFor({ state: 'visible', timeout: opts.timeout || 8000 }); }
  catch { throw new Attendu(`attendu visible : « ${texte} »`); }
}
export async function absent(page, texte) {
  await page.waitForTimeout(400);  // laisse le rendu se stabiliser avant de compter
  const n = await page.getByText(texte, { exact: false }).count();
  if (n > 0) throw new Attendu(`attendu ABSENT mais présent : « ${texte} »`);
}
// Ouvre le tiroir « Mon cabinet » puis sélectionne un cabinet (ses membres/dossiers
// n'apparaissent qu'après clic sur la carte).
export async function ouvrirCabinet(page, nom) {
  await menuItem(page, 'Mon cabinet');
  await page.locator('.drawer').getByText(nom, { exact: false }).first().click();
  await page.waitForTimeout(600);
}

// ---- actions réutilisables ----
export async function dismissOnboarding(page) {
  try { await page.getByText('Passer', { exact: false }).first().click({ timeout: 2500 }); } catch {}
}

export async function ask(page, q) {
  const input = page.locator('textarea').first();
  await input.waitFor({ timeout: 8000 });
  await input.fill(q);
  const send = page.getByRole('button', { name: /Rechercher|Envoyer/ }).first();
  if (await send.isVisible().catch(() => false)) await send.click();
  else await input.press('Enter');
}

export async function login(page, email) {
  await page.getByRole('button', { name: /Se connecter/ }).first().click();
  const form = page.locator('form.auth-form');
  await form.getByPlaceholder('vous@exemple.lu').fill(email);
  await form.getByPlaceholder('8 caractères minimum').first().fill(MDP);
  await form.locator('button[type=submit]').click();
  await page.waitForTimeout(700);
}

// Navigue par le tiroir mobile (☰), toujours disponible quel que soit le viewport.
export async function ouvrirMenu(page) {
  await page.setViewportSize({ width: 420, height: 900 });
  const b = page.getByRole('button', { name: 'Ouvrir le menu' });
  if (await b.isVisible().catch(() => false)) await b.click();
}
export async function menuItem(page, texte) {
  await ouvrirMenu(page);
  await page.locator('.nav-drawer').getByText(texte, { exact: false }).first().click();
  await page.waitForTimeout(700);
}

// Ouvre un SECOND acteur (contexte + page isolés) déjà connecté — pour les parcours
// multi-acteurs (owner + membre, cloison A/B…). L'appelant doit fermer ctx en fin de parcours.
export async function acteur(browser, email) {
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await p.goto(FRONT, { waitUntil: 'networkidle' });
  await dismissOnboarding(p);
  await login(p, email);
  return { ctx, p };
}

// ---- moteur d'un parcours ----
// `intentions` : map name → { intention, attendu }. Chaque parcours porte donc son INTENTION
// (but utilisateur) et son RÉSULTAT ATTENDU ; le runner y ajoute le RÉSULTAT FINAL mesuré.
export function makeRunner(results, intentions = {}) {
  return async function journey(browser, name, fn) {
    if (ONLY && !name.includes(ONLY)) return;
    const meta = intentions[name] || {};
    const ctx = await browser.newContext({
      viewport: { width: 1180, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],  // pour le parcours « Partager » (copie du lien)
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('dialog', (d) => d.accept().catch(() => {}));  // confirm() des actions destructives → OK
    const bag = instrument(page);
    const t0 = Date.now();
    const rec = { name, intention: meta.intention || null, attendu: meta.attendu || null, ok: true, ms: 0 };
    try { await fn(page, bag); await page.waitForTimeout(200); }
    catch (e) { rec.ok = false; rec.error = String(e.message || e).split('\n')[0].slice(0, 220); }
    rec.ms = Date.now() - t0;
    // Résultat final : CONFORME si le parcours a réussi ET qu'aucune page n'a planté.
    rec.final = (rec.ok && bag.errors.length === 0) ? 'CONFORME' : 'NON CONFORME';
    rec.resultat_final = rec.ok ? (meta.attendu || 'ok') : (rec.error || 'échec');
    try { rec.perf = await perf(page); } catch {}
    rec.consoleIssues = bag.console.filter((c) => !c.text.includes('Deprecated API')).length;
    rec.pageErrors = bag.errors.length;
    rec.errorsSample = bag.errors.slice(0, 3);
    rec.broken = bag.broken.slice(0, 6);
    rec.requestCount = bag.requests.length;
    try { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); } catch {}
    results.push(rec);
    const flag = rec.final === 'CONFORME' ? '✓' : '✗';
    console.log(`${flag} ${name} — ${rec.final}`);
    if (meta.intention) console.log(`    intention : ${meta.intention}`);
    if (meta.attendu) console.log(`    attendu   : ${meta.attendu}`);
    console.log(`    final     : ${rec.ok ? meta.attendu || 'ok' : '⚠ ' + rec.error}  (${rec.ms}ms)`);
    await ctx.close();
  };
}
