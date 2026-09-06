import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanChartMeta, SCAN_CHART_URI } from '../src/scanChart.js'
import type { ApiResponse } from '../src/apiClient.js'
import { connectClient, texts } from './helpers.js'
const metric = {
  present: 1,
  absent: 2,
  thresholds: [
    { op: 'gte', threshold: 0.01, count: 1 },
    { op: 'lte', threshold: -0.01, count: 0 },
  ],
  buckets: [
    { lo: null, hi: 0, count: 0 },
    { lo: 0, hi: null, count: 1 },
  ],
}
const scan = {
  counts: { total_matching: 3, eligible_symbol_buckets: 10 },
  query: { where: { all: [] } },
  reproducibility_key: { canonical_query_hash: 'exact' },
  outcomes_summary: { metrics: { fwd_ret_1h: metric } },
  occurrences: [{ secretExample: 'must-not-enter-chart' }],
}
const response = (value: unknown): ApiResponse => ({
  ok: true,
  status: 200,
  notModified: false,
  bodyText: JSON.stringify(value),
  headers: { creditsCharged: '1' },
})
afterEach(() => vi.unstubAllGlobals())
describe('inline evidence preserves engine semantics', () => {
  it('retains zero bins, open tails, missingness, exact thresholds and full-result keys without page data', () => {
    const data = scanChartMeta(
      response(scan),
      response({ baseline: { metrics: { fwd_ret_1h: metric } }, scope: { symbols: ['btcusdt'] } }),
    )!.edgedepthEvidence as any
    expect(data.metrics.fwd_ret_1h).toEqual(metric)
    expect(data.referenceMetrics.fwd_ret_1h).toEqual(metric)
    expect(data.key).toEqual(scan.reproducibility_key)
    expect(JSON.stringify(data)).not.toContain('secretExample')
  })
  it('does not fabricate charts for errors, 304 or invalid JSON', () => {
    expect(scanChartMeta({ ...response(scan), ok: false }, null)).toBeUndefined()
    expect(scanChartMeta({ ...response(scan), notModified: true }, null)).toBeUndefined()
    expect(scanChartMeta({ ...response(scan), bodyText: 'invalid' }, null)).toBeUndefined()
    const data = scanChartMeta(response(scan), { ...response({}), ok: false })!
      .edgedepthEvidence as any
    expect(data.referenceMetrics).toEqual({})
  })
  it('adds UI-only evidence to the existing scan with no extra requests or model payload', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify(
              String(url).endsWith('/baseline')
                ? { baseline: { metrics: { fwd_ret_1h: metric } }, scope: {} }
                : scan,
            ),
          ),
      )
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const list = await client.listTools()
      expect(list.tools.find((t) => t.name === 'run_scan')!._meta?.ui).toEqual({
        resourceUri: SCAN_CHART_URI,
      })
      const result = await client.callTool({
        name: 'run_scan',
        arguments: { document: { schema_version: 'research_query.v2' }, full_counts: true },
      })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(result._meta).toHaveProperty('edgedepthEvidence')
      expect(texts(result)).toContain(JSON.stringify(scan))
      expect(texts(result).join('')).not.toContain('edgedepthEvidence')
      const resource = await client.readResource({ uri: SCAN_CHART_URI })
      expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app')
      expect(resource.contents[0].text).toContain('Distribution')
    } finally {
      await client.close()
    }
  })
})
