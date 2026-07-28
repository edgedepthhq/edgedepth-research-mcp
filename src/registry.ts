/**
 * registry - the grounding document (GET /registry), cached in-process
 * and revalidated by ETag on every read. Feature ids may be added under
 * the current feature_version when old feature bytes remain frozen, so
 * a lifetime cache would strand long-running agents on an older grammar.
 * A 304 keeps the cached bytes; a 200 atomically replaces them.
 *
 * We keep BOTH the verbatim bytes (list_features returns them untouched)
 * and a parsed copy (base_rate reads schema_version /
 * normalization_version / feature_version from it, so those are
 * mirrored from the contract and never hand-written here).
 */
import { apiRequest, type ApiResponse } from './apiClient.js'

export interface RegistryResult {
  ok: boolean
  /** verbatim registry bytes (only meaningful when ok) */
  raw: string
  /** parsed registry document (only when ok and parseable) */
  doc: Record<string, unknown> | null
  etag?: string
  /** error body to surface verbatim when !ok */
  bodyText: string
  /** current HTTP exchange, including zero-charge/remaining headers */
  response: ApiResponse
}

const cache = new Map<string, RegistryResult>()

export async function getRegistry(apiBase: string, key: string): Promise<RegistryResult> {
  const prior = cache.get(apiBase)
  const res = await apiRequest(apiBase, {
    method: 'GET',
    path: '/registry',
    key,
    ifNoneMatch: prior?.etag,
  })
  if (res.notModified && prior) return { ...prior, response: res }
  if (res.notModified) {
    return {
      ok: false,
      raw: '',
      doc: null,
      bodyText: JSON.stringify({
        error: 'The registry returned 304 without a cached representation.',
        code: 'REGISTRY_REVALIDATION_ERROR',
      }),
      response: res,
    }
  }
  if (!res.ok) {
    // Never cache a failure: auth errors are per-key and transient.
    return { ok: false, raw: '', doc: null, bodyText: res.bodyText, response: res }
  }
  let doc: Record<string, unknown> | null = null
  try {
    doc = JSON.parse(res.bodyText) as Record<string, unknown>
  } catch {
    doc = null
  }
  const result: RegistryResult = {
    ok: true,
    raw: res.bodyText,
    doc,
    etag: res.headers.etag,
    bodyText: res.bodyText,
    response: res,
  }
  cache.set(apiBase, result)
  return result
}

/** Test hook: forget the process-wide registry cache. */
export function clearRegistryCache(): void {
  cache.clear()
}
