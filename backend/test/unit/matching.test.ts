import { describe, expect, it } from 'vitest';
import {
  jaroWinkler,
  matchSubject,
  normalizeName,
  tokenSort,
  type MatchParams,
} from '../../src/modules/screening/matching.js';

const params: MatchParams = {
  similarityThreshold: 0.87,
  birthYearTolerance: 2,
  nationalityMismatchPenalty: 0.05,
  birthYearMismatchDiscard: true,
};

describe('normalisation des noms', () => {
  it('supprime diacritiques, casse, ponctuation ; translittère ß/æ/ø', () => {
    expect(normalizeName('Éric  MÜLLER-Weiß')).toBe('eric muller weiss');
    expect(normalizeName("D'Añjou, José")).toBe('d anjou jose');
    expect(normalizeName('Sørensen Æbel')).toBe('sorensen aebel');
  });

  it('tokenSort neutralise l’ordre nom/prénom', () => {
    expect(tokenSort(normalizeName('Ali HASSAN'))).toBe(tokenSort(normalizeName('Hassan ALI')));
  });
});

describe('Jaro-Winkler', () => {
  it('identique → 1 ; disjoint → proche de 0 ; typo → élevé', () => {
    expect(jaroWinkler('martha', 'martha')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.94);
  });
});

describe('matching sujet ↔ entrée de liste (US-5.4)', () => {
  const entry = {
    normalizedNames: [normalizeName('Viktor Petrov'), normalizeName('Petrov Viktor Ivanovich')],
    birthDates: ['1969-04-12'],
    nationalities: ['RU'],
  };

  it('correspondance exacte (ordre inversé, accents) → hit', () => {
    const r = matchSubject({ fullName: 'PETROV Víktor' }, entry, params);
    expect(r.matched).toBe(true);
    expect(r.similarity).toBeGreaterThan(0.95);
  });

  it('discriminant année de naissance : écart > tolérance → écarté', () => {
    const r = matchSubject({ fullName: 'Viktor Petrov', birthYear: 1985 }, entry, params);
    expect(r.matched).toBe(false);
  });

  it('année de naissance dans la tolérance → conservé', () => {
    const r = matchSubject({ fullName: 'Viktor Petrov', birthYear: 1970 }, entry, params);
    expect(r.matched).toBe(true);
  });

  it('nationalité sans intersection → pénalité, jamais éliminatoire seule', () => {
    const near = matchSubject(
      { fullName: 'Viktor Petrov', nationalities: ['FR'] },
      entry,
      params,
    );
    const exact = matchSubject({ fullName: 'Viktor Petrov' }, entry, params);
    expect(near.similarity).toBeLessThan(exact.similarity);
    expect(near.matched).toBe(true); // 1.0 - 0.05 reste au-dessus du seuil
  });

  it('nom éloigné → pas de hit', () => {
    const r = matchSubject({ fullName: 'Jean Muller' }, entry, params);
    expect(r.matched).toBe(false);
  });
});
