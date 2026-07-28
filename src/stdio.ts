#!/usr/bin/env node
/**
 * stdio shim - the npx one-liner (npx @edgedepth/research-mcp). Same
 * tool core, stdio transport, key from EDGEDEPTH_API_KEY. Logs go to
 * stderr so they never corrupt the stdout JSON-RPC stream.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createResearchMcpServer } from './server.js'
import { DEFAULT_API_BASE } from './version.js'

async function main(): Promise<void> {
  const apiBase = process.env.EDGEDEPTH_API_BASE?.trim().replace(/\/$/, '') || DEFAULT_API_BASE
  const apiKey = process.env.EDGEDEPTH_API_KEY?.trim() || undefined

  const server = createResearchMcpServer({ apiBase, getKey: () => apiKey })
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error(
    `[edgedepth-research-mcp] stdio ready (api ${apiBase})` +
      (apiKey
        ? ''
        : ' - NO STDIO KEY: use the hosted OAuth URL https://mcp.edgedepth.com/mcp (recommended), or set EDGEDEPTH_API_KEY; stdio tool calls otherwise return AUTH_REQUIRED'),
  )
}

main().catch((err) => {
  console.error('[edgedepth-research-mcp] fatal:', err)
  process.exit(1)
})
