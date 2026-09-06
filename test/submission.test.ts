import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { connectClient } from './helpers.js'

const submission = JSON.parse(
  readFileSync(new URL('../submission/openai/submission.json', import.meta.url), 'utf8'),
) as {
  listing: Record<string, string>
  mcp: Record<string, unknown>
  starter_prompts: string[]
  positive_test_cases: { id: string; prompt: string; tool_arguments?: Record<string, unknown>; expected_tools: string[] }[]
  negative_test_cases: { expected_tools: string[] }[]
}

describe('OpenAI submission pack', () => {
  it('carries the required five positive and three negative cases', () => {
    expect(submission.positive_test_cases).toHaveLength(5)
    expect(submission.negative_test_cases).toHaveLength(3)
    expect(submission.starter_prompts.length).toBeGreaterThanOrEqual(3)
  })

  it('references only real tools and keeps negative cases tool-free', async () => {
    const client = await connectClient()
    const listed = (await client.listTools()).tools
    const tools = new Set(listed.map((tool) => tool.name))
    await client.close()
    for (const testCase of submission.positive_test_cases) {
      for (const tool of testCase.expected_tools) {
        expect(tools.has(tool), tool).toBe(true)
        const schema = listed.find((entry) => entry.name === tool)!.inputSchema
        for (const key of Object.keys(testCase.tool_arguments ?? {})) {
          expect(Object.keys(schema.properties ?? {}), `${tool}.${key}`).toContain(key)
        }
        for (const key of schema.required ?? []) expect(testCase.tool_arguments).toHaveProperty(key)
      }
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
  it('supplies copyable exact inputs for the scan, moments and report cases', () => {
    const [scan, commonality, report] = submission.positive_test_cases.slice(2)
    expect(scan.tool_arguments?.document).toMatchObject({ schema_version: 'research_query.v2', target: 'record_occurrences' })
    expect(scan.prompt).toContain(JSON.stringify(scan.tool_arguments?.document, null, 2))
    expect(commonality.tool_arguments?.moments).toHaveLength(3)
    expect(commonality.prompt).toContain(JSON.stringify(commonality.tool_arguments?.moments, null, 2))
    expect(report.tool_arguments?.hash8).toBe('fec86629')
    expect(report.prompt).toContain('fec86629')
    expect(JSON.stringify(submission)).not.toContain('a1b2c3d4')
  })

})
