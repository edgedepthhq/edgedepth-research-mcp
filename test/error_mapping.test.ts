import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache } from '../src/index.js'
import { connectClient, texts } from './helpers.js'

const fetchMock = vi.fn()

beforeEach(() => {
  clearRegistryCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('error + repro mapping', () => {
  it('passes interpret_prose time_zone unchanged and omits it when absent', async () => {
    const proposal = JSON.stringify({ proposal: true, time_zone_resolution: { resolved_time_zone: 'Asia/Kathmandu' } })
    fetchMock
      .mockResolvedValueOnce(new Response(proposal, { status: 200 }))
      .mockResolvedValueOnce(new Response(proposal, { status: 200 }))
    const client = await connectClient()

    await client.callTool({
      name: 'interpret_prose',
      arguments: { language: 'matches on June 7', time_zone: 'Asia/Kathmandu' },
    })
    await client.callTool({
      name: 'interpret_prose',
      arguments: { language: 'matches on June 7' },
    })

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      language: 'matches on June 7',
      time_zone: 'Asia/Kathmandu',
    })
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      language: 'matches on June 7',
    })
  })

  it('passes a transport envelope through verbatim with status in the meta line', async () => {
    const body = JSON.stringify({ error: 'A scan is already in flight on this key.', code: 'SCAN_BUSY' })
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '5',
          'x-research-credits-charged': '0',
          'x-research-credits-remaining': '5',
        },
      }),
    )
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: {} } })
    expect(res.isError).toBe(true)
    const blocks = texts(res)
    expect(blocks).toContain(body) // verbatim engine envelope
    expect(blocks[0]).toContain('status=429')
    expect(blocks[0]).toContain('retry_after=5')
    expect(blocks[0]).toContain('credits_charged=0')
    expect(blocks[0]).toContain('credits_remaining=5')
  })

  it('treats a 304 revalidation as free and forwards the weak ETag', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: 'W/"abc123"' } }))
    const client = await connectClient()
    const res = await client.callTool({
      name: 'run_scan',
      arguments: { document: {}, if_none_match: 'W/"abc123"' },
    })
    expect(res.isError).toBeFalsy()
    expect(texts(res).join('\n')).toContain('304 Not Modified')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('W/"abc123"')
  })

  it('surfaces repro + credit headers on a 200 scan (miss, charged)', async () => {
    const body = JSON.stringify({ counts: { total_matching: 3 }, reproducibility_key: { canonical_query_hash: 'deadbeef' } })
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          etag: 'W/"scan1"',
          'x-canonical-query-hash': 'deadbeef',
          'x-dataset-revision': 'rev-7',
          'x-research-cache': 'miss',
          'x-research-credits-charged': '1',
          'x-research-credits-remaining': '4',
        },
      }),
    )
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: { a: 1 } } })
    expect(res.isError).toBeFalsy()
    const blocks = texts(res)
    expect(blocks).toContain(body) // engine bytes verbatim
    expect(blocks[0]).toContain('cache=miss')
    expect(blocks[0]).toContain('credits_charged=1')
    expect(blocks[0]).toContain('canonical_query_hash=deadbeef')
  })

  it('posts an exact cohort document and returns the canonical cohort bytes', async () => {
    const document = {
      schema_version: 'research_query.v2',
      feature_version: 'feature_defs.v1',
      target: 'record_occurrences',
      where: { all: [['feature.top_global_long_skew', 'gte', 0.15]] },
    }
    const body = JSON.stringify({
      schema_version: 'cohort_result.v2',
      treatment: { total: 12 },
      baseline: { total: 1200 },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          etag: '"cohort1"',
          'x-canonical-query-hash': 'c0ffee12',
        },
      }),
    )
    const client = await connectClient()
    const res = await client.callTool({
      name: 'run_cohort',
      arguments: { document, if_none_match: '"prior"' },
    })
    expect(res.isError).toBeFalsy()
    expect(texts(res)).toContain(body)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('http://api.test/api/v1/research/cohort')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(document)
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('"prior"')
  })

  it('passes a cohort validation error through verbatim', async () => {
    const body = JSON.stringify({
      errors: [{ code: 'COHORT_SEQUENCE_UNSUPPORTED', message: 'Cohorts are where-only.' }],
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 422, headers: { 'content-type': 'application/json' } }),
    )
    const client = await connectClient()
    const res = await client.callTool({
      name: 'run_cohort',
      arguments: { document: { sequence: { steps: [] } } },
    })
    expect(res.isError).toBe(true)
    expect(texts(res)).toContain(body)
  })

  it('ETag-revalidates the registry and reuses cached bytes on 304', async () => {
    const reg = JSON.stringify({
      schema_version: 'research_query.v2',
      normalization_version: 'archive_normalization.v1',
      feature_version: 'feature_defs.v1',
      features: {},
    })
    fetchMock
      .mockResolvedValueOnce(
        new Response(reg, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: '"r1"',
            'x-research-credits-charged': '0',
            'x-research-credits-remaining': '5',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: {
            etag: '"r1"',
            'x-research-credits-charged': '0',
            'x-research-credits-remaining': '5',
          },
        }),
      )
    const client = await connectClient()
    const first = await client.callTool({ name: 'list_features', arguments: {} })
    const second = await client.callTool({ name: 'list_features', arguments: {} })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(texts(first)).toContain(reg) // registry bytes verbatim
    expect(texts(second)).toContain(reg)
    expect(texts(first)[0]).toContain('credits_charged=0')
    expect(texts(second)[0]).toContain('status=304')
    expect(texts(second)[0]).toContain('credits_remaining=5')
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('"r1"')
  })

  it('lists the manifest-derived instrument universe with provenance', async () => {
    const body = JSON.stringify({
      universe_encoding: 'universe_result.v1',
      dataset_revision: 'rev-universe',
      instruments: [
        {
          symbol: 'nvdausdt',
          exchange: 'binancef',
          contract_type: 'linear_perpetual',
          reference_asset: 'NVDA',
          provenance: 'not direct Nasdaq data',
        },
      ],
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: { etag: '"u1"', 'x-dataset-revision': 'rev-universe' },
      }),
    )
    const client = await connectClient()
    const res = await client.callTool({
      name: 'list_instruments',
      arguments: { if_none_match: '"u0"', full: true },
    })
    expect(texts(res)).toContain(body)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('http://api.test/api/v1/research/universe')
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('"u0"')
  })

  it('replaces cached registry bytes when additive ids land under the same feature version', async () => {
    const reg30 = JSON.stringify({
      schema_version: 'research_query.v2',
      normalization_version: 'archive_normalization.v1',
      feature_version: 'feature_defs.v1',
      features: { 'feature.vpin': { dtype: 'number' } },
    })
    const reg33 = JSON.stringify({
      schema_version: 'research_query.v2',
      normalization_version: 'archive_normalization.v1',
      feature_version: 'feature_defs.v1',
      features: {
        'feature.vpin': { dtype: 'number' },
        'feature.top_global_long_skew': { dtype: 'number' },
      },
    })
    fetchMock
      .mockResolvedValueOnce(new Response(reg30, { status: 200, headers: { etag: '"r30"' } }))
      .mockResolvedValueOnce(new Response(reg33, { status: 200, headers: { etag: '"r33"' } }))
    const client = await connectClient()
    await client.callTool({ name: 'list_features', arguments: {} })
    const refreshed = await client.callTool({ name: 'list_features', arguments: {} })
    expect(texts(refreshed)).toContain(reg33)
    expect(texts(refreshed).join('\n')).toContain('feature.top_global_long_skew')
  })

  it('base_rate assembles a one-clause document from the registry versions', async () => {
    const reg = JSON.stringify({
      schema_version: 'research_query.v2',
      normalization_version: 'archive_normalization.v1',
      feature_version: 'feature_defs.v1',
      features: {},
    })
    const scanBody = JSON.stringify({
      result_encoding: 'base_rate_result.v1',
      counts: { predicate_true_buckets: 10, eligible_buckets: 1000, prevalence: 0.01 },
    })
    fetchMock
      .mockResolvedValueOnce(new Response(reg, { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(scanBody, { status: 200, headers: { 'content-type': 'application/json' } }))

    const client = await connectClient()
    const res = await client.callTool({
      name: 'base_rate',
      arguments: {
        field: 'feature.vpin',
        operator: 'gte',
        value: 0.7,
        from: '2026-07-09T00:00:00Z',
        to: '2026-07-16T00:00:00Z',
      },
    })
    expect(res.isError).toBeFalsy()
    // Second call is the assembled scan.
    const [scanUrl, scanInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(String(scanUrl)).toBe('http://api.test/api/v1/research/prevalence')
    const doc = JSON.parse(scanInit.body as string)
    expect(doc.feature_version).toBe('feature_defs.v1')
    expect(doc.target).toBe('record_occurrences')
    expect(doc.where.all).toContainEqual(['feature.vpin', 'gte', 0.7])
    expect(doc.where.all).toContainEqual(['times.anchor_time', 'between', ['2026-07-09T00:00:00Z', '2026-07-16T00:00:00Z']])
  })
})

describe('client-serialization repair + universe sizing (0.2.2)', () => {
  it('repairs a string-encoded numeric value and array symbol on base_rate', async () => {
    const registry = JSON.stringify({
      schema_version: 'research_query.v2',
      normalization_version: 'archive_normalization.v1',
      feature_version: 'feature_defs.v1',
    })
    fetchMock
      .mockResolvedValueOnce(new Response(registry, { status: 200, headers: { etag: 'W/"reg"' } }))
      .mockResolvedValueOnce(new Response('{"counts":{}}', { status: 200 }))
    const client = await connectClient()

    await client.callTool({
      name: 'base_rate',
      arguments: {
        field: 'feature.vpin',
        operator: 'gte',
        value: '0.8',
        symbol: '["btcusdt","ethusdt"]',
        from: '2026-07-05T00:00:00Z',
        to: '2026-07-12T00:00:00Z',
      },
    })

    const prevalenceCall = fetchMock.mock.calls[1]
    const body = JSON.parse((prevalenceCall[1] as RequestInit).body as string) as {
      where: { all: [string, string, unknown][] }
    }
    expect(body.where.all).toContainEqual(['feature.vpin', 'gte', 0.8])
    expect(body.where.all).toContainEqual(['identity.symbol', 'in', ['btcusdt', 'ethusdt']])
  })

  it('leaves enum values untouched on base_rate', async () => {
    const registry = JSON.stringify({
      schema_version: 'research_query.v2',
      normalization_version: 'archive_normalization.v1',
      feature_version: 'feature_defs.v1',
    })
    fetchMock
      .mockResolvedValueOnce(new Response(registry, { status: 200, headers: { etag: 'W/"reg"' } }))
      .mockResolvedValueOnce(new Response('{"counts":{}}', { status: 200 }))
    const client = await connectClient()

    await client.callTool({
      name: 'base_rate',
      arguments: {
        field: 'feature.vpin_regime',
        operator: 'eq',
        value: 'critical',
        symbol: 'btcusdt',
        from: '2026-07-05T00:00:00Z',
        to: '2026-07-12T00:00:00Z',
      },
    })

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      where: { all: [string, string, unknown][] }
    }
    expect(body.where.all).toContainEqual(['feature.vpin_regime', 'eq', 'critical'])
    expect(body.where.all).toContainEqual(['identity.symbol', 'eq', 'btcusdt'])
  })

  const UNIVERSE = JSON.stringify({
    universe_encoding: 'universe_result.v1',
    feature_version: 'feature_defs.v1',
    dataset_revision: 'rev1',
    coverage: { from: '2026-05-15T00:00:00Z', to: '2026-07-26T00:00:00Z' },
    instruments: [
      {
        symbol: 'btcusdt',
        availability_status: 'present',
        feature_availability: { present_partition_days: 72, excluded_partition_days: 0 },
      },
      {
        symbol: '0gusdt',
        availability_status: 'partial',
        feature_availability: { present_partition_days: 51, excluded_partition_days: 21 },
      },
    ],
    notes: ['Coverage.to is exclusive.'],
  })

  it('list_instruments defaults to a compact summary, never the full body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(UNIVERSE, { status: 200, headers: { etag: 'W/"uni"' } }),
    )
    const client = await connectClient()
    const result = await client.callTool({ name: 'list_instruments', arguments: {} })
    const blocks = texts(result as { content: unknown })
    const summary = JSON.parse(blocks[1]) as Record<string, unknown>
    expect(summary.projection).toBe('summary')
    expect(summary.instrument_count).toBe(2)
    expect(summary.by_availability_status).toEqual({ present: 1, partial: 1 })
    expect(summary.dataset_revision).toBe('rev1')
    expect(summary.instruments_with_excluded_days).toBe(1)
    expect(blocks[1]).not.toContain('"instruments":[')
  })

  it('list_instruments symbols filter returns only the requested records + misses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(UNIVERSE, { status: 200, headers: { etag: 'W/"uni"' } }),
    )
    const client = await connectClient()
    const result = await client.callTool({
      name: 'list_instruments',
      arguments: { symbols: '["BTCUSDT","nopeusdt"]' },
    })
    const blocks = texts(result as { content: unknown })
    const projection = JSON.parse(blocks[1]) as {
      projection: string
      instruments: { symbol: string }[]
      not_in_universe: string[]
    }
    expect(projection.projection).toBe('symbols')
    expect(projection.instruments.map((entry) => entry.symbol)).toEqual(['btcusdt'])
    expect(projection.not_in_universe).toEqual(['nopeusdt'])
  })

  it('list_instruments full:true passes the canonical bytes through verbatim', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(UNIVERSE, { status: 200, headers: { etag: 'W/"uni"' } }),
    )
    const client = await connectClient()
    const result = await client.callTool({ name: 'list_instruments', arguments: { full: true } })
    const blocks = texts(result as { content: unknown })
    expect(blocks[1]).toBe(UNIVERSE)
  })

  // ── Projection-scoped ETags (2026-07-27 stress P1-2) ──────────────────
  // The raw API ETag names the FULL bytes. A summary-obtained ETag used to
  // 304 a full:true request ("identical result" for a body 500x larger than
  // the caller held). Projections now tag their ETags; cross-mode values
  // never revalidate.

  it('projection modes emit a projection-scoped ETag, never the raw full-body one', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(UNIVERSE, { status: 200, headers: { etag: 'W/"uni"' } })),
    )
    const client = await connectClient()
    const summary = await client.callTool({ name: 'list_instruments', arguments: {} })
    expect(texts(summary as { content: unknown })[0]).toContain('etag=W/"uni+summary"')
    const bySymbols = await client.callTool({
      name: 'list_instruments',
      arguments: { symbols: ['btcusdt'] },
    })
    const symMeta = texts(bySymbols as { content: unknown })[0]
    expect(symMeta).toMatch(/etag=W\/"uni\+symbols:[0-9a-f]{8}"/)
    expect(symMeta).not.toContain('etag=W/"uni"')
    const full = await client.callTool({ name: 'list_instruments', arguments: { full: true } })
    expect(texts(full as { content: unknown })[0]).toContain('etag=W/"uni"')
  })

  it('a summary ETag never forwards upstream against full:true or a different projection', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(UNIVERSE, { status: 200, headers: { etag: 'W/"uni"' } })),
    )
    const client = await connectClient()
    await client.callTool({
      name: 'list_instruments',
      arguments: { full: true, if_none_match: 'W/"uni+summary"' },
    })
    // full:true forwards the caller value verbatim (it cannot match upstream)
    let headers = (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['if-none-match']).toBe('W/"uni+summary"')
    // a raw full-body ETag against the summary projection is dropped entirely
    await client.callTool({ name: 'list_instruments', arguments: { if_none_match: 'W/"uni"' } })
    headers = (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['if-none-match']).toBeUndefined()
  })

  it('a matching summary ETag revalidates: base forwarded upstream, scoped 304 returned', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: 'W/"uni"' } }))
    const client = await connectClient()
    const result = await client.callTool({
      name: 'list_instruments',
      arguments: { if_none_match: 'W/"uni+summary"' },
    })
    const headers = (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['if-none-match']).toBe('W/"uni"')
    const meta = texts(result as { content: unknown })[0]
    expect(meta).toContain('304 Not Modified')
    expect(meta).toContain('etag=W/"uni+summary"')
  })
})
