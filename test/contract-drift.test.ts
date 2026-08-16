import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE ANTI-DRIFT GATE (MCP half).
 *
 * These tool descriptions are what an AGENT reads to decide how to call the
 * research engine. On 2026-08-16 the run_scan description advertised
 * `record_result.v3` with a "+/-20 pct" threshold ladder and "33-feature setup
 * vectors" while prod served v5 and a 39-wide vector. Wrong prose throws no
 * error, so it had been steering callers for weeks.
 *
 * `src/RESEARCH_CONTRACT.json` is a VERBATIM MIRROR of based-trader-backend
 * `docs/RESEARCH_CONTRACT.json`, which is generated from the engine constants
 * and pinned there by TestContractDescriptorGolden.
 *
 * Prose is deliberately NOT generated from the contract: a model reads it, and
 * schema-generated sentences make worse instructions. So it is CHECKED instead.
 */
const contract = JSON.parse(readFileSync(join(process.cwd(), 'src', 'RESEARCH_CONTRACT.json'), 'utf8')) as {
  result_encoding: string
  metrics: string[]
  gte_thresholds: number[]
  lte_thresholds: number[]
  bucket_count: number
  gte_threshold_count: number
  lte_threshold_count: number
}

/** The raw tool-description source. Read as TEXT, not imported: the assertion
 *  is about the strings a caller sees, and reading source keeps this honest
 *  even if the descriptions are later assembled differently. */
const toolsSource = readFileSync(join(process.cwd(), 'src', 'tools.ts'), 'utf8')

describe('research contract drift (MCP tool descriptions vs the engine artifact)', () => {
  it('names the live result encoding and no superseded one', () => {
    expect(toolsSource).toContain(contract.result_encoding)

    const current = Number(contract.result_encoding.split('.v')[1])
    for (let v = 1; v < current; v++) {
      expect(
        toolsSource.includes(`record_result.v${v}`),
        `tools.ts still advertises record_result.v${v}; the engine serves ${contract.result_encoding}`,
      ).toBe(false)
    }
  })

  it('does not advertise a superseded ladder bound', () => {
    // The pre-v6 prose said the ladder ran "to +/-20 pct". The top rung is now
    // 400 pct and the two sides are not mirrored, so that phrasing is wrong in
    // two ways at once.
    expect(
      /ladder to \+\/-20 pct|ladder to \+\/- ?20 pct/i.test(toolsSource),
      'tools.ts still describes the ladder as bounded at +/-20 pct',
    ).toBe(false)

    const topRungPct = String(Number((Math.max(...contract.gte_thresholds) * 100).toFixed(4)))
    expect(toolsSource, `tools.ts omits the top rung (${topRungPct} pct)`).toContain(topRungPct)

    const bottomRungPct = String(Number((Math.min(...contract.gte_thresholds) * 100).toFixed(4)))
    expect(toolsSource, `tools.ts omits the smallest rung (${bottomRungPct} pct)`).toContain(bottomRungPct)
  })

  it('does not claim the two ladders are symmetric', () => {
    expect(contract.gte_threshold_count).not.toBe(contract.lte_threshold_count)
    expect(
      /different lengths|not the same length|asymmetric/i.test(toolsSource),
      'the gte and lte ladders differ in length but tools.ts does not say so',
    ).toBe(true)
  })

  it('states the true setup-vector width', () => {
    // The stale text said "33-feature setup vectors" long after the
    // desc_resistance fields took the live vector to 39. The registry's closed
    // grammar and the emitted vector are DIFFERENT counts, which is exactly the
    // trap: assert no number other than the true width is attached to
    // "-feature setup vectors".
    const m = toolsSource.match(/(\d+)-feature setup vectors/)
    expect(m, 'tools.ts no longer describes the setup vector width').not.toBeNull()
    expect(
      Number(m?.[1]),
      'the setup vector is 39 wide (33 registry ids plus the 6 desc_resistance fields)',
    ).toBe(39)
  })

  it('mirror is byte-identical to the engine artifact when both are present', () => {
    const enginePath = join(process.cwd(), '..', 'based-trader-backend', 'docs', 'RESEARCH_CONTRACT.json')
    let engineBytes: string
    try {
      engineBytes = readFileSync(enginePath, 'utf8')
    } catch {
      return // sibling repo absent (CI); the engine side owns the authoritative golden
    }
    const mirrorBytes = readFileSync(join(process.cwd(), 'src', 'RESEARCH_CONTRACT.json'), 'utf8')
    expect(
      mirrorBytes,
      'src/RESEARCH_CONTRACT.json has drifted from based-trader-backend/docs/RESEARCH_CONTRACT.json - re-copy it verbatim',
    ).toBe(engineBytes)
  })
})
