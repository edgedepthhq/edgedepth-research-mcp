/**
 * outcome_first - the outcome-first DOOR tool (task outcome-first-door,
 * handoff OF3), over POST /api/v1/research/outcome-first.
 *
 * The three things that could go wrong here, each pinned:
 *
 *  1. THE PROJECTION LIES. It exists to fit a 150-row body into an
 *     agent context, and the audit's discipline is that it may only ever
 *     REMOVE. So the accounting test walks every count in the projected
 *     body and asserts it is byte-identical to the same count in the
 *     original, and asserts each removal is stated.
 *  2. THE AGENT READS A ROW AS A RULE. The tool contract and the server
 *     instructions must say, in the words the agent will repeat, that a
 *     row is selected on the outcome, that the order is display order,
 *     and that the honest rate is the setup-first rerun.
 *  3. A REFUSAL IS UNACTIONABLE. The closed target grammar is where an
 *     agent gets it wrong (a fraction, not a percentage; a suffix, not
 *     ISO), so the repair note names both, and an off-ladder magnitude
 *     is refused locally with the nearest rung rather than sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_OUTCOME_FIRST_ROWS,
  leanOutcomeFirstBody,
  outcomeFirstProjectionTag,
} from '../src/projection.js'
import { nearestLadderRung, repairNote } from '../src/repair.js'
import { connectClient, TEST_API_BASE, texts } from './helpers.js'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** A row as internal/research/outcome_first.go writes one. */
function row(i: number, offset = '15m') {
  return {
    field: `feature.reading_${i}`,
    band: 'high',
    operator: 'gte',
    value: 0.65,
    sentence: `Reading ${i} at or above 0.65`,
    offset,
    before_these_moves: { true: 22 - (i % 7), n: 41, share: 0.5365853658536586 },
    usual: { true: 148_320 + i, n: 1_842_000, share: 0.08052117263843648 },
    excess: 0.4560641932152221 - i / 1000,
    labelled: 'selected on the outcome',
    setup_first_rerun: {
      schema_version: 'research_query.v2',
      normalization_version: 'archive_normalization.v1',
      feature_version: 'feature_defs.v1',
      target: 'record_occurrences',
      where: {
        all: [
          [`feature.reading_${i}`, 'gte', 0.65],
          ['identity.symbol', 'in', ['aiusdt', 'fetusdt', 'grtusdt', 'renderusdt', 'taousdt']],
          ['times.anchor_time', 'between', ['2026-06-05T00:00:00.000Z', '2026-09-03T00:00:00.000Z']],
        ],
      },
      sort: ['times.anchor_time', 'desc'],
      page: { limit: 50, cursor: null },
    },
    setup_first_rerun_hash: `hash${i}`,
  }
}

function resultBody(rowCount = 40) {
  return {
    reproducibility_key: {
      schema_version: 'outcome_first_query.v1',
      feature_version: 'feature_defs.v1',
      dataset_revision: 'rev-abc',
      canonical_query_hash: 'f00dcafe1234567890',
      result_encoding: 'outcome_first_result.v1',
    },
    query: {
      schema_version: 'outcome_first_query.v1',
      window: { from: '2026-06-05T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
      target: { kind: 'reached', direction: 'up', magnitude: 0.1, horizon: '4h' },
      symbols: ['aiusdt', 'fetusdt', 'grtusdt', 'renderusdt', 'taousdt'],
    },
    result_encoding: 'outcome_first_result.v1',
    target: {
      kind: 'reached',
      direction: 'up',
      magnitude: 0.1,
      horizon: '4h',
      metric: 'mfe_4h',
      operator: 'gte',
      threshold: 0.1,
      sentence:
        'At some point during the next 4 hours, the recorded one-minute high was at least 10% above the anchor close.',
    },
    population: {
      eligible_anchors: 1_842_000,
      positive_anchors: 3120,
      unconditional_anchor_rate: 0.0016938110749185668,
      episodes: 41,
      symbols: 17,
      utc_days: 88,
      largest_day: '2026-07-14',
      largest_day_share: 0.0975609756097561,
      largest_symbol: 'taousdt',
      largest_symbol_share: 0.14634146341463414,
      scope_symbols: 17,
      sampled_episodes: 41,
      sample_rule: 'every episode',
    },
    feasibility: {
      ok: true,
      floor: {
        min_episodes: 20,
        min_utc_days: 8,
        min_symbols: 5,
        max_day_share: 0.35,
        max_symbol_share: 0.35,
      },
      reasons: [],
      adjustments: [],
    },
    pointed: null,
    offsets: ['1m', '15m', '1h', '4h', '24h'],
    rows: Array.from({ length: rowCount }, (_, i) => row(i)),
    unbanded_readings: ['feature.liq_notional_usd_1h', 'feature.oi_notional_usd'],
    episodes: Array.from({ length: 41 }, (_, i) => ({
      id: `fetusdt:ep${i}`,
      symbol: 'fetusdt',
      representative_anchor: '2026-06-11T03:12:00.000Z',
      first_crossing: '2026-06-11T05:40:00.000Z',
      last_crossing: '2026-06-11T06:02:00.000Z',
      positive_anchors: 63,
    })),
    replays: [
      {
        role: 'earliest',
        episode_id: 'fetusdt:ep0',
        replay: {
          symbol: 'fetusdt',
          from: '2026-06-11T02:42:00.000Z',
          to: '2026-06-11T06:10:00.000Z',
          seek: '2026-06-11T03:12:00.000Z',
          anchor_marker: 'outcome_first_anchor',
        },
      },
    ],
    notes: [
      'Selected on the outcome: every row describes minutes chosen because the move followed.',
      'Every reading is scored at once, so some excess is expected by chance.',
    ],
  }
}

function engineResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      etag: '"of-1"',
      'x-dataset-revision': 'rev-abc',
      'x-canonical-query-hash': 'f00dcafe1234567890',
      'x-research-cache': 'miss',
      ...extra,
    },
  })
}

/** Every number in a body, keyed by its full path. The accounting test
 *  compares these across the projection rather than trusting a handful
 *  of named fields. */
function numbersOf(value: unknown, path = '', out: Record<string, number> = {}) {
  if (typeof value === 'number') {
    out[path] = value
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => numbersOf(entry, `${path}[${i}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      numbersOf(v, path ? `${path}.${k}` : k, out)
    }
  }
  return out
}

describe('the outcome-first projection only ever removes', () => {
  it('keeps every count it keeps byte-identical, and states each removal', () => {
    const original = resultBody(40)
    const lean = leanOutcomeFirstBody(JSON.stringify(original))
    expect(lean).not.toBeNull()
    const projected = JSON.parse(lean!.bodyText) as Record<string, unknown>

    // Byte accounting: every number still present is the number that was
    // there. Nothing is recomputed, rounded or re-derived.
    const before = numbersOf(original)
    const after = numbersOf(projected)
    for (const [path, value] of Object.entries(after)) {
      expect(before[path], `${path} changed in the projection`).toBe(value)
    }
    // And nothing was invented.
    for (const path of Object.keys(after)) {
      expect(Object.prototype.hasOwnProperty.call(before, path), `${path} is new`).toBe(true)
    }

    // The denominator-bearing blocks are untouched, whole.
    expect(projected.population).toEqual(original.population)
    expect(projected.feasibility).toEqual(original.feasibility)
    expect(projected.reproducibility_key).toEqual(original.reproducibility_key)
    expect(projected.target).toEqual(original.target)
    expect(projected.notes).toEqual(original.notes)
    expect(projected.replays).toEqual(original.replays)
    expect(projected.offsets).toEqual(original.offsets)
    // Honesty-bearing and tiny: kept whole rather than saving bytes.
    expect(projected.unbanded_readings).toEqual(original.unbanded_readings)

    // Every removal is stated, with its count.
    const notes = lean!.notes.join(' ')
    expect(notes).toContain('28 of 40 row(s) omitted')
    expect(notes).toContain('setup_first_rerun')
    expect(notes).toContain('41 sampled entr')
    expect(notes).toContain('query')
  })

  it('keeps the first N rows in the body OWN order and says so is not a ranking', () => {
    const original = resultBody(40)
    const lean = leanOutcomeFirstBody(JSON.stringify(original))
    const projected = JSON.parse(lean!.bodyText) as { rows: { field: string }[] }
    expect(projected.rows).toHaveLength(DEFAULT_OUTCOME_FIRST_ROWS)
    expect(projected.rows.map((r) => r.field)).toEqual(
      original.rows.slice(0, DEFAULT_OUTCOME_FIRST_ROWS).map((r) => r.field),
    )
    expect(lean!.notes.join(' ')).toContain('nothing here reorders or ranks anything')
  })

  it('keeps both counted shares and the rerun HASH on every kept row', () => {
    const original = resultBody(40)
    const lean = leanOutcomeFirstBody(JSON.stringify(original))
    const projected = JSON.parse(lean!.bodyText) as {
      rows: Record<string, unknown>[]
    }
    for (const [i, projectedRow] of projected.rows.entries()) {
      expect(projectedRow.before_these_moves).toEqual(original.rows[i].before_these_moves)
      expect(projectedRow.usual).toEqual(original.rows[i].usual)
      expect(projectedRow.setup_first_rerun_hash).toBe(original.rows[i].setup_first_rerun_hash)
      expect(projectedRow.labelled).toBe('selected on the outcome')
      // The document itself is what went; the clause it tests did not.
      expect(projectedRow.setup_first_rerun).toBeUndefined()
      expect(projectedRow.field).toBe(original.rows[i].field)
      expect(projectedRow.operator).toBe(original.rows[i].operator)
      expect(projectedRow.value).toBe(original.rows[i].value)
    }
  })

  it('returns the verbatim bytes for full_rows, and scopes the ETag apart', () => {
    expect(leanOutcomeFirstBody(JSON.stringify(resultBody(40)), { rows: 12, fullRows: true })).toBeNull()
    expect(outcomeFirstProjectionTag({ rows: 12, fullRows: false })).not.toBe(
      outcomeFirstProjectionTag({ rows: 12, fullRows: true }),
    )
    expect(outcomeFirstProjectionTag({ rows: 12, fullRows: false })).not.toBe(
      outcomeFirstProjectionTag({ rows: 3, fullRows: false }),
    )
  })

  it('leaves a REFUSAL whole, because a refusal is already small and is the answer', () => {
    const refused = resultBody(0)
    refused.feasibility = {
      ok: false,
      floor: refused.feasibility.floor,
      reasons: ['4 distinct episodes; the floor is 20', 'episodes on 1 markets; the floor is 5'],
      adjustments: ['a smaller move', 'a longer horizon', 'a broader market scope', 'a longer window'],
    }
    refused.episodes = []
    const lean = leanOutcomeFirstBody(JSON.stringify(refused))
    const projected = JSON.parse(lean!.bodyText) as Record<string, unknown>
    expect(projected.feasibility).toEqual(refused.feasibility)
    expect(projected.population).toEqual(refused.population)
    expect(projected.rows).toEqual([])
  })
})

describe('the outcome_first tool', () => {
  it('assembles the closed document, echoes it, and projects the answer', async () => {
    fetchMock.mockResolvedValue(engineResponse(resultBody(40)))
    const client = await connectClient()
    const result = await client.callTool({
      name: 'outcome_first',
      arguments: {
        kind: 'reached',
        direction: 'up',
        magnitude: 0.1,
        horizon: '4h',
        from: '2026-06-05T00:00:00Z',
        to: '2026-09-03T00:00:00Z',
        symbols: ['aiusdt', 'fetusdt', 'grtusdt', 'renderusdt', 'taousdt'],
      },
    })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${TEST_API_BASE}/outcome-first`)
    expect(JSON.parse(String(init.body))).toEqual({
      schema_version: 'outcome_first_query.v1',
      window: { from: '2026-06-05T00:00:00Z', to: '2026-09-03T00:00:00Z' },
      target: { kind: 'reached', direction: 'up', magnitude: 0.1, horizon: '4h' },
      symbols: ['aiusdt', 'fetusdt', 'grtusdt', 'renderusdt', 'taousdt'],
    })
    const blocks = texts(result)
    expect(blocks[0]).toContain('outcome_first document (echo this to the user)')
    expect(blocks.join('\n')).toContain('projection (only removals; nothing recomputed)')
    // The ETag the caller gets back names THIS projection.
    expect(blocks.join('\n')).toContain('+nz.of.r12')
  })

  it('repairs a string-encoded magnitude and symbol list rather than failing', async () => {
    fetchMock.mockResolvedValue(engineResponse(resultBody(2)))
    const client = await connectClient()
    await client.callTool({
      name: 'outcome_first',
      arguments: {
        kind: 'reached',
        direction: 'up',
        magnitude: '0.1',
        horizon: '4h',
        from: '2026-06-05T00:00:00Z',
        to: '2026-09-03T00:00:00Z',
        symbols: '["aiusdt","fetusdt"]',
      },
    })
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>
    expect((sent.target as { magnitude: number }).magnitude).toBe(0.1)
    expect(sent.symbols).toEqual(['aiusdt', 'fetusdt'])
  })

  it('refuses an off-ladder magnitude locally, naming the nearest rung, and sends nothing', async () => {
    const client = await connectClient()
    const result = await client.callTool({
      name: 'outcome_first',
      arguments: {
        kind: 'reached',
        direction: 'up',
        magnitude: 0.118,
        horizon: '4h',
        from: '2026-06-05T00:00:00Z',
        to: '2026-09-03T00:00:00Z',
      },
    })
    expect(result.isError).toBe(true)
    const said = texts(result).join(' ')
    expect(said).toContain('not a rung of the outcome ladder')
    expect(said).toContain('The nearest rung is 0.1')
    expect(said).toContain('Nothing was sent and nothing was spent')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps the down ladder at total loss when it names a nearest rung', () => {
    expect(nearestLadderRung(3.4, 'down')).toBe(1)
    expect(nearestLadderRung(3.4, 'up')).toBe(4)
    expect(nearestLadderRung(0.118, 'up')).toBe(0.1)
  })

  it('offers the replay handoffs with how far back each one sits', async () => {
    fetchMock.mockResolvedValue(engineResponse(resultBody(2)))
    const client = await connectClient()
    const result = await client.callTool({
      name: 'outcome_first',
      arguments: {
        kind: 'reached',
        direction: 'up',
        magnitude: 0.1,
        horizon: '4h',
        from: '2026-06-05T00:00:00Z',
        to: '2026-09-03T00:00:00Z',
      },
    })
    const said = texts(result).join('\n')
    expect(said).toContain('earliest: https://app.edgedepth.com/terminal?replay=fetusdt')
    expect(said).toMatch(/\[\d+d back\]/)
    expect(said).toContain('do not promise it will play')
  })

  it('says, in the contract text, that a row is not a rule', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'outcome_first')!
    expect(tool.description).toContain('selected on the outcome')
    expect(tool.description).toContain(
      'A row is NOT a rule, a candidate, a finding or a predictor',
    )
    expect(tool.description).toContain('display order and not a ranking')
    expect(tool.description).toContain('setup-first rerun')
    expect(tool.description).toContain('refusal spends no allowance')
    expect(tool.description).toContain('one-market scope always refuses')
  })

  it('passes an engine refusal through and appends the grammar repair', async () => {
    fetchMock.mockResolvedValue(
      engineResponse(
        {
          errors: [
            { code: 'INVALID_VALUE', field: 'target.horizon', message: 'must be one of 30m, 1h, 4h, 24h, 72h, 7d' },
          ],
        },
        422,
      ),
    )
    const client = await connectClient()
    const result = await client.callTool({
      name: 'outcome_first',
      arguments: {
        kind: 'reached',
        direction: 'up',
        magnitude: 0.1,
        horizon: '4h',
        from: '2026-06-05T00:00:00Z',
        to: '2026-09-03T00:00:00Z',
      },
    })
    expect(result.isError).toBe(true)
    const said = texts(result).join('\n')
    // The contract body is untouched, and the note is a separate block.
    expect(said).toContain('must be one of 30m, 1h, 4h, 24h, 72h, 7d')
    expect(said).toContain('closed suffix, not an ISO duration')
  })
})

describe('the outcome-first repair notes', () => {
  it('names the ladder as fractions when the magnitude is refused', () => {
    const note = repairNote(
      JSON.stringify({
        errors: [
          {
            code: 'INVALID_VALUE',
            field: 'target.magnitude',
            message: 'must be a positive rung of the outcome ladder',
          },
        ],
      }),
      [],
    )
    expect(note).toContain('as a FRACTION')
    expect(note).toContain('0.001')
    expect(note).toContain('Down is capped at 1')
    expect(note).toContain('ten percent is 0.1')
  })

  it('names the closed horizon list when the horizon is refused', () => {
    const note = repairNote(
      JSON.stringify({
        errors: [{ code: 'INVALID_VALUE', field: 'target.horizon', message: 'must be one of 30m, 1h, 4h' }],
      }),
      [],
    )
    expect(note).toContain('30m, 1h, 4h, 24h, 72h, 7d')
    expect(note).toContain('"PT4H"')
  })

  it('states the lowercase-symbol rule on the door own message shape', () => {
    const note = repairNote(
      JSON.stringify({
        errors: [
          {
            code: 'INVALID_VALUE',
            field: 'symbols[0]',
            message: '"BTCUSDT" is not a lowercase perp symbol',
          },
        ],
      }),
      [],
    )
    expect(note).toContain('lowercase Binance USDT-M perpetuals')
    expect(note).toContain('"btcusdt"')
    expect(note).toContain('ONE of them refuses the whole document')
  })

  it('says nothing for a body it cannot improve', () => {
    expect(repairNote(JSON.stringify({ errors: [{ code: 'QUERY_LIMIT', message: 'too big' }] }), [])).toBeNull()
  })
})

describe('the other tools are unchanged by the door', () => {
  it('still refuses outcome fields in a predicate through the same note', () => {
    const note = repairNote(
      JSON.stringify({
        errors: [{ code: 'OUTCOME_IN_PREDICATE', message: 'outcome.mfe_4h cannot be filtered' }],
      }),
      [],
    )
    expect(note).toContain('Outcome fields can never be filtered')
    expect(note).toContain('run_cohort')
  })

  it('leaves the scan-family input shapes alone', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const runScan = tools.find((t) => t.name === 'run_scan')!
    expect(Object.keys((runScan.inputSchema.properties ?? {}) as Record<string, unknown>).sort()).toEqual([
      'document',
      'full_counts',
      'full_outcomes',
      'full_rows',
      'if_none_match',
      'rows',
    ])
    const baseRate = tools.find((t) => t.name === 'base_rate')!
    expect(Object.keys((baseRate.inputSchema.properties ?? {}) as Record<string, unknown>).sort()).toEqual(
      ['field', 'from', 'operator', 'symbol', 'to', 'value'],
    )
  })
})
