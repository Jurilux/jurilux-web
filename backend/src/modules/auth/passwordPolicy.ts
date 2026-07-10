// Politique de mots de passe (§ D.5-2) : longueur ≥ 12 + rejet des mots de passe
// notoirement compromis. V1 : liste locale embarquée (souveraineté : aucun appel
// sortant). Extension prévue : dictionnaire HIBP hors-ligne (fichier de hachés).

const COMMON_PASSWORDS = new Set(
  [
    'password1234',
    'motdepasse123',
    'azertyuiop12',
    'qwertyuiop12',
    '123456789012',
    'administrateur',
    'luxembourg123',
    'password12345',
    'bienvenue2026',
    'soleil123456',
    'avocat123456',
    'changemoi123',
    'aaaaaaaaaaaa',
    '111111111111',
    'abc123abc123',
  ].map((p) => p.toLowerCase()),
);

export interface PasswordCheck {
  ok: boolean;
  reason?: 'too_short' | 'compromised' | 'contains_email';
}

export function checkPassword(password: string, email?: string): PasswordCheck {
  if (password.length < 12) return { ok: false, reason: 'too_short' };
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return { ok: false, reason: 'compromised' };
  if (email) {
    const local = email.split('@')[0]?.toLowerCase();
    if (local && local.length >= 4 && password.toLowerCase().includes(local)) {
      return { ok: false, reason: 'contains_email' };
    }
  }
  return { ok: true };
}
