import { afterEach, expect, it, vi } from 'vitest'
import { connectClient, texts } from './helpers.js'
afterEach(() => vi.unstubAllGlobals())
const id = '12345678-1234-4234-8234-123456789012', attemptId = '12345678-1234-4234-8234-123456789013'
it('reads and prepares without mutating or computing, saves only with declared revision', async () => {
  const bytes = '{ "record": { "draft":{}, "history":[] } }'
  const fetcher = vi.fn().mockImplementation(async () => new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const client = await connectClient()
  try {
    expect(texts(await client.callTool({ name: 'get_hypothesis', arguments: { id, full: true } }))).toContain(bytes)
    expect(fetcher.mock.calls[0][0].toString()).toContain(`/hypotheses?id=${id}&full=true`)
    const input = { id, event: '1790899200000-BTCUSDT', draft: { question: 'Does A add anything?' } }
    await client.callTool({ name: 'prepare_hypothesis', arguments: input })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: 'prepare', ...input })
    await client.callTool({ name: 'save_hypothesis', arguments: { ...input, revision: 7 } })
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ action: 'save', ...input, revision: 7 })
    const tools = (await client.listTools()).tools
    expect(tools.find(t => t.name === 'get_hypothesis')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find(t => t.name === 'save_hypothesis')?.annotations?.readOnlyHint).toBe(false)
    expect(tools.find(t => t.name === 'run_hypothesis')?.annotations?.destructiveHint).toBe(true)
  } finally { await client.close() }
})
it('freezes the unchanged plan then runs only the next bounded request; propagates refusals', async () => {
  const next = { id, attemptId, index: 0 }, proposal = { id, revision: 2, planHash: 'exact', draft: { note: 'negative variants count' } }
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ record: { continuation: next } })))
    .mockResolvedValueOnce(new Response('{"record":{"history":[{"status":"interrupted"}],"continuation":null}}'))
    .mockResolvedValueOnce(new Response('{"code":"SCOPE_MISSING","error":"hypothesis permission required"}', { status: 403 }))
  vi.stubGlobal('fetch', fetcher)
  const client = await connectClient()
  try {
    await client.callTool({ name: 'run_hypothesis', arguments: { proposal } })
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: 'start', proposal })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: 'step', ...next })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const refusal = await client.callTool({ name: 'run_hypothesis', arguments: { proposal } })
    expect(refusal.isError).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(3)
    await client.callTool({ name: 'run_hypothesis', arguments: { proposal, continuation: next } })
    expect(fetcher).toHaveBeenCalledTimes(3)
  } finally { await client.close() }
})
