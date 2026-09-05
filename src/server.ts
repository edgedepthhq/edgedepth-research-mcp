/**
 * server - the one tool core wrapped in an McpServer. Both transports
 * (stdio shim, remote Streamable HTTP) call this; the ToolContext
 * carries the API base and a per-request credential resolver, so the server
 * holds no user or session state and stores no secrets.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerResearchPrompts } from './prompts.js'
import { SERVER_NAME, SERVER_VERSION } from './version.js'
import { registerResearchTools, type ToolContext } from './tools.js'

const INSTRUCTIONS =
  'EdgeDepth Research: deterministic search over recorded crypto and TradFi microstructure. ' +
  'For a prose question, call interpret_prose, show the exact proposed definition, then call ' +
  'run_scan only after confirmation. If an exact valid document already exists, call run_scan ' +
  'directly; do not add grounding calls reflexively. Use list_features to construct or repair a ' +
  'document and list_instruments to verify symbol coverage or provenance. Answer as: one exact ' +
  'definition, one denominated result, one unconditional same-scope reference rate when available, ' +
  'one contradictory example when the result actually identifies one, and one replay handoff. ' +
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
  'occurrences, never from page rows, and echo the reproducibility key. Outcome fields can never ' +
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
  return server
}
