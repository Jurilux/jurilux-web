// Libellés lisibles pour les clés de juridiction du corpus.
const LABELS: Record<string, string> = {
  cassation: 'Cour de Cassation',
  csj: 'Cour Supérieure de Justice',
  csj_ch01: 'CSJ — 1re chambre',
  csj_ch02: 'CSJ — 2e chambre',
  csj_ch03: 'CSJ — 3e chambre',
  csj_ch04: 'CSJ — 4e chambre',
  csj_ch05: 'CSJ — 5e chambre',
  csj_ch06: 'CSJ — 6e chambre',
  csj_ch07: 'CSJ — 7e chambre',
  csj_ch08: 'CSJ — 8e chambre',
  csj_ch09: 'CSJ — 9e chambre',
  csj_ch10: 'CSJ — 10e chambre',
  csj_conseil: 'CSJ — Chambre du Conseil',
};

export function juridictionLabel(key?: string | null): string {
  if (!key) return 'Jurisprudence';
  return LABELS[key.toLowerCase()] || key.replace(/_/g, ' ').toUpperCase();
}

// "eli-etat-leg-loi-2018-07-28-a630-consolide-20250101-fr-pdf.pdf" → "Loi du 28/07/2018 (consolidée au 01/01/2025)"
export function lawTitle(raw?: string | null): string {
  if (!raw) return 'Texte de loi';
  const m = raw.match(/eli-etat-leg-(loi|rgd|amin|rmin)-(\d{4})-(\d{2})-(\d{2}).*?(?:consolide-(\d{4})(\d{2})(\d{2}))?/i);
  if (!m) return raw.replace(/\.pdf$/i, '');
  const types: Record<string, string> = { loi: 'Loi', rgd: 'Règlement grand-ducal', amin: 'Arrêté ministériel', rmin: 'Règlement ministériel' };
  const type = types[m[1].toLowerCase()] || 'Texte';
  let out = `${type} du ${m[4]}/${m[3]}/${m[2]}`;
  if (m[5]) out += ` (consolidé au ${m[7]}/${m[6]}/${m[5]})`;
  return out;
}
