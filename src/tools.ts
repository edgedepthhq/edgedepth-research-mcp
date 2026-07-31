/**
 * tools - the one tool core (design doc RESEARCH_API_MCP_DESIGN
 * 2026-07-18 section 3.3, FROZEN). Ten read-only tools, each a thin
 * wrapper over the phase-A/B REST surface. No definitions, no alerts,
 * no publish - read-only v1.
 *
 * Contract discipline enforced here:
 *  - result bytes pass through VERBATIM (passthrough()); the API's
 *    canonical bytes and its error bodies (422 {errors:[{code}]} and the
 *    transport {error,code} envelope) reach the agent unchanged, so the
 *    contract error codes stay machine-actionable;
 *  - the registry is the grammar source (list_features); tool input
 *    schemas are NOT a hand-written mirror of the grammar - run_scan
 *    takes an opaque document and the frozen validator judges it;
 *  - the confirm gate is expressed as tool-contract TEXT (run_scan
 *    description), verbatim from the design doc.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { apiRequest, type ApiResponse } from './apiClient.js'
import { getRegistry } from './registry.js'

export interface ToolContext {
  apiBase: string
  /** resolves the caller key per request (env for stdio, header for HTTP) */
  getKey: () => string | undefined
}

type TextBlock = { type: 'text'; text: string }
type ToolResult = { content: TextBlock[]; isError?: boolean }

/** The confirm gate, translated for agents - VERBATIM from design 3.3. */
export const CONFIRM_GATE_CONTRACT =
  'Echo the exact document and the reproducibility key to the user with the result. ' +
  'Rates come from outcomes_summary over all occurrences; page rows are examples, never ' +
  'the denominator. Outcome fields cannot be filtered; expect OUTCOME_IN_PREDICATE if tried.'

function text(t: string): TextBlock {
  return { type: 'text', text: t }
}

/**
 * Deterministic client-serialization repair. Some MCP clients erase union
 * types from the input schema and send every argument as a string: 0.8
 * arrives as "0.8" and ["btcusdt","ethusdt"] as one stringified array,
 * which the API correctly refuses (INVALID_VALUE) - the tool becomes
 * uncallable for numeric fields. Only unambiguous JSON is repaired:
 * a strict number string parses to a number, a JSON array parses to an
 * array (elements repaired recursively). Enum values like "critical"
 * pass through untouched. Never guesses.
 */
export function coerceJsonish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(coerceJsonish)
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(coerceJsonish)
    } catch {
      /* not JSON - leave the string untouched */
    }
  }
  return value
}

function noKey(): ToolResult {
  return {
    isError: true,
    content: [
      text(
        'No EdgeDepth API key. For the local (stdio) server set EDGEDEPTH_API_KEY; for the ' +
          'remote server send Authorization: Bearer edk_live_... . Create a key at ' +
          'https://app.edgedepth.com/account#api-keys (scope research:read; research:interpret ' +
          'for interpret_prose).',
      ),
    ],
  }
}

/**
 * Projection-scoped ETags (2026-07-27 stress P1-2). The API's universe ETag
 * names the FULL canonical bytes; the summary/symbols projections are
 * different representations. Emitting the raw ETag on a projection let a
 * summary-holding caller revalidate `full: true` and be told 304 "identical
 * result" for a body 500x larger than the one it held. Projections therefore
 * carry the base ETag with a projection tag inside the quotes; a raw ETag
 * against a projection (or a projection ETag against full: true) simply never
 * matches, so it fetches instead of lying.
 */
export function scopeEtag(etag: string | undefined, tag: string): string | undefined {
  if (!etag) return undefined
  const match = etag.match(/^(W\/)?"(.*)"$/)
  if (!match) return `${etag}+${tag}`
  return `${match[1] ?? ''}"${match[2]}+${tag}"`
}

/** Strips a projection tag from an inbound If-None-Match. Returns the base
 *  ETag ONLY when the tag matches this request's projection; a raw or
 *  wrong-projection value returns undefined (never forwarded upstream). */
export function unscopeEtag(inm: string | undefined, tag: string): string | undefined {
  if (!inm) return undefined
  const match = inm.match(/^(W\/)?"(.*)\+([^+"]+)"$/)
  if (!match || match[3] !== tag) return undefined
  return `${match[1] ?? ''}"${match[2]}"`
}

/** Tiny deterministic FNV-1a hex hash - distinguishes symbols-projection
 *  ETags by their requested symbol set without any dependency. */
export function fnv1a8(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Compact metadata line: repro + credit headers, kept SEPARATE from the
 *  verbatim body block so the result bytes are never touched. */
function metaLine(res: ApiResponse): string {
  const h = res.headers
  const parts: string[] = [`status=${res.status}`]
  if (h.cache) parts.push(`cache=${h.cache}`)
  if (h.etag) parts.push(`etag=${h.etag}`)
  if (h.canonicalQueryHash) parts.push(`canonical_query_hash=${h.canonicalQueryHash}`)
  if (h.datasetRevision) parts.push(`dataset_revision=${h.datasetRevision}`)
  if (h.featureVer) parts.push(`feature_version=${h.featureVer}`)
  if (h.rulebookVersion) parts.push(`rulebook_version=${h.rulebookVersion}`)
  if (h.creditsCharged !== undefined) parts.push(`credits_charged=${h.creditsCharged}`)
  if (h.creditsRemaining !== undefined) parts.push(`credits_remaining=${h.creditsRemaining}`)
  if (h.retryAfter !== undefined) parts.push(`retry_after=${h.retryAfter}`)
  return '[edgedepth] ' + parts.join(' ')
}

/** Verbatim passthrough: a leading meta line, then the API body bytes
 *  untouched. 304 carries no body (a free revalidation). isError tracks
 *  the HTTP status so contract error bodies surface as tool errors. */
function passthrough(res: ApiResponse, on304?: string): ToolResult {
  if (res.notModified) {
    return {
      content: [
        text(
          `${metaLine(res)}\n304 Not Modified: identical result, nothing spent.` +
            (on304 ? ` ${on304}` : ''),
        ),
      ],
    }
  }
  return { content: [text(metaLine(res)), text(res.bodyText)], isError: !res.ok }
}

/** Render authenticated web replay handoffs from the additive v4
 * representative block without changing the canonical body block. */
function replayHandoffs(res: ApiResponse): TextBlock | null {
  if (!res.ok || !res.bodyText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(res.bodyText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const body = parsed as Record<string, unknown>
  const representatives = Array.isArray(body.representatives) ? body.representatives : []
  const key = body.reproducibility_key as Record<string, unknown> | undefined
  const hash = typeof key?.canonical_query_hash === 'string' ? key.canonical_query_hash : ''
  const links: string[] = []
  if (body.query && typeof body.query === 'object') {
    links.push(
      'definition_handoff: https://app.edgedepth.com/research?rq=' +
        encodeURIComponent(JSON.stringify(body.query)),
    )
  }
  for (const value of representatives) {
    if (!value || typeof value !== 'object') continue
    const representative = value as Record<string, unknown>
    const replay = representative.replay as Record<string, unknown> | undefined
    if (!replay || typeof replay.symbol !== 'string') continue
    const from = Date.parse(String(replay.from ?? ''))
    const to = Date.parse(String(replay.to ?? ''))
    const seek = Date.parse(String(replay.seek ?? ''))
    if (![from, to, seek].every(Number.isFinite)) continue
    const params = new URLSearchParams({
      replay: replay.symbol,
      from: String(from),
      to: String(to),
      t: String(seek),
    })
    if (hash) params.set('marker', `rq:${hash.slice(0, 8)}`)
    links.push(
      `${String(representative.id ?? 'representative')}: ` +
        `https://app.edgedepth.com/terminal?${params.toString()}`,
    )
  }
  if (links.length === 0) return null
  return text(
    'Authenticated web handoffs (save/arm require explicit confirmation; playback stays outside MCP):\n' +
      links.join('\n'),
  )
}

/**
 * Scan-body compaction (2026-07-30 agent-context economy). A full-universe
 * scan's counts_by_symbol enumerates EVERY instrument including zeros (660+
 * entries), so even page.limit 1 returns ~150 KB, most of it the literal
 * string `"total_matching":0` repeated per symbol. Default projection: entries
 * whose total_matching is 0 are dropped and COUNTED in a trailing note block;
 * counts, outcomes_summary, the reproducibility key, rows and representatives
 * are untouched. The ETag is projection-scoped (same discipline as the
 * universe summary) so a compact ETag can never 304 against the full bytes.
 * full_counts: true restores the engine's verbatim canonical bytes.
 */
export const COMPACT_TAG = 'nz'

export function compactScanBody(
  bodyText: string,
): { bodyText: string; omitted: number } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const body = parsed as Record<string, unknown>
  const counts = body.counts_by_symbol
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null
  const kept: Record<string, unknown> = {}
  let omitted = 0
  for (const [sym, value] of Object.entries(counts as Record<string, unknown>)) {
    const total = (value as Record<string, unknown> | null)?.total_matching
    if (total === 0) {
      omitted += 1
      continue
    }
    kept[sym] = value
  }
  if (omitted === 0) return null
  return { bodyText: JSON.stringify({ ...body, counts_by_symbol: kept }), omitted }
}

/** passthrough, minus the zero-count counts_by_symbol entries. Falls back to
 *  verbatim on parse failure, non-JSON, error bodies, or when nothing would
 *  be omitted, so the projection can only ever REMOVE stated zeros. */
function compactPassthrough(res: ApiResponse, on304?: string): ToolResult {
  const scopedHeaders = { ...res.headers, etag: scopeEtag(res.headers.etag, COMPACT_TAG) }
  if (res.notModified) return passthrough({ ...res, headers: scopedHeaders }, on304)
  if (!res.ok || !res.bodyText) return passthrough(res, on304)
  const compact = compactScanBody(res.bodyText)
  if (!compact) return passthrough(res, on304)
  const result = passthrough(
    { ...res, bodyText: compact.bodyText, headers: scopedHeaders },
    on304,
  )
  result.content.push(
    text(
      `counts_by_symbol: ${compact.omitted} zero-count instrument(s) omitted from this ` +
        'projection. Absence here means 0 matches, not missing data; totals and ' +
        'outcomes_summary are computed by the engine and unaffected. Pass full_counts: true ' +
        "for the engine's verbatim canonical bytes.",
    ),
  )
  return result
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const

/** Registers the ten read-only tools on an McpServer. */
export function registerResearchTools(server: McpServer, ctx: ToolContext): void {
  // 1. list_features - the grounding tool.
  server.registerTool(
    'list_features',
    {
      title: 'List research features (the grammar registry)',
      description:
        'Return the closed registry for the pinned feature_version: every feature id with its ' +
        'dtype and range, the operators, window aggregates and durations, sequence rules, limits, ' +
        'sort fields, and the machine-readable validation and transport error-code lists. Call ' +
        'this FIRST: a document that only uses ids from here cannot invent field names. The ' +
        'registry is ETag-revalidated on every read, so additive feature ids become visible to ' +
        'long-running agents without inventing or hard-coding fields.',
      annotations: READ_ONLY,
    },
    async () => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const reg = await getRegistry(ctx.apiBase, key)
      if (!reg.ok) {
        return { content: [text(metaLine(reg.response)), text(reg.bodyText)], isError: true }
      }
      return { content: [text(metaLine(reg.response)), text(reg.raw)] }
    },
  )

  // 2. list_instruments - authoritative manifest-derived universe.
  // The full universe body is ~360 KB (677 instruments), which overflows
  // most MCP clients' result caps and an agent's context. The default is
  // therefore a deterministic SUMMARY projection; symbols: [...] returns
  // the full canonical records for just those instruments; full: true is
  // the verbatim byte passthrough (the ETag belongs to that form).
  server.registerTool(
    'list_instruments',
    {
      title: 'List research instruments and coverage',
      description:
        'Return the authoritative feature-store universe derived from complete manifests. ' +
        'DEFAULT: a compact deterministic summary (coverage window, dataset revision, instrument ' +
        'counts by availability status) - the full body is ~360 KB and overflows agent contexts. ' +
        'Pass symbols: ["btcusdt", ...] for the complete canonical records of specific ' +
        'instruments (per-instrument coverage, present/excluded partition counts, provenance, ' +
        'replay entitlement). Pass full: true for the verbatim canonical bytes of the whole ' +
        'universe. Excluded symbol-days remain visible as universe membership. NVDAUSDT and ' +
        'QQQUSDT are Binance USDT-M perpetuals referencing TradFi assets, not direct Nasdaq ' +
        'data. This read is deterministic and free in every mode.',
      inputSchema: {
        symbols: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'Return only the full canonical records of these instruments (lowercase perps, e.g. ' +
              '["btcusdt","ethusdt"]). A string-encoded array is repaired deterministically.',
          ),
        full: z
          .boolean()
          .optional()
          .describe('True for the verbatim ~360 KB canonical universe bytes.'),
        if_none_match: z
          .string()
          .optional()
          .describe(
            'Optional ETag to revalidate an unchanged result for free. ETags are ' +
              'projection-scoped: pass back the ETag this tool returned for the SAME mode ' +
              '(full/summary/symbols). An ETag from a different mode never matches.',
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ symbols, full, if_none_match }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const requested = coerceJsonish(symbols)
      const wanted =
        requested !== undefined
          ? (Array.isArray(requested) ? requested : [requested]).map((entry) =>
              String(entry).toLowerCase(),
            )
          : null
      // Projection-scoped ETag discipline: the raw API ETag names the full
      // bytes only. Projections tag it; inbound values only revalidate when
      // their tag matches this request's projection (see scopeEtag).
      const projectionTag =
        full === true
          ? null
          : wanted !== null
            ? `symbols:${fnv1a8(JSON.stringify([...wanted].sort()))}`
            : 'summary'
      const res = await apiRequest(ctx.apiBase, {
        method: 'GET',
        path: '/universe',
        key,
        ifNoneMatch:
          projectionTag === null ? if_none_match : unscopeEtag(if_none_match, projectionTag),
      })
      const scoped: ApiResponse =
        projectionTag === null
          ? res
          : { ...res, headers: { ...res.headers, etag: scopeEtag(res.headers.etag, projectionTag) } }
      if (full === true || res.notModified || res.status !== 200) return passthrough(scoped)

      interface UniverseInstrument {
        symbol?: string
        availability_status?: string
        feature_availability?: { present_partition_days?: number; excluded_partition_days?: number }
      }
      let body: {
        universe_encoding?: string
        feature_version?: string
        dataset_revision?: string
        coverage?: unknown
        instruments?: UniverseInstrument[]
        notes?: string[]
      }
      try {
        body = JSON.parse(res.bodyText) as typeof body
      } catch {
        return passthrough(scoped) // unparseable: fall back to verbatim bytes
      }
      const instruments = Array.isArray(body.instruments) ? body.instruments : []

      if (wanted !== null) {
        const matched = instruments.filter(
          (instrument) => instrument.symbol && wanted.includes(instrument.symbol),
        )
        const missing = wanted.filter(
          (symbolName) => !matched.some((instrument) => instrument.symbol === symbolName),
        )
        const projection = {
          projection: 'symbols',
          note:
            'Projection of the canonical universe body (same dataset_revision); pass full: true ' +
            'for the verbatim bytes.',
          universe_encoding: body.universe_encoding,
          feature_version: body.feature_version,
          dataset_revision: body.dataset_revision,
          coverage: body.coverage,
          requested: wanted,
          not_in_universe: missing,
          instruments: matched,
          notes: body.notes,
        }
        return { content: [text(metaLine(scoped)), text(JSON.stringify(projection))] }
      }

      const byStatus: Record<string, number> = {}
      let presentDaysMin: number | null = null
      let presentDaysMax: number | null = null
      let withExcludedDays = 0
      for (const instrument of instruments) {
        const status = instrument.availability_status ?? 'unknown'
        byStatus[status] = (byStatus[status] ?? 0) + 1
        const present = instrument.feature_availability?.present_partition_days
        if (typeof present === 'number') {
          presentDaysMin = presentDaysMin === null ? present : Math.min(presentDaysMin, present)
          presentDaysMax = presentDaysMax === null ? present : Math.max(presentDaysMax, present)
        }
        if ((instrument.feature_availability?.excluded_partition_days ?? 0) > 0) withExcludedDays++
      }
      const summary = {
        projection: 'summary',
        note:
          'Deterministic summary of the canonical universe body (same dataset_revision). Pass ' +
          'symbols: [...] for specific instruments or full: true for the verbatim ~360 KB bytes.',
        universe_encoding: body.universe_encoding,
        feature_version: body.feature_version,
        dataset_revision: body.dataset_revision,
        coverage: body.coverage,
        instrument_count: instruments.length,
        by_availability_status: byStatus,
        present_partition_days: { min: presentDaysMin, max: presentDaysMax },
        instruments_with_excluded_days: withExcludedDays,
        notes: body.notes,
      }
      return { content: [text(metaLine(scoped)), text(JSON.stringify(summary))] }
    },
  )

  // 3. interpret_prose - proposal, never a result.
  server.registerTool(
    'interpret_prose',
    {
      title: 'Interpret prose into a proposed research document',
      description:
        'Turn a plain-language market question into a PROPOSED research_query.v2 document. The ' +
        'result is a proposal, not a result: it is labeled proposal:true and is never executed ' +
        'here. Show the document (plus any unsupported[] stand-ins and clarify notices) to the ' +
        'user, then call run_scan with the document to execute. That second call is the confirm ' +
        'gate. Requires the research:interpret scope and is metered separately (each call spends ' +
        'provider money).',
      inputSchema: {
        language: z
          .string()
          .min(1)
          .max(500)
          .describe(
            'The market question in plain language, e.g. "vpin above 0.7 then a liquidation ' +
              'surge within 30m on majors last week".',
          ),
        time_zone: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe(
            'Optional IANA identity used only to interpret local calendar language, for example ' +
              'Asia/Bangkok. Omit to use the public API default, UTC. Explicit prose such as ' +
              '"June 7 UTC" overrides this default. Abbreviations such as CST are rejected.',
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ language, time_zone }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/interpret',
        key,
        body: time_zone === undefined ? { language } : { language, time_zone },
      })
      return passthrough(res)
    },
  )

  // 3. run_scan - THE product. Document-only; confirm gate as contract text.
  server.registerTool(
    'run_scan',
    {
      title: 'Run a research scan (record_occurrences)',
      description:
        'Execute a research_query.v2 document over the deterministic engine and return counts, ' +
        'denominators, outcomes_summary, the reproducibility key and page-1 rows as the engine\'s ' +
        'canonical bytes. outcomes_summary carries forward outcomes over FOUR horizons per ' +
        'occurrence: 30m return, 1h MFE/MAE, and 4h and 24h return + MFE/MAE ' +
        '(record_result.v3), with a closed threshold ladder to +/-20 pct - "how often did this ' +
        'setup reach +5% within 24h, with how much drawdown" is answered by the summary over ' +
        'ALL occurrences. Completeness caveat: an occurrence closer to the end of recorded ' +
        'data than a horizon has that horizon ABSENT (counted in the absent tally, never a ' +
        'truncated or implied-zero outcome) - quote present, not total_matching, as the ' +
        'denominator for any horizon rate. Document-only input: stated chips are the only ' +
        'input the scan path accepts (use interpret_prose first if you have prose, then ' +
        're-submit its document). CONTRACT (relay to the user): ' +
        CONFIRM_GATE_CONTRACT +
        ' sequence.within accepts 15m/30m/1h/4h/12h/24h and the matching ISO aliases; ' +
        'both normalize to canonical ISO before hashing. identity.symbol must be an exact ' +
        'lowercase Binance USDT-M perpetual symbol: case, whitespace and separators are rejected. ' +
        ' You may rerun freely: a rerun of the same document is served from cache ' +
        '(X-Research-Cache: hit), and reruns and 304 revalidations are free. SIZE: page rows ' +
        'carry full 33-feature setup vectors (~2 KB each); page.limit 50 returns ~120 KB, which ' +
        'can overflow an agent context. Counts, outcomes_summary and representatives are ' +
        'complete-result regardless of page size - set page.limit 1-5 unless you need row-level ' +
        'evidence, then page with next_page. PROJECTION: counts_by_symbol lists only ' +
        'instruments with at least one match; the number of zero-count instruments omitted is ' +
        'stated in a trailing note (absence = 0 matches, not missing data). Pass ' +
        "full_counts: true for the engine's verbatim canonical bytes with every zero entry.",
      inputSchema: {
        document: z
          .record(z.any())
          .describe(
            'A complete research_query.v2 document (target record_occurrences, stated chips ' +
              'only). Call list_features for the grammar; do not invent field names.',
          ),
        if_none_match: z
          .string()
          .optional()
          .describe(
            'An ETag from a previous run to revalidate: identical data answers 304 and spends ' +
              'nothing. Pass it back verbatim (it may be weak, W/"...").',
          ),
        full_counts: z
          .boolean()
          .optional()
          .describe(
            "True returns the engine's verbatim canonical bytes, including every zero-count " +
              'instrument in counts_by_symbol (~150 KB+ for universe scans). Default omits ' +
              'zero-count entries and states how many were omitted.',
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ document, if_none_match, full_counts }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/query',
        key,
        body: document,
        // Compact mode accepts BOTH its scoped ETag (unscoped upstream) and a
        // raw one: a raw 304 stays truthful here because the compact body is a
        // pure function of the full bytes. (Contrast the universe projections,
        // where a summary ETag revalidating full bytes WOULD lie - scans have
        // no such cross-request direction: full_counts forwards verbatim and a
        // scoped ETag never matches upstream.)
        ifNoneMatch: full_counts
          ? if_none_match
          : (unscopeEtag(if_none_match, COMPACT_TAG) ?? if_none_match),
      })
      const result = (full_counts ? passthrough : compactPassthrough)(
        res,
        'Re-run the document without If-None-Match to fetch the cached bytes (still free).',
      )
      const handoffs = replayHandoffs(res)
      if (handoffs) result.content.push(handoffs)
      return result
    },
  )

  // 4. next_page - cursor continuation for a prior run_scan.
  server.registerTool(
    'next_page',
    {
      title: 'Fetch the next page of a prior scan',
      description:
        'Continue a prior run_scan by re-sending the SAME document with the opaque cursor from ' +
        'the previous response. Never construct cursors. If X-Dataset-Revision changed since page ' +
        '1, the data under THIS document changed (e.g. the nightly append) and the result set ' +
        'with it: restart from page 1. The revision is scoped to the document\'s symbols and ' +
        'window - never compare revisions across different documents. Every page ' +
        'has its own ETag and remains free, including a continuation cache miss. Complete-result ' +
        'counts and summaries remain independent of the page rows. Same counts_by_symbol ' +
        'projection as run_scan; full_counts: true for verbatim bytes.',
      inputSchema: {
        document: z.record(z.any()).describe('The EXACT document from the prior run_scan.'),
        cursor: z
          .string()
          .min(16)
          .max(4096)
          .describe(
            'The opaque page.cursor from the previous response. Never construct or edit it.',
          ),
        if_none_match: z.string().optional().describe('Optional ETag to revalidate this page.'),
        full_counts: z
          .boolean()
          .optional()
          .describe(
            "True returns the engine's verbatim canonical bytes, including every zero-count " +
              'instrument in counts_by_symbol. Default omits zero-count entries.',
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ document, cursor, if_none_match, full_counts }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const doc: Record<string, unknown> = { ...(document as Record<string, unknown>) }
      const prevPage = (doc.page ?? {}) as Record<string, unknown>
      const limit = typeof prevPage.limit === 'number' ? prevPage.limit : 50
      doc.page = { limit, cursor }
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/query',
        key,
        body: doc,
        // Compact mode accepts BOTH its scoped ETag (unscoped upstream) and a
        // raw one: a raw 304 stays truthful here because the compact body is a
        // pure function of the full bytes. (Contrast the universe projections,
        // where a summary ETag revalidating full bytes WOULD lie - scans have
        // no such cross-request direction: full_counts forwards verbatim and a
        // scoped ETag never matches upstream.)
        ifNoneMatch: full_counts
          ? if_none_match
          : (unscopeEtag(if_none_match, COMPACT_TAG) ?? if_none_match),
      })
      return (full_counts ? passthrough : compactPassthrough)(res)
    },
  )

  // 5. snapshot_at - the from-a-moment read (not a scan, not metered).
  server.registerTool(
    'snapshot_at',
    {
      title: 'Read the registry as-of a moment',
      description:
        'Read the engine registry AS-OF the grid bucket containing a moment: every feature value, ' +
        'the closed-list window aggregates, and the fired rulebook ids, as the engine\'s canonical ' +
        'bytes. A read, never a scan (not credit-metered). Use it to turn one observed moment into ' +
        'candidate clauses, then run_scan to find every other time it looked like that. Selection ' +
        'discipline: if you picked the moment because it moved, expect the follow-up scan to ' +
        'deflate over all occurrences. That is the product working.',
      inputSchema: {
        symbol: z.string().describe('Lowercase perp, e.g. btcusdt.'),
        at: z
          .string()
          .describe('An RFC3339 datetime; the engine floors it to the grid bucket that contains it.'),
      },
      annotations: READ_ONLY,
    },
    async ({ symbol, at }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const res = await apiRequest(ctx.apiBase, {
        method: 'GET',
        path: '/snapshot',
        key,
        query: { symbol, t: at },
      })
      return passthrough(res)
    },
  )

  // 6. base_rate - one-clause count; the honesty primitive.
  server.registerTool(
    'base_rate',
    {
      title: 'Base rate of a single condition',
      description:
        'Measure how often a SINGLE stated condition is true over all eligible symbol-minute ' +
        'buckets in a window. base_rate_result.v1 reports predicate_true_buckets, ' +
        'predicate_false_buckets, eligible_buckets, absent_or_ineligible_buckets and true ' +
        'prevalence globally and per symbol. This is not a count of false-to-true occurrence ' +
        'episodes and computes no forward outcomes. Missing values are excluded from eligible, ' +
        'never coerced to false or zero. Deterministic and free, including reruns. field, ' +
        'operator and value must be grammar-valid (see list_features); expect the 422 contract ' +
        'code verbatim ' +
        'if not. The assembled one-clause document is echoed back so you can show the user ' +
        'exactly what ran.',
      inputSchema: {
        field: z
          .string()
          .describe('A feature.* or window.* id from list_features (e.g. feature.vpin).'),
        operator: z
          .string()
          .describe('gte, lte, between, eq or in - matching the field dtype.'),
        value: z
          .union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))])
          .describe(
            'A number for numeric fields (send a JSON number, not a quoted string), a label for ' +
              'enum fields, or an array for between/in. String-encoded numbers and arrays are ' +
              'repaired deterministically.',
          ),
        from: z.string().describe('Window start, RFC3339.'),
        to: z.string().describe('Window end, RFC3339.'),
        symbol: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'Optional scope: one lowercase perp or a JSON array of them. Omit for the whole ' +
              'universe. A string-encoded array is repaired deterministically.',
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ field, operator, value, from, to, symbol }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      // Read the pinned versions from the registry so the assembled
      // document mirrors the contract (never hand-written here).
      const reg = await getRegistry(ctx.apiBase, key)
      if (!reg.ok || !reg.doc) {
        return {
          content: [
            text(metaLine(reg.response)),
            text(reg.bodyText || 'The registry could not be read.'),
          ],
          isError: true,
        }
      }
      const d = reg.doc as {
        schema_version?: string
        normalization_version?: string
        feature_version?: string
      }
      // Repair client serialization drift BEFORE assembling the document:
      // "0.8" -> 0.8 and "[\"btcusdt\"]" -> ["btcusdt"], so eq-vs-in and the
      // dtype check run against what the caller meant, not the transport form.
      const coercedValue = coerceJsonish(value)
      const coercedSymbol = symbol === undefined ? undefined : coerceJsonish(symbol)
      const where: unknown[] = []
      if (coercedSymbol !== undefined) {
        where.push(
          Array.isArray(coercedSymbol)
            ? ['identity.symbol', 'in', coercedSymbol]
            : ['identity.symbol', 'eq', coercedSymbol],
        )
      }
      where.push(['times.anchor_time', 'between', [from, to]])
      where.push([field, operator, coercedValue])
      const document = {
        schema_version: d.schema_version,
        normalization_version: d.normalization_version,
        feature_version: d.feature_version,
        target: 'record_occurrences',
        where: { all: where },
        sort: ['times.anchor_time', 'desc'],
        page: { limit: 1, cursor: null },
      }
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/prevalence',
        key,
        body: document,
      })
      const result = passthrough(res)
      result.content.unshift(text('base_rate document (echo this to the user):\n' + JSON.stringify(document)))
      return result
    },
  )

  // 7. commonality - via the SHARED web endpoint (decision 7).
  server.registerTool(
    'commonality',
    {
      title: 'Commonality across N moments',
      description:
        'Given N (symbol, time) moments, return the DETERMINISTIC intersection: per registry field ' +
        'a verdict of agree, partial, disagree, quiet or absent, plus the survivorship and ' +
        'multiple-comparisons honesty framing IN the output. Never similarity search. A shared ' +
        'feature is a description of the chosen moments, not a prediction: to test any AGREE chip, ' +
        'follow up with base_rate over the same window.',
      inputSchema: {
        moments: z
          .array(z.object({ symbol: z.string(), at: z.string() }))
          .min(2)
          .describe('At least 2 moments: { symbol: lowercase perp, at: RFC3339 }.'),
      },
      annotations: READ_ONLY,
    },
    async ({ moments }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/commonality',
        key,
        body: { moments },
      })
      return passthrough(res)
    },
  )

  // 8. get_report - list or fetch citable public artifacts.
  server.registerTool(
    'get_report',
    {
      title: 'List reports or fetch one by hash',
      description:
        'Omit hash8 to list published archive and record reports with count, revision and explicit ' +
        'integrity status. Provide an 8-hex canonical hash to fetch one report: structurally ' +
        'generated title, author, the definition that ran (re-submittable to run_scan) and the ' +
        'result pinned at publish time. Invalid or withdrawn reports carry correction and ' +
        'successor metadata and must not be presented as healthy.',
      inputSchema: {
        hash8: z
          .string()
          .regex(/^[0-9a-f]{8}$/)
          .optional()
          .describe('Optional 8 lowercase hex canonical id. Omit to list public reports.'),
      },
      annotations: READ_ONLY,
    },
    async ({ hash8 }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const res = await apiRequest(ctx.apiBase, {
        method: 'GET',
        path: hash8 ? `/reports/${encodeURIComponent(hash8)}` : '/reports',
        key,
      })
      return passthrough(res)
    },
  )

  // 9. run_cohort - the §4.5.3 cohort comparison (cohort_result.v2).
  //    Same document-in / canonical-bytes-out contract as run_scan, but
  //    where-only and it returns TWO distributions to compare by eye.
  server.registerTool(
    'run_cohort',
    {
      title: 'Run a cohort comparison study (record_occurrences)',
      description:
        'Execute a research_query.v2 document as a predicate-complement comparison and return ' +
        'canonical cohort_result.v2 bytes: what followed the condition (the treatment side, byte-identical to ' +
        'the run_scan outcomes_summary for the same document) vs what followed every OTHER ' +
        'eligible bucket where the full predicate was FALSE (the baseline), each as the same ' +
        '30m/1h/4h/24h return + MFE/MAE summary over ALL occurrences. WHERE-ONLY: a sequence ' +
        'document is refused with 422 COHORT_SEQUENCE_UNSUPPORTED (run it as an ordinary run_scan ' +
        'instead). The bytes carry NO ratios, lift, averages or significance - you compare the ' +
        'two distributions yourself. This is not covariate matching: treatment/baseline identities, ' +
        'different observation units, dedupe difference, and denominator arithmetic ship in the ' +
        'result with three mandatory caveats. Both sides ' +
        'honour the completeness rule: an occurrence closer to the end of recorded data than a ' +
        'horizon has that horizon ABSENT - quote present, not total, as the denominator. ' +
        'CONTRACT (relay to the user): ' +
        CONFIRM_GATE_CONTRACT +
        ' A rerun of the same document is served from cache (X-Research-Cache: hit) in its own ' +
        'cohort namespace; reruns and 304 revalidations are free.',
      inputSchema: {
        document: z
          .record(z.any())
          .describe(
            'A complete research_query.v2 document (target record_occurrences, WHERE-ONLY - no ' +
              'sequence). Call list_features for the grammar; do not invent field names.',
          ),
        if_none_match: z
          .string()
          .optional()
          .describe(
            'An ETag from a previous cohort run to revalidate: identical data answers 304 and ' +
              'spends nothing. Pass it back verbatim (it may be weak, W/"...").',
          ),
        full_counts: z
          .boolean()
          .optional()
          .describe(
            "True returns the engine's verbatim canonical bytes, including any zero-count " +
              'instrument in counts_by_symbol. Default omits zero-count entries when present.',
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ document, if_none_match, full_counts }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/cohort',
        key,
        body: document,
        // Compact mode accepts BOTH its scoped ETag (unscoped upstream) and a
        // raw one: a raw 304 stays truthful here because the compact body is a
        // pure function of the full bytes. (Contrast the universe projections,
        // where a summary ETag revalidating full bytes WOULD lie - scans have
        // no such cross-request direction: full_counts forwards verbatim and a
        // scoped ETag never matches upstream.)
        ifNoneMatch: full_counts
          ? if_none_match
          : (unscopeEtag(if_none_match, COMPACT_TAG) ?? if_none_match),
      })
      return (full_counts ? passthrough : compactPassthrough)(
        res,
        'Re-run the document without If-None-Match to fetch the cached cohort bytes (still free).',
      )
    },
  )
}
