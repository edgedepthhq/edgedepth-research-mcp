/**
 * The counts_by_symbol compaction projection (agent-context economy).
 * A universe scan enumerates 660+ instruments in counts_by_symbol, zeros
 * included; the default projection drops the zeros, states how many were
 * dropped, and scopes the ETag so a compact ETag can never 304 against
 * the full bytes. full_counts: true restores verbatim canonical bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache } from '../src/index.js'
import { compactScanBody, scopeEtag, unscopeEtag, COMPACT_TAG } from '../src/tools.js'
import { DEFAULT_LEAN, projectionTag } from '../src/projection.js'
import { connectClient, texts } from './helpers.js'

const fetchMock = vi.fn()

beforeEach(() => {
  clearRegistryCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const DOCUMENT = {
  schema_version: 'research_query.v2',
  target: 'record_occurrences',
  where: { all: [['feature.vpin', 'gte', 0.85]] },
}

function scanBody(): string {
  return JSON.stringify({
    counts: { total_matching: 3 },
    counts_by_symbol: {
      btcusdt: { total_matching: 2 },
      ethusdt: { total_matching: 0 },
      solusdt: { total_matching: 1 },
      adausdt: { total_matching: 0 },
    },
    outcomes_summary: { present: 3 },
    reproducibility_key: { canonical_query_hash: 'abc123' },
  })
}

function baselineResponse(): Response {
  return new Response(
    JSON.stringify({ baseline_encoding: 'baseline_result.v1', counts: { baseline_buckets: 100 } }),
    { status: 200 },
  )
}

describe('compactScanBody (unit)', () => {
  it('drops only zero-count entries and counts them', () => {
    const compact = compactScanBody(scanBody())
    expect(compact).not.toBeNull()
    expect(compact!.omitted).toBe(2)
    const body = JSON.parse(compact!.bodyText)
    expect(Object.keys(body.counts_by_symbol)).toEqual(['btcusdt', 'solusdt'])
    // Everything else is untouched.
    expect(body.counts).toEqual({ total_matching: 3 })
    expect(body.outcomes_summary).toEqual({ present: 3 })
    expect(body.reproducibility_key).toEqual({ canonical_query_hash: 'abc123' })
  })

  it('returns null (verbatim fallback) when nothing would be omitted', () => {
    const body = JSON.stringify({ counts_by_symbol: { btcusdt: { total_matching: 2 } } })
    expect(compactScanBody(body)).toBeNull()
  })

  it('returns null on non-JSON, non-object, and missing counts_by_symbol', () => {
    expect(compactScanBody('not json')).toBeNull()
    expect(compactScanBody('[1,2,3]')).toBeNull()
    expect(compactScanBody(JSON.stringify({ counts: {} }))).toBeNull()
  })
})

describe('run_scan projection (end to end)', () => {
  it('compacts by default, states the omission, and scopes the ETag', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(scanBody(), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: 'W/"abc"' },
        }),
      )
      .mockResolvedValueOnce(baselineResponse())
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: DOCUMENT } })
    const blocks = texts(res)

    // Body block: zeros gone, everything else intact.
    const body = JSON.parse(blocks[1])
    expect(Object.keys(body.counts_by_symbol)).toEqual(['btcusdt', 'solusdt'])
    expect(body.counts.total_matching).toBe(3)

    // The omission is stated, with the honesty framing.
    const note = blocks.find((b) => b.includes('zero-count instrument(s)'))
    expect(note).toBeTruthy()
    expect(note).toContain('2 zero-count')
    expect(note).toContain('never missing data')

    // Meta line carries the projection-scoped ETag, never the raw one.
    expect(blocks[0]).toContain(`etag=${scopeEtag('W/"abc"', projectionTag(DEFAULT_LEAN))}`)
    expect(blocks[0]).not.toContain('etag=W/"abc" ')
  })

  it('full_counts: true returns verbatim bytes with the raw ETag', async () => {
    const raw = scanBody()
    fetchMock
      .mockResolvedValueOnce(
        new Response(raw, {
          status: 200,
          headers: { 'content-type': 'application/json', etag: 'W/"abc"' },
        }),
      )
      .mockResolvedValueOnce(baselineResponse())
    const client = await connectClient()
    const res = await client.callTool({
      name: 'run_scan',
      arguments: { document: DOCUMENT, full_counts: true },
    })
    const blocks = texts(res)
    expect(blocks).toContain(raw)
    expect(blocks[0]).toContain('etag=W/"abc"')
  })

  it('unscopes a compact ETag before revalidating upstream, and forwards a raw one verbatim', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(scanBody(), { status: 200, headers: { etag: 'W/"abc"' } }),
      ),
    )
    const client = await connectClient()

    const scoped = scopeEtag('W/"abc"', projectionTag(DEFAULT_LEAN))!
    await client.callTool({
      name: 'run_scan',
      arguments: { document: DOCUMENT, if_none_match: scoped },
    })
    let [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('W/"abc"')

    // A raw ETag in compact mode stays truthful (the compact body is a pure
    // function of the full bytes), so it is forwarded verbatim.
    await client.callTool({
      name: 'run_scan',
      arguments: { document: DOCUMENT, if_none_match: 'W/"abc"' },
    })
    ;[, init] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('W/"abc"')
  })

  it('error bodies pass through verbatim (compaction never touches errors)', async () => {
    const body = JSON.stringify({ errors: [{ code: 'OUTCOME_IN_PREDICATE', message: 'no' }] })
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 422 }))
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: DOCUMENT } })
    expect(res.isError).toBe(true)
    expect(texts(res)).toContain(body)
  })

  it('single-symbol scans with no zeros pass through verbatim', async () => {
    const raw = JSON.stringify({
      counts: { total_matching: 5 },
      counts_by_symbol: { btcusdt: { total_matching: 5 } },
    })
    fetchMock
      .mockResolvedValueOnce(
        new Response(raw, { status: 200, headers: { etag: 'W/"one"' } }),
      )
      .mockResolvedValueOnce(baselineResponse())
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: DOCUMENT } })
    const blocks = texts(res)
    expect(blocks).toContain(raw)
    expect(blocks[0]).toContain('etag=W/"one"')
    expect(blocks.some((b) => b.includes('omitted'))).toBe(false)
  })
})

describe('etag scoping round-trip', () => {
  it('scope then unscope is identity; wrong tag never unscopes', () => {
    const scoped = scopeEtag('W/"abc"', COMPACT_TAG)
    expect(unscopeEtag(scoped, COMPACT_TAG)).toBe('W/"abc"')
    expect(unscopeEtag(scoped, 'other')).toBeUndefined()
    expect(unscopeEtag('W/"abc"', COMPACT_TAG)).toBeUndefined()
  })
})
