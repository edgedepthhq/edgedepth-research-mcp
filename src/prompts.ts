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
import { OUTCOME_HORIZONS, OUTCOME_LADDER, OUTCOME_LADDER_DOWN_MAX } from './repair.js'
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

  server.registerPrompt(
    'what_preceded_moves_like_this',
    {
      title: 'What preceded moves like this? (outcome first)',
      description:
        'Start from the move rather than from a setup: define the outcome exactly, read what ' +
        'the record was doing before every move like it, then re-test one reading setup first, ' +
        'which is where the honest rate lives.',
      argsSchema: {
        move: z
          .string()
          .optional()
          .describe(
            'The move to start from, e.g. "10 percent up within 4 hours". Omit for the worked ' +
              'example.',
          ),
        scope: z
          .string()
          .optional()
          .describe('Optional markets, e.g. "AI sector perps" or a comma-separated list.'),
      },
    },
    ({ move, scope }) =>
      userPrompt(
        `What preceded ${move ?? '10 percent up moves within 4 hours'} on ` +
          `${scope ?? 'AI-sector perps'}, over the last 90 complete UTC days? Use EdgeDepth:\n` +
          '1. list_instruments to pick the markets, because a scope of fewer than five markets ' +
          'is always refused and one market always is.\n' +
          '2. outcome_first with kind: "reached", direction: "up", magnitude: 0.1 (a ladder rung, ' +
          'as a fraction) and horizon: "4h". Show me the exact document before you run it.\n' +
          '3. Report the population first: how many realised moves, on how many markets, over ' +
          'how many days, and the unconditional rate with the counts it came from. If it refuses, ' +
          'give me the reasons and the four adjustments and stop; a refusal costs nothing.\n' +
          '4. Then the rows. Every row is SELECTED ON THE OUTCOME: say so. Give me both counted ' +
          'shares per row (before these moves, and usually), never a rate without its count, and ' +
          'do not call any row a rule, a candidate, a finding or something that works. The order ' +
          'is the gap between the two shares, which is display order, not a ranking.\n' +
          '5. Pick ONE row, fetch its setup-first rerun document with full_rows: true, and run it ' +
          'through run_scan. That asks the opposite question, out of every minute that looked ' +
          'like this how many were followed by the move, and THAT rate is the honest one. Tell me ' +
          'how far the two differ.\n' +
          '6. Quote the honesty notes from the result verbatim, and give me one replay handoff ' +
          'with how far back it sits.',
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

  /* The outcome-first door's closed TARGET grammar. A separate resource
     rather than an addition to the one above, because that one returns
     the API's registry bytes VERBATIM and injecting into them would end
     the byte identity list_features depends on. This one is static,
     owned by this package, needs no credential and no round trip, and
     says the two things an agent gets wrong: the magnitude is a
     fraction on a closed ladder, and the horizon is a suffix. */
  server.registerResource(
    'outcome-first-grammar',
    'edgedepth://research/outcome-first',
    {
      title: 'EdgeDepth outcome-first target grammar',
      description:
        'The closed target grammar for the outcome_first tool: the outcome ladder as fractions, ' +
        'the closed horizon suffixes, the two kinds and two directions, and the scope floor a ' +
        'thin population is refused against.',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(OUTCOME_FIRST_GRAMMAR, null, 2),
        },
      ],
    }),
  )
}

/**
 * The door's closed grammar, as the agent needs to see it. Mirrors
 * internal/research/outcome_first.go and the Phase 0 scope floor; it is
 * documentation, and the engine remains the thing that decides.
 */
export const OUTCOME_FIRST_GRAMMAR = {
  schema_version: 'outcome_first_query.v1',
  result_encoding: 'outcome_first_result.v1',
  kind: ['reached', 'finished'],
  direction: ['up', 'down'],
  magnitude_ladder: OUTCOME_LADDER,
  magnitude_unit: 'fraction of the anchor close, not a percentage: 0.1 is ten percent',
  magnitude_down_cap: OUTCOME_LADDER_DOWN_MAX,
  horizons: OUTCOME_HORIZONS,
  horizon_unit: 'closed suffix, not an ISO duration',
  lead_up_offsets: ['1m', '15m', '1h', '4h', '24h'],
  scope_floor: {
    min_episodes: 20,
    min_utc_days: 8,
    min_symbols: 5,
    max_day_share: 0.35,
    max_symbol_share: 0.35,
    note: 'A scope under the floor is REFUSED with its exact counts and four adjustments, and the refusal spends no allowance. One market always refuses.',
  },
  reading:
    'A descriptive read over the population where the outcome held, never a rule search. Every row is selected on the outcome and carries two counted shares plus a setup-first rerun; the rerun is where the honest rate lives.',
} as const
