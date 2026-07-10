import { describe, expect, it } from 'vitest';
import { checkPassword } from '../../src/modules/auth/passwordPolicy.js';

describe('politique de mots de passe (§ D.5-2)', () => {
  it('rejette les mots de passe < 12 caractères', () => {
    expect(checkPassword('Court1!')).toEqual({ ok: false, reason: 'too_short' });
    expect(checkPassword('abcdefghijk')).toEqual({ ok: false, reason: 'too_short' });
  });

  it('rejette les mots de passe notoirement compromis (insensible à la casse)', () => {
    expect(checkPassword('Password1234')).toEqual({ ok: false, reason: 'compromised' });
    expect(checkPassword('MOTDEPASSE123')).toEqual({ ok: false, reason: 'compromised' });
  });

  it("rejette un mot de passe contenant la partie locale de l'e-mail", () => {
    expect(checkPassword('maitre.dupont-2026!', 'maitre.dupont@barreau.lu')).toEqual({
      ok: false,
      reason: 'contains_email',
    });
  });

  it('accepte un mot de passe long et non compromis', () => {
    expect(checkPassword('Corr3ct-Cheval-Batterie-Agrafe', 'avocat@barreau.lu')).toEqual({
      ok: true,
    });
  });
});
