import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectClient, texts, TEST_API_BASE } from './helpers.js'
import { SCREENSHOT_URI, compactScreenshotSources } from '../src/screenshots.js'
afterEach(() => vi.unstubAllGlobals())

describe('screenshot tools: deterministic protocol contracts, not vision acceptance', () => {
  it.each(['ground_screenshots', 'investigate_move'])(
    'passes %s observations and response bytes unchanged, without a scan',
    async (name) => {
      const document = {
        schema_version: 'screenshot_observation.v1',
        images: [
          {
            image_id: 'cropped',
            start: { value: null, source: 'missing', evidence: 'Date cropped' },
          },
        ],
      }
      const input =
        name === 'ground_screenshots'
          ? { document }
          : {
              document,
              event_id: 'move-a',
              family: 'desc_resistance_short',
              study: {
                schema_version: 'outcome_first_query.v1',
                symbols: ['btcusdt'],
                window: { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' },
                target: { kind: 'finished', direction: 'down', magnitude: 0.05, horizon: '24h' },
              },
            }
      const bytes =
        '{ "status":"needs_clarification", "credits_charged":0, "question":"What date and time zone?", "missing":null }'
      const fetch = vi.fn(
        async () => new Response(bytes, { headers: { 'x-research-credits-charged': '0' } }),
      )
      vi.stubGlobal('fetch', fetch)
      const client = await connectClient()
      try {
        const result = await client.callTool({ name, arguments: input })
        expect(texts(result)).toContain(bytes)
        expect(texts(result)[0]).toContain('credits_charged=0')
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(fetch.mock.calls[0][0].toString()).toBe(
          TEST_API_BASE + (name === 'ground_screenshots' ? '/investigate/ground' : '/investigate'),
        )
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input)
      } finally {
        await client.close()
      }
    },
  )
  it.each([403, 404, 422, 429, 502])(
    'retains entitlement, deployment, contract and source failure HTTP %s',
    async (status) => {
      const bytes = '{"code":"FIXTURE_ERROR","error":"Keep this failure"}'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(bytes, { status })),
      )
      const client = await connectClient()
      try {
        const result = await client.callTool({
          name: 'ground_screenshots',
          arguments: { document: {} },
        })
        expect(result.isError).toBe(true)
        expect(texts(result)).toContain(bytes)
      } finally {
        await client.close()
      }
    },
  )
  it('requires an account before any API request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient(() => undefined)
    try {
      const result = await client.callTool({
        name: 'ground_screenshots',
        arguments: { document: {} },
      })
      expect(result.isError).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })
  it('exposes host vision, uncertainty, deduplication and explicit paid-study consent', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const resource = await client.readResource({ uri: SCREENSHOT_URI })
      const contract = (resource.contents[0] as { text: string }).text
      for (const word of [
        'visible',
        'inferred',
        'missing',
        'same_event',
        'independent',
        'commonality_input',
        'minute CLOSE boundary',
        'Wick',
        'setup_first_rerun',
        'explicit human approval',
        'selected screenshot sample',
      ])
        expect(contract.toLowerCase()).toContain(word.toLowerCase())
      expect(client.getInstructions()).toContain(
        'For attached chart screenshots, use the host vision',
      )
      const prompt = await client.getPrompt({ name: 'investigate_screenshots' })
      const text = (prompt.messages[0].content as { text: string }).text
      expect(text).toContain('wait for my confirmation')
      expect(text).toContain('one concise clarification')
      expect(text).toContain('separate period')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })
})

describe('inspectable screenshot projection', () => {
  it('omits only stated duplicate/raw sources and retains exact documents, gaps, parity and failures', () => {
    const source = {
      schema_version: 'screenshot_investigation.v1',
      source_snapshots: [
        { status: 404, at: 'exact', body: '{"code":"NO_DATA"}' },
        { status: 200, at: 'observed', body: 'duplicate observed values' },
      ],
      offsets: [
        { error: 'No data', reading: null },
        { at: 'observed', error: null, reading: { rows: [{ value: null }], standouts: [] } },
      ],
      geometry: {
        status: 200,
        body: JSON.stringify({
          candles: { bars: [1, 2] },
          tape: { missing: 2 },
          parity: { all_match: false },
        }),
      },
      setup_proposals: [
        { setup_first_rerun: { exact: 'document' }, target: { kind: 'finished', horizon: '24h' } },
      ],
    }
    const original = JSON.stringify(source)
    const projected = compactScreenshotSources({
      status: 200,
      ok: true,
      notModified: false,
      bodyText: original,
      headers: {},
    })
    const body = JSON.parse(projected.bodyText)
    expect(body.setup_proposals).toEqual(source.setup_proposals)
    expect(body.offsets[0]).toEqual(source.offsets[0])
    expect(body.source_snapshots[0]).toEqual(source.source_snapshots[0])
    expect(body.source_snapshots[1]).toEqual({ status: 200, at: 'observed' })
    expect(JSON.parse(body.geometry.body)).toEqual({
      candles: {},
      tape: { missing: 2 },
      parity: { all_match: false },
    })
    expect(body.projection.restore).toContain('full_sources: true')
    expect(JSON.stringify(source)).toBe(original)
  })
  it('returns complete API bytes with full_sources without forwarding the projection flag', async () => {
    const bytes =
      '{ "schema_version":"screenshot_investigation.v1", "source_snapshots":[{"body":"exact bytes"}] }'
    const fetch = vi.fn(async () => new Response(bytes))
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const result = await client.callTool({
        name: 'investigate_move',
        arguments: { document: {}, event_id: 'e', full_sources: true },
      })
      expect(texts(result)).toContain(bytes)
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ document: {}, event_id: 'e' })
    } finally {
      await client.close()
    }
  })
})
