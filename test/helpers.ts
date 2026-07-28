/**
 * Test helpers: a linked in-memory client/server pair over the real
 * tool core, so tools are exercised end to end (protocol + handlers)
 * with global fetch stubbed.
 */
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
