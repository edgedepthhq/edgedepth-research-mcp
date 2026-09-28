import { createHash } from 'node:crypto'
import type { SelectedMeasure } from './selectedOutcome.js'
import { selectedOutcome } from './selectedOutcome.js'
import type { ApiResponse } from './apiClient.js'
import { studyHeading } from './scanChart.js'

const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

/** Display receipt, never a replacement executable operand or canonical query hash. */
export function listReceipt(values: unknown) {
  if (!Array.isArray(values) || values.length <= 20 || !values.every(v => typeof v === 'string')) return null
  const sorted = [...values].sort()
  return { omitted_list: true, count: values.length,
    sha256: createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex'),
    first_five: sorted.slice(0, 5) }
}

/** Mutates only a freshly parsed response projection. Full bytes remain upstream. */
export function compactTextDetails(body: Record<string, any>, horizon: string, selectedOnly = false): string[] {
  const notes: string[] = []
  let lists = 0
  const receipts = new Set<string>()
  const preview = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const receipt = value.length === 3 && value[1] === 'in' ? listReceipt(value[2]) : null
      if (receipt) { lists++; receipts.add(receipt.sha256); return [value[0], value[1], receipt] }
      return value.map(preview)
    }
    return object(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, preview(child)])) : value
  }
  const query = preview(body.query)
  if (lists > 0) { body.query_preview = query; delete body.query }
  if (Array.isArray(body.occurrences)) {
    for (const row of body.occurrences) {
      if (!object(row) || !Array.isArray(row.evidence)) continue
      for (const evidence of row.evidence) {
        if (!object(evidence) || evidence.operator !== 'in') continue
        const receipt = listReceipt(evidence.query_value)
        if (receipt) {
          evidence.query_value_preview = receipts.has(receipt.sha256)
            ? { list_sha256: receipt.sha256 } : receipt
          receipts.add(receipt.sha256)
          delete evidence.query_value
          lists++
        }
      }
    }
  }
  if (lists > 0) notes.push(`text detail: ${lists} long in-list echo(s) replaced by count, SHA256 of UTF-8 JSON of the sorted list (duplicates retained), and first five sorted values; repeated receipts use list_sha256. query_preview is not executable. full_counts: true restores exact definitions and evidence.`)

  if (object(body.outcomes)) {
    let omitted = 0
    for (const [id, outcomes] of Object.entries(body.outcomes)) {
      if (!object(outcomes)) continue
      const entries = Object.entries(outcomes)
      const kept = entries.filter(([name]) => !/^(fwd_ret|mfe|mae|horizon_buckets_present)(_|$)/.test(name) ||
        name.endsWith(`_${horizon}`) || (horizon === '1h' && name === 'horizon_buckets_present'))
      omitted += entries.length - kept.length
      body.outcomes[id] = Object.fromEntries(kept)
    }
    if (omitted) notes.push(`text examples: ${omitted} per-row outcome values outside ${horizon} omitted. full_outcomes: true restores these values; aggregate denominators are unchanged.`)
  }
  const summary = body.outcomes_summary
  if (!object(summary)) return notes
  const days = summary.occurrences_per_day
  if (Array.isArray(days) && days.length > 0 && days.every(d => object(d) &&
      typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && count(d.count))) {
    const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date))
    const nonzero = ordered.filter(d => d.count > 0)
    const months: Record<string, number> = {}
    for (const day of nonzero) months[day.date.slice(0, 7)] = (months[day.date.slice(0, 7)] ?? 0) + day.count
    if (Object.values(months).every(count)) {
      const peak = nonzero.reduce<(typeof nonzero)[number] | null>((best, day) =>
        !best || day.count > best.count ? day : best, null)
      summary.match_calendar = { first_matching_day: nonzero[0]?.date ?? null,
        last_matching_day: nonzero.at(-1)?.date ?? null, peak_day: peak,
        monthly_counts: months, zero_days_omitted: days.length - nonzero.length }
      delete summary.occurrences_per_day
      notes.push(`text calendar: ${days.length} daily entries replaced by UTC monthly sums, first/last matching day and the peak day (earliest tie). These are match dates, not a feature-availability window. Predicate first-data dates are unavailable in this response. full_counts: true restores daily counts.`)
    }
  }
  if (object(summary.metrics) && (selectedOnly || Object.keys(summary.metrics).some(name => name.endsWith(`_${horizon}`)))) {
    let omitted = 0
    for (const [name, metric] of Object.entries(summary.metrics)) {
      if ((selectedOnly || !name.endsWith(`_${horizon}`)) && object(metric) && Array.isArray(metric.rungs)) {
        const { rungs, ...coverage } = metric
        summary.metrics[name] = selectedOnly ? coverage : { ...coverage, rungs_omitted: true }
        omitted += rungs.length
      }
    }
    if (selectedOnly) summary.rungs_omitted = 'All except the separate selected_outcome block; omitted is not zero.'
    if (omitted > 0) notes.push(`text outcomes: ${omitted} displayed rung(s) ${selectedOnly ? "outside the exact selected outcome block" : "outside " + horizon} omitted; every horizon's present/absent counts remain. Omitted rungs are not zero. full_outcomes: true restores all horizons.`)
  }
  return notes
}

/** Lead with the agreed outcome; never infer an effective window from match dates. */
export function scanTextAnswer(response: ApiResponse, reference: ApiResponse | null,
  measure?: SelectedMeasure): string | null {
  if (!response.ok || response.notModified) return null
  let body: unknown
  try { body = JSON.parse(response.bodyText) } catch { return null }
  if (!object(body) || !object(body.counts)) return null
  const heading = studyHeading(body.query, body.counts, measure)
  const selected = selectedOutcome(response, reference, measure)
  const reading = (value: NonNullable<typeof selected>['matched']): string => {
    if (!value.available) return value.reason
    if (value.present === 0) return `No measured outcomes (0 observed; ${value.absent} missing); no rate.`
    const rate = Number(((value.rate ?? 0) * 100).toPrecision(4))
    return `${value.count} of ${value.present} observed occurrences (${rate}%; ${value.absent} missing).${value.present < 30 ? " Small sample." : ""}`
  }
  const lines = [`Study: ${heading.title}. ${heading.scope}.`]
  if (selected) {
    lines.push(`Answer: ${heading.outcome}: ${reading(selected.matched)}`)
    lines.push(`Opposite direction, same size and horizon: ${reading(selected.opposite)}`)
    let referenceReading = reading(selected.reference)
    if (reference && !reference.ok) {
      let code = `HTTP_${reference.status}`
      try {
        const failure = JSON.parse(reference.bodyText)
        const value = failure?.code ?? failure?.error?.code
        if (typeof value === 'string') code = value
      } catch { /* Keep transport status. */ }
      referenceReading = `Unavailable (${code}); no comparison can be made.`
    }
    lines.push(`Unconditional same-scope reference: ${referenceReading}`)
  } else lines.push('Answer: No outcome was specified. Outcome rungs are exploratory; no success rate was selected.')
  lines.push(`Population: ${body.counts.total_matching ?? 'unknown'} matches; ${body.counts.eligible_symbol_buckets ?? 'unknown'} eligible market-minutes; ${body.counts.excluded_symbol_buckets ?? 'unknown'} excluded; ${body.counts.symbols_scanned ?? 'unknown'} markets scanned.`)
  compactTextDetails(body, measure?.horizon ?? '24h', !!measure)
  const calendar = body.outcomes_summary?.match_calendar
  if (calendar) lines.push(calendar.first_matching_day
    ? `Matching days: ${calendar.first_matching_day} to ${calendar.last_matching_day} UTC. Predicate first-data dates are unavailable; this is not the effective feature window.`
    : 'Matching days: none. Predicate first-data dates are unavailable.')
  lines.push('Limits: adjacent matches may overlap; the unconditional reference includes matches and is not a matched control. Historical counts do not establish trading profitability.' +
    (measure?.kind === 'touch' ? ' Both directions can be touched; ordering is unknown and missing internal minutes can hide hits.' : ''))
  return lines.join('\n')
}
