import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CONFIRM_GATE_CONTRACT, SERVER_VERSION } from '../src/index.js'
import { connectClient } from './helpers.js'

/**
 * Release identity must agree across all three files that carry it.
 * SERVER_VERSION is hardcoded (version.ts keeps the stdio bundle
 * dependency-free), so nothing but a test stops it drifting from
 * package.json - and the drift only surfaces at mcp-deploy.sh's
 * post-restart /healthz assertion, i.e. after a release has shipped.
 * 0.2.2 shipped code while /healthz still reported 0.2.1 exactly this way.
 */
describe('release identity is consistent', () => {
  const read = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >

  it('SERVER_VERSION matches package.json (what /healthz reports)', () => {
    expect(SERVER_VERSION).toBe(read('package.json').version)
  })

  it('package-lock.json matches package.json (npm ci refuses a mismatch)', () => {
    const pkg = read('package.json')
    const lock = read('package-lock.json')
    expect(lock.version).toBe(pkg.version)
    expect((lock.packages as Record<string, { version?: string }>)['']?.version).toBe(pkg.version)
  })

  it('server.json registry listing matches package.json', () => {
    const pkg = read('package.json')
    const server = read('server.json')
    expect(server.version).toBe(pkg.version)
    expect(String(server.description).length).toBeLessThanOrEqual(100)
    for (const entry of server.packages as { version?: string }[]) {
      expect(entry.version).toBe(pkg.version)
    }
  })
})

describe('tool schema', () => {
  it('exposes exactly the twelve research tools', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'base_rate',
      'commonality',
      'get_report',
      'interpret_prose',
      'list_features',
      'list_instruments',
      'next_page',
      'outcome_first',
      'run_cohort',
      'run_scan',
      'run_stratified',
      'snapshot_at',
    ])
  })

  it('run_scan carries the confirm-gate contract text verbatim and takes a document', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const runScan = tools.find((t) => t.name === 'run_scan')
    expect(runScan).toBeDefined()
    expect(runScan!.description).toContain(CONFIRM_GATE_CONTRACT)
    expect(runScan!.description).toContain('matching ISO aliases')
    expect(runScan!.description).toContain('exact lowercase Binance USDT-M perpetual symbol')
    const props = (runScan!.inputSchema.properties ?? {}) as Record<string, unknown>
    expect(Object.keys(props).sort()).toEqual([
      'document',
      'full_counts',
      'full_outcomes',
      'full_rows',
      'if_none_match',
      'rows',
    ])
  })

  it('snapshots each tool input shape (guards against grammar drift)', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const shape: Record<string, string[]> = {}
    for (const t of tools) {
      const props = (t.inputSchema.properties ?? {}) as Record<string, unknown>
      shape[t.name] = Object.keys(props).sort()
    }
    expect(shape).toEqual({
      list_features: ['compact', 'feature_ids', 'search'],
      list_instruments: ['full', 'if_none_match', 'symbols'],
      interpret_prose: ['language', 'time_zone'],
      run_scan: ['document', 'full_counts', 'full_outcomes', 'full_rows', 'if_none_match', 'rows'],
      run_cohort: ['document', 'full_counts', 'full_outcomes', 'full_rows', 'if_none_match', 'rows'],
      run_stratified: ['document', 'if_none_match'],
      next_page: [
        'cursor',
        'document',
        'full_counts',
        'full_outcomes',
        'full_rows',
        'if_none_match',
        'rows',
      ],
      snapshot_at: ['at', 'symbol'],
      base_rate: ['field', 'from', 'operator', 'symbol', 'to', 'value'],
      commonality: ['moments'],
      get_report: ['hash8'],
      outcome_first: [
        'direction',
        'from',
        'full_rows',
        'horizon',
        'if_none_match',
        'kind',
        'magnitude',
        'pointed',
        'rows',
        'symbols',
        'to',
      ],
    })
  })

  it('classifies every tool side effect and world boundary explicitly', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const annotations = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]))
    const closedRead = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    const externalRead = { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    const meteredCompute = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    expect(annotations).toEqual({
      list_features: closedRead,
      list_instruments: closedRead,
      interpret_prose: externalRead,
      run_scan: meteredCompute,
      next_page: closedRead,
      snapshot_at: closedRead,
      base_rate: closedRead,
      commonality: closedRead,
      get_report: closedRead,
      run_cohort: meteredCompute,
      run_stratified: meteredCompute,
      outcome_first: meteredCompute,
    })
  })

  it('writes invocation metadata rather than generic documentation', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description, tool.name).toMatch(/^Use this when /)
      expect(tool.description, tool.name).toContain('Do not use')
    }
  })
})
