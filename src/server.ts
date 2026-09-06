/**
 * server - the one tool core wrapped in an McpServer. Both transports
 * (stdio shim, remote Streamable HTTP) call this; the ToolContext
 * carries the API base and a per-request credential resolver, so the server
 * holds no user or session state and stores no secrets.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerResearchPrompts } from './prompts.js'
import { registerScanChart } from './scanChart.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'
import { registerResearchTools, type ToolContext } from './tools.js'

const INSTRUCTIONS =
  'EdgeDepth Research: deterministic search over recorded crypto and TradFi microstructure. ' +
  'For live prices, personalized buy/sell advice or trade execution, invoke NO EdgeDepth tools, ' +
  'including registry/capability discovery. ' +
  'For a prose question, call interpret_prose FIRST with the user question unchanged. ' +
  'Run only after explicit human approval of a short proposal; exact JSON stays inspectable. Do not ' +
  'prepend registry or universe discovery or silently add thresholds, dates, markets or outcomes. ' +
  'Show one short confirmation message: condition, markets, exact dates and time zone, outcome ' +
  'definition/horizon, and that interpretation is free but a fresh computation can consume allowance. ' +
  'Label every unprovided value as a proposed assumption, using the interpreter chip provenance; ' +
  'never call it locked or approved. Ask only questions that materially change the study. ' +
  'Keep exact JSON and diagnostics in inspectable tool details; do not require the user to read ' +
  'or write JSON. Resolve unsupported fragments before offering to run. Wait for explicit human ' +
  'approval of this proposal, then submit that exact document. A tool call or confirmed=true is ' +
  'not proof of human consent. Changing any assumption requires a new proposal and confirmation. ' +
  'If an exact valid document already exists AND the user approved it, call run_scan directly; ' +
  'do not add grounding calls reflexively. Use list_features to construct or repair a ' +
  'document and list_instruments only when symbol coverage or provenance needs checking. ' +
  'Lead with one plain-language finding about what the evidence does and does not support. ' +
  'Prefer everyday language to lift, conditional distribution or predictive power; explain any ' +
  'necessary term. Keep the opening to two sentences, then show the key counts, one short ' +
  'limitation and one relevant next action. Charts supplement the textual evidence in supported ' +
  'hosts; do not claim a chart rendered unless the host confirms it. Use the supplied component ' +
  'as the default visual, without duplicating its charts in the answer. Request full_outcomes ' +
  'only when your analysis needs omitted numbers, not merely to display the component. ' +
  'Keep long hashes and exact ' +
  'JSON in inspectable details unless asked; identify the study briefly without dumping keys. ' +
  'Then give matched/eligible counts, outcome present/absent counts, ' +
  'both directions at the agreed horizon, the unconditional same-scope reference when available, ' +
  'and the limitations. Zero matches, n=1 and inconclusive findings are valid answers. Retain ' +
  'coverage exclusions, overlap and representative-selection caveats. Offer ONE relevant next ' +
  'action: inspect a returned replay, change one assumption, or open an existing report. ' +
  'Saving and alerts are web actions, not MCP capabilities. Never use an rq workbench link for ' +
  'an unapproved proposal: it is an execution handoff. ' +
  'Scan-family results come back as a stated projection: rows are thinned examples and every ' +
  'removal is listed, so read counts and rates from counts and outcomes_summary, raise rows for ' +
  'more examples, and pass full_counts only when verbatim canonical bytes are required. ' +
  'outcomes_summary.metrics[].rungs already states, per selected threshold, the matched count and ' +
  'rate, the unconditional count and rate over the same symbols and window, and their ratio as ' +
  'lift: quote those numbers rather than recomputing them, and quote the count beside any rate. A ' +
  'rung marked kept_for was included because it carries the largest lift in that grid; absent ' +
  'lift means no reference was available or the unconditional rate was zero, and neither is a ' +
  'reason to estimate one. Pass full_outcomes for every rung and the per-rung histogram. ' +
  'outcome_first starts from the MOVE instead of the setup and is a DESCRIPTIVE READ, never a ' +
  'candidate list: it searches no rule space and claims no survivor. Every row it returns is ' +
  'selected on the outcome and carries two counted shares, and the row order is the gap between ' +
  'them, which is display order and not a ranking. Never present a row as a rule, a finding or ' +
  'something that works, and run the setup-first rerun through run_scan before quoting any rate ' +
  'from it; that rerun asks the opposite question and its rate is the honest one. Its magnitude ' +
  'is a ladder rung as a FRACTION and its horizon a closed suffix, both in the ' +
  'edgedepth://research/outcome-first resource. A scope under the floor is refused with its ' +
  'counts and four adjustments and spends nothing; one market always refuses. ' +
  'Never invent a baseline or counterexample, call the unconditional baseline comparable, ' +
  'recommend a buy/sell decision, or execute a trade. Read rates from outcomes_summary over all ' +
  'occurrences, never from page rows, and retain the reproducibility key in details. Outcome fields can never ' +
  'be filtered. Repair machine-actionable contract errors using list_features, whose result also ' +
  'carries the human reading page for a feature id: https://edgedepth.com/research/readings/<id ' +
  'without the "feature." prefix>, e.g. feature.vpin -> https://edgedepth.com/research/readings/vpin. ' +
  'list_instruments carries the same door for a market still being recorded, ' +
  'https://edgedepth.com/research/symbols/<symbol>, which 404s for a delisted one. ' +
  'Cache hits, reruns, continuations, and 304 revalidations are free.'

export function createResearchMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  )
  registerResearchTools(server, ctx)
  registerResearchPrompts(server, ctx)
  registerScanChart(server)
  return server
}
