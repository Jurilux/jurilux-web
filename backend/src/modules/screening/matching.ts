// Moteur de matching sanctions (US-5.4) — logique pure, testée unitairement.
// Normalisation Unicode (NFKD + suppression des diacritiques), translittération
// basique, comparaison Jaro-Winkler sur noms triés par tokens, discriminants
// (année de naissance, nationalité) pour réduire les faux positifs.

export interface MatchParams {
  similarityThreshold: number;
  birthYearTolerance: number;
  nationalityMismatchPenalty: number;
  birthYearMismatchDiscard: boolean;
}

const TRANSLIT: Record<string, string> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l',
};

export function normalizeName(name: string): string {
  let s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[ßæœøđðþł]/g, (c) => TRANSLIT[c] ?? c);
  s = s.replace(/[^a-z0-9\s'-]/g, ' ').replace(/['-]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Trie les tokens pour neutraliser l'ordre nom/prénom ("Ali HASSAN" vs "Hassan Ali"). */
export function tokenSort(normalized: string): string {
  return normalized.split(' ').sort().join(' ');
}

export function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const match1 = new Array<boolean>(len1).fill(false);
  const match2 = new Array<boolean>(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(len2 - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!match2[j] && s1[i] === s2[j]) {
        match1[i] = true;
        match2[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (match1[i]) {
      while (!match2[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }
  return (
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3
  );
}

export function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

export interface SubjectProfile {
  fullName: string;
  birthYear?: number | undefined;
  nationalities?: string[] | undefined;
}

export interface CandidateEntry {
  normalizedNames: string[];
  birthDates: string[]; // ISO ou années
  nationalities: string[];
}

export interface MatchResult {
  matched: boolean;
  similarity: number;
}

function birthYears(dates: string[]): number[] {
  return dates
    .map((d) => Number.parseInt(d.slice(0, 4), 10))
    .filter((y) => Number.isFinite(y) && y > 1900);
}

/** Compare un sujet à une entrée de liste. Similarité = max sur les alias. */
export function matchSubject(
  subject: SubjectProfile,
  entry: CandidateEntry,
  params: MatchParams,
): MatchResult {
  const subjectNorm = tokenSort(normalizeName(subject.fullName));
  let best = 0;
  for (const candidate of entry.normalizedNames) {
    const sim = jaroWinkler(subjectNorm, tokenSort(candidate));
    if (sim > best) best = sim;
  }

  // Discriminant année de naissance : écart au-delà de la tolérance → écarté.
  const entryYears = birthYears(entry.birthDates);
  if (subject.birthYear && entryYears.length > 0) {
    const minGap = Math.min(...entryYears.map((y) => Math.abs(y - subject.birthYear!)));
    if (minGap > params.birthYearTolerance && params.birthYearMismatchDiscard) {
      return { matched: false, similarity: best };
    }
  }

  // Discriminant nationalité : aucune intersection → pénalité (jamais éliminatoire :
  // les listes sont souvent incomplètes sur ce champ).
  if (
    subject.nationalities?.length &&
    entry.nationalities.length > 0 &&
    !subject.nationalities.some((n) => entry.nationalities.includes(n))
  ) {
    best -= params.nationalityMismatchPenalty;
  }

  return { matched: best >= params.similarityThreshold, similarity: Math.max(0, best) };
}
