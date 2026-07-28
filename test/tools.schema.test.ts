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
    for (const entry of server.packages as { version?: string }[]) {
      expect(entry.version).toBe(pkg.version)
    }
  })
})

describe('tool schema', () => {
  it('exposes exactly the ten read-only tools', async () => {
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
      'run_cohort',
      'run_scan',
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
    expect(Object.keys(props).sort()).toEqual(['document', 'if_none_match'])
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
      list_features: [],
      list_instruments: ['full', 'if_none_match', 'symbols'],
      interpret_prose: ['language', 'time_zone'],
      run_scan: ['document', 'if_none_match'],
      run_cohort: ['document', 'if_none_match'],
      next_page: ['cursor', 'document', 'if_none_match'],
      snapshot_at: ['at', 'symbol'],
      base_rate: ['field', 'from', 'operator', 'symbol', 'to', 'value'],
      commonality: ['moments'],
      get_report: ['hash8'],
    })
  })

  it('all tools declare read-only annotations (no write surface in v1)', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true)
    }
  })
})
