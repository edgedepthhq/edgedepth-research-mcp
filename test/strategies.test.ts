import { afterEach, expect, it, vi } from 'vitest'
import { connectClient, texts, TEST_API_BASE } from './helpers.js'
afterEach(() => vi.unstubAllGlobals())
it('requires exact human approval and marks paid execution as a side effect', async () => {
  const client = await connectClient(), { tools } = await client.listTools()
  const run = tools.find(t => t.name === 'run_strategy')!
  expect(run.description).toContain('explicit human approval'); expect(run.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  expect(tools.find(t => t.name === 'prepare_strategy')!.annotations?.readOnlyHint).toBe(true)
  await client.close()
})
it('forwards the confirmed request unchanged and never starts a second call', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"id":"job","status":"queued"}', { status: 202 }))
  vi.stubGlobal('fetch', fetch); const client = await connectClient()
  const input = { document: { schema_version: 'trade_query.v2', example: 'exact' }, confirmation: 'a'.repeat(64), attempt: 1, units: 2, name: 'Private' }
  await client.callTool({ name: 'run_strategy', arguments: input })
  expect(String(fetch.mock.calls[0][0])).toBe(`${TEST_API_BASE}/strategies/run`)
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input); expect(fetch).toHaveBeenCalledTimes(1)
  await client.close()
})
it('preserves complete denominators, unknowns and reproducibility when projecting examples', async () => {
  const body = { trade_encoding: 'trade_result.v2', summaries: { test: { opportunities: 23, unknown: 2, mean_net_per_known_opportunity: null } }, comparisons: [{ known_pairs: 10, unknown_pairs: 13 }], query: { exact: true }, reproducibility_key: { revision: 'abc' }, opportunities: Array.from({ length: 23 }, (_, i) => ({ id: i })), trades: Array.from({ length: 46 }, (_, i) => ({ id: i })) }
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body)))))
  const client = await connectClient(), result = await client.callTool({ name: 'get_strategy', arguments: { id: 'a'.repeat(64), result: true } })
  const text = texts(result).join('\n'); expect(text).toContain('"opportunities":23'); expect(text).toContain('"unknown":2'); expect(text).toContain('"total_trade_rows":46'); expect(text).toContain('"mean_net_per_known_opportunity":null')
  const full = await client.callTool({ name: 'get_strategy', arguments: { id: 'a'.repeat(64), result: true, full: true } }); expect(texts(full).join('\n')).toContain(JSON.stringify(body))
  await client.close()
})
it('missing credentials cannot run or save', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const client = await connectClient(() => undefined)
  const r = await client.callTool({ name: 'save_strategy', arguments: { document: {}, name: 'Private' } })
  expect(r.isError).toBe(true); expect(fetch).not.toHaveBeenCalled(); await client.close()
})
