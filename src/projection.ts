/**
 * projection - agent-context economy for scan-family result bytes
 * (2026-09-04 MCP agent surface audit).
 *
 * MEASURED, on the document the interpreter itself proposed for "do
 * liquidation cascades usually bounce": 344,621 characters, about 86k tokens,
 * over the tool-result cap of a mainstream client, so the agent received a
 * file path instead of an answer. Of the 282,895-character body, 48.1 pct was
 * fifty occurrence rows each carrying the whole setup vector, 31.3 pct was
 * counts_by_symbol, and 9.7 pct was a per-occurrence outcomes map duplicating
 * the page rows. The answer contract in the server instructions - one exact
 * definition, one denominated result, one unconditional reference, one replay
 * handoff - is served by counts, outcomes_summary, representatives, the
 * reproducibility key and the handoffs, which together were about 30 KB.
 *
 * THE DISCIPLINE, inherited from the earlier counts_by_symbol compaction and
 * not relaxed here:
 *
 *  1. RESPONSE-SIDE ONLY. The request document is never rewritten, so the
 *     canonical query hash, the credit charged and the cache entry are exactly
 *     what the caller asked for, and the document the agent echoes is the
 *     document that ran.
 *  2. ONLY EVER REMOVE. Nothing is recomputed, rounded, re-ordered or
 *     summarized into a new number. Every removal is counted and stated in a
 *     note, with the exact way to get the bytes back.
 *  3. NEVER TOUCH THE DENOMINATOR. counts, outcomes_summary bucket counts,
 *     absent tallies, predicate_coverage, the reproducibility key, the cursor
 *     and representatives pass through untouched. What is thinned is either an
 *     example (rows), a repetition (the per-occurrence outcomes map), a long
 *     tail (counts_by_symbol beyond the top N) or a stated zero (empty ladder
 *     rungs and zero-count instruments).
 *  4. THE ETAG IS PROJECTION-SCOPED. A caller holding rows: 3 bytes can never
 *     be told 304 "identical result" for a rows: 25 or a full_counts request.
 */

import { answerNote, pairOutcomes } from './answer.js'

/** Base projection tag, kept from the zero-count compaction so the meaning of
 *  the leading token does not change: this body is a projection, not the
 *  engine's canonical bytes. */
export const COMPACT_TAG = 'nz'

/** Default occurrence rows kept. Rows are examples; the instructions forbid
 *  computing a rate from them, and three is enough to show one, quote one and
 *  keep one in reserve. */
export const DEFAULT_ROWS = 3

/** Default counts_by_symbol entries kept, most matches first. */
export const DEFAULT_SYMBOLS = 25

export interface LeanOptions {
  /** occurrence rows to keep (0 keeps none, only their count) */
  rows: number
  /** keep the complete setup vector on the rows that are kept */
  fullRows: boolean
  /** counts_by_symbol entries to keep, by total_matching descending */
  symbols: number
  /** replace the outcome ladders with the paired answer block (see answer.ts).
   *  False restores the 0.4.0 shape: full ladders on both sides. */
  answer: boolean
}

export const DEFAULT_LEAN: LeanOptions = {
  rows: DEFAULT_ROWS,
  fullRows: false,
  symbols: DEFAULT_SYMBOLS,
  answer: true,
}

/**
 * The ETag tag for one projection. Every knob that changes the bytes is in
 * here, so revalidation can only ever match the same representation.
 *
 * The answer marker is ADDED for the 0.5.0 default rather than the full-ladder
 * shape being renamed, so an ETag minted by 0.4.0 (`nz.r3`) still revalidates
 * correctly against the same full-ladder bytes it described.
 */
export function projectionTag(opts: LeanOptions): string {
  const parts = [COMPACT_TAG]
  if (opts.answer) parts.push('a')
  parts.push(`r${Math.max(0, Math.trunc(opts.rows))}`)
  if (opts.fullRows) parts.push('full')
  if (opts.symbols !== DEFAULT_SYMBOLS) parts.push(`s${Math.max(0, Math.trunc(opts.symbols))}`)
  return parts.join('.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** setup keys the query actually touched, read from the row's own evidence
 *  block. Returns null when evidence is missing or unusable, and the caller
 *  then keeps the whole vector: a row is never thinned by guesswork. */
function evidenceFields(row: Record<string, unknown>): Set<string> | null {
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) return null
  const fields = new Set<string>()
  for (const entry of row.evidence) {
    if (!isRecord(entry)) continue
    if (typeof entry.field === 'string') fields.add(entry.field)
  }
  return fields.size > 0 ? fields : null
}

/** Drops ladder rungs whose count is 0. The grid is closed and published by
 *  list_features, so an absent rung is a stated zero, not missing data; sums,
 *  absent tallies and every non-zero count are untouched. */
function trimZeroRungs(summary: unknown): number {
  if (!isRecord(summary)) return 0
  const metrics = summary.metrics
  if (!isRecord(metrics)) return 0
  let dropped = 0
  for (const metric of Object.values(metrics)) {
    if (!isRecord(metric) || !Array.isArray(metric.buckets)) continue
    const kept = metric.buckets.filter((bucket) => !(isRecord(bucket) && bucket.count === 0))
    dropped += metric.buckets.length - kept.length
    metric.buckets = kept
  }
  return dropped
}

export interface LeanResult {
  bodyText: string
  /** one line per removal, in the order they were applied */
  notes: string[]
}

/**
 * The scan-family projection. Returns null (verbatim fallback) on non-JSON,
 * a non-object body, or when nothing at all would be removed.
 */
export function leanScanBody(
  bodyText: string,
  opts: LeanOptions = DEFAULT_LEAN,
  baselineSummary?: unknown,
): LeanResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const body = parsed as Record<string, unknown>
  const notes: string[] = []

  // 1. Occurrence rows: keep the first N as examples, thin each kept row to
  //    the fields its own evidence names.
  const keptIds = new Set<string>()
  if (Array.isArray(body.occurrences)) {
    const total = body.occurrences.length
    const limit = Math.max(0, Math.trunc(opts.rows))
    const kept = body.occurrences.slice(0, limit)
    if (total > kept.length) {
      notes.push(
        `occurrences: ${total - kept.length} of ${total} row(s) on this page omitted from this ` +
          'projection. Rows are examples, never the denominator - counts and outcomes_summary ' +
          'are computed by the engine over ALL occurrences and are untouched. Use next_page for ' +
          'more rows, or rows: <n> for a wider page projection.',
      )
    }
    let droppedFields = 0
    let thinnedRows = 0
    const rows = kept.map((row) => {
      if (!isRecord(row)) return row
      if (typeof row.id === 'string') keptIds.add(row.id)
      if (opts.fullRows || !isRecord(row.setup)) return row
      const fields = evidenceFields(row)
      if (!fields) return row
      const setup: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(row.setup)) {
        if (fields.has(field)) setup[field] = value
      }
      if (Object.keys(setup).length === Object.keys(row.setup).length) return row
      droppedFields += Object.keys(row.setup).length - Object.keys(setup).length
      thinnedRows += 1
      return { ...row, setup }
    })
    if (thinnedRows > 0) {
      notes.push(
        `occurrences[].setup: ${droppedFields} recorded value(s) across ${thinnedRows} row(s) ` +
          'omitted. Each kept row retains the setup fields its own evidence block names, which ' +
          'are the fields the predicate matched on. Pass full_rows: true for the whole vector, ' +
          'or snapshot_at for every recorded value at one exact moment.',
      )
    }
    if (rows.length !== total || thinnedRows > 0) body.occurrences = rows
  }

  // 2. The per-occurrence outcomes map: keep the entries for rows that are
  //    still here. It is page-scoped detail, and outcomes_summary is the
  //    instruction-sanctioned source for every rate.
  if (isRecord(body.outcomes) && body.outcomes_summary !== undefined) {
    const entries = Object.entries(body.outcomes)
    const kept = entries.filter(([id]) => keptIds.has(id))
    if (kept.length < entries.length) {
      body.outcomes = Object.fromEntries(kept)
      notes.push(
        `outcomes: ${entries.length - kept.length} per-occurrence entr(ies) omitted, leaving the ` +
          'entries for the rows above. This map is page-scoped detail; read every rate from ' +
          'outcomes_summary, which covers all occurrences.',
      )
    }
  }

  // 3. counts_by_symbol: stated zeros first, then the long tail.
  if (isRecord(body.counts_by_symbol)) {
    const all = Object.entries(body.counts_by_symbol)
    const matching = (value: unknown): number => {
      const total = isRecord(value) ? value.total_matching : undefined
      return typeof total === 'number' ? total : 0
    }
    const nonZero = all.filter(([, value]) => matching(value) !== 0)
    const zeros = all.length - nonZero.length
    const limit = Math.max(0, Math.trunc(opts.symbols))
    const ranked = [...nonZero].sort(
      (a, b) => matching(b[1]) - matching(a[1]) || a[0].localeCompare(b[0]),
    )
    const kept = ranked.slice(0, limit)
    const tail = ranked.slice(limit)
    if (zeros > 0 || tail.length > 0) {
      body.counts_by_symbol = Object.fromEntries(kept)
      const tailMatches = tail.reduce((sum, [, value]) => sum + matching(value), 0)
      const parts: string[] = []
      if (zeros > 0) parts.push(`${zeros} zero-count instrument(s)`)
      if (tail.length > 0) {
        parts.push(`${tail.length} further instrument(s) holding ${tailMatches} match(es) between them`)
      }
      notes.push(
        `counts_by_symbol: ${parts.join(' and ')} omitted from this projection, keeping the ` +
          `top ${kept.length} by match count. Absence here means a stated zero or an omitted ` +
          'tail entry, never missing data. THE PROJECTED MAP THEREFORE NO LONGER SUMS TO ' +
          'counts.total_matching: read the total from counts, which the engine computed over ' +
          "every instrument and which is untouched. Pass full_counts: true for the engine's " +
          'verbatim canonical bytes.',
      )
    }
  }

  // 4. The outcome ladders. In answer mode they are REPLACED by the paired
  //    block (the only step in this file that derives rather than removes, and
  //    it keeps every count beside its derived rate: see answer.ts). Otherwise
  //    the 0.4.0 behaviour stands and only empty rungs go.
  const paired = opts.answer
    ? pairOutcomes(body.outcomes_summary, baselineSummary ?? body.baseline)
    : null
  if (paired) {
    const summary = body.outcomes_summary
    body.outcomes_summary = {
      ...(isRecord(summary) && typeof summary.note === 'string' ? { note: summary.note } : {}),
      ...(isRecord(summary) && Array.isArray(summary.occurrences_per_day)
        ? { occurrences_per_day: summary.occurrences_per_day }
        : {}),
      metrics: paired.metrics,
    }
    // A baseline carried INSIDE the body has now been folded into the rungs
    // above, so its duplicate ladder goes; its scope and counts stay.
    if (isRecord(body.baseline) && isRecord(body.baseline.metrics)) {
      const { metrics: _metrics, ...rest } = body.baseline
      body.baseline = rest
    }
    notes.push(answerNote(paired))
  } else {
    // Not answerable (no threshold ladder in this body, or full_outcomes was
    // asked for): degrade to the 0.4.0 removal rather than doing nothing.
    const rungs = trimZeroRungs(body.outcomes_summary) + trimZeroRungs(body.baseline)
    if (rungs > 0) {
      notes.push(
        `outcomes_summary: ${rungs} empty threshold rung(s) omitted. The rung grid is closed and ` +
          'published by list_features, so an absent rung is a stated zero. Every non-zero count, ' +
          'absent tally and denominator is untouched.',
      )
    }
  }

  if (notes.length === 0) return null
  return { bodyText: JSON.stringify(body), notes }
}

/**
 * The same rung trim for a standalone summary body (the unconditional
 * same-scope reference). Returns null when nothing is removed.
 */
export function leanSummaryBody(bodyText: string, foldedIntoAnswer = false): LeanResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const body = parsed as Record<string, unknown>

  // In answer mode every unconditional rate the caller can act on is already
  // stated beside its matched rate, so this ladder is a second copy. Its
  // scope, counts, notes and reproducibility key stay, because those are the
  // provenance of the numbers folded above and are not restated there.
  if (foldedIntoAnswer) {
    let folded = 0
    for (const field of ['baseline', 'outcomes_summary']) {
      const container = body[field]
      if (isRecord(container) && isRecord(container.metrics)) {
        folded += Object.keys(container.metrics).length
        const { metrics: _metrics, occurrences_per_day: _perDay, ...rest } = container
        body[field] = rest
      }
    }
    if (folded === 0) return null
    return {
      bodyText: JSON.stringify(body),
      notes: [
        `reference: the ladder for ${folded} metric(s) is omitted because every unconditional ` +
          'rate is already stated as baseline_rate beside its matched rate in the answer block ' +
          'above, over these same symbols and this same window. Scope, counts, notes and the ' +
          "reproducibility key are untouched. Pass full_outcomes: true for the reference's own " +
          'full ladder.',
      ],
    }
  }

  const rungs = trimZeroRungs(body.baseline) + trimZeroRungs(body.outcomes_summary)
  // The unconditional population's per-day histogram answers no question the
  // reference is here for (concentration belongs to the MATCHED set, whose own
  // occurrences_per_day is untouched), and it is a long array.
  let perDay = 0
  for (const container of [body.baseline, body.outcomes_summary]) {
    if (isRecord(container) && Array.isArray(container.occurrences_per_day)) {
      perDay += container.occurrences_per_day.length
      delete container.occurrences_per_day
    }
  }
  if (rungs === 0 && perDay === 0) return null
  const notes: string[] = []
  if (rungs > 0) {
    notes.push(
      `${rungs} empty threshold rung(s) omitted; every non-zero count and denominator is untouched.`,
    )
  }
  if (perDay > 0) {
    notes.push(
      `the reference's own occurrences_per_day (${perDay} day(s)) omitted; day concentration is a ` +
        "property of the matched set, and the matched set's histogram is untouched.",
    )
  }
  return { bodyText: JSON.stringify(body), notes: [`reference: ${notes.join(' ')}`] }
}

/**
 * Back-compatible zero-count-only projection, kept because it is the exact
 * behaviour full_rows/rows callers get when they ask for every row: drop the
 * stated zeros in counts_by_symbol and nothing else.
 */
export function compactScanBody(
  bodyText: string,
): { bodyText: string; omitted: number } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const body = parsed as Record<string, unknown>
  const counts = body.counts_by_symbol
  if (!isRecord(counts)) return null
  const kept: Record<string, unknown> = {}
  let omitted = 0
  for (const [sym, value] of Object.entries(counts)) {
    const total = isRecord(value) ? value.total_matching : undefined
    if (total === 0) {
      omitted += 1
      continue
    }
    kept[sym] = value
  }
  if (omitted === 0) return null
  return { bodyText: JSON.stringify({ ...body, counts_by_symbol: kept }), omitted }
}

/**
 * The grammar registry projection (2026-09-04 audit finding 3). list_features
 * is the mandatory grounding call and returns the whole closed grammar with
 * every feature's prose: about 12k tokens, paid on every cold start, with no
 * way to ask for less. The prose is what an agent needs least once it holds
 * the ids, and a repair loop usually needs one family, not the registry.
 *
 * Same discipline as the scan projection: only ever REMOVE, state every
 * removal, and keep the closed parts of the grammar (operators, window,
 * sequence, limits, sort fields, error codes, notes) intact - they are what
 * makes a document valid, and they are small.
 */
export interface RegistryProjection {
  /** exact ids to keep; a bare name is matched against feature.<name> too */
  featureIds?: string[]
  /** case-insensitive substring over feature id and description */
  search?: string
  /** drop per-feature prose and the instrument examples */
  compact?: boolean
}

export function projectRegistry(raw: string, opts: RegistryProjection): LeanResult | null {
  const wants = (opts.featureIds?.length ?? 0) > 0 || !!opts.search || opts.compact === true
  if (!wants) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const doc = parsed as Record<string, unknown>
  const features = doc.features
  if (!isRecord(features)) return null
  const notes: string[] = []
  const total = Object.keys(features).length

  let kept: [string, unknown][] = Object.entries(features)
  if (opts.featureIds?.length) {
    const wanted = new Set<string>()
    for (const id of opts.featureIds) {
      const trimmed = id.trim()
      if (!trimmed) continue
      wanted.add(trimmed)
      if (!trimmed.includes('.')) wanted.add(`feature.${trimmed}`)
    }
    kept = kept.filter(([id]) => wanted.has(id))
    const missing = [...wanted].filter(
      (id) => id.includes('.') && !Object.prototype.hasOwnProperty.call(features, id),
    )
    if (missing.length > 0) {
      notes.push(
        `features: no such id in this feature_version: ${missing.join(', ')}. The registry is a ` +
          'closed grammar - call list_features without feature_ids (or with search) rather than ' +
          'inventing a field.',
      )
    }
  }
  if (opts.search) {
    const needle = opts.search.toLowerCase()
    kept = kept.filter(([id, value]) => {
      if (id.toLowerCase().includes(needle)) return true
      const description = isRecord(value) ? value.description : undefined
      return typeof description === 'string' && description.toLowerCase().includes(needle)
    })
  }

  let strippedProse = 0
  const projected: Record<string, unknown> = {}
  for (const [id, value] of kept) {
    if (opts.compact && isRecord(value) && typeof value.description === 'string') {
      const { description: _description, ...rest } = value
      strippedProse += 1
      projected[id] = rest
      continue
    }
    projected[id] = value
  }
  doc.features = projected

  if (kept.length < total) {
    notes.push(
      `features: ${total - kept.length} of ${total} feature(s) omitted by your filter. The ` +
        'grammar is closed: a field absent from THIS projection may still exist. Call ' +
        'list_features with no filter before concluding a feature does not exist.',
    )
  }
  if (strippedProse > 0) {
    notes.push(
      `features[].description: prose omitted on ${strippedProse} feature(s); dtype, range, unit, ` +
        'observation_scope and implemented are untouched. Drop compact to read what a feature ' +
        'actually measures before choosing a threshold.',
    )
  }
  if (opts.compact && doc.instrument_examples !== undefined) {
    delete doc.instrument_examples
    notes.push(
      'instrument_examples omitted; list_instruments is the authoritative universe and coverage read.',
    )
  }
  if (notes.length === 0) return null
  return { bodyText: JSON.stringify(doc), notes }
}

/* ── The outcome-first door ──────────────────────────────────────────
   outcome_first_result.v1 (task outcome-first-door; the engine side is
   internal/research/outcome_first.go). Its shape is rows x offsets: one
   row per band per lead-up offset, each carrying a whole setup-first
   research_query.v2 rerun document, which is roughly 150 rows and the
   overwhelming majority of the bytes.

   The SAME discipline as the scan projection applies, and the rules the
   audit set are worth restating because this body is where a slip would
   be easiest: response-side only, only ever REMOVE, never touch a
   denominator, state every removal, and scope the ETag so one
   projection can never 304 against another.

   What is removed, and why it is safe to remove:
    - the row TAIL beyond the top 12 in the bytes' OWN order. That order
      is excess descending and is the engine's, not ours: this reorders
      nothing and ranks nothing. The note states the count and says the
      order is display order.
    - each kept row's setup_first_rerun DOCUMENT, keeping its hash. The
      row still carries field, operator, value and the reader sentence,
      which is the clause the document tests, so nothing about what the
      row says is lost; what is lost is the ability to hand the document
      straight to run_scan, and full_rows: true returns it.
    - the sampled EPISODE list. population.sampled_episodes still states
      how many were read and by what rule, and replays carry the three
      the answer contract asks for.
    - the canonical query echo, which the tool already prints verbatim
      as its own block above the body, and whose hash is in
      reproducibility_key.

   What is NEVER removed: reproducibility_key, target, population,
   feasibility (including its floor and its reasons), pointed, offsets,
   replays, notes, and unbanded_readings. The last one is a handful of
   short ids and is honesty-bearing in the same way notes are (it names
   the readings that were counted in nothing), so it stays whole rather
   than saving a few hundred bytes. */

/** Rows kept by default. Twelve is enough to read the shape of the
 *  lead-up across all five offsets without carrying the whole grid. */
export const DEFAULT_OUTCOME_FIRST_ROWS = 12

export interface OutcomeFirstLeanOptions {
  /** rows to keep, in the bytes' own order */
  rows: number
  /** keep every row AND its whole setup-first rerun document */
  fullRows: boolean
}

export const DEFAULT_OUTCOME_FIRST_LEAN: OutcomeFirstLeanOptions = {
  rows: DEFAULT_OUTCOME_FIRST_ROWS,
  fullRows: false,
}

/** The ETag tag for one outcome-first projection. Every knob that
 *  changes the bytes is in here. */
export function outcomeFirstProjectionTag(opts: OutcomeFirstLeanOptions): string {
  if (opts.fullRows) return `${COMPACT_TAG}.of.full`
  return `${COMPACT_TAG}.of.r${Math.max(0, Math.trunc(opts.rows))}`
}

export function leanOutcomeFirstBody(
  bodyText: string,
  opts: OutcomeFirstLeanOptions = DEFAULT_OUTCOME_FIRST_LEAN,
): LeanResult | null {
  if (opts.fullRows) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const body = parsed as Record<string, unknown>
  const notes: string[] = []

  // 1. The row tail, in the engine's own order.
  if (Array.isArray(body.rows)) {
    const total = body.rows.length
    const limit = Math.max(0, Math.trunc(opts.rows))
    const kept = body.rows.slice(0, limit)
    let strippedDocs = 0
    const rows = kept.map((row) => {
      if (!isRecord(row) || row.setup_first_rerun === undefined) return row
      const { setup_first_rerun: _rerun, ...rest } = row
      strippedDocs += 1
      return rest
    })
    if (total > kept.length) {
      notes.push(
        `rows: ${total - kept.length} of ${total} row(s) omitted, keeping the first ` +
          `${kept.length} in the body's OWN order. That order is the gap between the two counted ` +
          'shares, descending; it is the order the engine wrote and nothing here reorders or ' +
          'ranks anything. A row is not a rule, a candidate or a finding. Pass full_rows: true ' +
          'for every row.',
      )
    }
    if (strippedDocs > 0) {
      notes.push(
        `rows[].setup_first_rerun: the document is omitted on ${strippedDocs} row(s); its ` +
          'setup_first_rerun_hash is untouched, and each row still carries the field, operator, ' +
          'value and sentence that document tests. Pass full_rows: true to get the exact ' +
          'research_query.v2 documents so run_scan can re-test a row setup first, which is where ' +
          'the honest rate lives.',
      )
    }
    if (rows.length !== total || strippedDocs > 0) body.rows = rows
  }

  // 2. The sampled episode list. The counts that describe it stay.
  if (Array.isArray(body.episodes) && body.episodes.length > 0) {
    const episodes = body.episodes.length
    delete body.episodes
    notes.push(
      `episodes: the ${episodes} sampled entr(ies) omitted. population.sampled_episodes and ` +
        'population.sample_rule still state how many were read and by what rule, both untouched, ' +
        'and replays carries the earliest, middle and latest of them with their coordinates.',
    )
  }

  // 3. The canonical query echo, which the tool prints above the body.
  if (body.query !== undefined) {
    delete body.query
    notes.push(
      'query: the canonical request echo omitted, because the tool prints the exact document it ' +
        'sent as its own block above this body, and reproducibility_key.canonical_query_hash ' +
        'names those same bytes.',
    )
  }

  if (notes.length === 0) return null
  return { bodyText: JSON.stringify(body), notes }
}
