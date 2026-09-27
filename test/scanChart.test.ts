import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanChartMeta, SCAN_CHART_URI, studyHeading } from '../src/scanChart.js'
import { SCAN_CHART_HTML } from '../src/scanChartHtml.js'
import type { ApiResponse } from '../src/apiClient.js'
import { connectClient, texts } from './helpers.js'

// Verbatim aggregate fields from the three P4 cached results, 2026-09-28.
// Only page data and metrics outside 1h/24h are omitted. Hashes pin the source.
const records = JSON.parse(readFileSync(new URL('./fixtures/p4-records.json', import.meta.url), 'utf8'))
const measure = { kind: 'touch', direction: 'down', magnitude: 0.2, horizon: '24h' } as const
const response = (value: unknown, status = 200): ApiResponse => ({
  ok: status === 200, status, notModified: status === 304,
  bodyText: JSON.stringify(value), headers: { cache: 'hit', creditsCharged: '0' },
})
const timeout = response({ code: 'SCAN_TIMEOUT', error: 'The reference scan timed out.' }, 504)
const metric = { present: 100, absent: 2,
  thresholds: [{ op: 'gte', threshold: 0.2, count: 30 }, { op: 'lte', threshold: -0.2, count: 40 }],
  buckets: [{ lo: null, hi: 0, count: 40 }, { lo: 0, hi: null, count: 60 }] }
const scan = { counts: { total_matching: 102, symbols_scanned: 2 },
  outcomes_summary: { metrics: { fwd_ret_24h: metric, mfe_24h: metric, mae_24h: metric } } }

// Executes the shipped inline JS, including both host bridges and control
// handlers. A small DOM double keeps the regression test dependency-free;
// real responsive browser verification is recorded in the task evidence.
class Element {
  children: Element[] = []
  style: Record<string, string> = {}
  attrs: Record<string, string> = {}
  value = ''; hidden = false; className = ''; ownText = ''; title = ''; type = ''
  tabIndex = -1
  onclick?: () => void; onchange?: () => void; onfocus?: () => void; onmouseenter?: () => void
  onkeydown?: (event: { key: string; preventDefault: () => void }) => void
  constructor(public tagName: string) {}
  get textContent(): string { return this.ownText + this.children.map(c => c.textContent).join(' ') }
  set textContent(value: string) { this.ownText = value; this.children = [] }
  appendChild(child: Element) { this.children.push(child); return child }
  replaceChildren() { this.children = []; this.ownText = '' }
  setAttribute(key: string, value: string) { this.attrs[key] = value }
  getAttribute(key: string) { return this.attrs[key] }
  focus() { this.onfocus?.() }
  addEventListener() {}
}
function host(metadata?: unknown, openai = false) {
  const elements = new Map<string, Element>()
  for (const match of SCAN_CHART_HTML.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const e = new Element(match[1]!); e.hidden = match[0].includes('hidden'); elements.set(match[2]!, e)
  }
  const listeners: Record<string, (event?: any) => void> = {}
  const parent = { postMessage: vi.fn() }
  const window: any = { parent, addEventListener: (name: string, fn: any) => { listeners[name] = fn } }
  if (openai) window.openai = { toolResponseMetadata: metadata }
  const document = { getElementById: (id: string) => elements.get(id), createElement: (tag: string) => new Element(tag),
    querySelectorAll: () => [], body: { scrollHeight: 900 } }
  runInNewContext(SCAN_CHART_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!, { document, window })
  const receive = (result: any, source = parent) => listeners.message!({ source,
    data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result } })
  if (!openai && metadata) receive({ _meta: metadata })
  return { get: (id: string) => elements.get(id)!, receive, window, listeners, parent }
}
afterEach(() => vi.unstubAllGlobals())

describe('P4 recorded evidence and outcome defaults', () => {
  it.each(records.map((r: any, i: number) => [i, r]))('renders P4 R%s without changing any recorded count', (index, record: any) => {
    const original = JSON.stringify(record.result)
    const meta = scanChartMeta(response(record.result), timeout, measure, record.document)
    const evidence = meta.edgedepthEvidence as any
    expect(evidence.groups[0].metrics).toEqual(record.result.outcomes_summary.metrics)
    expect(evidence.key.canonical_query_hash).toBe([
      '5fdc7699b7d01f0ff1a34d2e548ee6a8fe0da1b072b553371c00661647d13384',
      '57ee7bbdadb1f13babe278ab3bdaa56cc94a970a87919d565710db6dde37ec34',
      '9afc93bfb40d07a34c6e09cb2297e6c9fde431f1568814abe825eb3fa9f86494',
    ][Number(index)])
    const ui = host(meta)
    expect(ui.get('title').textContent).toContain('price rose at least 5% in one hour')
    expect(ui.get('title').textContent.toLowerCase()).toContain('open contracts fell at least 2% in one hour')
    expect(ui.get('scope').textContent).toContain('2025-07-15 00:00')
    expect(ui.get('scope').textContent).toContain('2026-09-27 00:00 UTC')
    expect(ui.get('stats').textContent).toContain('872 symbols scanned')
    expect(ui.get('horizon').value).toBe('24h')
    expect(ui.get('threshold').value).toBe('0.2')
    expect(ui.get('outcomes').textContent).toContain(['814 / 3,741 = 21.8%', '637 / 2,598 = 24.5%', '55 / 394 = 14.0%'][Number(index)])
    expect(ui.get('outcomes').children[0]!.textContent).toContain('Touched down 20%+ within 24h')
    expect(ui.get('glanceAnswer').textContent).toContain(['814 of 3,741 recorded outcomes (21.8%)', '637 of 2,598 recorded outcomes (24.5%)', '55 of 394 recorded outcomes (14.0%)'][Number(index)])
    expect(ui.get('glanceAnswer').textContent).toContain('reached a fall of at least 20% within 24h')
    expect(ui.get('glanceComparison').textContent).toContain('SCAN_TIMEOUT')
    expect(ui.get('glanceComparison').textContent).toContain('cannot tell whether')
    expect(ui.get('glanceCaveat').textContent).toContain('do not show which came first')
    expect(ui.get('histogram').children).toHaveLength(28)
    const m = record.result.outcomes_summary.metrics.fwd_ret_24h
    m.buckets.forEach((b: any, i: number) => {
      expect(ui.get('histogram').children[i]!.attrs['aria-label']).toContain(`${b.count.toLocaleString('en-US')} / ${m.present.toLocaleString('en-US')}`)
    })
    expect(ui.get('referenceNote').textContent).toContain('SCAN_TIMEOUT')
    expect(ui.get('referenceNote').textContent).toContain('No lift is shown')
    expect(ui.get('referenceLegend').hidden).toBe(true)
    expect(ui.get('ladder').children).toHaveLength(6)
    expect(JSON.stringify(record.result)).toBe(original)
  })
  it('selects the largest supported rung, not the largest lift or the 1% default', () => {
    const ui = host(scanChartMeta(response(scan), null))
    expect(ui.get('horizon').value).toBe('24h')
    expect(ui.get('threshold').value).toBe('0.2')
    const small = structuredClone(scan)
    small.outcomes_summary.metrics.fwd_ret_24h.thresholds = [{ op: 'gte', threshold: 0.01, count: 90 }, { op: 'gte', threshold: 0.5, count: 29 }]
    ui.receive({ _meta: scanChartMeta(response(small), null) })
    expect(ui.get('threshold').value).toBe('')
    expect(ui.get('defaultNote').textContent).toContain('No closing move above 1% has 30')
  })
  it('preserves an unavailable exact measure and its horizon instead of substituting', () => {
    const ui = host(scanChartMeta(response(scan), null, { ...measure, horizon: '7d', magnitude: 0.3 }))
    expect(ui.get('horizon').value).toBe('7d')
    expect(ui.get('threshold').value).toBe('0.3')
    expect(ui.get('outcomes').textContent).toContain('Exact outcome unavailable')
    expect(ui.get('counts').textContent).toContain('unavailable')
  })
})

describe('result at a glance', () => {
  it('distinguishes a viewed outcome from the stated one and restores the original measure', () => {
    const ui = host(scanChartMeta(response(scan), timeout, measure))
    expect(ui.get('glanceTitle').textContent).toContain('Stated outcome')
    expect(ui.get('resetOutcome').hidden).toBe(true)
    ui.get('horizon').value = '1h'; ui.get('horizon').onchange!()
    expect(ui.get('glanceTitle').textContent).toContain('Exploring another outcome')
    expect(ui.get('glanceAnswer').textContent).toContain('exact outcome unavailable')
    expect(ui.get('glanceAnswer').textContent).not.toContain('40.0%')
    expect(ui.get('resetOutcome').hidden).toBe(false)
    expect(ui.get('question').textContent).toContain('within 24h')
    ui.get('resetOutcome').onclick!()
    expect(ui.get('horizon').value).toBe('24h')
    expect(ui.get('threshold').value).toBe('0.2')
    expect(ui.get('glanceAnswer').textContent).toContain('40 of 100 recorded outcomes (40.0%)')
    expect(ui.get('resetOutcome').hidden).toBe(true)
    ui.get('threshold').value = '0.3'; ui.get('threshold').onchange!()
    expect(ui.get('glanceAnswer').textContent).toContain('exact outcome unavailable')
    ui.get('resetOutcome').onclick!()
    expect(ui.get('threshold').value).toBe('0.2')
  })
  it.each([[20, '20.0 percentage points higher'], [60, '20.0 percentage points lower'], [40, 'recorded rates are equal'], [0, '40.0 percentage points higher']])(
    'compares against an exact reference count of %s without making an edge claim', (hits, phrase) => {
      const reference = structuredClone(metric); reference.thresholds[1]!.count = Number(hits)
      const ui = host(scanChartMeta(response(scan), response({ baseline: { metrics: { mae_24h: reference } } }), measure))
      expect(ui.get('glanceComparison').textContent).toContain(`${hits} / 100 = ${Number(hits).toFixed(1)}%`)
      expect(ui.get('glanceComparison').textContent).toContain(String(phrase))
      expect(ui.get('glanceComparison').textContent).toContain('including matches')
      expect(ui.get('glanceComparison').textContent).not.toMatch(/significant|advantage|Infinity|NaN/)
    },
  )
  it('does not compare to an empty reference or round a small difference to equality', () => {
    const reference = structuredClone(metric); reference.present = 0; reference.absent = 100
    reference.thresholds[1]!.count = 0
    const ui = host(scanChartMeta(response(scan), response({ baseline: { metrics: { mae_24h: reference } } }), measure))
    expect(ui.get('glanceComparison').textContent).toContain('0 / 0 (no rate); 100 missing')
    expect(ui.get('glanceComparison').textContent).toContain('No rate comparison is available')
    expect(ui.get('glanceComparison').textContent).not.toContain('percentage points')
    const data = structuredClone(scan), m = data.outcomes_summary.metrics.mae_24h
    m.present = 10000; m.thresholds[1]!.count = 2
    reference.present = 10000; reference.absent = 0; reference.thresholds[1]!.count = 1
    ui.receive({ _meta: scanChartMeta(response(data), response({ baseline: { metrics: { mae_24h: reference } } }), measure) })
    expect(ui.get('glanceAnswer').textContent).toContain('2 of 10,000 recorded outcomes (<0.1%)')
    expect(ui.get('glanceComparison').textContent).toContain('1 / 10,000 = <0.1%')
    expect(ui.get('glanceComparison').textContent).toContain('less than 0.1 percentage points higher')
    expect(ui.get('glanceComparison').textContent).not.toContain('rates are equal')
  })
  it('keeps zero hits distinct from zero measured outcomes and warns about small denominators', () => {
    const data = structuredClone(scan)
    const m = data.outcomes_summary.metrics.mae_24h
    m.thresholds[1]!.count = 0; m.present = 4; m.absent = 98
    const ui = host(scanChartMeta(response(data), null, measure))
    expect(ui.get('glanceAnswer').textContent).toContain('0 of 4 recorded outcomes (0.0%)')
    expect(ui.get('glanceCaveat').textContent).toContain('98 outcomes missing')
    expect(ui.get('glanceCaveat').textContent).toContain('Fewer than 30 measured outcomes')
    m.present = 0; m.absent = 102
    ui.receive({ _meta: scanChartMeta(response(data), null, measure) })
    expect(ui.get('glanceAnswer').textContent).toContain('No recorded outcomes')
    expect(ui.get('glanceAnswer').textContent).not.toContain('0.0%')
    expect(ui.get('glanceCaveat').textContent).toContain('102 outcomes missing')
  })
  it('leads with both closing directions when no outcome was specified', () => {
    const ui = host(scanChartMeta(response(scan), null))
    expect(ui.get('glanceTitle').textContent).toContain('Exploring closing returns')
    expect(ui.get('glanceAnswer').textContent).toContain('30 of 100 recorded outcomes (30.0%) closed at least 20% higher after 24h')
    expect(ui.get('glanceAnswer').textContent).toContain('40 of 100 recorded outcomes (40.0%) closed at least 20% lower after 24h')
    expect(ui.get('resetOutcome').hidden).toBe(true)
    ui.get('threshold').value = ''; ui.get('threshold').onchange!()
    expect(ui.get('glanceAnswer').textContent).toContain('Choose a move')
    expect(ui.get('glanceComparison').textContent).toBe('')
  })
})

describe('reference, missingness and host delivery', () => {
  it('overlays aligned buckets, shows counted lift, and never divides by zero', () => {
    const reference = structuredClone(metric); reference.present = 200
    reference.buckets[1]!.count = 160
    const ui = host(scanChartMeta(response(scan), response({ baseline: { metrics: { fwd_ret_24h: reference } } })))
    expect(ui.get('outcomes').textContent).toContain('30 / 100 = 30.0%')
    expect(ui.get('outcomes').textContent).toContain('30 / 200 = 15.0%')
    expect(ui.get('outcomes').textContent).toContain('Lift: 2.00×')
    expect(ui.get('histogram').children[0]!.children).toHaveLength(2)
    reference.thresholds[0]!.count = 0
    ui.receive({ _meta: scanChartMeta(response(scan), response({ baseline: { metrics: { fwd_ret_24h: reference } } }), { ...measure, kind: 'close', direction: 'up' }) })
    expect(ui.get('outcomes').textContent).toContain('reference has no hits')
    const empty = { present: 0, absent: 102, thresholds: [{ op: 'gte', threshold: 0.2, count: 0 }], buckets: [{ lo: null, hi: null, count: 0 }] }
    ui.receive({ _meta: scanChartMeta(response({ ...scan, outcomes_summary: { metrics: { fwd_ret_24h: empty } } }), null, { ...measure, kind: 'close', direction: 'up' }) })
    expect(ui.get('outcomes').textContent).toContain('0 / 0 (no rate)')
    expect(ui.get('outcomes').textContent).not.toContain('NaN')
    expect(ui.get('counts').textContent).toContain('102 missing')
  })
  it('keeps hover, tap and keyboard selection on the same exact bucket without trapping Tab', () => {
    const ui = host(scanChartMeta(response(scan), response({ baseline: { metrics: { fwd_ret_24h: metric } } })))
    const bins = ui.get('histogram').children
    const selected = (index: number) => {
      expect(bins.filter(b => b.attrs['aria-pressed'] === 'true')).toEqual([bins[index]])
      expect(bins.filter(b => b.tabIndex === 0)).toEqual([bins[index]])
      expect(ui.get('binReading').textContent).toBe(bins[index]!.attrs['aria-label'])
    }
    selected(1)
    bins[0]!.onmouseenter!(); selected(0)
    expect(ui.get('binReading').textContent).toContain('40 / 100 = 40.0%')
    expect(ui.get('binReading').textContent).toContain('reference 40 / 100 = 40.0%')
    bins[1]!.onclick!(); selected(1)
    const press = (index: number, key: string, next: number) => {
      const preventDefault = vi.fn()
      bins[index]!.onkeydown!({ key, preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(key === 'Tab' ? 0 : 1)
      selected(next)
    }
    press(1, 'Home', 0); press(0, 'ArrowLeft', 0)
    press(0, 'ArrowRight', 1); press(1, 'ArrowRight', 1)
    press(1, 'ArrowLeft', 0); press(0, 'End', 1); press(1, 'Tab', 1)
    ui.get('horizon').value = '1h'; ui.get('horizon').onchange!()
    expect(ui.get('binReading').hidden).toBe(true)
    expect(ui.get('binReading').textContent).toBe('')
    expect(ui.get('histogram').children).toHaveLength(0)
  })
  it('refuses a malformed distribution and a mismatched overlay', () => {
    const bad = structuredClone(scan); bad.outcomes_summary.metrics.fwd_ret_24h.buckets[0]!.count++
    const ui = host(scanChartMeta(response(bad), null))
    expect(ui.get('histogram').children).toHaveLength(0)
    const reference = structuredClone(metric); reference.buckets[0]!.hi = -0.01
    ui.receive({ _meta: scanChartMeta(response(scan), response({ baseline: { metrics: { fwd_ret_24h: reference } } })) })
    expect(ui.get('referenceLegend').hidden).toBe(true)
    expect(ui.get('chartNote').textContent).toContain('edges differ')
  })
  it('carries the proposal summary verbatim as text and works through OpenAI globals', () => {
    const summary = '<img src=x onerror=alert(1)> Proposed exact study'
    const meta = scanChartMeta(response(scan), null, measure, {}, summary)
    const ui = host(meta, true)
    expect(ui.get('title').textContent).toBe(summary)
    expect(ui.get('title').children).toHaveLength(0)
    expect(ui.get('outcomes').textContent).toContain('40 / 100 = 40.0%')
    ui.get('horizon').value = '1h'; ui.get('horizon').onchange!()
    expect(ui.get('outcomes').textContent).toContain('Exact outcome unavailable')
    expect(ui.get('question').textContent).toContain('within 24h')
  })
  it('separates rejected documents, transport failures, 304 and missing host data, clearing stale charts', () => {
    const error = { errors: [{ code: 'INVALID_SHAPE', message: 'Query must contain only the v2 top-level fields' }] }
    const ui = host(scanChartMeta(response(scan), null))
    ui.receive({ _meta: scanChartMeta(response(error, 422), null) })
    expect(ui.get('app').hidden).toBe(true)
    expect(ui.get('title').textContent).toBe('The engine rejected this document')
    expect(ui.get('status').textContent).toContain('INVALID_SHAPE: Query must contain only')
    ui.receive({ isError: true, content: [{ type: 'text', text: JSON.stringify(error) }] })
    expect(ui.get('status').textContent).toContain('INVALID_SHAPE')
    ui.receive({ _meta: scanChartMeta(timeout, null) })
    expect(ui.get('title').textContent).toBe('The study could not complete')
    ui.receive({ _meta: scanChartMeta(response({}, 304), null) })
    expect(ui.get('status').textContent).toContain('(304)')
    ui.receive({})
    expect(ui.get('status').textContent).toContain('This host did not provide chart evidence')
    ui.receive({ _meta: scanChartMeta(response(error, 422), null) }, {} as any)
    expect(ui.get('status').textContent).toContain('This host did not provide chart evidence')
  })
})

it.each(['run_scan', 'run_cohort', 'run_stratified'])('%s attaches evidence without changing bytes, requests or the document', async name => {
  const resultBody = name === 'run_cohort' ? { counts: scan.counts, treatment: scan.outcomes_summary, baseline: scan.outcomes_summary }
    : name === 'run_stratified' ? { counts: { population_anchors: 102, symbols_scanned: 2 }, groups: {
      split_true: { anchor_count: 30, outcomes_summary: scan.outcomes_summary },
      split_false: { anchor_count: 70, outcomes_summary: scan.outcomes_summary },
      split_absent: { anchor_count: 2, outcomes_summary: { metrics: {} } },
    } } : scan
  const raw = JSON.stringify(resultBody)
  const fetch = vi.fn().mockImplementation(async () => new Response(raw))
  vi.stubGlobal('fetch', fetch)
  const client = await connectClient()
  try {
    expect((await client.listTools()).tools.find(t => t.name === name)!._meta?.ui).toEqual({ resourceUri: SCAN_CHART_URI })
    const document = { exact: 'opaque document' }
    const result = await client.callTool({ name, arguments: { document, measure, study_summary: 'Prepared study', ...(name !== 'run_stratified' ? { full_counts: true } : {}) } })
    expect(texts(result)).toContain(raw)
    expect(fetch).toHaveBeenCalledTimes(name === 'run_scan' ? 2 : 1)
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual(document)
    expect(texts(result).join('')).not.toContain('edgedepthEvidence')
    const ui = host(result._meta)
    expect(ui.get('title').textContent).toBe('Prepared study')
    if (name === 'run_cohort') {
      expect(ui.get('referenceNote').textContent).toContain('excludes matching minutes')
      expect(ui.get('glanceComparison').textContent).toContain('where the condition was false')
      expect(ui.get('glanceComparison').textContent).toContain('recorded rates are equal')
    }
    if (name === 'run_stratified') {
      expect(ui.get('group').children).toHaveLength(3)
      ui.get('group').value = 'split_absent'; ui.get('group').onchange!()
      expect(ui.get('counts').textContent).toContain('unavailable')
      expect(ui.get('referenceNote').textContent).toContain('Unavailable for this scope')
      expect(ui.get('glanceTitle').textContent).toContain('Split reading missing')
      expect(ui.get('glanceComparison').textContent).toContain('no reference comparison is supplied')
    }
    const resource = await client.readResource({ uri: SCAN_CHART_URI })
    expect(resource.contents[0]!.text).toBe(SCAN_CHART_HTML)
  } finally { await client.close() }
})

it('retains dates, roster and exact unknown clauses in legacy headings', () => {
  const heading = studyHeading({ where: { all: [['identity.symbol', 'in', ['btc', 'eth']], ['feature.unknown', 'gte', 0.25]] } }, {})
  expect(heading.title).toBe('feature.unknown at least 0.25')
  expect(heading.scope).toContain('BTC, ETH')
})
