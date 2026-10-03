import { afterEach, expect, it, vi } from 'vitest'
import { connectClient, texts } from './helpers.js'
afterEach(() => vi.unstubAllGlobals())
it('reads the exact saved assessment and preserves correction refusals without a model or compute call', async () => {
  const id = 'observation-binancef-lskusdt-1789254000000', edition = 'a'.repeat(64)
  const bytes = '{"schema_version":"investigation_assessment_readout.v1","assessment":{"summary":"An uncertain explanation."}}'
  const fetcher = vi.fn(async (_url: unknown, _init?: unknown) => new Response(bytes, { headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  const client = await connectClient()
  try {
    expect(texts(await client.callTool({name:'get_investigation_assessment',arguments:{id,edition}}))).toContain(bytes)
    expect(String(fetcher.mock.calls[0][0])).toBe(`http://api.test/api/v1/research/investigation-assessment?id=${id}&edition=${edition}`)
    fetcher.mockImplementation(async () => new Response('{"code":"EVIDENCE_INVALIDATED"}',{status:410}))
    expect(texts(await client.callTool({name:'get_investigation_assessment',arguments:{id,edition}})).join('\n')).toContain('EVIDENCE_INVALIDATED')
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally { await client.close() }
})
