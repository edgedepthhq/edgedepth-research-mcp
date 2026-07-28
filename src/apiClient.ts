/**
 * apiClient - the ONLY thing that talks to the phase-A/B REST surface.
 * It holds no durable secrets. A call carries either the caller's API key or
 * the short-lived internal assertion produced by OAuth exchange. Two hard
 * rules live here:
 *
 *  1. The response body is returned VERBATIM (bodyText). The engine's
 *     canonical bytes are the product; this layer never JSON-parses and
 *     re-stringifies a result, so byte-identity survives to the agent.
 *  2. Reproducibility, credit and Retry-After headers are surfaced as
 *     metadata (never mixed into the body bytes). ETags may be weakened
 *     to W/"..." in transit; we pass them through and let the API do the
 *     weak/substring If-None-Match compare.
 */

export interface ApiRequest {
  method: 'GET' | 'POST'
  /** path under the base, e.g. '/query', '/registry', '/reports/abcd1234' */
  path: string
  /** API key or edi.* internal assertion; omitted = AUTH_REQUIRED */
  key?: string
  /** JSON body for POST - the INPUT document, stringified here */
  body?: unknown
  /** inbound ETag to revalidate; passed through verbatim (may be weak) */
  ifNoneMatch?: string
  query?: Record<string, string>
  timeoutMs?: number
}

export interface ApiResponseHeaders {
  etag?: string
  canonicalQueryHash?: string
  datasetRevision?: string
  featureVer?: string
  rulebookVersion?: string
  cache?: string
  creditsEstimate?: string
  creditsCharged?: string
  creditsRemaining?: string
  retryAfter?: string
  contentType?: string
}

export interface ApiResponse {
  status: number
  ok: boolean
  notModified: boolean
  /** VERBATIM body bytes - never re-encoded */
  bodyText: string
  headers: ApiResponseHeaders
}

function synth(status: number, code: string, message: string): ApiResponse {
  // Mirror the engine transport envelope so tool error handling is uniform.
  return {
    status,
    ok: false,
    notModified: false,
    bodyText: JSON.stringify({ error: message, code }),
    headers: { creditsCharged: '0' },
  }
}

export async function apiRequest(base: string, req: ApiRequest): Promise<ApiResponse> {
  const url = new URL(base.replace(/\/$/, '') + req.path)
  if (req.query) {
    for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v)
  }
  const headers: Record<string, string> = { accept: 'application/json' }
  if (req.key?.startsWith('edi.')) headers['x-edgedepth-mcp-assertion'] = req.key
  else if (req.key) headers.authorization = `Bearer ${req.key}`
  if (req.ifNoneMatch) headers['if-none-match'] = req.ifNoneMatch
  let bodyText: string | undefined
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json'
    bodyText = JSON.stringify(req.body)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000)
  let res: Response
  try {
    res = await fetch(url, { method: req.method, headers, body: bodyText, signal: controller.signal })
  } catch {
    clearTimeout(timer)
    return controller.signal.aborted
      ? synth(504, 'UPSTREAM_TIMEOUT', 'The research API did not respond in time.')
      : synth(502, 'UPSTREAM_UNREACHABLE', 'The research API could not be reached from the MCP server.')
  }
  clearTimeout(timer)

  const text = await res.text()
  const h = res.headers
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    notModified: res.status === 304,
    bodyText: text,
    headers: {
      etag: h.get('etag') ?? undefined,
      canonicalQueryHash: h.get('x-canonical-query-hash') ?? undefined,
      datasetRevision: h.get('x-dataset-revision') ?? undefined,
      featureVer: h.get('x-research-feature-ver') ?? undefined,
      rulebookVersion: h.get('x-rulebook-version') ?? undefined,
      cache: h.get('x-research-cache') ?? undefined,
      creditsEstimate: h.get('x-research-credits-estimate') ?? undefined,
      creditsCharged: h.get('x-research-credits-charged') ?? undefined,
      creditsRemaining: h.get('x-research-credits-remaining') ?? undefined,
      retryAfter: h.get('retry-after') ?? undefined,
      contentType: h.get('content-type') ?? undefined,
    },
  }
}
