import { afterEach, expect, it, vi } from 'vitest'
import { connectClient, texts, TEST_API_BASE } from './helpers.js'
afterEach(() => vi.unstubAllGlobals())
it('requires a separate approved execution proposal and names omitted costs', async () => {
 const client = await connectClient(); const { tools } = await client.listTools(); const tool = tools.find(t => t.name === 'run_trade_test')!
 expect(tool.description).toContain('explicit human approval'); expect(tool.description).toContain('Funding is omitted'); expect(tool.description).toContain('trailing updates start next bar')
 expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false })
 await client.close()
})
it('forwards exact rules and source; never converts MFE into a trade return', async () => {
 const fetch = vi.fn().mockResolvedValue(new Response('{"trade_encoding":"trade_result.v1","summary":{"completed":0,"expectancy_after_fees_slippage":null}}', { headers: { 'content-type': 'application/json', 'X-Research-Cache': 'hit' } }))
 vi.stubGlobal('fetch', fetch); const client = await connectClient()
 const document = { schema_version: 'trade_query.v1', population: { original: 'unchanged' }, rules: { version: 'trade_rules.v1' }, source_measurement: { question: 'Original question' } }
 const result = await client.callTool({ name: 'run_trade_test', arguments: { document } })
 expect(String(fetch.mock.calls[0][0])).toBe(`${TEST_API_BASE}/trade-test`); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(document)
 expect(texts(result).join('\n')).toContain('"expectancy_after_fees_slippage":null'); expect(fetch).toHaveBeenCalledTimes(1); await client.close()
})
it('missing credentials cannot start a test', async () => {
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const client = await connectClient(() => undefined)
 const result = await client.callTool({ name: 'run_trade_test', arguments: { document: {} } }); expect(result.isError).toBe(true); expect(fetch).not.toHaveBeenCalled(); await client.close()
})

it('compact journal rows never change the complete summary or canonical full read', async () => {
 const { compactTradeResult } = await import('../src/tradeProjection.js')
 const body = { trade_encoding: 'trade_result.v1', summary: { signals: 30, completed: 25, missing: 2, overlap_skipped: 3, expectancy_after_fees_slippage: -.01 }, query: { exact: true }, trades: Array.from({ length: 30 }, (_, i) => ({ signal: i })) }
 const original = { status: 200, ok: true, notModified: false, bodyText: JSON.stringify(body), headers: {} }
 const compact = JSON.parse(compactTradeResult(original).bodyText)
 expect(compact.summary).toEqual(body.summary); expect(compact.query).toEqual(body.query); expect(compact.trades).toHaveLength(10); expect(compact.trade_projection.total_journal_rows).toBe(30)
 expect(JSON.parse(original.bodyText).trades).toHaveLength(30)
})
