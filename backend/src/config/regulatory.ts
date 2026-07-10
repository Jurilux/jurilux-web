import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Référentiel réglementaire (§ D.1) : seuils, durées et périodicités vivent en
// configuration versionnée — jamais dans le code (anticipation AMLR/AMLA 2027).

const schema = z.object({
  version: z.string(),
  retention_years: z.number().int().positive(),
  id_expiry_warning_days: z.number().int().positive(),
  rcs_extract_max_age_months: z.number().int().positive(),
  beneficial_owner_threshold_pct: z.number().positive().max(100),
  review_interval_years: z.object({
    low: z.number().int().positive(),
    medium: z.number().int().positive(),
    high: z.number().int().positive(),
  }),
});

export type RegulatoryConfig = z.infer<typeof schema>;

const defaultPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../config/regulatory_defaults.json',
);

let cached: RegulatoryConfig | null = null;

export function regulatoryConfig(path: string = defaultPath): RegulatoryConfig {
  if (cached) return cached;
  cached = schema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return cached;
}
