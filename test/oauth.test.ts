import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiRequest } from '../src/apiClient.js'
import { createHttpApp } from '../src/http.js'
import {
  bearerChallenge,
  exchangeAccessToken,
  protectedResourceMetadata,
} from '../src/oauth.js'

afterEach(() => {
  delete process.env.MCP_INTERNAL_SECRET
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function request(
  app: ReturnType<typeof createHttpApp>,
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing test port')
      const req = http.request(
        { host: '127.0.0.1', port: address.port, path, method, headers },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => (body += chunk))
          res.on('end', () => {
            server.close()
            resolve({ status: res.statusCode || 0, headers: res.headers, body })
          })
        },
      )
      req.end(body)
    })
  })
}

describe('hosted MCP OAuth resource server', () => {
  it('publishes path-aware protected resource metadata', async () => {
    const response = await request(createHttpApp(), '/.well-known/oauth-protected-resource/mcp')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual(protectedResourceMetadata())
    expect(JSON.parse(response.body).resource).toBe('https://mcp.edgedepth.com/mcp')
  })

  it('challenges an unauthenticated MCP request with resource metadata', async () => {
    const response = await request(createHttpApp(), '/mcp', 'POST')
    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toBe(bearerChallenge())
    expect(response.headers['www-authenticate']).toContain('oauth-protected-resource/mcp')
  })

  it('supports browser-client CORS preflight without authentication', async () => {
    const response = await request(createHttpApp(), '/mcp', 'OPTIONS')
    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe('*')
    expect(response.headers['access-control-allow-headers']).toContain('Authorization')
  })

  it('exchanges an opaque token for a distinct internal assertion', async () => {
    process.env.MCP_INTERNAL_SECRET = 'shared-test-secret'
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ assertion: 'edi.payload.signature', expires_in: 60 }), {
        status: 200,
      }),
    )
    await expect(exchangeAccessToken('edo_at_opaque', fetcher)).resolves.toEqual({
      ok: true,
      assertion: 'edi.payload.signature',
    })
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer shared-test-secret' })
    expect(JSON.parse(String(init.body))).toEqual({ access_token: 'edo_at_opaque' })
  })

  it('preserves a secret-free invalid-token reason from the authorization server', async () => {
    process.env.MCP_INTERNAL_SECRET = 'shared-test-secret'
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'invalid_token', reason: 'access_token_expired' }),
        { status: 401 },
      ),
    )
    await expect(exchangeAccessToken('edo_at_expired', fetcher)).resolves.toEqual({
      ok: false,
      reason: 'access_token_expired',
    })
  })

  it('surfaces an invalid-token reason in the MCP challenge and JSON-RPC error', async () => {
    process.env.MCP_INTERNAL_SECRET = 'shared-test-secret'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'invalid_token', reason: 'access_token_expired' }),
          { status: 401 },
        ),
      ),
    )
    const response = await request(
      createHttpApp(),
      '/mcp',
      'POST',
      {
        authorization: 'Bearer edo_at_expired',
        'content-type': 'application/json',
      },
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    )
    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toContain(
      'error_description="access_token_expired"',
    )
    expect(JSON.parse(response.body).error.data).toEqual({
      reason: 'access_token_expired',
    })
    vi.unstubAllGlobals()
  })

  it('sends internal assertions in a separate header, never as bearer tokens', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await apiRequest('https://api.example/research', {
      method: 'GET',
      path: '/registry',
      key: 'edi.payload.signature',
    })
    const [, init] = fetcher.mock.calls[0] as [URL, RequestInit]
    expect(init.headers).toMatchObject({
      'x-edgedepth-mcp-assertion': 'edi.payload.signature',
    })
    expect(init.headers).not.toHaveProperty('authorization')
    vi.unstubAllGlobals()
  })
})
