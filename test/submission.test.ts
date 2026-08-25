import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const submission = JSON.parse(
  readFileSync(new URL('../submission/openai/submission.json', import.meta.url), 'utf8'),
) as {
  listing: Record<string, string>
  mcp: Record<string, unknown>
  starter_prompts: string[]
  positive_test_cases: { expected_tools: string[] }[]
  negative_test_cases: { expected_tools: string[] }[]
}

const TOOL_NAMES = new Set([
  'list_features',
  'list_instruments',
  'interpret_prose',
  'run_scan',
  'next_page',
  'snapshot_at',
  'base_rate',
  'commonality',
  'get_report',
  'run_cohort',
  'run_stratified',
])

describe('OpenAI submission pack', () => {
  it('carries the required five positive and three negative cases', () => {
    expect(submission.positive_test_cases).toHaveLength(5)
    expect(submission.negative_test_cases).toHaveLength(3)
    expect(submission.starter_prompts.length).toBeGreaterThanOrEqual(3)
  })

  it('references only real tools and keeps negative cases tool-free', () => {
    for (const testCase of submission.positive_test_cases) {
      for (const tool of testCase.expected_tools) expect(TOOL_NAMES.has(tool), tool).toBe(true)
    }
    for (const testCase of submission.negative_test_cases) {
      expect(testCase.expected_tools).toEqual([])
    }
  })

  it('uses public HTTPS listing and MCP URLs', () => {
    for (const [name, value] of Object.entries(submission.listing)) {
      if (name.endsWith('_url') || name === 'logo_source') expect(value).toMatch(/^https:\/\//)
    }
    expect(submission.mcp.production_url).toBe('https://mcp.edgedepth.com/mcp')
    expect(submission.mcp.url_type).toBe('Universal')
  })

  it('contains no checkout funnel language', () => {
    expect(JSON.stringify(submission)).not.toMatch(/edgedepth\.com\/pricing|\bupgrade\b/i)
  })
})
