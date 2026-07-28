/** OAuth resource-server discovery and access-token validation. */

export const MCP_RESOURCE =
  process.env.EDGEDEPTH_MCP_RESOURCE?.trim().replace(/\/$/, '') ||
  'https://mcp.edgedepth.com/mcp'
export const OAUTH_ISSUER =
  process.env.EDGEDEPTH_OAUTH_ISSUER?.trim().replace(/\/$/, '') ||
  'https://app.edgedepth.com'
export const PROTECTED_RESOURCE_METADATA_URL =
  'https://mcp.edgedepth.com/.well-known/oauth-protected-resource/mcp'
export const MCP_SCOPES = ['research:read', 'research:interpret'] as const
export const OAUTH_INVALID_TOKEN_REASONS = [
  'access_token_malformed',
  'access_token_unknown',
  'grant_revoked',
  'access_token_expired',
] as const
export type OAuthInvalidTokenReason = (typeof OAUTH_INVALID_TOKEN_REASONS)[number]

export function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_documentation: `${OAUTH_ISSUER}/research/api/mcp`,
  }
}

export function bearerChallenge(
  error?: 'invalid_token',
  reason?: OAuthInvalidTokenReason,
): string {
  const pieces = [
    `resource_metadata="${PROTECTED_RESOURCE_METADATA_URL}"`,
    `scope="${MCP_SCOPES.join(' ')}"`,
  ]
  if (error) pieces.push(`error="${error}"`)
  if (reason) pieces.push(`error_description="${reason}"`)
  return `Bearer ${pieces.join(', ')}`
}

export class OAuthExchangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthExchangeError'
  }
}

/**
 * Validate an opaque access token at the authorization server and exchange it
 * for a separate 60-second internal assertion. The OAuth token never reaches
 * the Research API.
 */
export async function exchangeAccessToken(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<
  | { ok: true; assertion: string }
  | { ok: false; reason: OAuthInvalidTokenReason }
> {
  const secret = process.env.MCP_INTERNAL_SECRET?.trim() || ''
  if (!secret) throw new OAuthExchangeError('MCP_INTERNAL_SECRET is not configured.')
  const endpoint =
    process.env.EDGEDEPTH_OAUTH_EXCHANGE_URL?.trim() ||
    'http://127.0.0.1:3002/api/mcp/oauth/exchange'

  let response: Response
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new OAuthExchangeError('The OAuth authorization server could not be reached.')
  }
  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as { reason?: unknown } | null
    const reason = OAUTH_INVALID_TOKEN_REASONS.includes(
      body?.reason as OAuthInvalidTokenReason,
    )
      ? (body?.reason as OAuthInvalidTokenReason)
      : 'access_token_unknown'
    return { ok: false, reason }
  }
  if (!response.ok) throw new OAuthExchangeError(`OAuth exchange failed with HTTP ${response.status}.`)
  const body = (await response.json().catch(() => null)) as { assertion?: unknown } | null
  if (!body || typeof body.assertion !== 'string' || !body.assertion.startsWith('edi.')) {
    throw new OAuthExchangeError('The OAuth exchange response was invalid.')
  }
  return { ok: true, assertion: body.assertion }
}
