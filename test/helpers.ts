/**
 * Test helpers: a linked in-memory client/server pair over the real
 * tool core, so tools are exercised end to end (protocol + handlers)
 * with global fetch stubbed.
 */
import { runInNewContext } from 'node:vm'
import { vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createResearchMcpServer } from '../src/index.js'

export const TEST_API_BASE = 'http://api.test/api/v1/research'
export const TEST_KEY = 'edk_live_TESTKEY0000000000000000000000000000'

export async function connectClient(getKey: () => string | undefined = () => TEST_KEY): Promise<Client> {
  const server = createResearchMcpServer({ apiBase: TEST_API_BASE, getKey })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return client
}

/** Text of every content block, in order. */
export function texts(result: { content: unknown }): string[] {
  return (result.content as { type: string; text: string }[]).map((b) => b.text)
}

// Executes the shipped inline JS, including both host bridges and control
// handlers. A small DOM double keeps the regression test dependency-free;
// real responsive browser verification is recorded in the task evidence.
export class Element {
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
export function widgetHost(html: string, metadata?: unknown, openai = false) {
  const elements = new Map<string, Element>()
  for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const e = new Element(match[1]!); e.hidden = match[0].includes('hidden'); elements.set(match[2]!, e)
  }
  const listeners: Record<string, (event?: any) => void> = {}
  const parent = { postMessage: vi.fn() }
  const window: any = { parent, addEventListener: (name: string, fn: any) => { listeners[name] = fn } }
  if (openai) window.openai = { toolResponseMetadata: metadata }
  const document = { getElementById: (id: string) => elements.get(id), createElement: (tag: string) => new Element(tag),
    querySelectorAll: () => [], body: { scrollHeight: 900 } }
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1]!, { document, window })
  const receive = (result: any, source = parent) => listeners.message!({ source,
    data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result } })
  if (!openai && metadata) receive({ _meta: metadata })
  return { get: (id: string) => elements.get(id)!, receive, window, listeners, parent }
}
