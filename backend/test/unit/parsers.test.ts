import { describe, expect, it } from 'vitest';
import { parseEuList, parseUnList, withNormalizedNames } from '../../src/modules/screening/parsers.js';

// Fixtures synthétiques reprenant la structure des exports officiels.

const EU_XML = `<?xml version="1.0" encoding="UTF-8"?>
<export generationDate="2026-07-10">
  <sanctionEntity logicalId="13">
    <subjectType code="person"/>
    <nameAlias wholeName="Viktor PETROV"/>
    <nameAlias wholeName="Petrov Viktor Ivanovich"/>
    <birthdate birthdate="1969-04-12"/>
    <citizenship countryIso2Code="RU"/>
  </sanctionEntity>
  <sanctionEntity logicalId="14">
    <subjectType code="enterprise"/>
    <nameAlias wholeName="OOO Fictive Trading"/>
  </sanctionEntity>
</export>`;

const UN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>6908555</DATAID>
      <FIRST_NAME>Abdul</FIRST_NAME>
      <SECOND_NAME>Rahman</SECOND_NAME>
      <INDIVIDUAL_ALIAS><ALIAS_NAME>Abdel Rahmane</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_DATE_OF_BIRTH><DATE>1971-01-01</DATE></INDIVIDUAL_DATE_OF_BIRTH>
      <NATIONALITY><VALUE>AF</VALUE></NATIONALITY>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>110001</DATAID>
      <FIRST_NAME>Fictive Network Org</FIRST_NAME>
      <ENTITY_ALIAS><ALIAS_NAME>FNO</ALIAS_NAME></ENTITY_ALIAS>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`;

describe('parser liste UE', () => {
  it('extrait personnes et entités, alias, naissance, nationalité', () => {
    const entries = parseEuList(EU_XML);
    expect(entries).toHaveLength(2);
    const person = entries[0]!;
    expect(person.externalId).toBe('EU-13');
    expect(person.kind).toBe('person');
    expect(person.names).toContain('Viktor PETROV');
    expect(person.names).toContain('Petrov Viktor Ivanovich');
    expect(person.birthDates).toEqual(['1969-04-12']);
    expect(person.nationalities).toEqual(['RU']);
    expect(entries[1]!.kind).toBe('entity');
  });
});

describe('parser liste ONU', () => {
  it('extrait individus (noms composés + alias) et entités', () => {
    const entries = parseUnList(UN_XML);
    expect(entries).toHaveLength(2);
    const person = entries[0]!;
    expect(person.externalId).toBe('UN-6908555');
    expect(person.names).toContain('Abdul Rahman');
    expect(person.names).toContain('Abdel Rahmane');
    expect(person.birthDates).toEqual(['1971-01-01']);
    expect(person.nationalities).toEqual(['AF']);
    expect(entries[1]!.kind).toBe('entity');
    expect(entries[1]!.names).toContain('FNO');
  });
});

describe('normalisation en aval du parsing', () => {
  it('produit les formes normalisées pour le matching', () => {
    const [entry] = withNormalizedNames(parseEuList(EU_XML));
    expect(entry!.normalizedNames).toContain('viktor petrov');
  });
});
