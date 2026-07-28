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
  'Call list_features first to ground on the closed grammar and list_instruments for the ' +
  'manifest-derived universe and provenance. Scans return counts WITH ' +
  'denominators and an outcomes_summary computed forward over ALL occurrences: read rates from ' +
  'outcomes_summary, never from page rows. Echo the reproducibility key with any answer (same ' +
  'key, same bytes). Outcome fields can never be filtered. Errors carry machine-actionable ' +
  'contract codes (e.g. UNSUPPORTED_FEATURE, OUTCOME_IN_PREDICATE): read the code, call ' +
  'list_features, and repair the document. Reruns and 304 revalidations are free, so rerun freely.'

export function createResearchMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  )
  registerResearchTools(server, ctx)
  return server
}
