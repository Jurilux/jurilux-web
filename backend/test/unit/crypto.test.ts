import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  newOpaqueToken,
  sha256Hex,
  verifyPassword,
} from '../../src/crypto.js';

const KEY = 'a'.repeat(64);

describe('crypto', () => {
  it('hash + vérification scrypt (aller-retour)', async () => {
    const hash = await hashPassword('Corr3ct-Cheval-Batterie-Agrafe');
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('Corr3ct-Cheval-Batterie-Agrafe', hash)).toBe(true);
    expect(await verifyPassword('mauvais-mot-de-passe', hash)).toBe(false);
  });

  it('deux hachages du même mot de passe diffèrent (sel aléatoire)', async () => {
    const [h1, h2] = await Promise.all([hashPassword('xxxxxxxxxxxx'), hashPassword('xxxxxxxxxxxx')]);
    expect(h1).not.toEqual(h2);
  });

  it('chiffrement AES-256-GCM des secrets (aller-retour + authentification)', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', KEY);
    expect(decryptSecret(enc, KEY)).toBe('JBSWY3DPEHPK3PXP');
    // Altération du texte chiffré → échec d'authentification GCM.
    const [iv, ct, tag] = enc.split('.');
    const tampered = `${iv}.${Buffer.from('corrompu').toString('base64')}.${tag}`;
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('jetons opaques : 32 octets, uniques', () => {
    const t1 = newOpaqueToken();
    const t2 = newOpaqueToken();
    expect(t1).not.toEqual(t2);
    expect(Buffer.from(t1, 'base64url').length).toBe(32);
  });

  it('sha256 stable', () => {
    expect(sha256Hex('lexkyc')).toEqual(sha256Hex('lexkyc'));
    expect(sha256Hex('a')).not.toEqual(sha256Hex('b'));
  });
});
