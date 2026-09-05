import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRegistryCache, readingDocUrl, symbolDocUrl } from '../src/index.js'
import { connectClient, texts } from './helpers.js'

/**
 * The machine-readable feature and its human reading page are connected by a
 * RULE, not a table: edgedepth-web generates one static page per registry id
 * at /research/readings/<id without the "feature." prefix>. These tests pin
 * the rule at both ends - the URL this server emits, and the transform the web
 * route actually applies - and pin what the connection must NOT cost:
 * unchanged registry bytes, unchanged search/filter behaviour, compact still
 * compact.
 */
const registryBytes = JSON.stringify({
  schema_version: 'research_query.v2',
  normalization_version: 'archive_normalization.v1',
  feature_version: 'feature_defs.v1',
  features: {
    'feature.vpin': {
      dtype: 'number',
      min: 0,
      max: 1,
      description: 'informed trading proxy',
      implemented: true,
    },
    'feature.liq_intensity_norm': {
      dtype: 'number',
      description: 'liquidation rate',
      implemented: true,
    },
  },
  instrument_examples: { btcusdt: {} },
})

const fetchMock = vi.fn()

beforeEach(() => {
  clearRegistryCache()
  fetchMock.mockReset()
  // A fresh Response per call: a body can only be read once, and the registry
  // revalidates on every read.
  fetchMock.mockImplementation(
    () => new Response(registryBytes, { status: 200, headers: { etag: '"r1"' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('human reading pages', () => {
  it('resolves a known feature id to its reading page', () => {
    expect(readingDocUrl('feature.vpin')).toBe('https://edgedepth.com/research/readings/vpin')
    expect(readingDocUrl('feature.desc_resistance_short_broken_touches')).toBe(
      'https://edgedepth.com/research/readings/desc_resistance_short_broken_touches',
    )
  })

  it('list_features states the rule, so any returned id resolves', async () => {
    const client = await connectClient()
    const res = await client.callTool({ name: 'list_features', arguments: {} })
    const hint = texts(res).find((t) => t.includes('research/readings'))!
    expect(hint).toBeDefined()
    expect(hint).toContain('https://edgedepth.com/research/readings/')
    expect(hint).toContain(readingDocUrl('feature.vpin'))
  })

  it('carries the rule on the filtered read too', async () => {
    const client = await connectClient()
    const res = await client.callTool({
      name: 'list_features',
      arguments: { feature_ids: ['vpin'] },
    })
    expect(texts(res).some((t) => t.includes(readingDocUrl('feature.vpin')))).toBe(true)
  })

  it('leaves the registry bytes byte-identical: the URL is never in the document', async () => {
    const client = await connectClient()
    const res = await client.callTool({ name: 'list_features', arguments: {} })
    expect(texts(res)).toContain(registryBytes)
    const body = texts(res).find((t) => t.startsWith('{'))!
    expect(body).not.toContain('research/readings')
    expect(JSON.parse(body)).toEqual(JSON.parse(registryBytes))
  })

  it('leaves search and filter behaviour unchanged', async () => {
    const client = await connectClient()
    const searched = await client.callTool({
      name: 'list_features',
      arguments: { search: 'liquidation' },
    })
    const searchedDoc = JSON.parse(texts(searched).find((t) => t.startsWith('{'))!)
    expect(Object.keys(searchedDoc.features)).toEqual(['feature.liq_intensity_norm'])
    expect(searchedDoc.features['feature.liq_intensity_norm'].description).toBe('liquidation rate')

    const byId = await client.callTool({
      name: 'list_features',
      arguments: { feature_ids: ['vpin', 'feature.rsi'] },
    })
    const byIdDoc = JSON.parse(texts(byId).find((t) => t.startsWith('{'))!)
    expect(Object.keys(byIdDoc.features)).toEqual(['feature.vpin'])
    expect(texts(byId).join(' ')).toContain('feature.rsi')
  })

  it('keeps compact compact: one template line, not one URL per feature', async () => {
    const client = await connectClient()
    const res = await client.callTool({ name: 'list_features', arguments: { compact: true } })
    const doc = JSON.parse(texts(res).find((t) => t.startsWith('{'))!)
    expect(doc.features['feature.vpin']).toEqual({ dtype: 'number', min: 0, max: 1, implemented: true })
    expect(doc.instrument_examples).toBeUndefined()
    const hint = texts(res).find((t) => t.includes('research/readings'))!
    expect(hint.split('\n')).toHaveLength(1)
    // The template names one worked example, never every id.
    expect(hint.match(/research\/readings\//g)!).toHaveLength(2)
    expect(hint).not.toContain('liq_intensity_norm')
  })

  it('says nothing about readings when the registry read failed', async () => {
    fetchMock.mockImplementation(
      () => new Response(JSON.stringify({ error: 'nope', code: 'KEY_INVALID' }), { status: 401 }),
    )
    const client = await connectClient()
    const res = await client.callTool({ name: 'list_features', arguments: {} })
    expect(texts(res).some((t) => t.includes('research/readings'))).toBe(false)
  })

  it('matches the slug transform edgedepth-web actually applies', () => {
    const webPath = join(process.cwd(), '..', 'edgedepth-web', 'src', 'lib', 'researchReadingPages.ts')
    let web: string
    try {
      web = readFileSync(webPath, 'utf8')
    } catch {
      return // sibling repo absent (CI); the web side owns the route
    }
    // readingSlug is the whole mapping. If the route changes shape, this fails
    // rather than shipping a link that 404s.
    expect(web).toMatch(/export function readingSlug\(featureId: string\): string \{\s*return featureId\.replace\(\/\^feature\\\.\/, ''\)/)

    // And every id the web registry declares resolves under our rule.
    const contract = readFileSync(
      join(process.cwd(), '..', 'edgedepth-web', 'src', 'lib', 'researchQueryContract.ts'),
      'utf8',
    )
    const ids = [...contract.matchAll(/^ {2}'(feature\.[a-z0-9_]+)':/gm)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(50)
    for (const id of ids) {
      expect(readingDocUrl(id)).toBe(`https://edgedepth.com/research/readings/${id.slice(8)}`)
    }
  })
})

/**
 * The instrument half. Same rule, one honest difference: the market page
 * exists only while a market is still being recorded, so the hint offers the
 * link and states the 404 rather than promising a page for all 858.
 */
const universeBytes = JSON.stringify({
  universe_encoding: 'universe_result.v2',
  dataset_revision: 'rev-universe',
  coverage: { from: '2025-07-15T00:00:00Z', to: '2026-09-04T00:00:00Z' },
  instruments: [
    {
      symbol: 'btcusdt',
      availability_status: 'present',
      underlying_type: 'COIN',
      tradfi: false,
      feature_availability: { present_partition_days: 416, excluded_partition_days: 0 },
    },
    {
      symbol: 'nvdausdt',
      availability_status: 'partial',
      underlying_type: 'EQUITY',
      tradfi: true,
      feature_availability: { present_partition_days: 162, excluded_partition_days: 254 },
    },
  ],
  notes: ['Coverage.to is exclusive.'],
})

describe('human market pages', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(
      () => new Response(universeBytes, { status: 200, headers: { etag: '"u1"' } }),
    )
  })

  it('resolves a symbol to its market page, lowercasing as the route does', () => {
    expect(symbolDocUrl('btcusdt')).toBe('https://edgedepth.com/research/symbols/btcusdt')
    expect(symbolDocUrl('NVDAUSDT')).toBe('https://edgedepth.com/research/symbols/nvdausdt')
  })

  it('states the rule on the summary, the symbols projection and the full bytes', async () => {
    const client = await connectClient()
    for (const args of [{}, { symbols: ['btcusdt'] }, { full: true }]) {
      const res = await client.callTool({ name: 'list_instruments', arguments: args })
      const hint = texts(res).find((t) => t.includes('research/symbols'))
      expect(hint, `no hint for ${JSON.stringify(args)}`).toBeDefined()
      expect(hint).toContain(symbolDocUrl('btcusdt'))
      // The caveat is the point: a delisted market has no page.
      expect(hint).toContain('404')
    }
  })

  it('leaves the universe projections themselves unchanged', async () => {
    const client = await connectClient()
    const summary = await client.callTool({ name: 'list_instruments', arguments: {} })
    const doc = JSON.parse(texts(summary).find((t) => t.startsWith('{'))!)
    expect(doc.projection).toBe('summary')
    expect(doc.instrument_count).toBe(2)
    expect(doc.tradfi_count).toBe(1)
    expect(doc.by_availability_status).toEqual({ present: 1, partial: 1 })

    const full = await client.callTool({ name: 'list_instruments', arguments: { full: true } })
    expect(texts(full)).toContain(universeBytes) // verbatim canonical bytes

    const picked = await client.callTool({
      name: 'list_instruments',
      arguments: { symbols: ['btcusdt', 'ftmusdt'] },
    })
    const pickedDoc = JSON.parse(texts(picked).find((t) => t.startsWith('{'))!)
    expect(pickedDoc.instruments.map((i: { symbol: string }) => i.symbol)).toEqual(['btcusdt'])
    expect(pickedDoc.not_in_universe).toEqual(['ftmusdt'])
  })

  it('says nothing about a market page on a 304 or an error', async () => {
    fetchMock.mockImplementation(
      () => new Response(null, { status: 304, headers: { etag: '"u1"' } }),
    )
    const client = await connectClient()
    const revalidated = await client.callTool({
      name: 'list_instruments',
      arguments: { if_none_match: '"u1"', full: true },
    })
    expect(texts(revalidated).some((t) => t.includes('research/symbols'))).toBe(false)

    fetchMock.mockImplementation(
      () => new Response(JSON.stringify({ error: 'nope', code: 'KEY_INVALID' }), { status: 401 }),
    )
    const refused = await client.callTool({ name: 'list_instruments', arguments: {} })
    expect(texts(refused).some((t) => t.includes('research/symbols'))).toBe(false)
  })
})
