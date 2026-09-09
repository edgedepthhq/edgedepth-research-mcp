import { z } from 'zod'
const provenance = z
  .enum(['user_stated', 'semantic_translation', 'model_assumed'])
  .describe(
    'Direct user fact; equivalent stated meaning (top 10% = rank >= 0.9); or an unstated proposal requiring approval. Never assert approval.',
  )
export const preparationSchema = {
  scope: z
    .object({
      symbols: z.array(z.string()).min(1).max(800),
      from: z.string(),
      to: z.string(),
      provenance,
      venue: z.string().optional(),
      contract_type: z.string().optional(),
    })
    .strict()
    .describe(
      'Exact symbols and ISO timestamps with explicit UTC offset. No date defaults. Venue/type optional when current symbol is unambiguous.',
    ),
  setup: z
    .array(
      z
        .object({ field: z.string(), operator: z.string(), value: z.unknown(), provenance })
        .strict(),
    )
    .min(1)
    .max(16)
    .describe(
      'Common numeric fields: feature.oi_velocity_pctrank (rank 0..1), feature.vpin (0..1), feature.liq_ratio_1m (ratio). Operators gte, gt, lte, lt, eq, between. Use compact list_features only for uncommon/invalid fields. Percentage fractions: 1% = 0.01. Never turn a qualitative screenshot into an unstated numeric threshold.',
    ),
  outcome: z
    .object({
      kind: z.enum(['reached', 'finished']),
      direction: z.enum(['up', 'down']),
      magnitude: z.number().positive(),
      horizon: z.string(),
      provenance,
    })
    .strict()
    .describe(
      'Magnitude is a fraction, 0.01 = 1%. Common horizon 1h/4h/24h. reached means observed path, finished means ending close. Ask which if ambiguous; do not substitute a nearby threshold.',
    ),
  source: z
    .object({
      kind: z.enum(['text', 'screenshot']),
      anchor_time: z.string().optional(),
      time_provenance: z.enum(['user_stated', 'visible', 'uncertain', 'missing']).optional(),
    })
    .strict()
    .optional(),
}
