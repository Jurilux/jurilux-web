// Carte thématique de la réponse — au lieu d'un long texte façon ChatGPT, la PREMIÈRE
// réponse est présentée comme une constellation : un noyau « L'essentiel » entouré de
// bulles thématiques (une par section de la réponse). Cliquer une bulle déplie le détail
// sourcé de ce thème. Une bascule Carte / Texte reste disponible (le texte intégral
// n'est jamais perdu — la carte est un ré-agencement du même markdown).
import { useMemo, useState } from 'react';
import type { Citation } from './api';
import { renderAnswer } from './App';

export interface Theme { title: string; body: string; }
export interface ThemedAnswer { intro: string; themes: Theme[]; }

// Découpe le markdown de la réponse en thèmes : d'abord par titres (## / ###), sinon par
// paragraphes/puces à amorce en gras (« **Conditions** : … »). Moins de 2 thèmes → null
// (l'appelant garde la vue texte classique).
export function parseThemes(md: string): ThemedAnswer | null {
  const lines = (md || '').split('\n');
  const themes: Theme[] = [];
  let intro: string[] = [];
  let cur: Theme | null = null;

  for (const raw of lines) {
    // Titre de section : « ## X » / « ### X », ou une ligne composée UNIQUEMENT de « **X** »
    // (style fréquent des LLM), avec deux-points final optionnel.
    const h = raw.match(/^#{2,3}\s+(.+)/) || raw.match(/^\*\*([^*]{3,80})\*\*\s*:?\s*$/);
    if (h) {
      if (cur) themes.push(cur);
      cur = { title: h[1].replace(/\*\*/g, '').replace(/\s*:\s*$/, '').trim(), body: '' };
    } else if (cur) cur.body += raw + '\n';
    else intro.push(raw);
  }
  if (cur) themes.push(cur);

  if (themes.length < 2) {
    // Repli : amorces en gras (paragraphe ou puce « **Titre** : suite »).
    const alt: Theme[] = [];
    let intro2: string[] = [];
    let cur2: Theme | null = null;
    for (const raw of lines) {
      const m = raw.match(/^(?:[-*]\s+)?\*\*([^*]{3,60})\*\*\s*[:—–-]?\s*(.*)$/);
      if (m) {
        if (cur2) alt.push(cur2);
        cur2 = { title: m[1].trim(), body: (m[2] || '') + '\n' };
      } else if (cur2) cur2.body += raw + '\n';
      else intro2.push(raw);
    }
    if (cur2) alt.push(cur2);
    if (alt.length < 2) return null;
    return { intro: intro2.join('\n').trim(), themes: alt.slice(0, 8) };
  }
  return { intro: intro.join('\n').trim(), themes: themes.slice(0, 8) };
}

// Palette des bulles (accessible clair/sombre, déclinée par thème). Exportée : l'export PDF
// réutilise le MÊME code couleur pour que le document imprimé corresponde à la carte.
export const HUES = [212, 158, 268, 24, 340, 190, 96, 48];

function firstSentence(s: string, max = 170): string {
  const flat = s.replace(/[#*_]/g, '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.slice(0, max);
  const dot = cut.lastIndexOf('. ');
  return dot > 60 ? cut.slice(0, dot + 1) : cut + (flat.length > max ? '…' : '');
}

export function ThemeMap({ answer, citations }: { answer: ThemedAnswer; citations: Citation[] }) {
  const [open, setOpen] = useState(0);
  const { intro, themes } = answer;
  const n = themes.length;

  // Positions sur une ellipse (le 1er thème en haut, sens horaire).
  const pos = useMemo(() => themes.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: 50 + 37 * Math.cos(a), y: 50 + 36 * Math.sin(a) };
  }), [n]);

  const refCount = (body: string) =>
    citations.filter((c) => c.doc_id && body.includes(c.doc_id)).length;

  return (
    <div className="tmap">
      <div className="tmap-stage" role="list" aria-label="Thèmes de la réponse">
        <svg className="tmap-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {pos.map((p, i) => (
            <line key={i} x1="50" y1="50" x2={p.x} y2={p.y}
              className={'tmap-link' + (open === i ? ' on' : '')} />
          ))}
        </svg>
        <div className="tmap-core">
          <span className="tmap-core-tag">L'essentiel</span>
          <p>{firstSentence(intro) || firstSentence(themes[0].body)}</p>
        </div>
        {themes.map((t, i) => {
          const nref = refCount(t.body);
          return (
            <button key={i} role="listitem"
              className={'tmap-node' + (open === i ? ' on' : '')}
              style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%`, ['--hue' as string]: HUES[i % HUES.length] }}
              onClick={() => setOpen(i)}>
              <span className="tmap-node-title">{t.title}</span>
              {nref > 0 && <span className="tmap-node-refs" title={`${nref} source${nref > 1 ? 's' : ''}`}>{nref} src</span>}
            </button>
          );
        })}
      </div>

      <div className="tmap-detail" style={{ ['--hue' as string]: HUES[open % HUES.length] }}>
        <h3 className="tmap-detail-title">{themes[open].title}</h3>
        <div className="answer" dangerouslySetInnerHTML={{ __html: renderAnswer(themes[open].body, citations) }} />
        {n > 1 && (
          <div className="tmap-nav">
            <button className="ghost" onClick={() => setOpen((open + n - 1) % n)}>← {themes[(open + n - 1) % n].title}</button>
            <button className="ghost" onClick={() => setOpen((open + 1) % n)}>{themes[(open + 1) % n].title} →</button>
          </div>
        )}
      </div>
    </div>
  );
}
