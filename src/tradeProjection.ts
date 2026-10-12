import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiResponse } from './apiClient.js'
import { studyHeading } from './scanChart.js'
import { TRADE_PAYOFF_HTML } from './tradePayoffHtml.js'

export const TRADE_PAYOFF_URI = 'ui://edgedepth/trade-payoff-v1.html'

/** Keep the complete summary and provenance; only journal rows are examples. */
export function compactTradeResult(res: ApiResponse): ApiResponse {
  if (!res.ok || res.notModified) return res
  try {
    const body = JSON.parse(res.bodyText)
    if (body?.trade_encoding !== 'trade_result.v1' || !Array.isArray(body.trades)) return res
    return { ...res, bodyText: JSON.stringify({ ...body, trades: body.trades.slice(0, 10),
      trade_projection: { version: 'trade_summary.v1', total_journal_rows: body.trades.length,
        returned_journal_rows: Math.min(body.trades.length, 10),
        note: 'Journal rows are chronological examples. Summary counts and averages cover every event. Use full_trades:true for all rows.' } }) }
  } catch { return res }
}

const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function tradeBody(res: ApiResponse): Record<string, any> | null {
  if (!res.ok || res.notModified) return null
  try {
    const body: unknown = JSON.parse(res.bodyText)
    return object(body) && body.trade_encoding === 'trade_result.v1' && object(body.summary) ? body : null
  } catch { return null }
}

/** Payoff facts from the complete journal, before rows are trimmed. Derived
 * only when the journal reproduces the engine's win/loss counts; otherwise
 * null, never an estimate. Exits are counted by the engine's reason. */
function journal(body: Record<string, any>) {
  const trades: unknown[] = Array.isArray(body.trades) ? body.trades : []
  const s = body.summary
  if (trades.length !== s.signals) return null
  const exits: Record<string, number> = {}
  let largest: Record<string, any> | null = null, wins = 0, losses = 0, profit = 0
  for (const t of trades) {
    if (!object(t) || !finite(t.return_after_fees_slippage)) continue
    const v = t.return_after_fees_slippage
    exits[String(t.reason)] = (exits[String(t.reason)] ?? 0) + 1
    if (v > 0) { wins++; profit += v; if (!largest || v > largest.return_after_fees_slippage) largest = t }
    else if (v < 0) losses++
  }
  if (wins !== s.wins || losses !== s.losses) return null
  return { exits, largestWin: largest && profit > 0 ? { return: largest.return_after_fees_slippage,
    symbol: typeof largest.symbol === 'string' ? largest.symbol : null, share_of_gross_profit: largest.return_after_fees_slippage / profit } : null }
}

export const EXIT_LABELS: Record<string, string> = { time: 'at the time limit', stop: 'at the stop (initial or trailing)', target: 'at the target' }
const signed = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`

/** The payoff first, from the engine's complete summary. Frequency is not payoff. */
export function tradePayoffLead(res: ApiResponse, document?: Record<string, unknown>): string | null {
  const body = tradeBody(res)
  if (!body) return null
  const s = body.summary, rules = object(body.query?.rules) ? body.query.rules : object(document?.rules) ? document.rules : {}
  if (![s.signals, s.completed, s.wins, s.losses].every(count)) return null
  const lines: string[] = []
  const side = rules.direction === 'short' ? 'short' : rules.direction === 'long' ? 'long' : 'stated-direction'
  if (!finite(s.expectancy_after_fees_slippage) || s.completed === 0) {
    lines.push(`Payoff: no completed ${side} trades, so there is no expectancy (${s.signals} signals).`)
  } else {
    const e = s.expectancy_after_fees_slippage
    lines.push(`Payoff: each ${side} trade ${e < 0 ? 'lost' : e > 0 ? 'made' : 'broke even at'} ${(Math.abs(e) * 100).toFixed(2)}% on average after fees and slippage, over ${s.completed} completed trades${s.completed < 30 ? ' (fewer than 30: too few to judge)' : ''}.`)
    const flat = count(s.flat) && s.flat > 0 ? `, ${s.flat} flat` : ''
    lines.push(`Wins vs losses: ${s.wins} wins, ${s.losses} losses${flat}${finite(s.win_rate) ? ` (win rate ${(s.win_rate * 100).toFixed(1)}%)` : ''}.` +
      (finite(s.average_win) ? ` Average win ${signed(s.average_win)} (${s.wins}).` : '') +
      (finite(s.average_loss) ? ` Average loss ${signed(s.average_loss)} (${s.losses}).` : '') +
      (finite(s.average_win) && finite(s.average_loss) ? ` Added up: wins ${signed(s.wins * s.average_win)}, losses ${signed(s.losses * s.average_loss)}.` : ''))
  }
  const j = journal(body)
  if (j?.largestWin) lines.push(`Largest win: ${signed(j.largestWin.return)}${j.largestWin.symbol ? ` (${j.largestWin.symbol.toUpperCase()})` : ''}, ${(j.largestWin.share_of_gross_profit * 100).toFixed(1)}% of all winning trades' profit.`)
  if (j && Object.keys(j.exits).length) lines.push(`Exits: ${Object.entries(j.exits).sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${EXIT_LABELS[reason] ?? reason}`).join(', ')}.`)
  lines.push(`Not completed: ${count(s.missing) ? s.missing : 'unknown'} unavailable (missing prices), ${count(s.overlap_skipped) ? s.overlap_skipped : 'unknown'} skipped while the same market had a trade open.`)
  lines.push(`Excluded: funding. Holds end by ${count(rules.max_hold_minutes) ? rules.max_hold_minutes : 'the stated'} minutes and can never exceed 1440 minutes (24h), so longer runs cannot be tested here. Event trades of one unit each, not a portfolio.`)
  return lines.join('\n')
}

/** UI-only payoff evidence. Never alters bytes, the projection or metering. */
export function tradePayoffMeta(res: ApiResponse, document?: Record<string, unknown>): Record<string, unknown> {
  if (res.notModified) return { edgedepthTrade: { state: 'not_modified' } }
  if (!res.ok) {
    let errors: unknown = [{ code: `HTTP_${res.status}`, message: 'The trade test did not complete.' }]
    try {
      const failure = JSON.parse(res.bodyText)
      if (Array.isArray(failure?.errors)) errors = failure.errors
      else if (typeof failure?.code === 'string') errors = [{ code: failure.code, message: String(failure.error ?? failure.message ?? '') }]
    } catch { /* Keep the transport status. */ }
    return { edgedepthTrade: { state: 'error', status: res.status, errors } }
  }
  const body = tradeBody(res)
  if (!body) return { edgedepthTrade: { state: 'unavailable' } }
  const query = object(body.query) ? body.query : document ?? {}
  const counts = object(body.population_counts) ? body.population_counts : {}
  const source = object(query.source_measurement) ? query.source_measurement : object(document?.source_measurement) ? document.source_measurement : {}
  return { edgedepthTrade: {
    state: 'ready', heading: studyHeading(query, counts), question: typeof source.question === 'string' ? source.question : null,
    rules: object(query.rules) ? query.rules : null, summary: body.summary, ...journal(body),
    notes: body.notes, key: body.reproducibility_key,
    metering: { cache: res.headers.cache, charged: res.headers.creditsCharged, remaining: res.headers.creditsRemaining },
  } }
}

export function registerTradePayoff(server: McpServer): void {
  server.registerResource('trade-payoff', TRADE_PAYOFF_URI, {}, async () => ({
    contents: [{
      uri: TRADE_PAYOFF_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: TRADE_PAYOFF_HTML,
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        'openai/widgetDescription': 'Whether the approved trade rules paid after fees and slippage: expectancy, wins and losses, average win and loss, and exclusions.',
      },
    }],
  }))
}
