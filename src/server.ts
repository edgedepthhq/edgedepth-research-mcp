/**
 * server - the one tool core wrapped in an McpServer. Both transports
 * (stdio shim, remote Streamable HTTP) call this; the ToolContext
 * carries the API base and a per-request credential resolver, so the server
 * holds no user or session state and stores no secrets.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

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
  'Never invent a baseline or counterexample, call the unconditional baseline comparable, ' +
  'recommend a buy/sell decision, or execute a trade. Read rates from outcomes_summary over all ' +
  'occurrences, never from page rows, and echo the reproducibility key. Outcome fields can never ' +
  'be filtered. Repair machine-actionable contract errors using list_features. Cache hits, reruns, ' +
  'continuations, and 304 revalidations are free.'

export function createResearchMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  )
  registerResearchTools(server, ctx)
  return server
}
