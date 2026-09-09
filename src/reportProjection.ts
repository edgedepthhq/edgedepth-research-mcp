import { pairOutcomes } from './answer.js'
const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {}
/** Presentation only. Never rewrites, re-hashes or claims to verify stored pins. */
export function compactReport(bodyText: string): string | null {
  let body: Record<string, any>
  try {
    body = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || !body.pinned) return null
  const pinned = record(body.pinned),
    result = record(pinned.result)
  const baseline = record(record(pinned.baseline).result)
  const paired = pairOutcomes(
    result.outcomes_summary,
    baseline.baseline ?? baseline.outcomes_summary,
  )
  const overview = paired
    ? Object.fromEntries(
        Object.entries(paired.metrics).filter(([key]) =>
          ['fwd_ret_1h', 'mfe_1h', 'mae_1h'].includes(key),
        ),
      )
    : null
  const { definition, pinned: omitted, ...metadata } = body
  return JSON.stringify({
    ...metadata,
    integrity_basis: 'Stored publisher status; this read does not revalidate the pinned artifact.',
    definition_summary: body.title,
    counts: result.counts ?? pinned.counts ?? null,
    outcome_overview: overview,
    outcome_selection:
      'Fixed 1h overview, not a saved requested outcome. full:true restores all stored horizons and thresholds.',
    reference: {
      kind: 'unconditional_same_scope',
      counts: baseline.counts ?? null,
      reproducibility_key: baseline.reproducibility_key ?? null,
    },
    reproducibility_key: result.reproducibility_key ?? null,
    result_encoding: result.result_encoding ?? null,
    truncated: result.truncated ?? null,
    outcomes_note: result.outcomes_note ?? null,
    reference_notes: baseline.notes ?? null,
    pinned_at: pinned.pinned_at ?? null,
    representatives: Array.isArray(result.representatives)
      ? result.representatives.slice(0, 3)
      : [],
    predicate_coverage: result.predicate_coverage ?? null,
    limitations: [
      'Page rows are examples, not denominators. The reference includes matching minutes; it is not a causal control.',
      'Path measurements may miss crossings in internal gaps. Replay access depends on coverage and account entitlement.',
      ...(!paired
        ? [
            'This pin has no supported outcome overview; request full:true for its original encoding.',
          ]
        : []),
    ],
    projection: 'compact_report.v1; full:true returns exact stored API bytes',
  })
}
