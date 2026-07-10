import { z } from 'zod';

// Configuration validée au démarrage — échec rapide si l'environnement est incomplet.
// Aucun paramètre réglementaire n'est codé en dur (§ D.1) : ils vivent en config/.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().url(),
  // Clé applicative AES-256-GCM (hex, 32 octets) pour le chiffrement des secrets TOTP.
  // En production : fournie par le KMS, jamais commitée.
  APP_ENC_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'APP_ENC_KEY doit être 32 octets en hexadécimal'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration invalide:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
