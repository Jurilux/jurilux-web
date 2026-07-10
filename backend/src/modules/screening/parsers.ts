import { XMLParser } from 'fast-xml-parser';
import { normalizeName } from './matching.js';

// Parsers des listes consolidées officielles (US-5.4) :
//  - UE : liste consolidée des sanctions financières (XML « export »)
//  - ONU : liste consolidée du Conseil de sécurité (XML « CONSOLIDATED_LIST »)
// Les formats réels sont plus riches ; on extrait le nécessaire au matching :
// noms + alias, dates de naissance, nationalités, identifiant stable.

export interface ParsedEntry {
  externalId: string;
  kind: 'person' | 'entity';
  names: string[];
  birthDates: string[];
  nationalities: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['sanctionEntity', 'nameAlias', 'birthdate', 'citizenship', 'INDIVIDUAL', 'ENTITY',
     'INDIVIDUAL_ALIAS', 'ENTITY_ALIAS', 'INDIVIDUAL_DATE_OF_BIRTH', 'NATIONALITY'].includes(name),
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function clean(names: (string | undefined)[]): string[] {
  return [...new Set(names.filter((n): n is string => !!n && n.trim() !== '').map((n) => n.trim()))];
}

/** Liste consolidée UE (format sanctionsMap XML simplifié). */
export function parseEuList(xml: string): ParsedEntry[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc.export ?? doc.EXPORT) as Record<string, unknown> | undefined;
  if (!root) throw new Error('format UE inattendu : élément <export> absent');
  const entities = asArray(root.sanctionEntity as unknown);
  return entities.map((raw) => {
    const e = raw as Record<string, never>;
    const aliases = asArray<Record<string, string>>(e['nameAlias']);
    const subjectType = (e['subjectType'] ?? {}) as Record<string, string>;
    const kind =
      (subjectType['@_code'] ?? '').toLowerCase() === 'person' ? 'person' : 'entity';
    return {
      externalId: `EU-${(e as Record<string, string>)['@_logicalId'] ?? crypto.randomUUID()}`,
      kind,
      names: clean(aliases.map((a) => a['@_wholeName'])),
      birthDates: asArray<Record<string, string>>(e['birthdate'])
        .map((b) => b['@_birthdate'] ?? b['@_year'])
        .filter((d): d is string => !!d),
      nationalities: asArray<Record<string, string>>(e['citizenship'])
        .map((c) => c['@_countryIso2Code'])
        .filter((c): c is string => !!c),
    } satisfies ParsedEntry;
  });
}

/** Liste consolidée ONU (CONSOLIDATED_LIST). */
export function parseUnList(xml: string): ParsedEntry[] {
  const doc = parser.parse(xml) as Record<string, never>;
  const root = doc['CONSOLIDATED_LIST'] as Record<string, never> | undefined;
  if (!root) throw new Error('format ONU inattendu : élément <CONSOLIDATED_LIST> absent');
  const out: ParsedEntry[] = [];

  const individuals = asArray<Record<string, never>>(
    (root['INDIVIDUALS'] as Record<string, never> | undefined)?.['INDIVIDUAL'],
  );
  for (const ind of individuals) {
    const nameParts = clean([
      [ind['FIRST_NAME'], ind['SECOND_NAME'], ind['THIRD_NAME'], ind['FOURTH_NAME']]
        .filter((p) => typeof p === 'string')
        .join(' '),
    ]);
    const aliases = asArray<Record<string, string>>(ind['INDIVIDUAL_ALIAS'])
      .map((a) => a['ALIAS_NAME'])
      .filter((n): n is string => !!n);
    out.push({
      externalId: `UN-${String(ind['DATAID'])}`,
      kind: 'person',
      names: clean([...nameParts, ...aliases]),
      birthDates: asArray<Record<string, string>>(ind['INDIVIDUAL_DATE_OF_BIRTH'])
        .map((b) => b['DATE'] ?? b['YEAR'])
        .filter((d): d is string => !!d)
        .map(String),
      nationalities: asArray<Record<string, never>>(ind['NATIONALITY'])
        .flatMap((n) => asArray<string>(n['VALUE'] as never))
        .map(String),
    });
  }

  const entities = asArray<Record<string, never>>(
    (root['ENTITIES'] as Record<string, never> | undefined)?.['ENTITY'],
  );
  for (const ent of entities) {
    const aliases = asArray<Record<string, string>>(ent['ENTITY_ALIAS'])
      .map((a) => a['ALIAS_NAME'])
      .filter((n): n is string => !!n);
    out.push({
      externalId: `UN-${String(ent['DATAID'])}`,
      kind: 'entity',
      names: clean([ent['FIRST_NAME'] as never, ...aliases]),
      birthDates: [],
      nationalities: [],
    });
  }
  return out;
}

export function withNormalizedNames(entries: ParsedEntry[]) {
  return entries.map((e) => ({ ...e, normalizedNames: e.names.map(normalizeName) }));
}
