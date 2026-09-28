import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compactTextDetails, scanTextAnswer } from '../src/scanText.js'
import { DEFAULT_LEAN, projectionTag } from '../src/projection.js'
import { connectClient, texts } from './helpers.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/p4-records.json', import.meta.url), 'utf8'))
const measure = { kind: 'touch', direction: 'up', magnitude: 0.05, horizon: '24h' }
const roster = Array.from({ length: 608 }, (_, i) => `coin${String(i).padStart(3, '0')}usdt`)
function universeFixture() {
  // Synthetic scale case using the stored P4 shape, not a new P7 research finding.
  const result = structuredClone(fixtures[0].result)
  result.query.where.all.push(['identity.symbol', 'in', roster])
  result.counts_by_symbol = Object.fromEntries(roster.map((symbol, i) => [symbol, { ...result.counts, total_matching: i < 40 ? 1 : 0 }]))
  const base = result.outcomes_summary.metrics
  for (const horizon of ['30m', '1h', '4h', '24h', '72h', '7d']) {
    for (const family of ['fwd_ret', 'mfe', 'mae']) base[`${family}_${horizon}`] = structuredClone(base[`${family}_24h`])
  }
  result.outcomes_summary.occurrences_per_day = Array.from({ length: 425 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 6, 15 + i)).toISOString().slice(0, 10), count: i < 350 ? 0 : 50,
  }))
  result.predicate_coverage = { 'feature.oi_contract_change_1h': { present: 100, absent: 900, total_symbol_buckets: 1000 } }
  result.occurrences = Array.from({ length: 3 }, (_, i) => ({ id: `row${i}`, symbol: roster[i],
    anchor_time: '2026-06-30T12:00:00Z', setup: { 'feature.ret_1h': 0.1 },
    evidence: [{ field: 'identity.symbol', operator: 'in', query_value: roster, store_value: roster[i] }] }))
  result.representatives = Array.from({ length: 3 }, (_, i) => ({ id: `representative${i}`, method: 'synthetic size fixture',
    symbol: roster[i], anchor_time: '2026-06-30T12:00:00Z',
    replay: { symbol: roster[i], from: '2026-06-30T11:00:00Z', to: '2026-06-30T13:00:00Z', seek: '2026-06-30T12:00:00Z' } }))
  result.outcomes = Object.fromEntries(result.occurrences.map((row: any) => [row.id, Object.fromEntries([
    ...Object.keys(base).map(name => [name, 0.012345678901234]),
    ...['30m', '1h', '4h', '24h', '72h', '7d'].map(h => [h === '1h' ? 'horizon_buckets_present' : `horizon_buckets_present_${h}`, 60]),
  ])]))
  result.next_cursor = 'preserve-this-cursor'
  return result
}
afterEach(() => vi.unstubAllGlobals())

describe('compact scan text', () => {
  it('labels long lists as non-executable receipts, keeps order in the input and hashes sorted UTF-8 JSON', () => {
    const values = [...roster].reverse().concat('龙虾usdt', roster[0])
    const body = { query: { sequence: { steps: [{ all: [['identity.symbol', 'in', values]] }] } } }
    const notes = compactTextDetails(body, '24h')
    const projected = body as any
    expect(projected.query).toBeUndefined()
    const receipt = projected.query_preview.sequence.steps[0].all[0][2]
    expect(receipt.count).toBe(610)
    expect(receipt.sha256).toBe(createHash('sha256').update(JSON.stringify([...values].sort())).digest('hex'))
    expect(receipt.first_five).toEqual([...values].sort().slice(0, 5))
    expect(values[0]).toBe(roster.at(-1))
    expect(notes.join(' ')).toContain('not executable')
  })

  it('summarizes the entire UTC match calendar without calling match dates feature coverage', () => {
    const body = { outcomes_summary: { occurrences_per_day: [
      { date: '2026-07-02', count: 4 }, { date: '2026-06-01', count: 0 },
      { date: '2026-06-05', count: 4 }, { date: '2026-06-06', count: 2 },
    ] } } as any
    const notes = compactTextDetails(body, '24h')
    expect(body.outcomes_summary.match_calendar).toEqual({ first_matching_day: '2026-06-05',
      last_matching_day: '2026-07-02', peak_day: { date: '2026-06-05', count: 4 },
      monthly_counts: { '2026-06': 6, '2026-07': 4 }, zero_days_omitted: 1 })
    expect(notes.join(' ')).toContain('Predicate first-data dates are unavailable')
    const empty = { outcomes_summary: { occurrences_per_day: [{ date: '2026-06-01', count: 0 }] } } as any
    compactTextDetails(empty, '24h')
    expect(empty.outcomes_summary.match_calendar.first_matching_day).toBeNull()
    const invalid = { outcomes_summary: { occurrences_per_day: [{ date: '2026-06-01', count: null }] } }
    compactTextDetails(invalid, '24h')
    expect(invalid.outcomes_summary.occurrences_per_day[0].count).toBeNull()
  })

  it.each([false, true])('keeps a 608-market/425-day default below 10,000 characters, reference=%s', async available => {
    const body = universeFixture()
    const canonical = JSON.stringify(body)
    const fetch = vi.fn().mockImplementation(async (url: string) => String(url).endsWith('/baseline')
      ? available ? new Response(JSON.stringify({ baseline: { metrics: body.outcomes_summary.metrics },
          scope: { from: '2025-07-15', to: '2026-09-13', symbols: roster }, counts: { baseline_buckets: 999999 },
          reproducibility_key: { baseline_scope_hash: 'reference-hash' } }))
        : new Response(JSON.stringify({ code: 'SCAN_TIMEOUT' }), { status: 504 })
      : new Response(canonical, { headers: { ETag: '"fixed"', 'X-Research-Credits-Charged': '0' } }))
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'run_scan', arguments: { document: body.query, measure } })
      const output = texts(result)
      expect(output.join('\n').length, JSON.stringify(output.map(t => ({ chars: t.length, start: t.slice(0, 65) })))).toBeLessThan(10_000)
      expect(output[0]).toContain('Answer: 5% rise touched within 24h')
      expect(output[0]).toContain('credits_charged=0')
      expect(output.join('\n')).toContain('No hash-only link is available')
      const scan = output.map(t => { try { return JSON.parse(t) } catch { return null } }).find(v => v?.counts)
      expect(scan.occurrences).toHaveLength(1)
      expect(scan.counts).toEqual(body.counts)
      expect(scan.predicate_coverage).toEqual(body.predicate_coverage)
      expect(scan.reproducibility_key).toEqual(body.reproducibility_key)
      expect(scan.next_cursor).toBe(body.next_cursor)
      expect(scan.representatives).toEqual(body.representatives)
      expect(scan.outcomes_summary.metrics.fwd_ret_7d).toMatchObject({ present: body.outcomes_summary.metrics.fwd_ret_7d.present })
      expect(scan.outcomes_summary.rungs_omitted).toContain('omitted is not zero')
      expect(scan.outcomes.row0).toEqual({ fwd_ret_24h: 0.012345678901234, mfe_24h: 0.012345678901234, mae_24h: 0.012345678901234, horizon_buckets_present_24h: 60 })
      expect((result._meta as any).edgedepthEvidence.query).toEqual(body.query)
      expect(fetch).toHaveBeenCalledTimes(2)
      for (const [, init] of fetch.mock.calls) expect(JSON.parse(init.body)).toEqual(body.query)
      const full = await client.callTool({ name: 'run_scan', arguments: { document: body.query, measure, full_counts: true } })
      expect(texts(full)).toContain(canonical)
      const link = texts(full).join('\n').match(/definition_handoff: (https:\/\/\S+)/)![1]
      expect(JSON.parse(new URL(link).searchParams.get('rq')!)).toEqual(body.query)
    } finally { await client.close() }
  })

  it.each(fixtures.map((_: unknown, i: number) => i))('preserves the selected counts for stored P4 response %s', async i => {
    const fixture = fixtures[i]
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => String(url).endsWith('/baseline')
      ? new Response('{"code":"SCAN_TIMEOUT"}', { status: 504 }) : new Response(JSON.stringify(fixture.result))))
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'run_scan', arguments: { document: fixture.document, measure } })
      const output = texts(result)
      const selected = output.map(t => { try { return JSON.parse(t).selected_outcome } catch { return null } }).find(Boolean)
      expect(selected.matched.count).toBe(fixture.result.outcomes_summary.metrics.mfe_24h.thresholds.find((r: any) => r.op === 'gte' && r.threshold === 0.05).count)
      expect(output.join('\n').length).toBeLessThan(10_000)
    } finally { await client.close() }
  })

  it('revalidates only the same view and leaves changed measures/full detail/errors usable', async () => {
    const body = universeFixture()
    const canonical = JSON.stringify(body)
    const fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/baseline')) return new Response('{"code":"SCAN_TIMEOUT"}', { status: 504 })
      if ((init.headers as Record<string, string>)['if-none-match'] === '"fixed"')
        return new Response(null, { status: 304, headers: { ETag: '"fixed"', 'X-Research-Credits-Charged': '0' } })
      return new Response(canonical, { headers: { ETag: '"fixed"' } })
    })
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const first = texts(await client.callTool({ name: 'run_scan', arguments: { document: body.query, measure } }))
      const etag = first[0].match(/etag=("[^"\n]+")/)![1]
      const held = texts(await client.callTool({ name: 'run_scan', arguments: { document: body.query, measure, if_none_match: etag } }))
      expect(held.join(' ')).toContain('status=304')
      expect(held.join(' ')).not.toContain('Answer:')
      expect(fetch).toHaveBeenCalledTimes(3)
      for (const changes of [{ measure: { ...measure, magnitude: 0.1 } }, { measure: { ...measure, direction: 'down' } },
        { measure: { ...measure, kind: 'close' } }, { measure: { ...measure, horizon: '1h' } }, { rows: 3 }, { full_counts: true }, { full_outcomes: true }]) {
        const result = texts(await client.callTool({ name: 'run_scan', arguments: { document: body.query, measure, if_none_match: etag, ...changes } }))
        expect(result.join(' ')).not.toContain('status=304')
        if ('full_counts' in changes) expect(result).toContain(canonical)
        if ('full_outcomes' in changes) {
          const scan = result.map(t => { try { return JSON.parse(t) } catch { return null } }).find(v => v?.counts)
          expect(scan.query).toEqual(body.query)
          expect(scan.outcomes_summary.metrics.mfe_7d.thresholds).toEqual(body.outcomes_summary.metrics.mfe_7d.thresholds)
        }
      }
      const error = '{"errors":[{"code":"INVALID_SHAPE","message":"bad document"}]}'
      fetch.mockResolvedValueOnce(new Response(error, { status: 422 }))
      const rejected = await client.callTool({ name: 'run_scan', arguments: { document: body.query, measure } })
      expect(rejected.isError).toBe(true)
      expect(texts(rejected)).toContain(error)
      expect(texts(rejected).join(' ')).not.toContain('Answer:')
    } finally { await client.close() }
  })

  it('distinguishes zero hits, missing observations and an unavailable exact rung in the opening answer', () => {
    const body = structuredClone(fixtures[0].result)
    const metric = body.outcomes_summary.metrics.mfe_24h
    const rung = metric.thresholds.find((r: any) => r.op === 'gte' && r.threshold === 0.05)
    const answer = () => scanTextAnswer({ ok: true, status: 200, notModified: false,
      bodyText: JSON.stringify(body), headers: {} }, null, measure as any)!
    rung.count = 0
    metric.present = 5
    metric.absent = 2
    expect(answer()).toContain('0 of 5 observed occurrences (0%; 2 missing). Small sample.')
    metric.present = 0
    expect(answer()).toContain('No measured outcomes (0 observed; 2 missing); no rate.')
    rung.threshold = 0.1
    expect(answer()).toContain('Exact threshold unavailable; no nearby rung substituted.')
    rung.threshold = 0.05
    rung.count = 1
    metric.present = 1_000_000
    expect(answer()).toContain('1 of 1000000 observed occurrences (0.0001%')
  })

  it('separates projection ETags by text format and horizon', () => {
    const tags = [projectionTag(DEFAULT_LEAN), ...['1h', '24h'].map(textHorizon => projectionTag({ ...DEFAULT_LEAN, textHorizon }))]
    expect(new Set(tags).size).toBe(3)
  })
})
