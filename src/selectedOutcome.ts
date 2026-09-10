import type { ApiResponse } from './apiClient.js'

export interface SelectedMeasure {
  kind: 'close' | 'touch'
  direction: 'up' | 'down'
  magnitude: number
  horizon: string
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
function body(response: ApiResponse | null): Record<string, unknown> | null {
  if (!response?.ok || response.notModified) return null
  try { const value = JSON.parse(response.bodyText); return object(value) ? value : null } catch { return null }
}
function reading(summary: unknown, measure: SelectedMeasure) {
  const metric = `${measure.kind === 'close' ? 'fwd_ret' : measure.direction === 'up' ? 'mfe' : 'mae'}_${measure.horizon}`
  const operator = measure.direction === 'up' ? 'gte' : 'lte'
  const threshold = measure.magnitude * (measure.direction === 'up' ? 1 : -1)
  const value = object(summary) && object(summary.metrics) ? summary.metrics[metric] : null
  const absent = object(value) && count(value.absent) ? value.absent : null
  if (!object(value) || !count(value.present) || absent === null || !Array.isArray(value.thresholds))
    return { metric, operator, threshold, available: false as const, reason: 'Exact metric or denominator unavailable.' }
  const rung = value.thresholds.find(r => object(r) && r.op === operator && r.threshold === threshold)
  if (!object(rung) || !count(rung.count) || rung.count > value.present)
    return { metric, operator, threshold, available: false as const, present: value.present, absent, reason: 'Exact threshold unavailable; no nearby rung substituted.' }
  return { metric, operator, threshold, available: true as const, count: rung.count, present: value.present, absent,
    rate: value.present > 0 ? rung.count / value.present : null }
}

/** Separate display evidence, never part of canonical result bytes or the query hash. */
export function selectedOutcome(response: ApiResponse, reference: ApiResponse | null, measure?: SelectedMeasure) {
  const scan = body(response)
  if (!measure || !scan) return null
  const baseline = body(reference)
  const opposite: SelectedMeasure = { ...measure, direction: measure.direction === 'up' ? 'down' : 'up' }
  return {
    schema_version: 'selected_outcome.v1', measure,
    matched: reading(scan.outcomes_summary, measure),
    opposite: reading(scan.outcomes_summary, opposite),
    reference: reading(baseline?.baseline, measure),
    reference_kind: 'unconditional_same_scope_including_matches',
    definition_key: scan.reproducibility_key,
    limitations: [
      'Counts describe the full recorded matching population, not the example page. The reference is not a matched control.',
      ...(measure.kind === 'touch' ? ['Touch uses recorded MFE/MAE path diagnostics, not realized returns. Missing internal minutes can hide hits; both directions can be reached.'] : []),
      'No executable trading-rule evaluation is supplied. Net expectancy, realized payoff, traded losing streaks and portfolio drawdown are unavailable from this event study.',
    ],
  }
}
