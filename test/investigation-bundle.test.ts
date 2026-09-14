import { afterEach, expect, it, vi } from 'vitest'
import { connectClient, texts } from './helpers.js'
afterEach(() => vi.unstubAllGlobals())
it('reads compact or full API bytes verbatim without compute or interpretation', async () => {
  const id = 'a'.repeat(64)
  const bytes = '{ "schema_version":"investigation_evidence.v1", "metrics":[], "gaps":["unknown population"] }'
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(bytes, { headers: { 'content-type': 'application/json' } })))
  vi.stubGlobal('fetch', fetcher)
  const client = await connectClient()
  try {
    for (const full of [false, true]) {
      const result = await client.callTool({ name: 'get_investigation_bundle', arguments: { id, full } })
      expect(texts(result)).toContain(bytes)
      expect(String(fetcher.mock.calls.at(-1)![0])).toBe(`http://api.test/api/v1/research/investigation-bundle?id=${id}&full=${full}`)
    }
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally { await client.close() }
})
