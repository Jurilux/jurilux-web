import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// Paramètres scrypt (OWASP) : N=2^15, r=8, p=1 — natif Node, aucune dépendance binaire.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(keyB64!, 'base64');
  const actual = (await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  })) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// AES-256-GCM pour les secrets applicatifs (TOTP). Format: iv.ciphertext.tag en base64.
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${ct.toString('base64')}.${cipher.getAuthTag().toString('base64')}`;
}

export function decryptSecret(payload: string, keyHex: string): string {
  const [ivB64, ctB64, tagB64] = payload.split('.');
  if (!ivB64 || !ctB64 || !tagB64) throw new Error('payload chiffré invalide');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Clé dérivée PAR ENTITÉ (HKDF-SHA256) à partir de la clé maîtresse : les DOS
 * sont chiffrées avec une clé distincte par entité (US-7.4) — la compromission
 * d'une clé dérivée n'expose pas les autres entités.
 */
export function deriveEntityKeyHex(masterKeyHex: string, entityId: string, purpose: string): string {
  const derived = hkdfSync(
    'sha256',
    Buffer.from(masterKeyHex, 'hex'),
    Buffer.from(entityId, 'utf8'),
    Buffer.from(`lexkyc:${purpose}`, 'utf8'),
    32,
  );
  return Buffer.from(derived).toString('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// Signatures HMAC-SHA256 — URLs signées à durée courte (§ D.5-5).
export function hmacSignHex(keyHex: string, data: string): string {
  return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(data, 'utf8').digest('hex');
}

export function hmacVerifyHex(keyHex: string, data: string, signatureHex: string): boolean {
  const expected = hmacSignHex(keyHex, data);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex.padEnd(expected.length, '0').slice(0, expected.length), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
