import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SelectedMeasure } from './selectedOutcome.js'
import type { ApiResponse } from './apiClient.js'
import { SCAN_CHART_HTML } from './scanChartHtml.js'

export const SCAN_CHART_URI = 'ui://edgedepth/scan-evidence-v2.html'

function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function body(response: ApiResponse | null): Record<string, any> | null {
  try {
    const value: unknown = JSON.parse(response?.bodyText ?? '')
    return object(value) ? value : null
  } catch { return null }
}
function errors(response: ApiResponse | null) {
  const value = body(response)
  const items = Array.isArray(value?.errors) ? value.errors : [value]
  return items.filter(object).map(item => ({
    code: typeof item.code === 'string' ? item.code : `HTTP_${response?.status ?? 'UNKNOWN'}`,
    message: typeof item.message === 'string' ? item.message
      : typeof item.error === 'string' ? item.error : 'The research request did not complete.',
  }))
}
function metrics(summary: unknown): Record<string, unknown> {
  return object(summary) && object(summary.metrics)
    ? Object.fromEntries(Object.entries(summary.metrics).filter(([name]) =>
      /^(fwd_ret|mfe|mae)_(30m|1h|4h|24h|72h|7d)$/.test(name))) : {}
}

// Old exact-document callers have no proposal summary to carry forward. Render
// their clauses faithfully, keeping unrecognised fields/units literal.
const labels: Record<string, [string, boolean]> = {
  'feature.ret_1h': ['trailing one-hour return', true],
  'feature.oi_contract_change_1h': ['one-hour change in open contracts', true],
  'feature.liq_side_skew_1h': ['one-hour liquidation side skew', false],
  'feature.turnover_multiple_1h': ['one-hour turnover multiple', false],
}
function clause(value: unknown): string {
  if (!Array.isArray(value)) return JSON.stringify(value) ?? 'Unspecified condition'
  const [field, op, raw] = value
  if (typeof raw === 'number' && ((op === 'gte' && raw > 0) || (op === 'lte' && raw < 0)) &&
      (field === 'feature.ret_1h' || field === 'feature.oi_contract_change_1h')) {
    const subject = field === 'feature.ret_1h' ? 'price' : 'open contracts'
    return `${subject} ${raw > 0 ? 'rose' : 'fell'} at least ${Number((Math.abs(raw) * 100).toFixed(8))}% in one hour`
  }
  const [label, percent] = labels[String(field)] ?? [String(field), false]
  const format = (v: unknown): string => percent && typeof v === 'number'
    ? `${Number((v * 100).toFixed(8))}%` : typeof v === 'string' ? v : JSON.stringify(v)
  const operator = ({ gte: 'at least', gt: 'greater than', lte: 'at most', lt: 'less than', eq: '=',
    neq: 'not equal to', in: 'in', between: 'between', exists: 'is present' } as Record<string, string>)[op] ?? String(op)
  return `${label} ${operator}${raw === undefined ? '' : ` ${Array.isArray(raw) ? raw.map(format).join(op === 'between' ? ' and ' : ', ') : format(raw)}`}`
}
export function studyHeading(query: unknown, counts: Record<string, any>, measure?: SelectedMeasure, summary?: string) {
  const wrapper = object(query) ? query : {}
  const doc = object(wrapper.population) ? wrapper.population : wrapper
  const clauses: unknown[] = Array.isArray(doc.where?.all) ? doc.where.all : []
  const conditions = clauses.filter(c => !Array.isArray(c) || !['identity.symbol', 'times.anchor_time'].includes(c[0]))
  let condition = conditions.map(clause).join(' and ')
  if (object(doc.sequence)) {
    const steps = Array.isArray(doc.sequence.steps) ? doc.sequence.steps : []
    condition += `${condition ? '; then ' : ''}${steps.map((step: any) =>
      (Array.isArray(step?.all) ? step.all : []).map(clause).join(' and ')).join('; then ')} within ${doc.sequence.within}`
  }
  if (object(wrapper.split)) condition += `; split by ${(wrapper.split.where?.all ?? []).map(clause).join(' and ')}${wrapper.split.sequence ? `; sequence ${JSON.stringify(wrapper.split.sequence)}` : ''}${wrapper.split.observation?.relative_to ? ` at ${wrapper.split.observation.relative_to}` : ''}`
  const symbols = clauses.find(c => Array.isArray(c) && c[0] === 'identity.symbol') as unknown[] | undefined
  const roster = symbols?.[1] === 'in' && Array.isArray(symbols[2]) ? symbols[2]
    : symbols?.[1] === 'eq' ? [symbols[2]] : null
  const markets = roster && roster.length <= 3 ? roster.join(', ').toUpperCase()
    : roster ? `${roster.length} markets` : Number.isSafeInteger(counts.symbols_scanned)
      ? `${counts.symbols_scanned} markets` : 'Recorded markets'
  const dateLabel = (v: unknown) => typeof v === 'string'
    ? v.replace('T', ' ').replace(/:00\.000Z$/, '').replace(/Z$/, '') : String(v)
  const dates = clauses.filter(c => Array.isArray(c) && c[0] === 'times.anchor_time')
    .map(c => {
      const [, op, value] = c as unknown[]
      return op === 'between' && Array.isArray(value)
        ? `${dateLabel(value[0])} to ${dateLabel(value[1])}`
        : clause(c).replace('times.anchor_time', 'Anchor time')
    }).join('; ')
  return {
    // The proposal text remains verbatim and outside the canonical query.
    title: summary || (condition ? /^(feature|window|identity)\./.test(condition) ? condition : condition.charAt(0).toUpperCase() + condition.slice(1) : 'Recorded study'),
    scope: `${markets}${dates ? ` · ${dates} UTC` : ' · Exact dates unavailable'}`,
    outcome: measure ? `${Number((measure.magnitude * 100).toFixed(8))}% ${measure.direction === 'up' ? 'rise' : 'fall'} ${measure.kind === 'touch' ? 'touched within' : 'at the close after'} ${measure.horizon}`
      : 'No outcome specified; explore closing returns.',
  }
}

/** UI-only evidence from complete engine summaries. Never alters the document,
 * canonical bytes, metering, or model projection and never makes a request. */
export function scanChartMeta(
  response: ApiResponse,
  reference: ApiResponse | null,
  measure?: SelectedMeasure,
  document?: Record<string, unknown>,
  studySummary?: string,
): Record<string, unknown> {
  if (response.notModified) return { edgedepthEvidence: { state: 'not_modified' } }
  if (!response.ok) return { edgedepthEvidence: {
    state: 'error', status: response.status, errors: errors(response),
  } }
  const scan = body(response)
  if (!scan) return { edgedepthEvidence: { state: 'unavailable' } }
  const baseline = reference?.ok ? body(reference) : null
  const counts = object(scan.counts) ? scan.counts : {}
  const query = scan.query ?? document
  const cohort = object(scan.treatment)
  const stratified = object(scan.groups)
  const groups = stratified
    ? ['split_true', 'split_false', 'split_absent'].map((id, i) => ({
      id, label: ['Split condition met', 'Split condition not met', 'Split reading missing'][i],
      count: scan.groups[id]?.anchor_count, metrics: metrics(scan.groups[id]?.outcomes_summary),
    }))
    : [{ id: 'matched', label: 'Matching occurrences', count: counts.total_matching,
      metrics: metrics(cohort ? scan.treatment : scan.outcomes_summary) }]
  const referenceMetrics = metrics(cohort ? scan.baseline : baseline?.baseline ?? baseline?.outcomes_summary)
  const referenceErrors = reference && !reference.ok ? errors(reference) : []
  return { edgedepthEvidence: {
    state: 'ready',
    heading: studyHeading(query, counts, measure, studySummary), measure,
    groups, referenceMetrics,
    referenceLabel: cohort ? 'Other eligible minutes (condition false)' : 'Unconditional same-scope reference',
    referenceReason: Object.keys(referenceMetrics).length ? null
      : referenceErrors.length ? referenceErrors.map(e => `${e.code}: ${e.message}`).join('; ')
      : 'Unavailable for this scope.',
    referenceTimedOut: referenceErrors.some(e => ['SCAN_TIMEOUT', 'UPSTREAM_TIMEOUT'].includes(e.code)),
    referenceKind: cohort ? 'predicate_false' : stratified ? 'none' : 'unconditional',
    counts, coverage: scan.predicate_coverage, query, key: scan.reproducibility_key,
    referenceScope: baseline?.scope, referenceCounts: baseline?.counts,
    notes: scan.notes, referenceNotes: baseline?.notes,
    metering: { cache: response.headers.cache, charged: response.headers.creditsCharged,
      remaining: response.headers.creditsRemaining },
  } }
}

export function registerScanChart(server: McpServer): void {
  server.registerResource('scan-evidence', SCAN_CHART_URI, {}, async () => ({
    contents: [{
      uri: SCAN_CHART_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: SCAN_CHART_HTML,
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        'openai/widgetDescription': 'The exact study, chosen outcome, return distribution and path ladder. Counts, missing data and reference limitations remain visible.',
      },
    }],
  }))
}
