/**
 * tools - the one tool core (design doc RESEARCH_API_MCP_DESIGN
 * 2026-07-18 section 3.3, FROZEN). Twelve research tools, each a thin
 * wrapper over the phase-A/B REST surface. No definitions, no alerts,
 * no publish - research-only v1.
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
import {
  COMPACT_TAG,
  DEFAULT_OUTCOME_FIRST_ROWS,
  DEFAULT_ROWS,
  DEFAULT_SYMBOLS,
  leanOutcomeFirstBody,
  leanScanBody,
  leanSummaryBody,
  outcomeFirstProjectionTag,
  projectRegistry,
  projectionTag,
  type LeanOptions,
  type OutcomeFirstLeanOptions,
} from './projection.js'
import { getRegistry } from './registry.js'
import {
  OUTCOME_HORIZONS,
  OUTCOME_LADDER,
  OUTCOME_LADDER_DOWN_MAX,
  nearestLadderRung,
  needsRegistry,
  registryFeatureIds,
  repairNote,
} from './repair.js'

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
 * The human half of a reading (2026-09-05). list_features answers what a
 * feature IS to a validator - dtype, bounds, scope - and nothing in the
 * result told a caller where the prose page for a person lives.
 *
 * The connection is a RULE, not a table: edgedepth-web generates one static
 * page per registry id at /research/readings/<slug>, and its readingSlug is
 * `id.replace(/^feature\./, '')` (edgedepth-web
 * src/lib/researchReadingPages.ts), enumerated from the same closed registry
 * this tool returns. So the URL is derivable from any id list_features can
 * emit, including ids added later, with no list to keep in sync here.
 *
 * It is emitted as its OWN text block and as one line of the server
 * instructions - never as a field inside the registry bytes. Those bytes are
 * the API's canonical grammar document, passed through verbatim, and the
 * projection contract is removals only; adding a key would break both.
 */
const READING_DOC_BASE = 'https://edgedepth.com/research/readings/'

/** The human reading page for a registry feature id. Deterministic. */
export function readingDocUrl(featureId: string): string {
  return READING_DOC_BASE + featureId.replace(/^feature\./, '')
}

/** One line, appended to every successful list_features read. Stays one line
 *  under compact: it is a template, not 58 URLs. */
export const READING_DOC_HINT =
  `human explanation of any feature id above: ${READING_DOC_BASE}` +
  '<id without the "feature." prefix> - one page per reading (feature.vpin -> ' +
  `${readingDocUrl('feature.vpin')}). Prose for a person; the bytes above remain the contract.`

/**
 * The same connection for an instrument, with the caveat that makes it
 * honest. edgedepth-web serves /research/symbols/<lowercase symbol> for a
 * market it is still recording: a baked nightly page, or an honest pending
 * page when the bake has not reached it. A market that STOPPED trading gets
 * notFound(), because the route's isRecordedSymbol asks for a candle inside
 * the last two days (edgedepth-web src/lib/marketEventsSource.ts).
 *
 * This universe deliberately keeps delisted markets (858 instruments, of
 * which 128 were delisted before the instruments stream began), and nothing
 * in the universe bytes distinguishes a delisted member from a live one:
 * coverage is the record's global range on every record, and
 * availability_status/present_partition_days describe the FEATURE store, not
 * whether the market still trades. So the caveat is stated rather than
 * guessed at - a hint that silently 404s on part of the universe would be
 * worse than none.
 */
const SYMBOL_DOC_BASE = 'https://edgedepth.com/research/symbols/'

/** The human market page for a symbol. Deterministic; see the caveat above. */
export function symbolDocUrl(symbol: string): string {
  return SYMBOL_DOC_BASE + symbol.toLowerCase()
}

/** One line, appended to every successful list_instruments read. */
export const SYMBOL_DOC_HINT =
  `human market page for a market still being recorded: ${SYMBOL_DOC_BASE}<symbol> (btcusdt -> ` +
  `${symbolDocUrl('btcusdt')}). A delisted market in this universe has no page and returns 404, ` +
  'so offer the link, never promise it.'

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
  if (h.baselineScopeHash) parts.push(`baseline_scope_hash=${h.baselineScopeHash}`)
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
  let oldestDays = 0
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
    // Replay reach is an ACCOUNT entitlement measured back from now, and the
    // scan window routinely reaches further back than any plan can play. A
    // handoff older than the caller's reach is refused (TIER_WINDOW) at the
    // web surface, so the age travels with the link and the agent can say so
    // instead of handing over a link that fails. The reach ladder itself is
    // NOT restated here: it is an account fact that changes without this
    // package, and a stale number would be worse than none.
    const ageDays = Math.floor((Date.now() - seek) / 86_400_000)
    const age = Number.isFinite(ageDays) && ageDays >= 0 ? ` [${ageDays}d back]` : ''
    links.push(
      `${String(representative.id ?? 'representative')}: ` +
        `https://app.edgedepth.com/terminal?${params.toString()}${age}`,
    )
    if (Number.isFinite(ageDays)) oldestDays = Math.max(oldestDays, ageDays)
  }
  if (links.length === 0) return null
  return text(
    'Authenticated web handoffs (save/arm require explicit confirmation; playback stays outside MCP):\n' +
      links.join('\n') +
      '\nEach [Nd back] is how far back that moment sits from now. Replay reach is a per-account ' +
      'entitlement counted back from now, so a handoff older than the caller reach is refused at ' +
      'the web surface (TIER_WINDOW) even though the occurrence is real and the scan is valid. ' +
      `The oldest handoff here is ${oldestDays}d back. Offer the link, say how far back it is, and ` +
      'do not promise it will play.',
  )
}

/** The baseline is useful context, not a precondition for a valid scan. Keep
 *  its bytes in a separately labelled block and make every failure explicitly
 *  non-fatal. Never describe this unconditional population as comparable. */
function baselineReference(res: ApiResponse, lean = true, foldedIntoAnswer = false): TextBlock {
  if (!res.ok || res.notModified || !res.bodyText) {
    let code = `HTTP_${res.status}`
    try {
      const parsed = JSON.parse(res.bodyText) as { code?: unknown; error?: { code?: unknown } }
      const candidate = parsed.code ?? parsed.error?.code
      if (typeof candidate === 'string') code = candidate
    } catch {
      // Keep the transport status when the error body is not JSON.
    }
    return text(
      'unconditional_same_scope_reference: unavailable (' +
        `${code}). The historical scan result remains valid; do not invent a reference rate.`,
    )
  }
  const projected = lean ? leanSummaryBody(res.bodyText, foldedIntoAnswer) : null
  return text(
    'unconditional_same_scope_reference:\n' +
      'This reference is unconditional over the same symbols and window. It is not matched, ' +
      'comparable, or a causal control.\n' +
      (projected ? `projection: ${projected.notes.join(' ')}\n` : '') +
      `${metaLine(res)}\n${projected ? projected.bodyText : res.bodyText}`,
  )
}

/**
 * Scan-body projection (2026-07-30 counts compaction, widened 2026-09-04 by
 * the agent surface audit). The projection itself lives in projection.ts with
 * its discipline written down; this is the wiring. Default projection thins
 * page rows, the per-occurrence outcomes map, the counts_by_symbol tail and
 * empty ladder rungs, states every removal in trailing note blocks, and leaves
 * counts, denominators, representatives, the cursor and the reproducibility
 * key untouched. The ETag carries the projection's exact parameters, so a
 * projected ETag can never 304 against different bytes. full_counts: true
 * restores the engine's verbatim canonical bytes.
 */
export { COMPACT_TAG, compactScanBody, leanScanBody, projectionTag } from './projection.js'

/** passthrough, minus what the lean projection removes. Falls back to verbatim
 *  on parse failure, non-JSON, error bodies, or when nothing would be removed,
 *  so the projection can only ever REMOVE. */
function leanPassthrough(
  res: ApiResponse,
  opts: LeanOptions,
  on304?: string,
  baselineSummary?: unknown,
): ToolResult {
  const scopedHeaders = { ...res.headers, etag: scopeEtag(res.headers.etag, projectionTag(opts)) }
  if (res.notModified) return passthrough({ ...res, headers: scopedHeaders }, on304)
  if (!res.ok || !res.bodyText) return passthrough(res, on304)
  const lean = leanScanBody(res.bodyText, opts, baselineSummary)
  if (!lean) return passthrough(res, on304)
  const result = passthrough({ ...res, bodyText: lean.bodyText, headers: scopedHeaders }, on304)
  // The answer block derives, so it carries its own heading and states its
  // operands; every other note is still a pure removal.
  const removals = lean.notes.filter((note) => !note.startsWith('answer ('))
  const derived = lean.notes.filter((note) => note.startsWith('answer ('))
  if (removals.length > 0) {
    result.content.push(text(`projection (only removals; nothing recomputed):\n- ${removals.join('\n- ')}`))
  }
  for (const note of derived) result.content.push(text(note))
  return result
}

/** The row/symbol/answer knobs, read from tool input with the audited defaults. */
function leanOptions(input: {
  rows?: number
  full_rows?: boolean
  full_outcomes?: boolean
}): LeanOptions {
  return {
    rows: typeof input.rows === 'number' ? Math.max(0, Math.min(50, Math.trunc(input.rows))) : DEFAULT_ROWS,
    fullRows: input.full_rows === true,
    symbols: DEFAULT_SYMBOLS,
    answer: input.full_outcomes !== true,
  }
}

/** The unconditional summary to pair against, read from a /baseline response.
 *  Returns undefined on anything unusable, and the answer block then states
 *  that no reference was available rather than inventing one. */
function baselineSummaryOf(res: ApiResponse | null): unknown {
  if (!res || !res.ok || res.notModified || !res.bodyText) return undefined
  try {
    const parsed = JSON.parse(res.bodyText) as Record<string, unknown>
    return parsed.baseline ?? parsed.outcomes_summary
  } catch {
    return undefined
  }
}

/**
 * Appends a repair note to a contract refusal. The engine's error body is
 * never touched; this is a separate block naming the next move (nearest real
 * feature ids, the lowercase-symbol rule, the legal way to ask an outcome
 * question). A registry outage silently yields the unaugmented refusal, which
 * is exactly today's behaviour, so this can only ever add.
 */
async function withRepair(
  result: ToolResult,
  res: ApiResponse,
  ctx: ToolContext,
  key: string,
): Promise<ToolResult> {
  if (res.ok || res.notModified || res.status !== 422 || !res.bodyText) return result
  let known: string[] = []
  // Only a refusal that names an unknown field needs the id list, so a
  // refusal this note cannot improve costs no extra round trip.
  if (needsRegistry(res.bodyText)) {
    try {
      const reg = await getRegistry(ctx.apiBase, key)
      if (reg.ok) known = registryFeatureIds(reg.doc)
    } catch {
      // A registry failure must never change the refusal the caller sees.
    }
  }
  const note = repairNote(res.bodyText, known)
  if (note) result.content.push(text(note))
  return result
}


/** Verbatim-or-projected passthrough for outcome_first bytes. The ETag is
 *  projection-scoped exactly as the scan family's is, so a caller holding
 *  the 12-row projection can never be told 304 "identical result" for the
 *  full-rows body. */
function outcomeFirstPassthrough(
  res: ApiResponse,
  opts: OutcomeFirstLeanOptions,
  on304?: string,
): ToolResult {
  const scopedHeaders = {
    ...res.headers,
    etag: scopeEtag(res.headers.etag, outcomeFirstProjectionTag(opts)),
  }
  if (res.notModified) return passthrough({ ...res, headers: scopedHeaders }, on304)
  if (!res.ok || !res.bodyText) return passthrough(res, on304)
  const lean = leanOutcomeFirstBody(res.bodyText, opts)
  if (!lean) return passthrough({ ...res, headers: scopedHeaders }, on304)
  const result = passthrough({ ...res, bodyText: lean.bodyText, headers: scopedHeaders }, on304)
  result.content.push(
    text(`projection (only removals; nothing recomputed):\n- ${lean.notes.join('\n- ')}`),
  )
  return result
}

/** The replay handoffs an outcome_first result carries: earliest, middle,
 *  latest and, when the caller pointed at one, their own move. Same web
 *  link shape and the same age annotation the scan family uses, so an
 *  agent never promises a replay the caller's plan cannot reach. */
function outcomeFirstHandoffs(res: ApiResponse): TextBlock | null {
  if (!res.ok || !res.bodyText) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(res.bodyText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const body = parsed as Record<string, unknown>
  const replays = Array.isArray(body.replays) ? body.replays : []
  const key = body.reproducibility_key as Record<string, unknown> | undefined
  const hash = typeof key?.canonical_query_hash === 'string' ? key.canonical_query_hash : ''
  const links: string[] = []
  for (const value of replays) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const replay = entry.replay as Record<string, unknown> | undefined
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
    if (hash) params.set('marker', `of:${hash.slice(0, 8)}`)
    const ageDays = Math.floor((Date.now() - seek) / 86_400_000)
    const age = Number.isFinite(ageDays) && ageDays >= 0 ? ` [${ageDays}d back]` : ''
    links.push(
      `${String(entry.role ?? 'episode')}: https://app.edgedepth.com/terminal?${params.toString()}${age}`,
    )
  }
  if (links.length === 0) return null
  return text(
    'Replay handoffs (earliest, middle and latest by time, never the most dramatic, plus the ' +
      'pointed move when one was given):\n' +
      links.join('\n') +
      '\nEach [Nd back] is how far back that move sits from now. Replay reach is a per-account ' +
      'entitlement counted back from now, so a handoff older than the caller reach is refused at ' +
      'the web surface even though the move is real. Offer the link, say how far back it is, and ' +
      'do not promise it will play.',
  )
}

/** Shared input schema for the three scan-family tools. */
const ROWS_INPUT = {
  rows: z
    .number()
    .int()
    .min(0)
    .max(50)
    .optional()
    .describe(
      'How many occurrence rows to keep in the returned projection (default 3, max 50). Rows ' +
        'are examples: every rate comes from outcomes_summary over all occurrences, so raise ' +
        'this only when you want more example moments. The engine still computes the full page.',
    ),
  full_rows: z
    .boolean()
    .optional()
    .describe(
      'True keeps every recorded setup value on each returned row. Default keeps only the ' +
        'fields that row\'s own evidence names, which are the fields the predicate matched on.',
    ),
  full_outcomes: z
    .boolean()
    .optional()
    .describe(
      'True returns the complete outcome ladders: every threshold rung and per-rung histogram ' +
        'for all twelve metrics, on the matched set and on the unconditional reference ' +
        'separately, with no rate or lift computed for you. That is tens of thousands of ' +
        'characters and can exceed a client tool-result limit. Default returns the paired answer ' +
        'block instead: the same verbatim counts and denominators for the canonical rungs, with ' +
        'the matched rate, the unconditional rate and their ratio stated side by side.',
    ),
}

const CLOSED_READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const
const EXTERNAL_READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const
const METERED_COMPUTE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const

/** Registers the twelve research tools on an McpServer. */
export function registerResearchTools(server: McpServer, ctx: ToolContext): void {
  // 1. list_features - the grounding tool.
  server.registerTool(
    'list_features',
    {
      title: 'List research features (the grammar registry)',
      description:
        'Use this when you need the valid EdgeDepth query grammar, supported feature ids, ' +
        'operators, windows, limits, or machine-actionable error codes before constructing or ' +
        'repairing a query document. Do not use this to answer a market question; it returns ' +
        'capabilities, not historical evidence. The whole registry is large: pass search or ' +
        'feature_ids to read one family, and compact to drop the per-feature prose. This is a ' +
        'free deterministic read.',
      inputSchema: {
        search: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe(
            'Case-insensitive substring over feature ids and descriptions, e.g. "liquidation", ' +
              '"funding", "candle". Returns the matching features with the closed grammar ' +
              '(operators, windows, sequence rules, limits, error codes) intact.',
          ),
        feature_ids: z
          .array(z.string())
          .max(64)
          .optional()
          .describe(
            'Exact feature ids to return, e.g. ["feature.vpin","feature.funding_rate"]. A bare ' +
              'name is also matched against feature.<name>. Ids with no match are named back.',
          ),
        compact: z
          .boolean()
          .optional()
          .describe(
            'True drops each feature\'s prose description and the instrument examples, keeping ' +
              'dtype, range, unit, observation_scope and implemented. Use it once you know what ' +
              'a feature measures and only need the shape.',
          ),
      },
      annotations: CLOSED_READ,
    },
    async ({ search, feature_ids, compact }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const reg = await getRegistry(ctx.apiBase, key)
      if (!reg.ok) {
        return { content: [text(metaLine(reg.response)), text(reg.bodyText)], isError: true }
      }
      const projected = projectRegistry(reg.raw, {
        search,
        featureIds: feature_ids,
        compact,
      })
      if (!projected)
        return {
          content: [text(metaLine(reg.response)), text(reg.raw), text(READING_DOC_HINT)],
        }
      // Projection-scoped ETag: a filtered registry must never revalidate as
      // the whole grammar. The tag names the exact filter.
      const tag = `reg.${fnv1a8(JSON.stringify([search ?? '', feature_ids ?? [], compact === true]))}`
      const scoped = {
        ...reg.response,
        headers: { ...reg.response.headers, etag: scopeEtag(reg.response.headers.etag, tag) },
      }
      return {
        content: [
          text(metaLine(scoped)),
          text(projected.bodyText),
          text(`projection (only removals; nothing recomputed):\n- ${projected.notes.join('\n- ')}`),
          text(READING_DOC_HINT),
        ],
      }
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
        'Use this when you need to verify supported symbols, recorded coverage, data availability, ' +
        'or whether an instrument is a session-bound TradFi perpetual before running or describing ' +
        'research. Use symbols for selected full records; use full only when canonical whole-universe ' +
        'bytes are required. Do not use this for live prices or historical outcomes. This is a free ' +
        'deterministic read.',
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
      annotations: CLOSED_READ,
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
      if (full === true || res.notModified || res.status !== 200) {
        const out = passthrough(scoped)
        // The canonical-bytes mode still names the instruments, so it gets the
        // same door. Never on a 304 (no body) or an error.
        if (full === true && res.status === 200 && !res.notModified) {
          out.content.push(text(SYMBOL_DOC_HINT))
        }
        return out
      }

      interface UniverseInstrument {
        symbol?: string
        availability_status?: string
        // universe_result.v2 (2026-08-22). 170 of 744 trading symbols track an
        // underlying with SESSION HOURS, so these decide whether a
        // universe-wide statistic means anything.
        underlying_type?: string
        tradfi?: boolean
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
        return {
          content: [
            text(metaLine(scoped)),
            text(JSON.stringify(projection)),
            text(SYMBOL_DOC_HINT),
          ],
        }
      }

      const byStatus: Record<string, number> = {}
      const byUnderlyingType: Record<string, number> = {}
      let tradfiCount = 0
      let presentDaysMin: number | null = null
      let presentDaysMax: number | null = null
      let withExcludedDays = 0
      for (const instrument of instruments) {
        const status = instrument.availability_status ?? 'unknown'
        byStatus[status] = (byStatus[status] ?? 0) + 1
        const underlying = instrument.underlying_type ?? 'unknown'
        byUnderlyingType[underlying] = (byUnderlyingType[underlying] ?? 0) + 1
        if (instrument.tradfi === true) tradfiCount++
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
        // The default projection has to carry these, otherwise the only way to
        // learn that a quarter of the universe is session-bound is to pull the
        // full 360 KB body, and nobody does that before quoting a statistic.
        tradfi_count: tradfiCount,
        by_underlying_type: byUnderlyingType,
        present_partition_days: { min: presentDaysMin, max: presentDaysMax },
        instruments_with_excluded_days: withExcludedDays,
        notes: body.notes,
      }
      return {
        content: [text(metaLine(scoped)), text(JSON.stringify(summary)), text(SYMBOL_DOC_HINT)],
      }
    },
  )

  // 3. interpret_prose - proposal, never a result.
  server.registerTool(
    'interpret_prose',
    {
      title: 'Interpret prose into a proposed research document',
      description:
        'Use this when the user asks a historical market-microstructure question in prose and no ' +
        'exact query document exists. It returns a proposed research_query.v2 document, unsupported ' +
        'fragments, and clarification notices; it never runs the scan. Show the exact proposal, then ' +
        'call run_scan only after confirmation. Do not use this for live quotes, trading advice, ' +
        'trade execution, or when the caller already supplied an exact document. This free proposal ' +
        'step uses the configured external language interpreter.',
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
      annotations: EXTERNAL_READ,
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
        'Use this when an exact research_query.v2 document has been confirmed and the user wants ' +
        'historical occurrences and what followed. It returns the exact definition, counts with ' +
        'denominators, forward outcomes over all matches, an unconditional same-scope reference ' +
        'baseline when available, a reproducibility key, and replay-linked representatives. Read ' +
        'rates from outcomes_summary and use each horizon\'s present count as its denominator; ' +
        'horizons run from 30m to 7d, and a horizon absent for an occurrence is a record-edge ' +
        'fact that is counted absent, never a small value. Do not ' +
        'use this for live quotes, personalized buy/sell advice, trade execution, prose ' +
        'interpretation, or outcome filtering. ' +
        CONFIRM_GATE_CONTRACT +
        ' sequence.within accepts 15m/30m/1h/4h/12h/24h and the matching ISO aliases. ' +
        'sort accepts times.anchor_time, outcome.mfe_24h or outcome.mfe_7d, asc or desc: an ' +
        'outcome sort orders the returned page only (the biggest runs first, and the ' +
        'max_mfe_7d representative carries a replay handoff to the biggest one) and changes no ' +
        'count or rate; outcome.* in a predicate is still OUTCOME_IN_PREDICATE. ' +
        'identity.symbol must be an exact lowercase Binance USDT-M perpetual symbol. A fresh ' +
        'initial scan can consume research allowance units; cache hits, continuations, reruns, and ' +
        '304 revalidations are free.',
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
            "True returns the engine's verbatim canonical bytes with no projection at all: " +
              'every zero-count instrument, every page row with its whole setup vector, the ' +
              'per-occurrence outcomes map and every empty ladder rung. Universe scans are ' +
              'hundreds of KB this way and can exceed a client tool-result limit. Default ' +
              'returns a projection that only ever REMOVES, and states each removal.',
          ),
        ...ROWS_INPUT,
      },
      annotations: METERED_COMPUTE,
    },
    async ({ document, if_none_match, full_counts, rows, full_rows, full_outcomes }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const lean = leanOptions({ rows, full_rows, full_outcomes })
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
          : (unscopeEtag(if_none_match, projectionTag(lean)) ?? if_none_match),
      })
      const baseline =
        res.ok && !res.notModified
          ? await apiRequest(ctx.apiBase, {
              method: 'POST',
              path: '/baseline',
              key,
              body: document,
            })
          : null
      const result = full_counts
        ? passthrough(
            res,
            'Re-run the document without If-None-Match to fetch the cached bytes (still free).',
          )
        : leanPassthrough(
            res,
            lean,
            'Re-run the document without If-None-Match to fetch the cached bytes (still free).',
            baselineSummaryOf(baseline),
          )
      // The reference sheds its ladder only when the answer block actually
      // paired one in, so a baseline that failed still arrives whole.
      const folded = !full_counts && lean.answer && baselineSummaryOf(baseline) !== undefined
      if (baseline) result.content.push(baselineReference(baseline, !full_counts, folded))
      const handoffs = replayHandoffs(res)
      if (handoffs) result.content.push(handoffs)
      return withRepair(result, res, ctx, key)
    },
  )

  // 4. next_page - cursor continuation for a prior run_scan.
  server.registerTool(
    'next_page',
    {
      title: 'Fetch the next page of a prior scan',
      description:
        'Use this when a prior run_scan returned an opaque page cursor and more occurrence rows are ' +
        'needed. Re-send the exact document and cursor; if its dataset revision changed, restart at ' +
        'page 1. Do not use this with a constructed or edited cursor, for a different document, or to infer rates ' +
        'from page rows. Continuations are free.',
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
            "True returns the engine's verbatim canonical bytes with no projection at all. " +
              'Default returns a projection that only ever REMOVES, and states each removal.',
          ),
        ...ROWS_INPUT,
      },
      annotations: CLOSED_READ,
    },
    async ({ document, cursor, if_none_match, full_counts, rows, full_rows, full_outcomes }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const lean = leanOptions({ rows, full_rows, full_outcomes })
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
          : (unscopeEtag(if_none_match, projectionTag(lean)) ?? if_none_match),
      })
      return withRepair(full_counts ? passthrough(res) : leanPassthrough(res, lean), res, ctx, key)
    },
  )

  // 5. snapshot_at - the from-a-moment read (not a scan, not metered).
  server.registerTool(
    'snapshot_at',
    {
      title: 'Read the registry as-of a moment',
      description:
        'Use this when you need the recorded feature values, window aggregates, and fired rulebook ' +
        'ids at one exact symbol-time, often to turn an observed moment into candidate scan clauses. ' +
        'Do not use this to find similar moments, compute outcomes, or infer that a selected moment ' +
        'is typical. Current-minute reads are available on every key; past-minute reads require the ' +
        'corresponding account entitlement.',
      inputSchema: {
        symbol: z.string().describe('Lowercase perp, e.g. btcusdt.'),
        at: z
          .string()
          .describe('An RFC3339 datetime; the engine floors it to the grid bucket that contains it.'),
      },
      annotations: CLOSED_READ,
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
        'Use this when the user asks how common one exact condition was across eligible ' +
        'symbol-minute buckets in a time window. It returns true, false, eligible, and ' +
        'absent/ineligible counts plus prevalence. Do not use this for occurrence episodes, forward ' +
        'outcomes, multi-condition studies, or causal claims. Missing values are excluded rather ' +
        'than treated as false. This is a free deterministic computation.',
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
      annotations: CLOSED_READ,
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
      if (res.status === 422 && res.bodyText) {
        const note = repairNote(res.bodyText, registryFeatureIds(reg.doc))
        if (note) result.content.push(text(note))
      }
      return result
    },
  )

  // 7. commonality - via the SHARED web endpoint (decision 7).
  server.registerTool(
    'commonality',
    {
      title: 'Commonality across N moments',
      description:
        'Use this when the user supplied at least two exact historical moments and wants the ' +
        'deterministic feature intersection across them. Do not use this as similarity search or ' +
        'treat shared features as predictive evidence; test an agreed condition separately with ' +
        'base_rate or run_scan. This is a free deterministic computation.',
      inputSchema: {
        moments: z
          .array(z.object({ symbol: z.string(), at: z.string() }))
          .min(2)
          .describe('At least 2 moments: { symbol: lowercase perp, at: RFC3339 }.'),
      },
      annotations: CLOSED_READ,
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
        'Use this when the user wants to list citable public EdgeDepth reports or retrieve one by ' +
        'its 8-character canonical hash. A fetched report includes its exact definition, pinned ' +
        'result, revision, and integrity status. Do not use this to present invalid or withdrawn reports as ' +
        'healthy, and do not use this for unpublished user research. This is a free read.',
      inputSchema: {
        hash8: z
          .string()
          .regex(/^[0-9a-f]{8}$/)
          .optional()
          .describe('Optional 8 lowercase hex canonical id. Omit to list public reports.'),
      },
      annotations: CLOSED_READ,
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
        'Use this when an exact where-only research_query.v2 document has been confirmed and the ' +
        'user explicitly wants the matched occurrence distribution beside every other eligible ' +
        'predicate-false bucket. Do not use this for sequences, as a default reference baseline, for ' +
        'covariate matching, significance, or causal claims. Read rates from each side\'s present ' +
        'denominator. ' +
        CONFIRM_GATE_CONTRACT +
        ' A fresh cohort computation can consume research allowance units; cache hits, reruns, and ' +
        '304 revalidations are free.',
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
            "True returns the engine's verbatim canonical bytes with no projection at all. " +
              'Default returns a projection that only ever REMOVES, and states each removal.',
          ),
        ...ROWS_INPUT,
      },
      annotations: METERED_COMPUTE,
    },
    async ({ document, if_none_match, full_counts, rows, full_rows, full_outcomes }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const lean = leanOptions({ rows, full_rows, full_outcomes })
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
          : (unscopeEtag(if_none_match, projectionTag(lean)) ?? if_none_match),
      })
      const on304 = 'Re-run the document without If-None-Match to fetch the cached cohort bytes (still free).'
      return withRepair(
        full_counts ? passthrough(res, on304) : leanPassthrough(res, lean, on304),
        res,
        ctx,
        key,
      )
    },
  )

  // 10. run_stratified - the fixed-anchor setup stratification
  //     (stratified_result.v3). ONE population, split THREE ways at the
  //     population's own anchors. This is the tool that answers "is this
  //     finding really just <other condition>?" without moving an anchor.
  //
  //     No compact projection here: stratified_result carries aggregate
  //     counts and per-stratum summaries, and no counts_by_symbol map for
  //     compactScanBody to thin, so the bytes forward verbatim.
  server.registerTool(
    'run_stratified',
    {
      title: 'Split one population three ways at its own anchors',
      description:
        'Use this when the user wants to test whether the outcome distribution of one confirmed ' +
        'population changes when its existing anchors are partitioned by one setup-time condition. ' +
        'It returns split_true, split_false, and split_absent denominators and outcomes without ' +
        'moving or creating anchors. Do not use this for sequences in the split, cursor populations, ' +
        'causal claims, or two independently selected scans. ' +
        CONFIRM_GATE_CONTRACT +
        ' A fresh stratified computation can consume research allowance units; cache hits, reruns, ' +
        'and 304 revalidations are free.',
      inputSchema: {
        document: z
          .record(z.any())
          .describe(
            'A complete stratified_query.v1 wrapper: schema_version, population (a ' +
              'research_query.v2 document, target record_occurrences) and split. Call ' +
              'list_features for the population grammar and for the ids usable as split ' +
              'fields; do not invent field names.',
          ),
        if_none_match: z
          .string()
          .optional()
          .describe(
            'An ETag from a previous stratified run to revalidate: identical data answers 304 ' +
              'and spends nothing. Pass it back verbatim (it may be weak, W/"...").',
          ),
      },
      annotations: METERED_COMPUTE,
    },
    async ({ document, if_none_match }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/stratified',
        key,
        body: document,
        ifNoneMatch: if_none_match,
      })
      return withRepair(
        passthrough(
          res,
          'Re-run the wrapper without If-None-Match to fetch the cached stratified bytes (still free).',
        ),
        res,
        ctx,
        key,
      )
    },
  )

  // 12. outcome_first - the outcome-first DOOR (task outcome-first-door).
  //     Start from the MOVE, read what preceded moves like it. A
  //     descriptive read over the outcome population, never the
  //     discovery miner: it searches no rule space and claims no
  //     survivor, and the tool contract says so in the words the agent
  //     will repeat.
  server.registerTool(
    'outcome_first',
    {
      title: 'What preceded moves like this',
      description:
        'Use this when the user starts from an OUTCOME (a move of a stated size, in a stated ' +
        'direction, inside a stated horizon) and wants to know what the record was doing in the ' +
        'minutes before every move like it. It returns the outcome population with its ' +
        'denominators, a feasibility verdict, and one row per reading per lead-up offset carrying ' +
        'TWO counted shares: how often that reading sat outside its usual band before these ' +
        'moves, and how often it did so across every eligible minute in the same scope. ' +
        'Every row is labelled selected on the outcome. A row is NOT a rule, a candidate, a ' +
        'finding or a predictor, and the row order is the gap between those two shares, which is ' +
        'display order and not a ranking: never present a row as something that works. The ' +
        'honest rate is the setup-first rerun each row carries, which run_scan re-tests the ' +
        'other way round; quote a row only after running it. Do not use this to filter outcomes, ' +
        'to mine for a strategy, or to recommend a trade. A scope with too few realised moves is ' +
        'REFUSED with the counts and four honest adjustments rather than answered underpowered, ' +
        'and a refusal spends no allowance. ' +
        CONFIRM_GATE_CONTRACT +
        ' A one-market scope always refuses (the floor is five markets), so scope to a sector or ' +
        'a volume tier. A fresh read can consume research allowance units; cache hits, reruns and ' +
        '304 revalidations are free.',
      inputSchema: {
        kind: z
          .enum(['reached', 'finished'])
          .describe(
            'reached: the extreme touched the size at any point inside the horizon. finished: ' +
              'the close was there at the end of it.',
          ),
        direction: z.enum(['up', 'down']).describe('up or down.'),
        magnitude: z
          // A union, not a bare number, for the same reason base_rate's
          // value is one: some MCP clients erase the type and send every
          // argument as a string, and a bare z.number() then makes the
          // tool uncallable rather than repairable. coerceJsonish turns
          // "0.1" into 0.1 below; anything else is refused, never guessed.
          .union([z.number(), z.string()])
          .describe(
            'A rung of the outcome ladder, as a FRACTION: ' +
              OUTCOME_LADDER.join(', ') +
              `. Down is capped at ${OUTCOME_LADDER_DOWN_MAX}. 0.1 is a ten percent move; 10 ` +
              'would be a thousand percent. Off-ladder values are refused with the nearest rung ' +
              'named, because a population defined on a free number is a population of one.',
          ),
        horizon: z
          .enum(OUTCOME_HORIZONS)
          .describe('A closed suffix: ' + OUTCOME_HORIZONS.join(', ') + '. Not an ISO duration.'),
        from: z.string().describe('Window start, RFC3339.'),
        to: z.string().describe('Window end, RFC3339.'),
        symbols: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'Scope: a JSON array of lowercase perps (max 800), or one symbol. Omit for the whole ' +
              'universe. A string-encoded array is repaired deterministically. Fewer than five ' +
              'markets always refuses.',
          ),
        pointed: z
          .object({ symbol: z.string(), at: z.string() })
          .optional()
          .describe(
            'Optional: one move the user is asking about, { symbol, at: RFC3339 }. It must lie ' +
              'inside the window and the scope, and the result says whether it is inside the ' +
              'population it is being compared with.',
          ),
        if_none_match: z
          .string()
          .optional()
          .describe(
            'An ETag from a previous outcome_first run to revalidate: identical data answers 304 ' +
              'and spends nothing. Pass it back verbatim (it may be weak, W/"...").',
          ),
        rows: z
          .number()
          .int()
          .min(0)
          .max(400)
          .optional()
          .describe(
            `How many rows to keep in the returned projection (default ${DEFAULT_OUTCOME_FIRST_ROWS}). ` +
              'The full body is roughly 150 rows, each carrying a whole rerun document. Every ' +
              'count and both shares on a kept row are untouched.',
          ),
        full_rows: z
          .boolean()
          .optional()
          .describe(
            "True returns the engine's verbatim canonical bytes: every row, every " +
              'setup_first_rerun document, and the sampled episode list. That is the way to get ' +
              'a rerun document to hand to run_scan. It is large and can exceed a client ' +
              'tool-result limit.',
          ),
      },
      annotations: METERED_COMPUTE,
    },
    async ({ kind, direction, magnitude, horizon, from, to, symbols, pointed, if_none_match, rows, full_rows }) => {
      const key = ctx.getKey()
      if (!key) return noKey()
      // Repair client serialization drift before anything is judged:
      // "0.1" -> 0.1 and "[\"btcusdt\"]" -> ["btcusdt"].
      const coercedMagnitude = coerceJsonish(magnitude)
      const coercedSymbols = symbols === undefined ? undefined : coerceJsonish(symbols)
      const value = typeof coercedMagnitude === 'number' ? coercedMagnitude : Number.NaN
      // The API accepts any positive magnitude; the door and the terminal
      // only ever send rungs, and a population defined on a free number
      // shares its cache key with nobody. Refusing here, with the nearest
      // rung named, costs no round trip and no allowance.
      if (!(OUTCOME_LADDER as readonly number[]).includes(value)) {
        const nearest = Number.isFinite(value) ? nearestLadderRung(value, direction) : 0.1
        return {
          isError: true,
          content: [
            text(
              `magnitude ${JSON.stringify(magnitude)} is not a rung of the outcome ladder. The ` +
                `ladder, as fractions: ${OUTCOME_LADDER.join(', ')} (down is capped at ` +
                `${OUTCOME_LADDER_DOWN_MAX}). The nearest rung is ${nearest}. Nothing was sent ` +
                'and nothing was spent. The ladder is closed on purpose: an exact user magnitude ' +
                'would make a population of one and a cache entry nobody else ever hits.',
            ),
          ],
        }
      }
      const symbolList =
        coercedSymbols === undefined
          ? undefined
          : Array.isArray(coercedSymbols)
            ? coercedSymbols.map(String)
            : [String(coercedSymbols)]
      const document: Record<string, unknown> = {
        schema_version: 'outcome_first_query.v1',
        window: { from, to },
        target: { kind, direction, magnitude: value, horizon },
      }
      if (symbolList && symbolList.length > 0) document.symbols = symbolList
      if (pointed) document.pointed = pointed
      const lean: OutcomeFirstLeanOptions = {
        rows:
          typeof rows === 'number'
            ? Math.max(0, Math.min(400, Math.trunc(rows)))
            : DEFAULT_OUTCOME_FIRST_ROWS,
        fullRows: full_rows === true,
      }
      const res = await apiRequest(ctx.apiBase, {
        method: 'POST',
        path: '/outcome-first',
        key,
        body: document,
        ifNoneMatch: full_rows
          ? if_none_match
          : (unscopeEtag(if_none_match, outcomeFirstProjectionTag(lean)) ?? if_none_match),
      })
      const result = full_rows
        ? passthrough(res, 'Re-run the same inputs without If-None-Match to fetch the cached bytes (still free).')
        : outcomeFirstPassthrough(
            res,
            lean,
            'Re-run the same inputs without If-None-Match to fetch the cached bytes (still free).',
          )
      result.content.unshift(
        text('outcome_first document (echo this to the user):\n' + JSON.stringify(document)),
      )
      const handoffs = outcomeFirstHandoffs(res)
      if (handoffs) result.content.push(handoffs)
      return withRepair(result, res, ctx, key)
    },
  )
}
