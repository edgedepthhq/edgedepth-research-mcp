/**
 * The paired answer block (2026-09-05).
 *
 * This is the first projection step that DERIVES rather than removes, so the
 * tests here are about the licence for that: the engine's integers survive
 * untouched, every derived number is reproducible from operands that travel
 * beside it, the rung selection is fixed rather than chosen for relevance, and
 * a missing or zero baseline produces no number at all rather than a guess.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache } from '../src/index.js'
import { CANONICAL_RUNGS, MIN_PROMOTED_COUNT, pairOutcomes } from '../src/answer.js'
import { DEFAULT_LEAN, leanScanBody, projectionTag } from '../src/projection.js'
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

/** The real grid shape: the same 26 rungs on every metric. */
function ladder(counts: Record<string, number>, present: number, absent = 0) {
  const grid = [
    ['gte', 0.001],
    ['gte', 0.01],
    ['gte', 0.02],
    ['gte', 0.05],
    ['lte', -0.01],
    ['lte', -0.02],
  ] as const
  return {
    present,
    absent,
    thresholds: grid.map(([op, threshold]) => ({
      op,
      threshold,
      count: counts[`${op}:${threshold}`] ?? 0,
    })),
    // one empty rung, so the full_outcomes path has a removal to make and
    // does not fall through to the verbatim null.
    buckets: [{ lo: -1, hi: 0, count: 10 }, { lo: 0, hi: 1, count: 0 }],
  }
}

/** Cumulative and monotonic, like the engine's. gte 0.001 matches every
 *  occurrence, so it is degenerate; gte 0.05 clears MIN_PROMOTED_COUNT and
 *  carries the widest lift. */
const MATCHED = {
  metrics: {
    fwd_ret_1h: ladder(
      {
        'gte:0.001': 1000,
        'gte:0.01': 500,
        'gte:0.02': 200,
        'gte:0.05': 40,
        'lte:-0.01': 250,
        'lte:-0.02': 100,
      },
      1000,
      3,
    ),
  },
}
const BASELINE = {
  metrics: {
    fwd_ret_1h: ladder(
      {
        'gte:0.001': 8000,
        'gte:0.01': 1000,
        'gte:0.02': 400,
        'gte:0.05': 2,
        'lte:-0.01': 1250,
        'lte:-0.02': 500,
      },
      10000,
      7,
    ),
  },
}

describe('pairOutcomes: the counts are the record', () => {
  it('passes present, absent and every kept integer count through untouched', () => {
    const paired = pairOutcomes(MATCHED, BASELINE)!
    const metric = paired.metrics.fwd_ret_1h
    expect(metric.present).toBe(1000)
    expect(metric.absent).toBe(3)
    expect(metric.baseline_present).toBe(10000)
    const gte01 = metric.rungs.find((r) => r.op === 'gte' && r.threshold === 0.01)!
    expect(gte01.count).toBe(500)
    expect(gte01.baseline_count).toBe(1000)
  })

  it('derives rate and lift from the operands it ships, and nothing else', () => {
    const metric = pairOutcomes(MATCHED, BASELINE)!.metrics.fwd_ret_1h
    for (const rung of metric.rungs) {
      expect(rung.rate).toBeCloseTo(rung.count / metric.present, 4)
      if (rung.lift !== undefined) {
        expect(rung.baseline_rate).toBeCloseTo(rung.baseline_count! / metric.baseline_present!, 6)
        expect(rung.lift).toBeCloseTo(rung.rate / rung.baseline_rate!, 2)
      }
    }
    const gte01 = metric.rungs.find((r) => r.threshold === 0.01 && r.op === 'gte')!
    expect(gte01.rate).toBe(0.5)
    expect(gte01.baseline_rate).toBe(0.1)
    expect(gte01.lift).toBe(5)
  })
})

describe('pairOutcomes: the selection is fixed, not chosen', () => {
  it('keeps the four canonical rungs whatever the data says about them', () => {
    const metric = pairOutcomes(MATCHED, BASELINE)!.metrics.fwd_ret_1h
    for (const canonical of CANONICAL_RUNGS) {
      expect(
        metric.rungs.some((r) => r.op === canonical.op && r.threshold === canonical.threshold),
      ).toBe(true)
    }
  })

  it('adds the single widest-lift rung so the fixed set cannot hide an effect', () => {
    // gte 0.05 is outside the canonical set and has the largest lift (25x).
    const metric = pairOutcomes(MATCHED, BASELINE)!.metrics.fwd_ret_1h
    const extra = metric.rungs.find((r) => r.op === 'gte' && r.threshold === 0.05)!
    expect(extra.lift).toBe(200)
    expect(extra.kept_for).toContain('largest lift')
    expect(metric.rungs.filter((r) => r.kept_for)).toHaveLength(1)
  })

  it('drops rungs that separate nothing, which is what removes mae and mfe dead halves', () => {
    // gte 0.001 matches every occurrence, so it distinguishes nothing.
    const metric = pairOutcomes(MATCHED, BASELINE)!.metrics.fwd_ret_1h
    expect(metric.rungs.some((r) => r.threshold === 0.001)).toBe(false)
    expect(pairOutcomes(MATCHED, BASELINE)!.dropped).toBeGreaterThan(0)
  })

  it('refuses to promote a rung whose lift rests on too few occurrences', () => {
    // Same 200x lift, but on 5 occurrences instead of 40. MEASURED on the real
    // golden result, the unguarded valve promoted count 1 of 1,986 at 48.79x.
    const thin = {
      metrics: {
        fwd_ret_1h: ladder(
          {
            'gte:0.001': 1000,
            'gte:0.01': 500,
            'gte:0.02': 200,
            'gte:0.05': 5,
            'lte:-0.01': 250,
            'lte:-0.02': 100,
          },
          1000,
        ),
      },
    }
    const metric = pairOutcomes(thin, BASELINE)!.metrics.fwd_ret_1h
    expect(metric.rungs.some((r) => r.threshold === 0.05)).toBe(false)
    expect(metric.rungs.every((r) => !r.kept_for)).toBe(true)
    expect(MIN_PROMOTED_COUNT).toBe(30)
  })

  it('is deterministic: the same input twice gives byte-identical output', () => {
    expect(JSON.stringify(pairOutcomes(MATCHED, BASELINE))).toBe(
      JSON.stringify(pairOutcomes(MATCHED, BASELINE)),
    )
  })
})

describe('pairOutcomes: it never invents a comparison', () => {
  it('states rates alone and no lift when there is no baseline', () => {
    const paired = pairOutcomes(MATCHED, undefined)!
    expect(paired.paired).toBe(false)
    for (const rung of paired.metrics.fwd_ret_1h.rungs) {
      expect(rung.lift).toBeUndefined()
      expect(rung.baseline_rate).toBeUndefined()
      expect(rung.rate).toBeGreaterThan(0)
    }
  })

  it('omits lift rather than dividing by a zero unconditional rate', () => {
    const zeroBase = {
      metrics: { fwd_ret_1h: ladder({ 'gte:0.001': 9000, 'lte:-0.01': 1250 }, 10000) },
    }
    const metric = pairOutcomes(MATCHED, zeroBase)!.metrics.fwd_ret_1h
    const gte01 = metric.rungs.find((r) => r.op === 'gte' && r.threshold === 0.01)!
    expect(gte01.baseline_count).toBe(0)
    expect(gte01.baseline_rate).toBe(0)
    expect(gte01.lift).toBeUndefined()
    expect(gte01.rate).toBe(0.5)
  })

  it('returns null on a body with no threshold ladder, so the caller degrades to removal', () => {
    expect(pairOutcomes({ metrics: {} }, BASELINE)).toBeNull()
    expect(pairOutcomes({ metrics: { fwd_ret_1h: { present: 5 } } }, BASELINE)).toBeNull()
    expect(pairOutcomes('nonsense', BASELINE)).toBeNull()
  })
})

describe('leanScanBody in answer mode', () => {
  const body = () =>
    JSON.stringify({
      counts: { total_matching: 1000 },
      occurrences: [],
      outcomes_summary: { ...MATCHED, note: 'computed forward from anchor' },
      baseline: BASELINE,
      reproducibility_key: { canonical_query_hash: 'abc123' },
    })

  it('replaces the ladders, keeps the summary note, and states that it derived', () => {
    const lean = leanScanBody(body())!
    const parsed = JSON.parse(lean.bodyText)
    expect(parsed.outcomes_summary.note).toBe('computed forward from anchor')
    expect(parsed.outcomes_summary.metrics.fwd_ret_1h.rungs).toBeDefined()
    expect(parsed.outcomes_summary.metrics.fwd_ret_1h.thresholds).toBeUndefined()
    expect(parsed.baseline.metrics).toBeUndefined()
    const note = lean.notes.find((n) => n.startsWith('answer ('))!
    expect(note).toContain('verbatim')
    expect(note).toContain('full_outcomes: true')
    expect(note).toContain('not matched, comparable, or a causal control')
  })

  it('leaves counts and the reproducibility key exactly as they arrived', () => {
    const parsed = JSON.parse(leanScanBody(body())!.bodyText)
    expect(parsed.counts).toEqual({ total_matching: 1000 })
    expect(parsed.reproducibility_key).toEqual({ canonical_query_hash: 'abc123' })
  })

  it('keeps the full ladders under full_outcomes', () => {
    const lean = leanScanBody(body(), { ...DEFAULT_LEAN, answer: false })
    const parsed = JSON.parse(lean!.bodyText)
    expect(parsed.outcomes_summary.metrics.fwd_ret_1h.thresholds).toHaveLength(6)
    expect(lean!.notes.some((n) => n.startsWith('answer ('))).toBe(false)
  })

  it('is markedly smaller than the ladders it replaced', () => {
    const answered = leanScanBody(body())!.bodyText.length
    const ladders = leanScanBody(body(), { ...DEFAULT_LEAN, answer: false })!.bodyText.length
    expect(answered).toBeLessThan(ladders)
  })
})

describe('the answer projection carries its own ETag', () => {
  it('cannot revalidate against the full-ladder representation', () => {
    const answer = projectionTag(DEFAULT_LEAN)
    const ladders = projectionTag({ ...DEFAULT_LEAN, answer: false })
    expect(answer).not.toBe(ladders)
    const held = scopeEtag('W/"abc"', answer)
    expect(unscopeEtag(held, answer)).toBe('W/"abc"')
    expect(unscopeEtag(held, ladders)).toBeUndefined()
  })

  it('leaves the 0.4.0 tag meaning what it meant: the full-ladder shape', () => {
    // A client holding nz.r3 from 0.4.0 described full ladders, and
    // full_outcomes still produces exactly that tag.
    expect(projectionTag({ ...DEFAULT_LEAN, answer: false })).toBe('nz.r3')
    expect(projectionTag(DEFAULT_LEAN)).toBe('nz.a.r3')
  })
})

describe('run_scan end to end', () => {
  it('pairs the separately fetched baseline in and sheds the reference ladder', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith('/baseline')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              baseline: BASELINE,
              scope: { from: 'a', to: 'b' },
              counts: { baseline_buckets: 1000 },
              reproducibility_key: { baseline_scope_hash: 'def456' },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            counts: { total_matching: 1000 },
            occurrences: [],
            outcomes_summary: MATCHED,
            reproducibility_key: { canonical_query_hash: 'abc123' },
          }),
          { status: 200 },
        ),
      )
    })
    const client = await connectClient()
    const out = texts(await client.callTool({ name: 'run_scan', arguments: { document: DOCUMENT } }))
    const joined = out.join('\n')

    // The lift is in the body, computed against the separately fetched baseline.
    const scan = JSON.parse(out[1])
    expect(scan.outcomes_summary.metrics.fwd_ret_1h.rungs[0].lift).toBeDefined()
    expect(scan.outcomes_summary.metrics.fwd_ret_1h.baseline_present).toBe(10000)

    // The reference block keeps its provenance and loses its duplicate ladder.
    const reference = out.find((t) => t.startsWith('unconditional_same_scope_reference'))!
    expect(reference).toContain('def456')
    expect(reference).toContain('is already stated as baseline_rate')
    expect(JSON.parse(reference.slice(reference.indexOf('{'))).baseline.metrics).toBeUndefined()
    expect(joined).toContain('answer (counts verbatim')
  })

  it('says so plainly when the baseline call failed, and states no lift', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('/baseline')
          ? new Response(JSON.stringify({ error: 'nope', code: 'BASELINE_UNAVAILABLE' }), {
              status: 503,
            })
          : new Response(
              JSON.stringify({
                counts: { total_matching: 1000 },
                occurrences: [],
                outcomes_summary: MATCHED,
                reproducibility_key: { canonical_query_hash: 'abc123' },
              }),
              { status: 200 },
            ),
      ),
    )
    const client = await connectClient()
    const out = texts(await client.callTool({ name: 'run_scan', arguments: { document: DOCUMENT } }))
    const scan = JSON.parse(out[1])
    expect(scan.outcomes_summary.metrics.fwd_ret_1h.rungs[0].lift).toBeUndefined()
    expect(out.join('\n')).toContain('Do not invent a baseline')
    expect(out.join('\n')).toContain('do not invent a reference rate')
  })
})
