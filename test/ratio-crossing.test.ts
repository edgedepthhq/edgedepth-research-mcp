import { afterEach, expect, it, vi } from 'vitest'
import { clearRegistryCache } from '../src/index.js'
import { connectClient, texts } from './helpers.js'

afterEach(() => { vi.unstubAllGlobals(); clearRegistryCache() })
it('discovers a query-derived crossing from the API without an MCP feature allowlist', async () => {
  clearRegistryCache()
  const id = 'feature.price_oi_ratio_cross_5m_v1'
  const feature = { dtype: 'enum', values: ['none', 'above', 'below'], implemented: true,
    live_available: false, description: 'Price versus OI/supply crossing at five-minute closes, daily 00:05 UTC reference.' }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ features: { [id]: feature } }), { status: 200 }))))
  const client = await connectClient()
  try {
    const result = await client.callTool({ name: 'list_features', arguments: { feature_ids: [id] } })
    expect(result.isError).not.toBe(true)
    const body = JSON.parse(texts(result).find(t => t.startsWith('{'))!)
    expect(body.features[id]).toMatchObject(feature)
  } finally { await client.close() }
})
