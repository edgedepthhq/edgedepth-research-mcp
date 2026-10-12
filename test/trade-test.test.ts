import { afterEach, expect, it, vi } from 'vitest'
import { connectClient, texts, TEST_API_BASE, widgetHost } from './helpers.js'
import { tradePayoffMeta, TRADE_PAYOFF_URI } from '../src/tradeProjection.js'
import { TRADE_PAYOFF_HTML } from '../src/tradePayoffHtml.js'
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

// Five completed trades (two wins, three losses), one unavailable, one skipped.
const trade = (symbol: string, value: number | null, reason: string) => ({ symbol, reason, return_after_fees_slippage: value })
const journal = [trade('4usdt', 0.3, 'time'), trade('abcusdt', 0.1, 'stop'), trade('abcusdt', -0.05, 'stop'), trade('xyzusdt', -0.05, 'stop'),
  trade('xyzusdt', -0.1, 'time'), trade('abcusdt', null, 'missing_path'), trade('abcusdt', null, 'overlap_skipped')]
const summary = { signals: 7, completed: 5, missing: 1, overlap_skipped: 1, wins: 2, losses: 3, flat: 0, ambiguous: 0,
  average_win: 0.2, average_loss: -0.2 / 3, expectancy_after_fees_slippage: 0.04, win_rate: 0.4 }
const rules = { version: 'trade_rules.v1', direction: 'long', stop_fraction: 0.1, target_fraction: 0, trail_fraction: 0.25,
  max_hold_minutes: 1440, fee_bps_per_side: 6, slippage_bps_per_side: 30, overlap: 'skip_until_exit' }
const tradeBody = { trade_encoding: 'trade_result.v1', query: { rules, source_measurement: { question: 'Do long trades after the warning signs pay?' },
  population: { where: { all: [['identity.symbol', 'in', ['4usdt', 'abcusdt', 'xyzusdt']]] } } },
  population_counts: { total_matching: 7, symbols_scanned: 3 }, summary, trades: journal, notes: ['Funding omitted.'] }
const ok = (body: unknown) => ({ ok: true, status: 200, notModified: false, bodyText: JSON.stringify(body), headers: { cache: 'hit', creditsCharged: '0' } })

it('leads with payoff from the complete journal and attaches the payoff view', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(tradeBody)))
  vi.stubGlobal('fetch', fetch); const client = await connectClient()
  expect((await client.listTools()).tools.find(t => t.name === 'run_trade_test')!._meta?.ui).toEqual({ resourceUri: TRADE_PAYOFF_URI })
  const result = await client.callTool({ name: 'run_trade_test', arguments: { document: { rules } } })
  const [lead, bytes] = texts(result)
  expect(lead!.split('\n')[0]).toBe('Payoff: each long trade made 4.00% on average after fees and slippage, over 5 completed trades (fewer than 30: too few to judge).')
  expect(lead).toContain('Wins vs losses: 2 wins, 3 losses (win rate 40.0%). Average win +20.00% (2). Average loss -6.67% (3). Added up: wins +40.00%, losses -20.00%.')
  expect(lead).toContain("Largest win: +30.00% (4USDT), 75.0% of all winning trades' profit.")
  expect(lead).toContain('Exits: 3 at the stop (initial or trailing), 2 at the time limit.')
  expect(lead).toContain('Not completed: 1 unavailable (missing prices), 1 skipped')
  expect(lead).toContain('Excluded: funding. Holds end by 1440 minutes and can never exceed 1440 minutes (24h)')
  expect(lead!.indexOf('Payoff:')).toBeLessThan(lead!.indexOf('[edgedepth]'))
  expect(JSON.parse(bytes!).summary).toEqual(summary)
  expect((result._meta as any).edgedepthTrade.largestWin).toMatchObject({ return: 0.3, symbol: '4usdt', share_of_gross_profit: expect.closeTo(0.75, 12) })
  expect(fetch).toHaveBeenCalledTimes(1); await client.close()
  const resource = await (await connectClient()).readResource({ uri: TRADE_PAYOFF_URI })
  expect(resource.contents[0]!.text).toBe(TRADE_PAYOFF_HTML)
})

it('never derives a largest-win share from a journal that does not reproduce the summary', () => {
  const evidence = (tradePayoffMeta(ok({ ...tradeBody, summary: { ...summary, wins: 3 } })) as any).edgedepthTrade
  expect(evidence.state).toBe('ready'); expect(evidence.largestWin).toBeUndefined(); expect(evidence.exits).toBeUndefined()
  const trimmed = (tradePayoffMeta(ok({ ...tradeBody, trades: journal.slice(0, 3) })) as any).edgedepthTrade
  expect(trimmed.largestWin).toBeUndefined()
})

it('payoff view leads with the verdict, pairs wins with losses and states exclusions', () => {
  const ui = widgetHost(TRADE_PAYOFF_HTML, tradePayoffMeta(ok(tradeBody)))
  expect(ui.get('app').hidden).toBe(false)
  expect(ui.get('title').textContent).toBe('Trade test: long after the setup')
  expect(ui.get('question').textContent).toBe('Question: Do long trades after the warning signs pay?')
  expect(ui.get('rules').textContent).toContain('Long · enter at the next minute\'s open · 10% stop · no fixed target · 25% trailing stop from closes · hold up to 1,440 minutes · 6 bps fee + 30 bps slippage per side')
  expect(ui.get('headline').textContent).toBe('Too few completed trades to judge. It paid on these past trades: +4.00% per trade on average after fees and slippage, before funding.')
  expect(ui.get('headlineCounts').textContent).toBe('5 completed trades: 2 wins, 3 losses (40.0% won).')
  const compare = ui.get('compare').children.map(c => c.textContent)
  expect(compare.slice(3)).toEqual(['How many', ' 2', ' 3', 'Average size', ' +20.00%', ' -6.67%', 'All added up', ' +40.00%', ' -20.00%'])
  expect(ui.get('largest').textContent).toBe("Largest win: +30.00% on 4USDT, 75.0% of all winning trades' profit.")
  expect(ui.get('coverage').textContent).toBe('7 signals: 5 completed, 1 unavailable (missing prices), 1 skipped while the same market had a trade open.')
  expect(ui.get('excluded').textContent).toContain('Not included: funding payments. Holds are capped at 1,440 minutes (24h)')
  const losing = { ...tradeBody, summary: { ...summary, completed: 186, wins: 56, losses: 130, expectancy_after_fees_slippage: -0.0167 } }
  ui.receive({ _meta: tradePayoffMeta(ok(losing)) })
  expect(ui.get('headline').textContent).toBe('It did not pay: -1.67% per trade on average after fees and slippage.')
  expect(ui.get('answer').className).toBe('negative')
  ui.receive({ _meta: tradePayoffMeta({ ok: false, status: 422, notModified: false, bodyText: '{"errors":[{"code":"INVALID_RULES","message":"stop_fraction required"}]}', headers: {} }) })
  expect(ui.get('app').hidden).toBe(true); expect(ui.get('title').textContent).toBe('The engine rejected these rules')
  expect(ui.get('status').textContent).toContain('INVALID_RULES: stop_fraction required')
  ui.receive({ _meta: tradePayoffMeta({ ok: true, status: 304, notModified: true, bodyText: '', headers: {} }) })
  expect(ui.get('status').textContent).toContain('(304)')
  ui.receive({})
  expect(ui.get('status').textContent).toContain('did not provide payoff evidence')
})
