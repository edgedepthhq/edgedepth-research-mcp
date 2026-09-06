import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { connectClient, texts, TEST_API_BASE } from './helpers.js'

afterEach(() => vi.unstubAllGlobals())

// These are transport/contract regressions, not evidence of ChatGPT routing.
describe('natural-language proposal boundary', () => {
  const pack = JSON.parse(readFileSync(new URL('../submission/openai/submission.json', import.meta.url), 'utf8'))
  const document = pack.positive_test_cases[2].tool_arguments.document

  it.each([true, false])('preserves proposal details without discovery or execution (valid=%s)', async (valid) => {
    const language = pack.positive_test_cases[0].prompt
    const body = JSON.stringify({
      proposal: true,
      executable: false,
      document: valid ? document : null,
      validation: { ok: valid },
      chips: [{ field: 'feature.ret_15m', operator: 'gte', value: 0.01,
        provenance: 'inferred', inferredNote: 'Suggested threshold. Confirm or edit.' }],
      unsupported: valid ? [] : [{ phrase: 'bounce', reason: 'Define magnitude and horizon.' }],
      notices: ['Dates and markets require approval.'],
      diagnostics: { semantic_check_passed: valid, mode: 'live' },
    }, null, 2)
    const fetch = vi.fn().mockResolvedValue(new Response(body, {
      status: 200, headers: { 'x-research-credits-charged': '0' },
    }))
    vi.stubGlobal('fetch', fetch)
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'interpret_prose', arguments: { language } })
      expect(texts(result)).toContain(body)
      expect(texts(result).at(-1)).toContain('do not print them in the chat unless asked')
      expect(texts(result).at(-1)).toContain('implicit whole-universe scope')
      expect(texts(result)[0]).toContain('credits_charged=0')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(String(fetch.mock.calls[0][0])).toBe(`${TEST_API_BASE}/interpret`)
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ language })
    } finally {
      await client.close()
    }
  })

  it('keeps interpretation-first routing and human consent in discovery and worked prompts', async () => {
    const client = await connectClient()
    try {
      const instructions = client.getInstructions() ?? ''
      expect(instructions.slice(0, 512)).toContain('interpret_prose FIRST')
      expect(instructions.slice(0, 512)).toContain('explicit human approval')
      expect(instructions).toContain('Changing any assumption requires a new proposal and confirmation')
      const { tools } = await client.listTools()
      const interpret = tools.find(t => t.name === 'interpret_prose')!
      expect(interpret.description).toContain('without prerequisite registry or universe calls')
      expect(interpret.description).toContain('chip provenance')
      expect(interpret.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true })
      expect(tools.find(t => t.name === 'run_scan')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
      for (const name of ['test_a_claim', 'liquidation_cascade_bounce']) {
        const result = await client.getPrompt({ name, ...(name === 'test_a_claim' ? { arguments: { claim: 'Do cascades bounce?' } } : {}) })
        const prompt = result.messages.map(m => (m.content as { text: string }).text).join(' ')
        expect(prompt).toContain('interpret_prose')
        expect(prompt).not.toContain('list_features first')
        expect(prompt).toContain('wait for my confirmation')
        expect(prompt).toContain('allowance consumption')
      }
    } finally {
      await client.close()
    }
  })
})
