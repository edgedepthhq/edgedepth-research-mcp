# EdgeDepth Research MCP Server

`@edgedepth/research-mcp` is the official, research-only Model Context Protocol server for [EdgeDepth](https://edgedepth.com/), a [market microstructure search engine](https://edgedepth.com/research) over recorded Binance USDT-M crypto and TradFi perpetuals. Use it from ChatGPT, Claude, Cursor, Codex, or any MCP client to find every verified occurrence of a market condition, inspect forward outcomes across the complete matched set, read an unconditional same-scope reference, and open replay-linked evidence.

Every result includes counts with denominators and a reproducibility key. Same key, same bytes.

[Website](https://edgedepth.com/) · [Search the market](https://edgedepth.com/research) · [REST API documentation](https://app.edgedepth.com/research/api) · [MCP setup guide](https://app.edgedepth.com/research/api/mcp) · [Learning hub](https://edgedepth.com/learn/)

## Why use EdgeDepth Research?

- **Search recorded market microstructure:** query a closed, versioned feature registry covering order flow, price action, volatility, funding, open interest, positioning, candle formations, and liquidations.
- **Keep the denominator:** every count reports the eligible population and exclusions behind it. Missing data is absent, never silently changed to zero.
- **Measure outcomes without lookahead selection:** forward returns, MFE, and MAE are computed over all occurrences. Outcome fields cannot be used as filters.
- **Compare matched and baseline populations:** deterministic cohort results put the matched distribution beside every other eligible predicate-false bucket.
- **Audit and replay the evidence:** results carry a reproducibility key, and representative occurrences include authenticated web handoffs to the exact recorded market moment.
- **Stay research-only:** no tool trades, modifies alerts, publishes reports, or writes account data. A fresh scan, cohort, or stratified computation can consume research allowance units; the annotations state that side effect explicitly.

## Choose a connection

The package exposes one tool core through two transports:

- **Hosted MCP (recommended):** connect to `https://mcp.edgedepth.com/mcp` over Streamable HTTP and authorize once in your browser. No API key to copy.
- **Local stdio:** run `npx -y @edgedepth/research-mcp` with an EdgeDepth API key.

## Connect

### Claude Desktop

In **Settings > Connectors > Add custom connector**, enter:

```text
https://mcp.edgedepth.com/mcp
```

Complete the EdgeDepth browser authorization prompt.

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "edgedepth-research": {
      "url": "https://mcp.edgedepth.com/mcp"
    }
  }
}
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.edgedepth]
url = "https://mcp.edgedepth.com/mcp"
```

Then run:

```bash
codex mcp login edgedepth
```

Remove any old `bearer_token_env_var` line before using browser OAuth.

### Local stdio with npx

Create a key on the [EdgeDepth Developer page](https://app.edgedepth.com/account/developer), then add:

```json
{
  "mcpServers": {
    "edgedepth-research": {
      "command": "npx",
      "args": ["-y", "@edgedepth/research-mcp"],
      "env": {
        "EDGEDEPTH_API_KEY": "edk_live_YOUR_KEY"
      }
    }
  }
}
```

Local stdio requires Node.js 20 or newer. Use the `research:read` key scope for recorded-data tools and add `research:interpret` only when you need the free `interpret_prose` proposal step.

## Result projection (agent context economy)

Scan-family results are large: a universe scan's canonical bytes run to
hundreds of kilobytes, most of it page rows carrying every recorded feature,
the zero and long-tail entries of `counts_by_symbol`, and empty threshold
rungs. That overflows a client's tool-result budget before it answers anything.

`run_scan`, `next_page` and `run_cohort` therefore return a **stated
projection** by default. It only ever REMOVES, and every removal is listed in a
trailing note with the exact way to get the bytes back:

- occurrence rows are trimmed to `rows` (default 3) and each kept row keeps the
  setup fields its own `evidence` block names - `full_rows: true` restores the
  whole vector;
- the per-occurrence `outcomes` map keeps the entries for the rows that remain;
- `counts_by_symbol` keeps the top entries by match count, and says how many
  instruments and matches were omitted;
- the outcome ladders are replaced by a paired answer block: for each metric,
  `present`, `absent` and the selected rungs' integer counts pass through
  verbatim, with `rate`, the unconditional `baseline_rate` over the same
  symbols and window, and their ratio as `lift` stated beside them. The
  selection is fixed in advance (`gte 0.01`, `gte 0.02`, `lte -0.01`,
  `lte -0.02`), drops rungs that separate nothing, and adds the single rung
  carrying the largest lift among those holding at least 30 occurrences,
  marked `kept_for`. `full_outcomes: true` returns every rung and the per-rung
  histogram, on the matched set and the reference separately.

Counts, denominators, absent tallies, `predicate_coverage`, representatives,
the page cursor and the reproducibility key are never touched, and the request
document is never rewritten, so the canonical query hash and the credit charged
are exactly what you asked for. `full_counts: true` returns the engine's
verbatim canonical bytes with no projection at all. ETags are
projection-scoped: an ETag held for one projection can never revalidate as a
different one.

`list_features` takes the same treatment on request: `search`, `feature_ids`
and `compact` return one feature family instead of the whole grammar, with the
closed parts (operators, windows, sequence rules, limits, error codes) intact.

## Prompts and resources

The server publishes worked prompts, which compatible clients surface as
pickable commands: `test_a_claim`, `liquidation_cascade_bounce`,
`investigate_symbol`, `does_it_confirm` and `how_common_is_it` (the free
prevalence path). Each one encodes the same answer contract: ground the
grammar, propose the exact definition, wait for confirmation, then report with
denominators, the reference, the reproducibility key and a replay handoff.

The grammar registry is also served as a resource, `edgedepth://research/grammar`,
so a client can attach it once instead of calling `list_features` every session.

## Recommended agent workflow

1. Call `list_features` first. It is the live, closed grammar and prevents invented fields.
2. Call `list_instruments` to check the manifest-derived universe, coverage, and provenance.
3. If starting from natural language, call `interpret_prose`. It returns a proposed document and never executes it.
4. Inspect or show that proposal, then pass the exact document to `run_scan`.
5. Read rates from `outcomes_summary`, which covers all occurrences. Page rows are examples, never the denominator. Each rung already carries its matched count and rate, the unconditional rate, and their ratio as `lift`: quote those, and quote the count beside the rate. No `lift` means no reference was available or the unconditional rate was zero; neither licenses estimating one.
6. Read the appended unconditional same-scope reference when available. It is not matched, comparable, or a causal control.
7. Return the full reproducibility key with the answer and one replay handoff. Each handoff states how far back it sits; replay reach is a per-account entitlement, so an old moment can be refused at the web surface even though the occurrence is real. Use `next_page` only with a cursor returned by the API.

Example instruction for an MCP client:

```text
Call list_features first, then list_instruments for btcusdt and ethusdt.
Propose an exact query for elevated VPIN and one-sided taker flow over the last
seven complete UTC days. Show me the proposed document before running it.
Report counts with denominators, summarize outcomes over all occurrences, and
include the full reproducibility key.
```

## Tools

| Tool | What it does |
| --- | --- |
| `list_features` | Returns the closed grammar registry: feature ids, types, ranges, operators, windows, sequence rules, limits, and error codes. `search`, `feature_ids` and `compact` narrow it. |
| `list_instruments` | Returns the research universe and coverage. The default is a compact summary; use `symbols: [...]` for selected full records or `full: true` for the verbatim canonical universe. |
| `interpret_prose` | Turns prose into a proposed query document. It does not execute the query. Optional `time_zone` accepts an IANA time zone for calendar planning. |
| `run_scan` | Executes a `research_query.v2` document and returns result bytes with counts, denominators, outcomes, the unconditional same-scope reference, and the reproducibility key. Projected by default (`rows`, `full_rows`, `full_counts`). |
| `next_page` | Continues a prior scan with its opaque cursor. Never construct cursors manually. |
| `snapshot_at` | Reads registry feature values, window aggregates, and fired rules as of a recorded moment. |
| `base_rate` | Counts matches and eligible buckets for one clause over a window. |
| `commonality` | Finds the deterministic intersection across multiple moments with selection-bias caveats included. |
| `get_report` | Retrieves a published report by its 8-character canonical hash. |
| `run_cohort` | Compares what followed every match with what followed every other eligible predicate-false bucket. |
| `run_stratified` | Partitions one matched population at its existing anchors into split-true, split-false, and split-absent outcome summaries. |
| `outcome_first` | Starts from the MOVE instead of the setup: names an outcome (size, direction, horizon) and reports what the record was doing at five fixed offsets before every realised move like it. Each row carries two counted shares, the share before these moves and the share across every eligible minute in the same scope, plus the setup-first rerun that re-tests it the other way round. A descriptive read, never a rule search: a row is not a rule, a candidate or a finding, and the row order is display order. A scope with too few realised moves is refused with its counts and four adjustments, and a refusal spends nothing. Projected by default (`rows`, `full_rows`). |

No tool can trade, change market state, publish, or modify account data. `run_scan`, `run_cohort`, `run_stratified` and `outcome_first` are annotated as metered computations because a fresh call can irreversibly consume an allowance unit. The other recorded-data tools are closed-world reads. `interpret_prose` is a free read that uses the configured external language interpreter.

## Research contract

- Validation failures pass through as `422 {"errors":[{"code":"...","message":"..."}]}`.
- Transport failures use the `{"error","code"}` envelope.
- Contract codes are machine-actionable. For errors such as `UNSUPPORTED_FEATURE` or `OUTCOME_IN_PREDICATE`, call `list_features`, repair the document, and retry.
- Deterministic tools are exact-document, UTC-only tools. `interpret_prose` may use a time zone to plan dates, but `run_scan`, `run_cohort`, and `base_rate` never reinterpret calendar language.
- Reruns and ETag `304 Not Modified` revalidations are free. `list_instruments` ETags are scoped to the requested summary, symbol projection, or full representation.
- Interpretation is free and never debits the scan allowance. An unavailable scan allowance returns neutral `402 RESEARCH_ALLOWANCE_EXHAUSTED` metadata without a checkout link.

## REST API and documentation

The MCP server is a thin, deterministic interface to the public EdgeDepth Research API:

- [REST API quickstart](https://app.edgedepth.com/research/api)
- [Authentication and API keys](https://app.edgedepth.com/research/api/auth)
- [Credits, caching, and limits](https://app.edgedepth.com/research/api/credits)
- [Versioned query grammar](https://app.edgedepth.com/research/api/grammar)
- [Reproducibility contract](https://app.edgedepth.com/research/api/reproducibility)
- [Worked API examples](https://app.edgedepth.com/research/api/examples)
- [MCP connection guide](https://app.edgedepth.com/research/api/mcp)
- [How EdgeDepth Research works](https://edgedepth.com/learn/how-research-works/)
- [What you can ask](https://edgedepth.com/learn/what-you-can-ask/)

The default REST base used by the stdio package is `https://app.edgedepth.com/api/v1/research`.

## Environment

### Local stdio

| Variable | Default | Purpose |
| --- | --- | --- |
| `EDGEDEPTH_API_KEY` | None | Required for stdio tool calls. |
| `EDGEDEPTH_API_BASE` | `https://app.edgedepth.com/api/v1/research` | Optional REST API base override. |

### Hosted server operators

| Variable | Default | Purpose |
| --- | --- | --- |
| `EDGEDEPTH_OAUTH_EXCHANGE_URL` | `http://127.0.0.1:3002/api/mcp/oauth/exchange` | OAuth access-token exchange endpoint. |
| `MCP_INTERNAL_SECRET` | None | Required internal assertion secret; must match the web app. |
| `PORT` | `3003` | HTTP listen port. |
| `HOST` | `127.0.0.1` | HTTP listen host. |

## Authentication and security

The hosted server uses browser OAuth. It validates opaque access tokens, exchanges them for separate short-lived internal assertions, and never passes the OAuth access token to the REST API. The MCP server is stateless and stores no user credentials.

Compatible clients rotate refresh tokens silently while the connection remains active. Review or revoke access at [EdgeDepth Connected Apps](https://app.edgedepth.com/account/mcp).

API keys remain available for scripts, local stdio, and MCP clients without browser OAuth. Treat an `edk_live_...` key as a secret and never commit it to source control.

## Develop

```bash
npm install
npm run build
npm test
npm run typecheck
```

TypeScript builds to `dist/`. Example nginx locations, systemd hardening, and operator environment values live under `deploy/`. Production deployment and npm publishing remain operator actions.

## Related projects

- [edgedepth-terminal](https://github.com/edgedepthhq/edgedepth-terminal) (AGPL): the open-source C++/WASM orderflow terminal. Replay-linked evidence from research results opens the exact recorded market moment in it, and it self-hosts with one docker compose command.
- [edgedepth-gateway](https://github.com/edgedepthhq/edgedepth-gateway) (MIT): a Go bridge from Binance's public streams to the terminal's wire format, for running the terminal on live data without an account.

## License

MIT
