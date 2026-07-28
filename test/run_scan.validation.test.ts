import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache } from '../src/index.js'
import { connectClient, texts, TEST_KEY } from './helpers.js'

const fetchMock = vi.fn()

beforeEach(() => {
  clearRegistryCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('run_scan validation passthrough', () => {
  it('POSTs the document verbatim and surfaces the 422 contract code byte-identically', async () => {
    const body = JSON.stringify({
      errors: [{ code: 'OUTCOME_IN_PREDICATE', message: 'Outcome fields cannot be filtered.' }],
    })
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 422, headers: { 'content-type': 'application/json' } }),
    )

    const client = await connectClient()
    const document = {
      schema_version: 'research_query.v2',
      target: 'record_occurrences',
      where: { all: [['outcome.ret_1h', 'gte', 0.05]] },
    }
    const res = await client.callTool({ name: 'run_scan', arguments: { document } })

    expect(res.isError).toBe(true)
    // The 422 body reaches the agent byte-for-byte (contract codes intact).
    expect(texts(res)).toContain(body)

    // The engine sees the exact document, over POST /query, with the bearer key.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('http://api.test/api/v1/research/query')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TEST_KEY}`)
    expect(JSON.parse(init.body as string)).toEqual(document)
  })

  it('does not validate the document itself (any object is forwarded for the API to judge)', async () => {
    const body = JSON.stringify({ errors: [{ code: 'INVALID_SHAPE', message: 'not a document' }] })
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 422 }))
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: { nonsense: true } } })
    expect(res.isError).toBe(true)
    expect(texts(res)).toContain(body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a helpful error and makes no call when no key is configured', async () => {
    const client = await connectClient(() => undefined)
    const res = await client.callTool({ name: 'run_scan', arguments: { document: {} } })
    expect(res.isError).toBe(true)
    expect(texts(res).join('\n')).toContain('EDGEDEPTH_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds authenticated web links for complete-result representatives without changing body bytes', async () => {
    const body = JSON.stringify({
      reproducibility_key: { canonical_query_hash: 'abcdef0123456789' },
      representatives: [
        {
          id: 'median_fwd_ret_30m',
          replay: {
            symbol: 'btcusdt',
            from: '2026-07-20T00:00:00.000Z',
            to: '2026-07-20T02:00:00.000Z',
            seek: '2026-07-20T00:30:00.000Z',
          },
        },
      ],
    })
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }))
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: {} } })
    const blocks = texts(res)
    expect(blocks).toContain(body)
    expect(blocks.join('\n')).toContain('https://app.edgedepth.com/terminal?')
    expect(blocks.join('\n')).toContain('marker=rq%3Aabcdef01')
  })
})
