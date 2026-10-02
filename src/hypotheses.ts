import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { apiRequest, type ApiResponse } from './apiClient.js'
import type { ToolContext, ToolResult } from './tools.js'
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const
const continuation = z.object({ id: z.string().uuid(), attemptId: z.string().uuid(), index: z.number().int().min(0).max(3) })
export function registerHypothesisTools(server: McpServer, ctx: ToolContext, passthrough: (r: ApiResponse) => ToolResult) {
  server.registerTool('get_hypothesis', {
    title: 'Read private hypotheses and original Radar observations',
    description: 'Use this when reading your saved hypothesis or original observation. Do not use for general market scans or other accounts. Private Radar admin pilot. With id, read the account-owned saved definition, all attempted variants, counts, failures and supporting/contradictory examples. With event, read only the original Radar observation and an explicitly unrun example draft; never future outcomes. With neither, list your hypotheses. full=true restores every saved receipt. Opening never computes, retries or spends allowance. Other users cannot read these records.',
    inputSchema: { id: z.string().uuid().optional(), event: z.string().optional(), full: z.boolean().optional() }, annotations: read,
  }, async ({ id, event, full }) => passthrough(await apiRequest(ctx.apiBase, { method: 'GET', path: '/hypotheses', key: ctx.getKey(), query: { ...(id ? { id } : {}), ...(event ? { event } : {}), full: String(full ?? false) } })))
  server.registerTool('prepare_hypothesis', {
    title: 'Prepare a bounded hypothesis comparison',
    description: 'Use this when proposing a bounded Radar hypothesis comparison. Do not use to execute or validate a strategy. Free deterministic preparation for the private Radar admin pilot. Supply the exact event and draft, plus existing id when revisiting. Returns an unrun proposal with exact four requests, revision, plan hash and allowance estimate; creates no account record. Draft fields are question, mechanism, challenge, from/through and reserveFrom/reserveThrough (UTC dates), population/a/b (three-item native clauses), decision (test/keep/reject), note. Reuse a draft from get_hypothesis; disclose every proposed assumption. One Binance asset; six existing numeric readings, A/B/A+B with common eligibility; population additionally allows native daily price/OI-ratio crossings. +5% MFE within 4h is fixed. Development <=31 days; seven full days before reserved evaluation; anchors end by September 11, 2026. Evaluation is never queried. Present exact scope, conditions, dates, outcome and allowance for human approval before run_hypothesis. A plan hash is not consent.',
    inputSchema: { id: z.string().uuid().optional(), event: z.string(), draft: z.record(z.unknown()) }, annotations: read,
  }, async input => passthrough(await apiRequest(ctx.apiBase, { method: 'POST', path: '/hypotheses', key: ctx.getKey(), body: { action: 'prepare', ...input } })))
  server.registerTool('save_hypothesis', {
    title: 'Save a private hypothesis or research decision',
    description: 'Use this when the user asks to save a hypothesis or decision. Do not use to run studies, delete history or change alerts. Requires explicit user intent to save and optional research:hypotheses permission, plus Radar admin access. Save the draft or Test/Keep/Reject decision at the known revision (0 for the id returned by preparation). Existing attempts and original source are immutable. Refuses concurrent edits; read the current history before reconciling. A failed/ambiguous save must be checked with get_hypothesis, not blindly repeated. No study, alert, trade or publication. Keep means retain for more testing, not validated edge.',
    inputSchema: { id: z.string().uuid(), revision: z.number().int().nonnegative(), event: z.string(), draft: z.record(z.unknown()) }, annotations: write,
  }, async input => passthrough(await apiRequest(ctx.apiBase, { method: 'POST', path: '/hypotheses', key: ctx.getKey(), body: { action: 'save', ...input } })))
  server.registerTool('run_hypothesis', {
    title: 'Run the next declared hypothesis comparison request',
    description: 'Use this when executing the next request of an explicitly approved hypothesis comparison. Do not use to search combinations, open evaluation or retry unknown work. Requires research:read and research:hypotheses plus private Radar admin access. Only after human approval of the exact prepare_hypothesis proposal, submit that unchanged proposal. This records all four planned requests before running the first. Fresh API requests can each consume allowance. Continue serially using the returned continuation instead of a proposal until it is absent (at most four native requests under the same approval). Never change the definition or infer approval from a model flag/hash. No continuation means stop. After timeout or ambiguous completion, get_hypothesis first; never retry a running/unknown step. Missing, failed and negative results remain saved. The account record and web link are shared with the web interface. Reserved evaluation is never queried; no automatic trading, monitoring or validation.',
    inputSchema: { proposal: z.record(z.unknown()).optional(), continuation: continuation.optional() },
    annotations: { ...write, destructiveHint: true },
  }, async ({ proposal, continuation: next }) => {
    if (!!proposal === !!next) return { isError: true, content: [{ type: 'text', text: 'Provide exactly one unchanged prepared proposal or returned continuation.' }] }
    if (proposal) {
      const started = await apiRequest(ctx.apiBase, { method: 'POST', path: '/hypotheses', key: ctx.getKey(), body: { action: 'start', proposal, attemptId: randomUUID() } })
      if (!started.ok) return passthrough(started)
      try {
        const parsed = continuation.safeParse(JSON.parse(started.bodyText).record?.continuation)
        if (!parsed.success) return passthrough(started)
        next = parsed.data
      } catch { return passthrough(started) }
    }
    return passthrough(await apiRequest(ctx.apiBase, { method: 'POST', path: '/hypotheses', key: ctx.getKey(), body: { action: 'step', ...next } }))
  })
}
