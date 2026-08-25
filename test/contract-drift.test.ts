import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE ANTI-DRIFT GATE (MCP half).
 *
 * Tool descriptions are invocation metadata, not a result-format manual. On
 * 2026-08-16 run_scan duplicated fast-changing result details and drifted from
 * production without throwing an error. The repair is to keep those values in
 * the machine-readable contract and forbid numeric/version duplication in the
 * invocation copy.
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

describe('research contract drift (MCP invocation copy vs the engine artifact)', () => {
  it('keeps fast-changing result details out of invocation metadata', () => {
    expect(toolsSource).not.toMatch(/record_result\.v\d+/)
    expect(toolsSource).not.toMatch(/\d+-feature setup vectors/)
    expect(toolsSource).not.toMatch(/threshold ladder runs|ladder to \+\//i)
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
