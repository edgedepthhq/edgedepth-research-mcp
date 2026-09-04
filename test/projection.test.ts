/**
 * The lean projection (2026-09-04 agent surface audit).
 *
 * The projection exists to keep a scan answerable inside a client's
 * tool-result budget, and it is only allowed to REMOVE. These tests hold the
 * three promises that make that safe: no denominator ever moves, every removal
 * is stated, and a projected ETag can never revalidate different bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache } from '../src/index.js'
import {
  DEFAULT_LEAN,
  leanScanBody,
  leanSummaryBody,
  projectRegistry,
  projectionTag,
} from '../src/projection.js'
import { scopeEtag, unscopeEtag } from '../src/tools.js'
import { connectClient, texts } from './helpers.js'

const fetchMock = vi.fn()

beforeEach(() => {
  clearRegistryCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const DOCUMENT = {
  schema_version: 'research_query.v2',
  target: 'record_occurrences',
  where: { all: [['feature.vpin', 'gte', 0.85]] },
}

function occurrence(id: string, symbol: string) {
  return {
    id,
    symbol,
    anchor_time: '2026-06-06T09:58:00.000Z',
    evidence: [{ field: 'feature.vpin', operator: 'gte', store_value: 0.9 }],
    setup: {
      'feature.vpin': 0.9,
      'feature.book_imbalance': 0.3,
      'feature.funding_rate': 0.0001,
      'feature.ret_1h': -0.02,
    },
  }
}

/** A body shaped like the engine's, small enough to assert on exactly. */
function scanBody(rows = 5) {
  const occurrences = Array.from({ length: rows }, (_, i) => occurrence(`id${i}`, 'btcusdt'))
  const outcomes = Object.fromEntries(occurrences.map((o) => [o.id, { fwd_ret_1h: 0.01 }]))
  const counts_by_symbol: Record<string, { total_matching: number }> = {
    btcusdt: { total_matching: 40 },
    ethusdt: { total_matching: 0 },
    solusdt: { total_matching: 30 },
    adausdt: { total_matching: 7 },
  }
  return JSON.stringify({
    counts: { total_matching: 77, eligible_symbol_buckets: 1_000_000 },
    counts_by_symbol,
    occurrences,
    outcomes,
    outcomes_summary: {
      metrics: {
        fwd_ret_1h: {
          absent: 3,
          buckets: [
            { lo: null, hi: -1, count: 0 },
            { lo: -1, hi: -0.5, count: 4 },
            { lo: -0.5, hi: 0, count: 0 },
            { lo: 0, hi: 0.5, count: 70 },
          ],
        },
      },
      occurrences_per_day: [{ day: '2026-06-06', count: 77 }],
    },
    representatives: [{ id: 'max_fwd_ret_1h' }],
    next_cursor: 'opaque',
    reproducibility_key: { canonical_query_hash: 'abc123' },
  })
}

/** Every number an answer is allowed to quote. */
function denominators(body: string) {
  const parsed = JSON.parse(body)
  const metrics = parsed.outcomes_summary.metrics.fwd_ret_1h
  return {
    counts: parsed.counts,
    absent: metrics.absent,
    bucketSum: metrics.buckets.reduce((a: number, b: { count: number }) => a + b.count, 0),
    key: parsed.reproducibility_key,
    cursor: parsed.next_cursor,
    representatives: parsed.representatives.length,
  }
}

describe('leanScanBody: what it removes', () => {
  it('keeps the default number of rows and states how many it dropped', () => {
    const lean = leanScanBody(scanBody(5))!
    const body = JSON.parse(lean.bodyText)
    expect(body.occurrences).toHaveLength(DEFAULT_LEAN.rows)
    expect(lean.notes.join(' ')).toContain('2 of 5 row(s)')
    expect(lean.notes.join(' ')).toContain('never the denominator')
  })

  it('thins each kept row to the fields its own evidence names', () => {
    const lean = leanScanBody(scanBody(3))!
    const body = JSON.parse(lean.bodyText)
    expect(Object.keys(body.occurrences[0].setup)).toEqual(['feature.vpin'])
    expect(body.occurrences[0].evidence).toHaveLength(1)
    expect(lean.notes.join(' ')).toContain('full_rows: true')
  })

  it('keeps the whole vector under full_rows, and whenever evidence is missing', () => {
    const full = leanScanBody(scanBody(3), { ...DEFAULT_LEAN, fullRows: true })!
    expect(Object.keys(JSON.parse(full.bodyText).occurrences[0].setup)).toHaveLength(4)

    const noEvidence = JSON.parse(scanBody(3))
    delete noEvidence.occurrences[0].evidence
    const lean = leanScanBody(JSON.stringify(noEvidence))!
    expect(Object.keys(JSON.parse(lean.bodyText).occurrences[0].setup)).toHaveLength(4)
  })

  it('keeps the per-occurrence outcomes entries for the rows it kept', () => {
    const lean = leanScanBody(scanBody(5))!
    const body = JSON.parse(lean.bodyText)
    expect(Object.keys(body.outcomes)).toEqual(['id0', 'id1', 'id2'])
    expect(lean.notes.join(' ')).toContain('read every rate from outcomes_summary')
  })

  it('drops zero-count instruments and the tail, ranked and tie-broken deterministically', () => {
    const lean = leanScanBody(scanBody(3), { ...DEFAULT_LEAN, symbols: 2 })!
    const body = JSON.parse(lean.bodyText)
    expect(Object.keys(body.counts_by_symbol)).toEqual(['btcusdt', 'solusdt'])
    const note = lean.notes.find((n) => n.startsWith('counts_by_symbol'))!
    expect(note).toContain('1 zero-count instrument(s)')
    expect(note).toContain('1 further instrument(s) holding 7 match(es)')
    expect(note).toContain('NO LONGER SUMS')
  })

  it('drops empty ladder rungs only', () => {
    const lean = leanScanBody(scanBody(3))!
    const buckets = JSON.parse(lean.bodyText).outcomes_summary.metrics.fwd_ret_1h.buckets
    expect(buckets.map((b: { count: number }) => b.count)).toEqual([4, 70])
    expect(lean.notes.join(' ')).toContain('2 empty threshold rung(s)')
  })

  it('falls back to verbatim on non-JSON, non-objects, and a body with nothing to remove', () => {
    expect(leanScanBody('not json')).toBeNull()
    expect(leanScanBody('[1,2,3]')).toBeNull()
    expect(leanScanBody(JSON.stringify({ counts: { total_matching: 1 } }))).toBeNull()
  })
})

describe('leanScanBody: what it must never touch', () => {
  it('leaves every denominator, the key, the cursor and the representatives identical', () => {
    const raw = scanBody(5)
    const lean = leanScanBody(raw)!
    expect(denominators(lean.bodyText)).toEqual(denominators(raw))
  })

  it('never rewrites the request document (the projection is response-side only)', async () => {
    fetchMock.mockResolvedValue(new Response(scanBody(5), { status: 200 }))
    const client = await connectClient()
    await client.callTool({ name: 'run_scan', arguments: { document: DOCUMENT, rows: 1 } })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual(DOCUMENT)
  })
})

describe('projection-scoped ETags', () => {
  it('gives each projection its own tag, so one can never revalidate another', () => {
    const three = projectionTag(DEFAULT_LEAN)
    const ten = projectionTag({ ...DEFAULT_LEAN, rows: 10 })
    const full = projectionTag({ ...DEFAULT_LEAN, fullRows: true })
    expect(new Set([three, ten, full]).size).toBe(3)
    const held = scopeEtag('W/"abc"', three)
    expect(unscopeEtag(held, three)).toBe('W/"abc"')
    expect(unscopeEtag(held, ten)).toBeUndefined()
    expect(unscopeEtag(held, full)).toBeUndefined()
  })
})

describe('leanSummaryBody (the unconditional reference block)', () => {
  it('drops empty rungs and the reference own per-day histogram, and says so', () => {
    const body = JSON.stringify({
      baseline: {
        metrics: { fwd_ret_1h: { absent: 5, buckets: [{ count: 0 }, { count: 9 }] } },
        occurrences_per_day: [{ day: '2026-06-06', count: 1 }],
      },
    })
    const lean = leanSummaryBody(body)!
    const parsed = JSON.parse(lean.bodyText)
    expect(parsed.baseline.metrics.fwd_ret_1h.buckets).toEqual([{ count: 9 }])
    expect(parsed.baseline.metrics.fwd_ret_1h.absent).toBe(5)
    expect(parsed.baseline.occurrences_per_day).toBeUndefined()
    expect(lean.notes[0]).toContain('empty threshold rung')
  })

  it('returns null when there is nothing to remove', () => {
    expect(leanSummaryBody(JSON.stringify({ baseline: { metrics: {} } }))).toBeNull()
  })
})

describe('projectRegistry', () => {
  const registry = JSON.stringify({
    schema_version: 'research_query.v2',
    features: {
      'feature.vpin': { dtype: 'number', description: 'informed trading proxy', implemented: true },
      'feature.liq_intensity_norm': { dtype: 'number', description: 'liquidation rate' },
      'feature.funding_rate': { dtype: 'number', description: 'perpetual funding' },
    },
    operators: { number: ['gte'] },
    limits: { maxClauses: 16 },
    error_codes: { validation: ['UNSUPPORTED_FEATURE'] },
    instrument_examples: { btcusdt: {} },
  })

  it('returns null with no filter, so the default read is verbatim', () => {
    expect(projectRegistry(registry, {})).toBeNull()
  })

  it('filters by substring over id and description, keeping the closed grammar', () => {
    const lean = projectRegistry(registry, { search: 'liquidation' })!
    const doc = JSON.parse(lean.bodyText)
    expect(Object.keys(doc.features)).toEqual(['feature.liq_intensity_norm'])
    expect(doc.operators).toEqual({ number: ['gte'] })
    expect(doc.limits).toEqual({ maxClauses: 16 })
    expect(doc.error_codes).toBeDefined()
    expect(lean.notes.join(' ')).toContain('may still exist')
  })

  it('accepts bare names and names back the ids that do not exist', () => {
    const lean = projectRegistry(registry, { featureIds: ['vpin', 'feature.rsi'] })!
    const doc = JSON.parse(lean.bodyText)
    expect(Object.keys(doc.features)).toEqual(['feature.vpin'])
    expect(lean.notes.join(' ')).toContain('feature.rsi')
    expect(lean.notes.join(' ')).toContain('closed grammar')
  })

  it('compact drops prose and the instrument examples, never the shape', () => {
    const lean = projectRegistry(registry, { compact: true })!
    const doc = JSON.parse(lean.bodyText)
    expect(doc.features['feature.vpin']).toEqual({ dtype: 'number', implemented: true })
    expect(doc.instrument_examples).toBeUndefined()
    expect(lean.notes.join(' ')).toContain('list_instruments')
  })
})

describe('prompts and resources (the examples an agent can reach)', () => {
  it('publishes the worked prompts', async () => {
    const client = await connectClient()
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'does_it_confirm',
      'how_common_is_it',
      'investigate_symbol',
      'liquidation_cascade_bounce',
      'test_a_claim',
    ])
  })

  it('renders a prompt that grounds, proposes, and waits for confirmation', async () => {
    const client = await connectClient()
    const result = await client.getPrompt({
      name: 'test_a_claim',
      arguments: { claim: 'liquidation cascades bounce' },
    })
    const rendered = result.messages.map((m) => (m.content as { text: string }).text).join(' ')
    expect(rendered).toContain('liquidation cascades bounce')
    expect(rendered).toContain('list_features')
    expect(rendered).toContain('wait for my confirmation')
    expect(rendered).toContain('reproducibility key')
  })

  it('serves the grammar as a resource, read with the caller own credential', async () => {
    const registryBytes = JSON.stringify({ features: { 'feature.vpin': { dtype: 'number' } } })
    fetchMock.mockResolvedValue(new Response(registryBytes, { status: 200 }))
    const client = await connectClient()
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri)).toEqual(['edgedepth://research/grammar'])
    const read = await client.readResource({ uri: 'edgedepth://research/grammar' })
    expect((read.contents[0] as { text: string }).text).toBe(registryBytes)
  })

  it('refuses the resource read without a credential instead of returning empty bytes', async () => {
    const client = await connectClient(() => undefined)
    await expect(client.readResource({ uri: 'edgedepth://research/grammar' })).rejects.toThrow(
      /No EdgeDepth credential/,
    )
  })
})
