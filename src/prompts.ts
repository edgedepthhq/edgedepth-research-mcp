/**
 * prompts + resources - the worked examples, where the agent can actually
 * reach them (2026-09-04 MCP agent surface audit, finding 2).
 *
 * The cookbook and the golden prompt set already existed, on a web page and in
 * submission/openai/submission.json - both surfaces an agent never reads. MCP
 * prompts are the channel that does reach it: a client renders them as
 * pickable commands, so a first-time user gets a correct EdgeDepth workflow
 * (ground the grammar, propose the exact definition, confirm, then run and
 * report with denominators) without knowing any of it.
 *
 * Every prompt here encodes the SAME answer contract as the server
 * instructions, and none of them runs anything: a prompt returns a user
 * message, and the confirm gate still belongs to the person.
 *
 * The registry is also exposed as a RESOURCE so a client can attach the
 * grammar once instead of paying for list_features in every session.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { getRegistry } from './registry.js'
import type { ToolContext } from './tools.js'

/** The shared closing instruction: one definition, one denominated result, one
 *  labelled reference, one replay handoff, no invented anything. */
const REPORT_CONTRACT =
  'Show me the exact proposed document before running it, and wait for my confirmation. ' +
  'Then report: the exact definition, the count with its eligible denominator, the outcome ' +
  'rates read from outcomes_summary over all occurrences (never from page rows), the ' +
  'unconditional same-scope reference labelled as not comparable, the full reproducibility ' +
  'key, and one replay handoff with how far back it sits. Quote each rate with the count it ' +
  'came from, and quote lift as the ratio of the two stated rates it is, not as an effect ' +
  'size. If the result contradicts the premise, say so plainly.'

function userPrompt(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] }
}

export function registerResearchPrompts(server: McpServer, ctx: ToolContext): void {
  server.registerPrompt(
    'test_a_claim',
    {
      title: 'Test a market claim against the record',
      description:
        'Turn a trading belief into an exact definition, run it over recorded market ' +
        'microstructure, and report what actually followed, with denominators.',
      argsSchema: {
        claim: z
          .string()
          .describe('The belief to test, e.g. "liquidation cascades usually bounce within an hour".'),
      },
    },
    ({ claim }) =>
      userPrompt(
        `Test this claim against the recorded market with EdgeDepth: "${claim}".\n\n` +
          'Call list_features first so the definition uses real fields, then interpret_prose to ' +
          `propose the exact document. ${REPORT_CONTRACT}`,
      ),
  )

  server.registerPrompt(
    'liquidation_cascade_bounce',
    {
      title: 'Do liquidation cascades bounce?',
      description:
        'The worked example: define a liquidation cascade precisely, then read the forward ' +
        'outcome distribution over every occurrence against the unconditional reference.',
    },
    () =>
      userPrompt(
        'Do liquidation cascades usually bounce? Define the condition precisely with EdgeDepth ' +
          'before running anything: use list_features for the liquidation family (search: ' +
          '"liquidation"), then interpret_prose. Scope it to a handful of majors first so the ' +
          `first run is small and cheap, and tell me what widening it would cost. ${REPORT_CONTRACT}`,
      ),
  )

  server.registerPrompt(
    'investigate_symbol',
    {
      title: 'Investigate one instrument',
      description:
        'The cookbook flow for a single market: confirm coverage, read one recorded moment, ' +
        'turn it into a candidate condition, then check how common that condition is.',
      argsSchema: {
        symbol: z.string().describe('Lowercase Binance USDT-M perpetual, e.g. btcusdt.'),
      },
    },
    ({ symbol }) =>
      userPrompt(
        `Investigate ${symbol} with EdgeDepth, cheaply and in this order:\n` +
          `1. list_instruments with symbols: ["${symbol}"] to confirm coverage and provenance.\n` +
          '2. snapshot_at on a moment I name (or the latest complete minute) to see the recorded ' +
          'values there.\n' +
          '3. Propose ONE condition from that snapshot that could be interesting, and use ' +
          'base_rate to tell me how common it is. base_rate spends no allowance.\n' +
          '4. Only then propose a full scan, and tell me what it would cost before running it.',
      ),
  )

  server.registerPrompt(
    'does_it_confirm',
    {
      title: 'Does this signal confirm anything?',
      description:
        'Compare what followed a condition with what followed every other eligible bucket, ' +
        'using the cohort tool rather than a hand-picked control.',
      argsSchema: {
        setup: z
          .string()
          .describe('The condition to test, e.g. "rising open interest during a breakout".'),
      },
    },
    ({ setup }) =>
      userPrompt(
        `Does "${setup}" actually confirm anything on the record? Define it with EdgeDepth, then ` +
          'use run_cohort so the matched population is set beside every other eligible ' +
          'predicate-false bucket over identical horizons, each with its own denominator. Do not ' +
          'call the comparison causal, matched or significant. ' +
          REPORT_CONTRACT,
      ),
  )

  server.registerPrompt(
    'how_common_is_it',
    {
      title: 'How common is this condition? (free)',
      description:
        'The cheapest useful call: prevalence of one exact condition over eligible buckets in a ' +
        'window. Spends no research allowance.',
      argsSchema: {
        condition: z
          .string()
          .describe('One condition, e.g. "vpin above 0.85" or "funding rate above 0.001".'),
        symbols: z
          .string()
          .optional()
          .describe('Optional comma-separated lowercase perps; omit for the whole universe.'),
      },
    },
    ({ condition, symbols }) =>
      userPrompt(
        `How common was "${condition}"${symbols ? ` on ${symbols}` : ' across eligible markets'} ` +
          'over the last 30 complete UTC days? Use EdgeDepth: list_features to find the exact ' +
          'field, then base_rate, which is free and spends no allowance. Report true, false, ' +
          'eligible and absent counts with the prevalence, and say explicitly that missing ' +
          'values are excluded rather than counted as false.',
      ),
  )

  // The grammar, attachable once instead of paid for per session. Reads use
  // the caller's own credential, exactly like list_features.
  server.registerResource(
    'research-grammar',
    'edgedepth://research/grammar',
    {
      title: 'EdgeDepth research grammar registry',
      description:
        'The closed feature registry: feature ids, dtypes, ranges, operators, windows, sequence ' +
        'rules, limits and machine-actionable error codes. The same bytes list_features returns.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const key = ctx.getKey()
      if (!key) {
        throw new Error(
          'No EdgeDepth credential. Authorize the hosted server in your browser, or set ' +
            'EDGEDEPTH_API_KEY for the stdio package.',
        )
      }
      const reg = await getRegistry(ctx.apiBase, key)
      if (!reg.ok) throw new Error(`The research registry could not be read: ${reg.bodyText}`)
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: reg.raw }],
      }
    },
  )
}
