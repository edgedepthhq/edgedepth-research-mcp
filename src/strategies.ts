import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { apiRequest, type ApiResponse, type ApiRequest } from './apiClient.js'
import type { ToolContext, ToolResult } from './tools.js'
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const
const id = z.string().regex(/^[a-f0-9]{64}$/)
export function registerStrategyTools(server: McpServer, ctx: ToolContext, passthrough: (r: ApiResponse) => ToolResult) {
  const request = (options: ApiRequest): Promise<ApiResponse> => options.key
    ? apiRequest(ctx.apiBase, options)
    : Promise.resolve({ status: 401, ok: false, notModified: false, bodyText: '{"code":"AUTH_REQUIRED","error":"Connect your Research account first."}', headers: {} })
  server.registerTool('get_strategy', {
    title: 'Read private strategy history, results or qualified sources',
    description: 'Use this when the user wants to inspect the same private strategies and immutable results as the web. With no id, list saved definitions and all trial attempts; catalog=true reads qualified OHLC/volume/funding source coverage, exact revision and contract limits. With id, read status/progress; result=true reads a completed result. Reads never compute, retry, arm monitoring or spend allowance. Full=false retains whole-result summaries, comparisons, coverage, exact definition and reproducibility, but only ten example opportunities and trades. Never infer denominators from those examples. Funding gaps remain unknown, bracketed zero-settlement holds remain included, and net risk units/exposure are not portfolio returns. A negative result is a valid outcome. Do not use this to start computation or monitor live markets.',
    inputSchema: { id: id.optional(), catalog: z.boolean().optional(), result: z.boolean().optional(), full: z.boolean().optional() }, annotations: read,
  }, async ({ id, catalog, result, full }) => {
    if ((catalog && id) || (result && !id)) return { isError: true, content: [{ type: 'text', text: 'Choose catalog, list, a job id, or a completed result id.' }] }
    const res = await request({ method: 'GET', path: `/strategies/${catalog ? 'catalog' : id ? result ? 'result' : 'job' : 'list'}`, key: ctx.getKey(), ...(id ? { query: { id } } : {}) })
    if (result && !full && res.ok) {
      const body = JSON.parse(res.bodyText)
      if (body.trade_encoding === 'trade_result.v2') {
        const projected = { ...body, opportunities: body.opportunities.slice(0, 10), trades: body.trades.slice(0, 10), projection: { version: 'strategy_summary.v1', example_opportunities: Math.min(10, body.opportunities.length), total_opportunities: body.opportunities.length, total_trade_rows: body.trades.length, note: 'Full summaries and paired comparisons; journal examples are not the denominator. full=true restores immutable canonical bytes.' } }
        return passthrough({ ...res, headers: { ...res.headers, etag: undefined }, bodyText: JSON.stringify(projected) })
      }
    }
    return passthrough(res)
  })
  server.registerTool('prepare_strategy', {
    title: 'Estimate an exact strategy study without running it',
    description: 'Use this when the user wants to prepare trade_query.v2 using the backend-owned contract and exact qualified dataset revision. Get sources with get_strategy(catalog=true). The document has symbols, from_ms/to_ms (UTC day boundaries, to exclusive), setup (first_daily_base_break with base_days, reference_blocks, compression_ratio, turnover_baseline_days, awakening_multiple, min_usual_daily_turnover, cooldown_minutes), a common decision_delay_minutes and horizon_minutes, atr_hours, persistence (intervals, interval_minutes, multiple, required_intervals, require_latest, max_interval_share), 1-4 policies, costs, split_at_ms and source_measurement. Every field is explicit, including zero/false. Each policy has id, direction=long, cohort (all/neither/compression_only/awakening_only/both), persistence (any/persistent/fading), nullable max_extension_atr; entry {kind:market|pullback_limit|pullback_reclaim,delay_minutes,expiry_minutes,recent_high_minutes,pullback_fraction,reclaim_fraction,cancel_below_base}; stop {kind:fixed|base_low|pullback_low|atr,fraction,atr_multiple,buffer_atr}; target_fraction, trail_fraction, trail_basis (none/previous_extreme/completed_close). Costs are round_trip_fraction, low_liquidity_threshold, low_liquidity_extra_fraction and funding (fixed_notional_settlements.v1 or omitted). Pullback is below a recent completed high at submission, not below alert price; reclaim fills only next bar after its close. Persistence intervals finish before the common decision. LB1 funding is fixed-notional, not mark-price cash flow. Return the inspectable estimate to the human with all assumptions before run_strategy. Preparation is free and creates no saved state. Do not use this to execute a study. Never optimize thresholds or call a rule validated from a numeric example.',
    inputSchema: { document: z.record(z.unknown()) }, annotations: read,
  }, async input => passthrough(await request({ method: 'POST', path: '/strategies/estimate', key: ctx.getKey(), body: input })))
  server.registerTool('save_strategy', {
    title: 'Save an account-owned strategy definition',
    description: 'Use this when the user asks to save a private strategy definition. Requires optional research:strategies permission and Research entitlement. Saves immutable exact trade_query.v2 bytes with an optional private predecessor (revisit_of). Changed rules, dates or sources create a new hash; previous results and attempts remain. No computation, monitoring, trading or public publication. General v1 browser-local saves are unchanged. Do not use this to run computation or publish a strategy.',
    inputSchema: { document: z.record(z.unknown()), name: z.string().max(120), revisit_of: id.optional() }, annotations: write,
  }, async input => passthrough(await request({ method: 'POST', path: '/strategies/save', key: ctx.getKey(), body: input })))
  server.registerTool('run_strategy', {
    title: 'Run one exactly approved background strategy study',
    description: 'Use this when the user wants to run a study, only after explicit human approval of the exact prepare_strategy definition, scope, rules, funding convention, assumptions and allowance, send its unchanged document, confirmation, attempt and units. Requires Research plus optional research:strategies permission. A hash or model flag is not consent. Do not use this without that exact human approval. Fresh computation reserves allowance once; duplicate retries do not double bill; cached results are free; known failed/cancelled attempts refund. Returns a private job id; read progress/result with get_strategy. After ambiguous transport completion read that same job id (the canonical query hash) before deciding to retry. Failed/cancelled work requires a fresh estimate and explicit retry approval. Never change clocks or exclude no-fill/unknown opportunities to improve a result. No live monitoring or execution is armed. Event returns and risk units are not portfolio performance.',
    inputSchema: { document: z.record(z.unknown()), confirmation: id, attempt: z.number().int().min(1).max(3), units: z.number().int().nonnegative(), name: z.string().max(120), revisit_of: id.optional() }, annotations: { ...write, destructiveHint: true },
  }, async input => passthrough(await request({ method: 'POST', path: '/strategies/run', key: ctx.getKey(), body: input })))
  server.registerTool('cancel_strategy', {
    title: 'Cancel an account-owned strategy computation',
    description: 'Use this when the user asks to cancel this background strategy job. Requires optional research:strategies permission. The trial remains in private history; cancellation is terminal only when status says cancelled. Read status to reconcile a pending cancellation and its refund. Do not use this to delete evidence. It does not delete saved definitions or results and has no effect on live alerts or trades.',
    inputSchema: { id }, annotations: write,
  }, async input => passthrough(await request({ method: 'POST', path: '/strategies/cancel', key: ctx.getKey(), body: input })))
}
