// Libellés lisibles pour les clés de juridiction du corpus.
const LABELS: Record<string, string> = {
  cassation: 'Cour de cassation',
  csj: 'Cour supérieure de justice',
  csj_ch01: 'CSJ — 1re chambre', csj_ch02: 'CSJ — 2e chambre', csj_ch03: 'CSJ — 3e chambre',
  csj_ch04: 'CSJ — 4e chambre', csj_ch05: 'CSJ — 5e chambre', csj_ch06: 'CSJ — 6e chambre',
  csj_ch07: 'CSJ — 7e chambre', csj_ch08: 'CSJ — 8e chambre', csj_ch09: 'CSJ — 9e chambre',
  csj_ch10: 'CSJ — 10e chambre', csj_conseil: 'CSJ — Chambre du conseil',
};

export function juridictionLabel(key?: string | null): string {
  if (!key) return 'Jurisprudence';
  return LABELS[key.toLowerCase()] || key.replace(/_/g, ' ').toUpperCase();
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Date complète FR à partir d'un préfixe AAAAMMJJ fiable ("21 novembre 2024"). Sinon null.
export function jurisDate(docId?: string | null): string | null {
  if (!docId) return null;
  const m = docId.match(/(?:^|[^0-9])((?:19|20)\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const mi = parseInt(mo, 10) - 1;
  if (mi < 0 || mi > 11 || +d < 1 || +d > 31) return null;
  return `${parseInt(d, 10)} ${MOIS[mi]} ${y}`;
}

// Juridiction déduite du doc_id (best-effort). Repli : "Décision de justice".
export function jurisCourt(docId?: string | null, key?: string | null): string {
  if (key) return juridictionLabel(key);
  const s = (docId || '');
  if (/(^|[_-])cass?([_-]|\d|$)/i.test(s) || /cassation/i.test(s)) return 'Cour de cassation';
  const cach = s.match(/cach0?(\d{1,2})/i);
  if (cach) return `Cour d'appel — ${parseInt(cach[1], 10)}e chambre`;
  if (/talux|(^|[_-])tal\d?/i.test(s)) return "Tribunal d'arrondissement de Luxembourg";
  if (/tadi|(^|[_-])tad\d?/i.test(s)) return "Tribunal d'arrondissement de Diekirch";
  if (/(^|[_-])cal[_-]/i.test(s)) return "Cour d'appel";
  const ch = s.match(/(?:^|_)ch0?(\d{1,2})(?:_|$)/i);
  if (ch) return `Cour supérieure — ${parseInt(ch[1], 10)}e chambre`;
  if (/(^|[_-])jp/i.test(s)) return 'Justice de paix';
  return 'Décision de justice';
}

// Référence nettoyée du doc_id (numéro d'affaire), ex. "CAS-2023-00116".
export function jurisRef(docId?: string | null): string | null {
  if (!docId) return null;
  let r = docId
    .replace(/^((?:19|20)?\d{6,8})[_-]/, '')                 // date en tête
    .replace(/[_-]?(accessible|pseudonymis\w*|anonymis\w*)$/gi, '')
    .replace(/\.docx?$/i, '')
    .replace(/_\d{1,4}[a-z]?$/i, '')                          // index de chunk/page en queue
    .replace(/[_]+/g, ' ')
    .trim();
  return r && r.length <= 40 ? r : null;
}

const CODE_NAMES: Record<string, string> = {
  travail: 'Code du travail', civil: 'Code civil', penal: 'Code pénal',
  commerce: 'Code de commerce', consommation: 'Code de la consommation',
  route: 'Code de la route', environnement: "Code de l'environnement",
  procedure_civile: 'Nouveau Code de procédure civile', procedure_penale: 'Code de procédure pénale',
  securite_sociale: 'Code de la sécurité sociale', fonction_publique: 'Code de la fonction publique',
};

// ELI -> libellé lisible d'un texte de loi (lois, RGD, arrêtés ET codes).
export function lawTitle(raw?: string | null): string {
  if (!raw) return 'Texte de loi';
  const code = raw.match(/eli-etat-leg-code-([a-z_]+)-(\d{4})(\d{2})(\d{2})/i);
  if (code) {
    const name = CODE_NAMES[code[1].toLowerCase()] || `Code ${code[1].replace(/_/g, ' ')}`;
    return `${name} (version du ${code[4]}/${code[3]}/${code[2]})`;
  }
  const m = raw.match(/eli-etat-leg-(loi|rgd|amin|rmin)-(\d{4})-(\d{2})-(\d{2}).*?(?:consolide-(\d{4})(\d{2})(\d{2}))?/i);
  if (!m) return raw.replace(/\.pdf$/i, '');
  const types: Record<string, string> = { loi: 'Loi', rgd: 'Règlement grand-ducal', amin: 'Arrêté ministériel', rmin: 'Règlement ministériel' };
  let out = `${types[m[1].toLowerCase()] || 'Texte'} du ${m[4]}/${m[3]}/${m[2]}`;
  if (m[5]) out += ` (consolidé au ${m[7]}/${m[6]}/${m[5]})`;
  return out;
}
