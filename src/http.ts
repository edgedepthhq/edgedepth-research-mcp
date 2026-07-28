/** Hosted stateless Streamable HTTP MCP resource server. */
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response as ExpressResponse } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import {
  bearerChallenge,
  exchangeAccessToken,
  OAuthExchangeError,
  type OAuthInvalidTokenReason,
  protectedResourceMetadata,
} from './oauth.js'
import { createResearchMcpServer } from './server.js'
import { DEFAULT_API_BASE, SERVER_NAME, SERVER_VERSION } from './version.js'

const PORT = Number(process.env.PORT || 3003)
const HOST = process.env.HOST || '127.0.0.1'
const API_BASE = process.env.EDGEDEPTH_API_BASE?.trim().replace(/\/$/, '') || DEFAULT_API_BASE

function bearerFromHeaders(req: Request): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth !== 'string') return undefined
  return /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1]
}

function apiKeyFromHeaders(req: Request): string | undefined {
  const bearer = bearerFromHeaders(req)
  if (bearer?.startsWith('edk_live_') || bearer?.startsWith('edk_test_')) return bearer
  const header = req.headers['x-api-key']
  const candidate = typeof header === 'string' ? header.trim() : ''
  return candidate.startsWith('edk_live_') || candidate.startsWith('edk_test_')
    ? candidate
    : undefined
}

async function credentialFromRequest(req: Request): Promise<
  | { ok: true; credential: string }
  | {
      ok: false
      invalid: boolean
      unavailable?: boolean
      reason?: OAuthInvalidTokenReason | 'oauth_exchange_unavailable'
    }
> {
  const apiKey = apiKeyFromHeaders(req)
  if (apiKey) return { ok: true, credential: apiKey }
  const bearer = bearerFromHeaders(req)
  if (!bearer) return { ok: false, invalid: false }
  try {
    const exchange = await exchangeAccessToken(bearer)
    if (exchange.ok) return { ok: true, credential: exchange.assertion }
    console.warn('[edgedepth-research-mcp] OAuth access token refused:', exchange.reason)
    return { ok: false, invalid: true, reason: exchange.reason }
  } catch (error) {
    if (error instanceof OAuthExchangeError) {
      console.error('[edgedepth-research-mcp] OAuth exchange unavailable:', error.message)
    }
    return {
      ok: false,
      invalid: false,
      unavailable: true,
      reason: 'oauth_exchange_unavailable',
    }
  }
}

const methodNotAllowed = {
  jsonrpc: '2.0' as const,
  error: { code: -32000, message: 'Method Not Allowed: this server is stateless; use POST /mcp.' },
  id: null,
}

export function createHttpApp(): express.Express {
  const app = express()
  app.use(express.json({ limit: '256kb' }))

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION })
  })

  const metadata = (_req: Request, res: ExpressResponse) => {
    res
      .set('Access-Control-Allow-Origin', '*')
      .set('Cache-Control', 'public, max-age=300')
      .status(200)
      .json(protectedResourceMetadata())
  }
  app.get('/.well-known/oauth-protected-resource', metadata)
  app.get('/.well-known/oauth-protected-resource/mcp', metadata)

  app.use('/mcp', (_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id')
    next()
  })
  app.options('/mcp', (_req, res) => {
    res
      .set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, MCP-Protocol-Version, X-Api-Key',
      )
      .set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      .status(204)
      .end()
  })

  app.post('/mcp', async (req, res) => {
    const auth = await credentialFromRequest(req)
    if (!auth.ok) {
      if (auth.unavailable) {
        res.status(503).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'OAuth validation is temporarily unavailable.',
            data: { reason: auth.reason },
          },
          id: null,
        })
        return
      }
      res
        .set(
          'WWW-Authenticate',
          bearerChallenge(
            auth.invalid ? 'invalid_token' : undefined,
            auth.invalid ? (auth.reason as OAuthInvalidTokenReason) : undefined,
          ),
        )
        .set('Cache-Control', 'no-store')
        .status(401)
        .json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Authorization required.',
            data: { reason: auth.reason || 'authorization_missing' },
          },
          id: null,
        })
      return
    }

    const server = createResearchMcpServer({ apiBase: API_BASE, getKey: () => auth.credential })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('[edgedepth-research-mcp] request error:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    }
  })

  app.get('/mcp', (_req, res) => res.status(405).json(methodNotAllowed))
  app.delete('/mcp', (_req, res) => res.status(405).json(methodNotAllowed))
  return app
}

export async function main(): Promise<void> {
  createHttpApp().listen(PORT, HOST, () => {
    console.error(
      `[edgedepth-research-mcp] streamable-http on http://${HOST}:${PORT}/mcp (api ${API_BASE})`,
    )
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('[edgedepth-research-mcp] fatal:', error)
    process.exit(1)
  })
}
