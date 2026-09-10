import { describe, expect, it } from 'vitest'
import { selectedOutcome } from '../src/selectedOutcome.js'
import type { ApiResponse } from '../src/apiClient.js'
const response = (body: unknown): ApiResponse => ({ ok: true, status: 200, notModified: false, bodyText: JSON.stringify(body), headers: {} })
const metric = (count: number, present = 5) => ({ present, absent: 2, thresholds: [{ op: 'gte', threshold: 0.1, count }] })
const measure = { kind: 'touch', direction: 'up', magnitude: 0.1, horizon: '4h' } as const

describe('the selected full-population outcome', () => {
  it('keeps the exact nondefault path metric, zero counts, opposite denominator and reference', () => {
    const scan = response({ outcomes_summary: { metrics: { mfe_4h: metric(0), mae_4h: { present: 4, absent: 3, thresholds: [{ op: 'lte', threshold: -0.1, count: 1 }] }, fwd_ret_1h: metric(5) } }, occurrences: [{ outcome: 999 }] })
    const out = selectedOutcome(scan, response({ baseline: { metrics: { mfe_4h: metric(3, 20) } } }), measure)!
    expect(out.matched).toMatchObject({ metric: 'mfe_4h', count: 0, present: 5, absent: 2, rate: 0 })
    expect(out.opposite).toMatchObject({ metric: 'mae_4h', count: 1, present: 4 })
    expect(out.reference).toMatchObject({ count: 3, present: 20, rate: 0.15 })
  })
  it('does not substitute a default close or nearby rung for an absent target', () => {
    const out = selectedOutcome(response({ outcomes_summary: { metrics: { fwd_ret_1h: metric(4), mfe_4h: metric(2) } } }), null, { ...measure, magnitude: 0.2 })!
    expect(out.matched).toMatchObject({ available: false, metric: 'mfe_4h' })
    expect(out.matched).not.toHaveProperty('rate')
    expect(out.reference.available).toBe(false)
  })
  it('preserves zero denominators without inventing a rate and handles errors and 304', () => {
    expect(selectedOutcome(response({ outcomes_summary: { metrics: { mfe_4h: metric(0, 0) } } }), null, measure)!.matched).toMatchObject({ count: 0, present: 0, rate: null })
    expect(selectedOutcome({ ...response({}), notModified: true }, null, measure)).toBeNull()
    expect(selectedOutcome({ ...response({}), ok: false }, null, measure)).toBeNull()
  })
})
