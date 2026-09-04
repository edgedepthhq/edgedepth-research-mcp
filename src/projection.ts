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
}

export const DEFAULT_LEAN: LeanOptions = {
  rows: DEFAULT_ROWS,
  fullRows: false,
  symbols: DEFAULT_SYMBOLS,
}

/**
 * The ETag tag for one projection. Every knob that changes the bytes is in
 * here, so revalidation can only ever match the same representation.
 */
export function projectionTag(opts: LeanOptions): string {
  const parts = [COMPACT_TAG, `r${Math.max(0, Math.trunc(opts.rows))}`]
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
export function leanScanBody(bodyText: string, opts: LeanOptions = DEFAULT_LEAN): LeanResult | null {
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

  // 4. Empty ladder rungs, in the result's own summary and in any baseline
  //    summary carried inside the same body.
  const rungs = trimZeroRungs(body.outcomes_summary) + trimZeroRungs(body.baseline)
  if (rungs > 0) {
    notes.push(
      `outcomes_summary: ${rungs} empty threshold rung(s) omitted. The rung grid is closed and ` +
        'published by list_features, so an absent rung is a stated zero. Every non-zero count, ' +
        'absent tally and denominator is untouched.',
    )
  }

  if (notes.length === 0) return null
  return { bodyText: JSON.stringify(body), notes }
}

/**
 * The same rung trim for a standalone summary body (the unconditional
 * same-scope reference). Returns null when nothing is removed.
 */
export function leanSummaryBody(bodyText: string): LeanResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const body = parsed as Record<string, unknown>
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
