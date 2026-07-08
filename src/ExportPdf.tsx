// Export PDF de la réponse — reprend le CODE COULEUR de la carte thématique (mêmes teintes
// par thème) dans un document d'impression propre : question, « L'essentiel », une section
// colorée par thème, sources numérotées, avertissement. Zéro dépendance : on ouvre une
// fenêtre print-ready et le navigateur génère le PDF (Imprimer → Enregistrer en PDF).
import { pdfHref, type Citation } from './api';
import { renderAnswer } from './App';
import { HUES, type ThemedAnswer } from './ThemeMap';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PRINT_CSS = `
  * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { margin: 0; padding: 34px 40px; color: #1c1b18; background: #fff;
         font: 13.5px/1.55 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .head { display: flex; justify-content: space-between; align-items: baseline;
          border-bottom: 2px solid #17365c; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { font-size: 17px; font-weight: 700; color: #17365c; }
  .date { color: #6e6b64; font-size: 11.5px; }
  .question { font-size: 16px; font-weight: 650; margin: 0 0 14px; }
  .essential { background: #17365c; color: #f3f2ec; border-radius: 10px; padding: 12px 16px; margin-bottom: 18px; }
  .essential .tag { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; opacity: .75; display: block; margin-bottom: 4px; }
  .theme { border: 1px solid #e2ded4; border-left: 4px solid var(--th); border-radius: 8px;
           padding: 12px 16px; margin-bottom: 12px; break-inside: avoid; }
  .theme h2 { margin: 0 0 6px; font-size: 14px; color: var(--th); }
  .theme h2 .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--th); margin-right: 7px; }
  .answer p { margin: 6px 0; } .answer ul, .answer ol { margin: 6px 0; padding-left: 20px; }
  .answer h2, .answer h3 { font-size: 13px; margin: 8px 0 4px; }
  sup.refnum { color: #17365c; font-weight: 700; }
  .sources { margin-top: 18px; border-top: 1px solid #e2ded4; padding-top: 10px; }
  .sources h2 { font-size: 13px; margin: 0 0 6px; }
  .sources ol { margin: 0; padding-left: 20px; font-size: 12px; }
  .sources a { color: #17365c; }
  .src-ref { color: #9c988f; font-size: 10.5px; font-family: ui-monospace, monospace; }
  .foot { margin-top: 22px; color: #6e6b64; font-size: 10.5px; border-top: 1px dashed #e2ded4; padding-top: 8px; }
  .printbar { position: fixed; top: 10px; right: 10px; }
  .printbar button { background: #17365c; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  @media print { .printbar { display: none; } body { padding: 0; } }
`;

export interface PdfExportInput {
  question: string;
  content: string;
  citations: Citation[];
  themed: ThemedAnswer | null;
}

export function openPdfExport({ question, content, citations, themed }: PdfExportInput): void {
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const parts: string[] = [];
  parts.push(`<div class="head"><span class="brand">⚖ Jurilux</span><span class="date">${esc(date)}</span></div>`);
  if (question) parts.push(`<p class="question">${esc(question)}</p>`);

  if (themed) {
    if (themed.intro.trim()) {
      parts.push(`<div class="essential"><span class="tag">L'essentiel</span><div class="answer">${renderAnswer(themed.intro, citations)}</div></div>`);
    }
    themed.themes.forEach((t, i) => {
      const hue = HUES[i % HUES.length];
      parts.push(
        `<section class="theme" style="--th: hsl(${hue} 45% 32%)">` +
        `<h2><span class="dot"></span>${esc(t.title)}</h2>` +
        `<div class="answer">${renderAnswer(t.body, citations)}</div></section>`);
    });
  } else {
    parts.push(`<div class="answer">${renderAnswer(content, citations)}</div>`);
  }

  if (citations.length > 0) {
    const items = citations.map((c) => {
      const label = esc(c.title || c.doc_id || 'Document');
      const raw = pdfHref(c) || c.url || '';
      const href = raw && !raw.startsWith('http') ? window.location.origin + raw : raw;
      // Le TITRE est le lien (cliquable dans le PDF) — jamais d'URL brute étalée.
      const ref = c.doc_id && c.title ? ` <span class="src-ref">réf. ${esc(c.doc_id)}</span>` : '';
      return `<li>${href ? `<a href="${esc(href)}">${label}</a>` : label}${ref}</li>`;
    }).join('');
    parts.push(`<div class="sources"><h2>Sources · ${citations.length} document${citations.length > 1 ? 's' : ''}</h2><ol>${items}</ol></div>`);
  }
  parts.push(`<p class="foot">Généré par Jurilux (jurilux.lu) — les réponses ne constituent pas un avis juridique.</p>`);
  parts.push(`<div class="printbar"><button onclick="window.print()">🖨 Imprimer / Enregistrer en PDF</button></div>`);

  // NB : pas de 'noopener' ici — il rendrait le handle null (spec) et on écrit NOTRE document.
  const w = window.open('', '_blank');
  if (!w) return;   // popup bloquée par le navigateur
  w.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Jurilux — réponse</title>` +
    `<style>${PRINT_CSS}</style></head><body>${parts.join('')}` +
    `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},350)})</script>` +
    `</body></html>`);
  w.document.close();
}
