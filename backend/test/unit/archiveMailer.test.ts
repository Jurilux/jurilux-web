import { describe, expect, it } from 'vitest';
import { decryptArchive, encryptedArchive, tarball, untar } from '../../src/archive.js';
import { NoopMailer, weeklyDigestBody } from '../../src/mailer.js';

describe('archive chiffrée (US-9.2)', () => {
  const files = [
    { name: 'export.json', data: Buffer.from('{"ok":true}') },
    { name: 'documents/abc/piece.pdf', data: Buffer.from('%PDF-1.7 contenu') },
  ];

  it('tar : aller-retour fidèle', () => {
    const extracted = untar(tarball(files));
    expect(extracted.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(extracted[1]!.data.equals(files[1]!.data)).toBe(true);
  });

  it('chiffrement : bonne phrase de passe → contenu restitué ; mauvaise → échec', () => {
    const archive = encryptedArchive(files, 'phrase-de-passe-solide');
    expect(archive.subarray(0, 7).toString()).toBe('LEXKYC1');
    // Le contenu en clair n'apparaît nulle part.
    expect(archive.includes(Buffer.from('%PDF'))).toBe(false);

    const tar = decryptArchive(archive, 'phrase-de-passe-solide');
    const extracted = untar(tar);
    expect(extracted[0]!.data.toString()).toBe('{"ok":true}');

    expect(() => decryptArchive(archive, 'mauvaise-phrase-!!')).toThrow();
  });

  it('altération de l’archive détectée (GCM)', () => {
    const archive = encryptedArchive(files, 'phrase-de-passe-solide');
    archive.writeUInt8(archive.readUInt8(archive.length - 5) ^ 0xff, archive.length - 5);
    expect(() => decryptArchive(archive, 'phrase-de-passe-solide')).toThrow();
  });
});

describe('digest hebdomadaire (US-6.2)', () => {
  it('comptages uniquement — aucune donnée nominative requise', () => {
    const body = weeklyDigestBody({
      entityName: 'Me Test',
      openAlerts: 2,
      frozenMatters: 1,
      reviewsDue: 3,
      expiringDocuments: 4,
      purgeUpcoming: 0,
    });
    expect(body).toContain('2 alerte(s)');
    expect(body).toContain('3 revue(s)');
    expect(body).toContain('aucune donnée nominative');
    expect(body).not.toMatch(/dossier n°|client\s*:/i);
  });

  it('NoopMailer capture les envois', async () => {
    const mailer = new NoopMailer();
    await mailer.send(['rc@etude.lu'], 'Sujet', 'Corps');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toEqual(['rc@etude.lu']);
  });
});
