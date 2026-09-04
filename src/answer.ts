/**
 * answer - pair the matched ladder with the unconditional one and ship the
 * answer instead of the grid (2026-09-05, the residual the 0.4.0 projection
 * measured but could not remove).
 *
 * MEASURED, on the live 0.4.0 server: the lean projection took the golden
 * result from 351,876 characters to 64,165, and it STILL exceeded the client
 * tool-result cap, so it still arrived as a file path. The reason is that the
 * projection's discipline is "never touch a denominator" and what was left IS
 * denominators: outcomes_summary plus the unconditional reference were 84 pct
 * of the projected bytes, and a rows:0 request, which drops every example row
 * AND the whole per-occurrence outcomes map, still returned 74,144 characters.
 * There was no removing left to do.
 *
 * So this does the one thing the projection would not: it DERIVES. Two rules
 * make that safe, and they are the whole design.
 *
 *  1. THE COUNTS STAY. `present`, `absent` and every rung's integer `count`
 *     pass through verbatim, and each derived `rate` and `lift` sits directly
 *     beside the integers it came from. A caller checks the arithmetic in
 *     place rather than trusting it. Nothing is rounded away: the counts are
 *     the record, the rates are a convenience.
 *  2. SELECTION IS FIXED AND STATED, never chosen by relevance. The rung grid
 *     is closed and published by list_features, so this keeps the same four
 *     canonical rungs for every metric plus, when a baseline exists, the one
 *     rung with the largest absolute log lift, so a strong effect outside the
 *     canonical set can never be hidden by the selection. The note names what
 *     was dropped and how to get it back.
 *
 * Why derive at all, which is the part worth arguing: the server's own
 * instructions already tell the caller to compute exactly this rate, from
 * exactly this denominator, and warn three separate times against computing
 * it from the wrong place. Shipping 54 KB of ladder so an agent can perform a
 * division we have specified is not more honest than performing it once and
 * showing the operands. It is the same number with more chances to be wrong,
 * and the two logged sessions where an agent misread a rate came from having
 * to join two ladders across two blocks by hand.
 *
 * The unconditional population remains NOT comparable and is never described
 * as one. `lift` is a ratio of two stated rates over the same symbols and
 * window, nothing more, and it is omitted rather than guessed whenever the
 * baseline rate is zero or the baseline is absent.
 */

/** The rungs kept for every metric, in this order. The grid is uniform across
 *  all twelve metrics (26 thresholds, gte 0.001..4 and lte -0.001..-1), so a
 *  fixed subset needs no per-family special casing. */
export const CANONICAL_RUNGS: { op: string; threshold: number }[] = [
  { op: 'gte', threshold: 0.01 },
  { op: 'gte', threshold: 0.02 },
  { op: 'lte', threshold: -0.01 },
  { op: 'lte', threshold: -0.02 },
]

/**
 * Floor on the matched count before a rung may be promoted as the widest lift.
 *
 * MEASURED, and the reason this constant exists: on the golden result the
 * unguarded valve promoted `gte 0.5` at count 1 of 1,986 with a lift of 48.79,
 * and put it in the answer beside rungs carrying hundreds of occurrences. A
 * ratio computed on a single occurrence is noise wearing the clothes of the
 * largest effect in the grid, and this block is read by an agent that will
 * quote whatever looks biggest. The canonical four are exempt because they are
 * fixed in advance and never chosen for their size; only the promoted rung has
 * to earn its place. 30 is the same floor the web surface already uses before
 * it will report a rate at all.
 */
export const MIN_PROMOTED_COUNT = 30

export interface AnswerRung {
  op: string
  threshold: number
  count: number
  rate: number
  baseline_count?: number
  baseline_rate?: number
  lift?: number
  /** set only on the rung kept because its lift was the largest in the grid */
  kept_for?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Four significant figures is finer than any denominator here supports and
 *  keeps the bytes small. The integer count is always present beside it. */
function round(value: number, places = 4): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

interface Threshold {
  op: string
  threshold: number
  count: number
}

function thresholds(metric: unknown): Threshold[] {
  if (!isRecord(metric) || !Array.isArray(metric.thresholds)) return []
  const out: Threshold[] = []
  for (const entry of metric.thresholds) {
    if (!isRecord(entry)) continue
    const { op, threshold, count } = entry
    if (typeof op === 'string' && typeof threshold === 'number' && typeof count === 'number') {
      out.push({ op, threshold, count })
    }
  }
  return out
}

function key(rung: { op: string; threshold: number }): string {
  return `${rung.op}:${rung.threshold}`
}

/**
 * A rung is degenerate when it separates nothing: every occurrence is on one
 * side of it. Dropping those is what makes mae's positive rungs and mfe's
 * negative rungs disappear without naming either family.
 */
function degenerate(count: number, present: number): boolean {
  return present <= 0 || count === 0 || count === present
}

export interface AnswerMetric {
  present: number
  absent: number
  baseline_present?: number
  rungs: AnswerRung[]
}

export interface AnswerResult {
  metrics: Record<string, AnswerMetric>
  /** total rungs dropped, for the note */
  dropped: number
  /** true when a baseline was paired in */
  paired: boolean
}

/**
 * Build the paired answer from a matched outcomes_summary and, when one is
 * available, the unconditional summary over the same symbols and window.
 * Returns null when the matched summary has no usable metrics.
 */
export function pairOutcomes(summary: unknown, baseline: unknown): AnswerResult | null {
  if (!isRecord(summary) || !isRecord(summary.metrics)) return null
  const baseMetrics = isRecord(baseline) && isRecord(baseline.metrics) ? baseline.metrics : null
  const metrics: Record<string, AnswerMetric> = {}
  let dropped = 0
  let paired = false

  for (const [name, metric] of Object.entries(summary.metrics)) {
    if (!isRecord(metric)) continue
    const present = typeof metric.present === 'number' ? metric.present : 0
    const absent = typeof metric.absent === 'number' ? metric.absent : 0
    const all = thresholds(metric)
    if (all.length === 0) continue

    const baseMetric = baseMetrics ? baseMetrics[name] : undefined
    const basePresent =
      isRecord(baseMetric) && typeof baseMetric.present === 'number' ? baseMetric.present : 0
    const baseByKey = new Map(thresholds(baseMetric).map((t) => [key(t), t]))
    if (basePresent > 0) paired = true

    const rateOf = (count: number): number => (present > 0 ? count / present : 0)
    const baseRateOf = (k: string): number | null => {
      const entry = baseByKey.get(k)
      if (!entry || basePresent <= 0) return null
      return entry.count / basePresent
    }

    // The safety valve: the rung whose lift is furthest from 1 in either
    // direction, so the fixed selection can never bury the real effect. Only
    // computable when a baseline exists, and only over non-degenerate rungs.
    let widest: Threshold | null = null
    let widestScore = 0
    if (basePresent > 0) {
      for (const rung of all) {
        if (degenerate(rung.count, present)) continue
        // A lift computed on a handful of occurrences is noise, and this is
        // the one rung chosen FOR its size, so it is the one that must clear
        // a floor before it is allowed to speak.
        if (rung.count < MIN_PROMOTED_COUNT) continue
        const base = baseRateOf(key(rung))
        if (base === null || base <= 0) continue
        const score = Math.abs(Math.log(rateOf(rung.count) / base))
        if (score > widestScore) {
          widestScore = score
          widest = rung
        }
      }
    }

    const wanted = new Map<string, Threshold>()
    const byKey = new Map(all.map((t) => [key(t), t]))
    for (const canonical of CANONICAL_RUNGS) {
      const found = byKey.get(key(canonical))
      if (found && !degenerate(found.count, present)) wanted.set(key(found), found)
    }
    const widestKey = widest ? key(widest) : null
    if (widest && !wanted.has(widestKey as string)) wanted.set(widestKey as string, widest)

    const rungs: AnswerRung[] = []
    for (const rung of all) {
      const k = key(rung)
      if (!wanted.has(k)) continue
      const base = baseRateOf(k)
      const entry: AnswerRung = { op: rung.op, threshold: rung.threshold, count: rung.count, rate: round(rateOf(rung.count)) }
      if (base !== null) {
        entry.baseline_count = baseByKey.get(k)?.count
        entry.baseline_rate = round(base, 6)
        // A zero unconditional rate makes the ratio meaningless rather than
        // infinite, so it is omitted and the two rates still stand alone.
        if (base > 0) entry.lift = round(rateOf(rung.count) / base, 2)
      }
      if (k === widestKey && !CANONICAL_RUNGS.some((c) => key(c) === k)) {
        entry.kept_for = `largest lift in this metric grid at count >= ${MIN_PROMOTED_COUNT}`
      }
      rungs.push(entry)
    }

    dropped += all.length - rungs.length
    const out: AnswerMetric = { present, absent, rungs }
    if (basePresent > 0) out.baseline_present = basePresent
    metrics[name] = out
  }

  if (Object.keys(metrics).length === 0) return null
  return { metrics, dropped, paired }
}

/** The note that must travel with a derived block. */
export function answerNote(result: AnswerResult): string {
  const rungs = CANONICAL_RUNGS.map((r) => `${r.op} ${r.threshold}`).join(', ')
  const lines = [
    `outcomes_summary: replaced by a paired answer block. Every rung's integer count, and each ` +
      `metric's present and absent tallies, are the engine's verbatim numbers; rate is count / ` +
      `present and lift is rate / baseline_rate, both computed here so the division the ` +
      `instructions require is done once, beside its operands, rather than by hand across two ` +
      `ladders.`,
    `rungs: ${result.dropped} rung(s) omitted across all metrics. Kept for every metric: ${rungs}, ` +
      `dropped where degenerate (a rung matching none or all of the occurrences separates ` +
      `nothing), plus the single rung with the largest lift in that metric's grid among those ` +
      `holding at least ${MIN_PROMOTED_COUNT} occurrences, marked kept_for, so the fixed ` +
      `selection cannot hide a strong effect at another threshold and cannot promote a ratio ` +
      `computed on a handful of rows. The ` +
      `rung grid is closed and published by list_features. Pass full_outcomes: true for every ` +
      `rung and the per-rung histogram, or full_counts: true for the engine's verbatim bytes.`,
  ]
  if (result.paired) {
    lines.push(
      `baseline_rate is the UNCONDITIONAL rate over the same symbols and window. It is not ` +
        `matched, comparable, or a causal control, and lift is the ratio of two stated rates, ` +
        `nothing more. The reference block below keeps its scope, counts and reproducibility key.`,
    )
  } else {
    lines.push(
      `no unconditional reference was available for this call, so rates stand alone and no lift ` +
        `is stated. Do not invent a baseline: run_scan on the same document returns one when the ` +
        `engine has it.`,
    )
  }
  return `answer (counts verbatim; rate and lift derived, operands shown):\n- ${lines.join('\n- ')}`
}
