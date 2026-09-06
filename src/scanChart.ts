import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiResponse } from './apiClient.js'
import { SCAN_CHART_HTML } from './scanChartHtml.js'

export const SCAN_CHART_URI = 'ui://edgedepth/scan-evidence-v1.html'

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function body(response: ApiResponse | null): Record<string, unknown> | null {
  if (!response?.ok || response.notModified) return null
  try {
    const value: unknown = JSON.parse(response.bodyText)
    return object(value) ? value : null
  } catch {
    return null
  }
}

/** UI-only copy of engine evidence. No new requests, row-derived statistics,
 * estimated bins, persistent storage, or extra model-context payload. */
export function scanChartMeta(
  response: ApiResponse,
  reference: ApiResponse | null,
): Record<string, unknown> | undefined {
  const scan = body(response)
  if (!scan || !object(scan.outcomes_summary) || !object(scan.outcomes_summary.metrics))
    return undefined
  const baseline = body(reference)
  const referenceSummary = baseline && object(baseline.baseline) ? baseline.baseline : null
  const metrics = Object.fromEntries(
    Object.entries(scan.outcomes_summary.metrics).filter(([name]) =>
      /^fwd_ret_(30m|1h|4h|24h|72h|7d)$/.test(name),
    ),
  )
  if (!Object.keys(metrics).length) return undefined
  const referenceMetrics =
    referenceSummary && object(referenceSummary.metrics) ? referenceSummary.metrics : {}
  return {
    edgedepthEvidence: {
      metrics,
      referenceMetrics: Object.fromEntries(
        Object.keys(metrics)
          .filter((name) => name in referenceMetrics)
          .map((name) => [name, referenceMetrics[name]]),
      ),
      counts: scan.counts,
      coverage: scan.predicate_coverage,
      query: scan.query,
      key: scan.reproducibility_key,
      referenceScope: baseline?.scope,
      referenceCounts: baseline?.counts,
      referenceNotes: baseline?.notes,
      metering: {
        cache: response.headers.cache,
        charged: response.headers.creditsCharged,
        remaining: response.headers.creditsRemaining,
      },
    },
  }
}

export function registerScanChart(server: McpServer): void {
  server.registerResource('scan-evidence', SCAN_CHART_URI, {}, async () => ({
    contents: [
      {
        uri: SCAN_CHART_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: SCAN_CHART_HTML,
        _meta: {
          ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
          'openai/widgetDescription':
            'Historical outcome comparisons and recorded distributions. Exact counts, missing outcomes and research limitations remain visible.',
        },
      },
    ],
  }))
}
