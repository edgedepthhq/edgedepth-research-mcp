import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectClient, texts } from './helpers.js'

const document = {
  schema_version: 'research_query.v2', target: 'record_occurrences',
  where: { all: [['feature.oi_velocity_pctrank', 'gte', 0.9]] },
  sort: ['times.anchor_time', 'asc'], page: { limit: 50, cursor: null },
}
afterEach(() => vi.unstubAllGlobals())

describe('the agreed outcome in a workbench handoff', () => {
  it.each(['touch', 'close'])('carries %s/down/2%%/4h without rewriting or recomputing the study', async (kind) => {
    const canonical = JSON.stringify({ query: document, reproducibility_key: { canonical_query_hash: 'abcdef01' } })
    const fetch = vi.fn().mockResolvedValueOnce(new Response(canonical, {
      headers: { 'X-Research-Cache': 'hit', 'X-Credits-Charged': '0' },
    })).mockResolvedValueOnce(new Response(JSON.stringify({ baseline: {} })))
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'run_scan', arguments: {
        document, full_counts: true,
        measure: { kind, direction: 'down', magnitude: 0.02, horizon: '4h' },
      } })
      expect(result.isError).not.toBe(true)
      expect(texts(result)).toContain(canonical)
      const link = texts(result).join('\n').match(/definition_handoff: (\S+)/)![1]
      const url = new URL(link)
      expect(JSON.parse(url.searchParams.get('rq')!)).toEqual(document)
      expect(url.searchParams.get('measure')).toBe(`${kind},down,0.02,4h`)
      expect(fetch).toHaveBeenCalledTimes(2)
      for (const [, init] of fetch.mock.calls) expect(JSON.parse(init.body)).toEqual(document)
    } finally { await client.close() }
  })

  it.each([
    { kind: 'touch', direction: 'up', magnitude: 2, horizon: '4h' },
    { kind: 'close', direction: 'up', magnitude: 0.02, horizon: '7d' },
  ])('keeps valid large sizes and long horizons: %j', async (measure) => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ query: document })))
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'run_scan', arguments: { document, measure } })
      expect(result.isError).not.toBe(true)
      expect(texts(result).join('')).toContain(encodeURIComponent([measure.kind, measure.direction, measure.magnitude, measure.horizon].join(',')))
    } finally { await client.close() }
  })

  it.each([
    { kind: 'touch', direction: 'down', magnitude: 2, horizon: '4h' },
    { kind: 'touch', direction: 'up', magnitude: 0.023, horizon: '4h' },
    { kind: 'close', direction: 'up', magnitude: 0.02, horizon: '3h' },
  ])('rejects an unsupported display choice before any request: %j', async (measure) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'run_scan', arguments: { document, measure } })
      expect(result.isError).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
    } finally { await client.close() }
  })
})
