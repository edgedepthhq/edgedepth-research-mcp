/**
 * Repair notes on contract refusals (2026-09-04 agent surface audit,
 * finding 4). The engine's error body is a contract and must still arrive
 * byte-for-byte; the note is additive, and it must never appear when it would
 * have nothing true to say.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache } from '../src/index.js'
import { nearestFeatures, needsRegistry, repairNote } from '../src/repair.js'
import { connectClient, texts, TEST_KEY } from './helpers.js'

const fetchMock = vi.fn()

beforeEach(() => {
  clearRegistryCache()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const KNOWN = [
  'feature.vpin',
  'feature.vpin_regime',
  'feature.realized_vol_1h',
  'feature.realized_vol_pctrank',
  'feature.funding_rate',
  'feature.liq_intensity_norm',
]

const REGISTRY = JSON.stringify({
  schema_version: 'research_query.v2',
  normalization_version: 'archive_normalization.v1',
  feature_version: 'feature_defs.v1',
  features: Object.fromEntries(KNOWN.map((id) => [id, { dtype: 'number' }])),
})

function errorBody(...errors: { code: string; message: string }[]) {
  return JSON.stringify({ errors })
}

describe('nearestFeatures', () => {
  it('prefers containment, then edit distance, then alphabetical order', () => {
    expect(nearestFeatures('feature.vpin_reg', KNOWN)).toEqual([
      'feature.vpin_regime',
      'feature.vpin',
    ])
    expect(nearestFeatures('feature.realized_vol', KNOWN)).toEqual([
      'feature.realized_vol_1h',
      'feature.realized_vol_pctrank',
    ])
    expect(nearestFeatures('feature.fundingrate', KNOWN)).toEqual(['feature.funding_rate'])
  })

  it('says nothing rather than guessing when nothing is close', () => {
    expect(nearestFeatures('feature.rsi', KNOWN)).toEqual([])
  })
})

describe('repairNote', () => {
  it('names the nearest real ids for an unknown feature', () => {
    const note = repairNote(
      errorBody({ code: 'UNSUPPORTED_FEATURE', message: 'Unknown feature: feature.vpin_reg' }),
      KNOWN,
    )!
    expect(note).toContain('feature.vpin_regime')
    expect(note).toContain('list_features (search: "vpin_reg")')
  })

  it('states the closed grammar when an unknown feature has no near match', () => {
    const note = repairNote(
      errorBody({ code: 'UNSUPPORTED_FEATURE', message: 'Unknown feature: feature.rsi' }),
      KNOWN,
    )!
    expect(note).toContain('nothing in the registry is close to it')
    expect(note).not.toContain('Nearest real ids')
  })

  it('states the lowercase rule and the lowercased candidate for a rejected symbol', () => {
    const note = repairNote(
      errorBody({ code: 'INVALID_VALUE', message: 'Invalid identity.symbol: "BTCUSDT"' }),
      [],
    )!
    expect(note).toContain('exact lowercase')
    expect(note).toContain('"btcusdt"')
  })

  it('gives the one legal way to ask an outcome question', () => {
    const note = repairNote(
      errorBody({
        code: 'OUTCOME_IN_PREDICATE',
        message: 'Outcome fields ... cannot be filtered: outcome.fwd_ret_1h',
      }),
      [],
    )!
    expect(note).toContain('outcomes_summary')
    expect(note).toContain('run_cohort')
  })

  it('covers every error in one note when the body carries several', () => {
    const note = repairNote(
      errorBody(
        { code: 'INVALID_VALUE', message: 'Invalid identity.symbol: "BTCUSDT"' },
        { code: 'UNSUPPORTED_FEATURE', message: 'Unknown feature: feature.vpin_reg' },
      ),
      KNOWN,
    )!
    expect(note).toContain('2 contract errors above')
    expect(note).toContain('"btcusdt"')
    expect(note).toContain('feature.vpin_regime')
  })

  it('stays silent on codes it cannot improve, and on non-contract bodies', () => {
    expect(repairNote(errorBody({ code: 'INVALID_SHAPE', message: 'not a document' }), KNOWN)).toBeNull()
    expect(repairNote(JSON.stringify({ error: 'busy', code: 'SCAN_BUSY' }), KNOWN)).toBeNull()
    expect(repairNote('not json', KNOWN)).toBeNull()
  })

  it('only asks for the registry when the refusal actually needs ids', () => {
    expect(needsRegistry(errorBody({ code: 'UNSUPPORTED_FEATURE', message: 'x' }))).toBe(true)
    expect(needsRegistry(errorBody({ code: 'OUTCOME_IN_PREDICATE', message: 'x' }))).toBe(false)
    expect(needsRegistry('not json')).toBe(false)
  })
})

describe('repair notes end to end', () => {
  it('adds the note after the verbatim body, and reads the registry once', async () => {
    const body = errorBody({ code: 'UNSUPPORTED_FEATURE', message: 'Unknown feature: feature.vpin_reg' })
    fetchMock
      .mockResolvedValueOnce(new Response(body, { status: 422 }))
      .mockResolvedValueOnce(new Response(REGISTRY, { status: 200 }))
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: { a: 1 } } })
    const blocks = texts(res)

    expect(res.isError).toBe(true)
    expect(blocks).toContain(body) // the contract body is untouched
    expect(blocks[blocks.length - 1]).toContain('feature.vpin_regime')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, registryCall] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect((registryCall.headers as Record<string, string>).authorization).toBe(`Bearer ${TEST_KEY}`)
  })

  it('still returns the plain refusal when the registry itself is unavailable', async () => {
    const body = errorBody({ code: 'UNSUPPORTED_FEATURE', message: 'Unknown feature: feature.rsi' })
    fetchMock
      .mockResolvedValueOnce(new Response(body, { status: 422 }))
      .mockResolvedValueOnce(new Response('{"code":"ENGINE_UNREACHABLE"}', { status: 502 }))
    const client = await connectClient()
    const res = await client.callTool({ name: 'run_scan', arguments: { document: { a: 1 } } })
    expect(res.isError).toBe(true)
    expect(texts(res)).toContain(body)
    expect(texts(res).join('\n')).toContain('closed')
  })

  it('repairs a base_rate refusal from the registry it already holds', async () => {
    const body = errorBody({ code: 'UNSUPPORTED_FEATURE', message: 'Unknown feature: feature.vpin_reg' })
    fetchMock
      .mockResolvedValueOnce(new Response(REGISTRY, { status: 200 }))
      .mockResolvedValueOnce(new Response(body, { status: 422 }))
    const client = await connectClient()
    const res = await client.callTool({
      name: 'base_rate',
      arguments: {
        field: 'feature.vpin_reg',
        operator: 'gte',
        value: 0.85,
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-08T00:00:00Z',
      },
    })
    expect(texts(res).join('\n')).toContain('feature.vpin_regime')
    // The registry it already read is reused: no extra call for the note.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
