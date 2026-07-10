import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Paramètres du matching + listes de pays + matrice de risque : tout est en
// configuration versionnée (§ D.1) — modifiable sans redéploiement de code.

const here = dirname(fileURLToPath(import.meta.url));

const screeningSchema = z.object({
  version: z.string(),
  similarity_threshold: z.number().min(0.5).max(1),
  birth_year_tolerance: z.number().int().min(0),
  nationality_mismatch_penalty: z.number().min(0).max(0.5),
  birth_year_mismatch_discard: z.boolean(),
});
export type ScreeningConfig = z.infer<typeof screeningSchema>;

const countrySchema = z.object({
  version: z.string(),
  gafi_black: z.array(z.string().length(2)),
  gafi_grey: z.array(z.string().length(2)),
  eu_high_risk: z.array(z.string().length(2)),
  offshore: z.array(z.string().length(2)),
});
export type CountryRiskConfig = z.infer<typeof countrySchema>;

const factorSchema = z.object({
  id: z.string(),
  axis: z.enum(['client', 'geography', 'service', 'channel']),
  trigger: z.string(),
  label: z.string(),
  points: z.number().int().positive().optional(),
  forced: z.enum(['high']).optional(),
  removable: z.boolean().optional(),
});
const matrixSchema = z.object({
  version: z.string(),
  thresholds: z.object({ medium: z.number().int(), high: z.number().int() }),
  factors: z.array(factorSchema),
});
export type RiskMatrix = z.infer<typeof matrixSchema>;
export type RiskFactor = z.infer<typeof factorSchema>;

function load<T>(file: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(join(here, '../../config', file), 'utf8')));
}

const sourcesSchema = z.object({
  version: z.string(),
  EU: z.string().url(),
  UN: z.string().url(),
});
export type ListSources = z.infer<typeof sourcesSchema>;

let screening: ScreeningConfig | null = null;
let countries: CountryRiskConfig | null = null;
let matrix: RiskMatrix | null = null;
let sources: ListSources | null = null;

export const screeningConfig = () => (screening ??= load('screening_defaults.json', screeningSchema));
export const countryRiskConfig = () => (countries ??= load('country_risk_defaults.json', countrySchema));
export const defaultRiskMatrix = () => (matrix ??= load('risk_matrix_default.json', matrixSchema));
export const listSources = () => (sources ??= load('list_sources.json', sourcesSchema));

/**
 * Valide une matrice personnalisée (édition par le RC, US-5.1) : structure
 * correcte ET présence intacte des facteurs forcés non désactivables (US-5.2).
 */
export function validateCustomMatrix(input: unknown): RiskMatrix {
  const candidate = matrixSchema.parse(input);
  const mandatory = defaultRiskMatrix().factors.filter((f) => f.removable === false);
  for (const required of mandatory) {
    const found = candidate.factors.find((f) => f.id === required.id);
    if (!found || found.forced !== 'high' || found.trigger !== required.trigger) {
      throw new Error(
        `facteur obligatoire manquant ou altéré: ${required.id} (risque élevé forcé, non désactivable)`,
      );
    }
  }
  return candidate;
}
