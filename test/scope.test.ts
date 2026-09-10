import { afterEach, expect, it, vi } from 'vitest'
import { connectClient, texts } from './helpers.js'
afterEach(() => vi.unstubAllGlobals())
it('resolves scope with a free authenticated GET and preserves a blocked result', async () => {
  const body = { schema_version: 'research_scope.v1', symbols: [], blockedReason: 'No recorded sector', execution: 'not_run' }
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))
  vi.stubGlobal('fetch', fetch)
  const client = await connectClient()
  try {
    const result = await client.callTool({ name: 'resolve_scope', arguments: { symbol: 'tutusdt', sector: 'sector_meme' } })
    expect(texts(result)).toContain(JSON.stringify(body))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toContain('/scope?symbol=tutusdt&sector=sector_meme')
    expect(fetch.mock.calls[0][1].method).toBe('GET')
  } finally { await client.close() }
})
