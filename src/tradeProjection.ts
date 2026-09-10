import type { ApiResponse } from './apiClient.js'

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
