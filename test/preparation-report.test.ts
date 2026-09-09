import { afterEach, describe, expect, it, vi } from 'vitest'
import { compactReport } from '../src/reportProjection.js'
import { connectClient, texts } from './helpers.js'
afterEach(() => vi.unstubAllGlobals())
const metric = {
  present: 100,
  absent: 7,
  thresholds: [
    { op: 'gte', threshold: 0.01, count: 12 },
    { op: 'lte', threshold: -0.01, count: 10 },
  ],
  buckets: [],
}
const body = JSON.stringify({
  title: 'Test',
  integrity_status: 'withdrawn',
  correction_notice: 'Do not rely on this',
  definition: { large: Array(1000).fill('definition') },
  pinned: {
    result: {
      counts: { total_matching: 107 },
      outcomes_summary: { metrics: { fwd_ret_1h: metric } },
      occurrences: Array(1000).fill({ features: Array(50).fill(2) }),
      representatives: [{ symbol: 'btcusdt', replay: { seek: '2026-08-20T00:00:00Z' } }],
      reproducibility_key: { dataset_revision: 'r' },
    },
    baseline: {
      result: {
        baseline: {
          metrics: {
            fwd_ret_1h: {
              ...metric,
              present: 1000,
              thresholds: [{ op: 'gte', threshold: 0.01, count: 110 }],
            },
          },
        },
      },
    },
  },
})
describe('compact public reports', () => {
  it('retains denominators, status and replay while dropping bulk', () => {
    const raw = compactReport(body)!,
      result = JSON.parse(raw)
    expect(raw.length).toBeLessThan(body.length / 10)
    expect(result.integrity_status).toBe('withdrawn')
    expect(result.counts.total_matching).toBe(107)
    expect(result.outcome_overview.fwd_ret_1h.present).toBe(100)
    expect(result.outcome_overview.fwd_ret_1h.absent).toBe(7)
    expect(result.outcome_overview.fwd_ret_1h.rungs[0]).toMatchObject({
      count: 12,
      baseline_count: 110,
    })
    expect(result.representatives[0].replay.seek).toBe('2026-08-20T00:00:00Z')
    expect(result.pinned).toBeUndefined()
  })
  it('keeps full mode byte identical and compact ETags separate', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(body, {
              headers: { etag: '"original"', 'x-research-credits-charged': '0' },
            }),
          ),
        ),
    )
    const client = await connectClient()
    try {
      const full = await client.callTool({
        name: 'get_report',
        arguments: { hash8: 'fec86629', full: true },
      })
      expect(texts(full)).toContain(body)
      const lean = await client.callTool({ name: 'get_report', arguments: { hash8: 'fec86629' } })
      expect(texts(lean)[0]).toContain('report-compact-v1')
      expect(texts(lean)).not.toContain(body)
    } finally {
      await client.close()
    }
  })
})
it('prepares host intent with one free request and never invokes interpretation or scan', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ proposal: true, executable: false }), {
        headers: { 'x-research-credits-charged': '0' },
      }),
    )
  vi.stubGlobal('fetch', fetch)
  const client = await connectClient()
  try {
    const intent = {
      scope: {
        symbols: ['btcusdt'],
        from: '2026-08-01T00:00:00Z',
        to: '2026-09-01T00:00:00Z',
        provenance: 'user_stated',
      },
      setup: [{ field: 'feature.vpin', operator: 'gte', value: 0.7, provenance: 'model_assumed' }],
      outcome: {
        kind: 'finished',
        direction: 'up',
        magnitude: 0.01,
        horizon: '1h',
        provenance: 'user_stated',
      },
    }
    const result = await client.callTool({ name: 'prepare_study', arguments: intent })
    expect(result.isError).not.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0]).endsWith('/prepare')).toBe(true)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(intent)
    expect(texts(result)[0]).toContain('credits_charged=0')
  } finally {
    await client.close()
  }
})
