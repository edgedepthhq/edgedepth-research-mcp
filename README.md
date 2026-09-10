# EdgeDepth Research MCP Server

`@edgedepth/research-mcp` is the official, research-only Model Context Protocol server for [EdgeDepth](https://edgedepth.com/), a [market microstructure search engine](https://edgedepth.com/research) over recorded Binance USDT-M crypto and TradFi perpetuals. Use it from ChatGPT, Claude, Cursor, Codex, or any MCP client to find every verified occurrence of a market condition, inspect forward outcomes across the complete matched set, read an unconditional same-scope reference, and open replay-linked evidence.

Every result includes counts with denominators and a reproducibility key. Same key, same bytes.

[Website](https://edgedepth.com/) · [Search the market](https://edgedepth.com/research/workbench) · [REST API documentation](https://app.edgedepth.com/research/api) · [MCP setup guide](https://app.edgedepth.com/research/api/mcp) · [Learning hub](https://edgedepth.com/learn/)

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
`investigate_symbol`, `what_preceded_moves_like_this`, `does_it_confirm` and `how_common_is_it` (the free
prevalence path). Each one encodes the same answer contract: ground the
grammar, propose the exact definition, wait for confirmation, then report with
denominators, the reference, the reproducibility key and a replay handoff.

The grammar registry is also served as a resource, `edgedepth://research/grammar`,
so a client can attach it once instead of calling `list_features` every session.

## Recommended agent workflow

1. For setup-first questions, interpret prose in the host and call `prepare_study` with structured scope, predicates and outcome. It reuses the web validator and measure contract, validates current instrument membership and returns an unrun canonical definition plus a fresh allowance estimate. No external LLM is used. Preserve `user_stated`, `semantic_translation` (top 10% means rank >= 0.9) and `model_assumed` separately; only the latter denotes an invented proposal. Use `interpret_prose` unchanged as the raw-prose fallback. Use compact `list_features` for uncommon fields or validation repair, not every question.
2. Call `list_instruments` only when you need to check the manifest-derived universe, coverage, and provenance. Its result carries the human market page in the same way, `https://edgedepth.com/research/symbols/<symbol>`, for a market still being recorded; a delisted market in the universe has no page, so offer that link rather than promising it.
3. Show one short proposal: condition, exact markets and dates/time zone, outcome definition and horizon, and metering. Interpretation is free; fresh computations can consume allowance. Label every unprovided value as a proposed assumption using chip provenance. Resolve unsupported fragments and ask only questions that materially change the study. Keep exact JSON and diagnostics inspectable in tool details, available on request.
4. Wait for explicit human approval, then pass the same document to `run_scan`. Changes require a new proposal and confirmation. The exact-document API does not store a proposal ID or a human approval receipt; client consent is required, and a model-supplied flag is not proof. On the supporting web release (b68c744 or later), returned `rq` workbench links load editable proposals and wait for Run; navigation never authorizes computation.
5. Answer the question first, preserving zero-match and inconclusive findings. Give matched/eligible counts, coverage exclusions, present/absent outcomes, both directions at the agreed horizon, and overlap/selection limitations. Read rates from `outcomes_summary`, which covers all occurrences. Page rows are examples, never the denominator. Each rung already carries its matched count and rate, the unconditional rate, and their ratio as `lift`: quote those, and quote the count beside the rate. No `lift` means no reference was available or the unconditional rate was zero; neither licenses estimating one.
6. Read the appended unconditional same-scope reference when available. It is not matched, comparable, or a causal control.
7. Return the full reproducibility key with the answer and one relevant next action: a returned replay, a changed assumption, or an existing report. Saving and alerts remain web actions. Each handoff states how far back it sits; replay reach is a per-account entitlement, so an old moment can be refused at the web surface even though the occurrence is real. Use `next_page` only with a cursor returned by the API.

Example instruction for an MCP client:

```text
Did elevated VPIN and one-sided buying tend to precede a rise? Propose a precise
study before running anything. Label any suggested thresholds, markets, dates
and outcome definition so I can approve or change them.
```

The user does not need tool names, feature IDs or JSON. The client translates the
confirmed proposal into the existing exact-document call.

## Outcome-first and pointed-move workflow

For an outcome-first question, use `outcome_first` after agreeing the target and
scope. Preserve touched-within (`reached`) versus close-at-end (`finished`),
direction, size and horizon. Do not pass the outcome to the setup interpreter or
substitute the worked example. The target grammar is available at
`edgedepth://research/outcome-first`.

Report the population and both counted shares for each displayed reading. Help
the person choose one reading, retrieve its `setup_first_rerun` with `full_rows:
true` on the unchanged request, and confirm that exact setup before `run_scan`.
Pass the original target as `run_scan.measure` outside the unchanged document:
`kind: "touch"` for reached, `"close"` for finished, plus the agreed direction,
fractional magnitude and horizon. The returned workbench link keeps that display
choice and remains an unrun draft. This does not alter the scan/cache key. The local selected-outcome addition below preserves the exact reading separately from closing-return exploration.
Read the original outcome target from the complete matched-set summary; request
`full_outcomes` if the projection omitted its rung. An unavailable rung is stated,
never replaced by the default horizon. The two reads have different denominators.
A same-period rerun remains exploratory; freeze the condition and use a separate
period before claiming validation.

A named moment can be inspected with `snapshot_at`; `commonality` compares multiple
supplied moments. The screenshot path below adds bounded explicit close-range investigation and the existing
detector geometry. Automatic move selection is not exposed through MCP. Historical marker browsing and general volume-tier resolution are not MCP
capabilities yet. The local resolve_scope addition below supplies explicit sector resolution after its web release. `list_instruments` supplies coverage and instrument provenance,
not sector membership. Use resolve_scope for recorded sector membership when available; otherwise use an exact supplied roster;
never invent group members or a numeric price. Replay handoffs open the web surface
and remain subject to the person's coverage and entitlement.

## Tools

| Tool | What it does |
| --- | --- |
| `list_features` | Returns the closed grammar registry: feature ids, types, ranges, operators, windows, sequence rules, limits, and error codes. `search`, `feature_ids` and `compact` narrow it. |
| `list_instruments` | Returns the research universe and coverage. The default is a compact summary; use `symbols: [...]` for selected full records or `full: true` for the verbatim canonical universe. |
| `prepare_study` | Free deterministic structured preparation, provenance and allowance estimate. Requires the web `/prepare` release first. |
| `interpret_prose` | Turns prose into a proposed query document. It does not execute the query. Optional `time_zone` accepts an IANA time zone for calendar planning. |
| `run_scan` | Executes a `research_query.v2` document and returns result bytes with counts, denominators, outcomes, the unconditional same-scope reference, and the reproducibility key. Projected by default (`rows`, `full_rows`, `full_counts`). |
| `next_page` | Continues a prior scan with its opaque cursor. Never construct cursors manually. |
| `ground_screenshots` | Resolves host-extracted screenshot coordinates against recorded candle closes and coverage, retaining uncertainty and deduplicating event views. Free. |
| `investigate_move` | Reads the existing lead-up and optional recorded detector geometry for a grounded event, and optionally prepares exact unrun setup documents. Free read; historical entitlement applies. |
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


### Inline scan evidence

Supported MCP Apps hosts can display a comparison and recorded-distribution card
from `run_scan`. The card receives only complete-result forward-return summaries,
coverage, exact query/key and metering in tool-result `_meta`. This data is hidden
from the model in ChatGPT; the existing text projection is unchanged. No raw page
observations are used to make distributions, no fitted curves are invented, and
no additional requests or allowance consumption occur when changing chart views.
Reference distributions are compared only when their bin edges align. Empty bins,
open tails, missing outcomes and zero/one-observation states remain visible.
Horizon and move-size controls are display choices over already-computed outcomes,
not changes to the approved query. The card defaults to the labelled 1h / 1% view.
Exact study/evidence details expand inside the card; text-only hosts keep the
existing response. The HTML resource has no network dependencies or mutations.
This is a developer-connector update, not an automatic official V1 rescan.


## Screenshot-led investigation (local implementation; release required)

Attach charts to a vision-capable host and use `investigate_screenshots`. The host
reads the images; the server receives `screenshot_observation.v1` facts through
`ground_screenshots`. The contract is `edgedepth://research/screenshots`. No second
image model or automatic attachment access is used.

Grounding is free for every authenticated tier. It checks explicit minute-close
boundaries against recorded Binance futures candles and manifest bounds, retains
visible/inferred/user/missing provenance, and deduplicates exact event views.
Unclear dates, zones, inferred boundaries, conflicting coordinates and overlapping
examples need one clarification. No default date, venue substitution or nearby
move search occurs. Wick tick timing and unsupported drawings are not matched.

`investigate_move` rechecks the event and reuses the web's five lead-up offsets,
recorded detector evidence and setup-combination builder. It consumes no allowance;
historical snapshots retain their existing entitlement. Optional exact study scope
and target return unrun `setup_first_rerun` documents, an allowance estimate and an
editable workbench link. The default response omits duplicate source snapshots and detector candle bars,
with `full_sources: true` restoring the complete bytes. All reading values, exact
setup documents, source metadata, gaps and parity stay inspectable; a free re-read
may see a newer revision. Population counts and forward rates still require the existing
`outcome_first` or `run_scan`, after a concrete proposal and explicit human approval.
The exact target stays separate from the setup predicate. Selected winning examples
and same-period reruns remain exploratory; use a separate period before validation.
Replay coverage and entitlement remain independent of research history.

Deploy the web's `/api/v1/research/investigate/ground`, `/investigate` and `/evidence`
routes before releasing these MCP tools. The workbench on web b68c744 loads `rq`
as an editable proposal and waits for Run. Do not use the new proposal links with older releases that execute on arrival.
Historical-marker and named-collection MCP parity remain separate work. The returned
estimate is for each prepared setup, not a general quote endpoint.

Local deterministic tests exercise extracted observations and authenticated handlers
with fixtures. They are not image-model or vision-host acceptance. Follow the
`test/screenshot-host-acceptance.md` cases in an actual vision-capable host before
claiming that upload-to-investigation works end to end.

### Release 0.8.0

Adds explicit screenshot grounding and move investigation, with compact source
projection by default and `full_sources: true` when the complete evidence is needed.
The host reads the images; the MCP validates structured observations and exact
recorded coordinates. Ambiguity requests clarification rather than inventing a move.

Saved scans, cohorts, comparisons and outcome-first studies remain readable when
allowance is exhausted. The web uses dedicated engine cache-read routes; a missing
result cannot start a new computation. A cache is revision-bound and may be evicted,
so this is not a promise of permanent result storage. General replay access depends
on the recorded date, market and plan; research links do not confer an event grant.

### Host preparation and compact reports (local; release required)

`prepare_study` accepts scope (symbols, offset-qualified from/to, provenance),
setup (field/operator/value/provenance) and outcome (reached/finished, direction,
fractional magnitude, horizon, provenance). Source metadata stays separate from
the hashed query. Screenshot anchors must be visible or user supplied; uncertain
times need clarification. Retrieve EdgeDepth readings with snapshot_at first.
Qualitative rules remain model_assumed until the person approves the proposal.
The server validates host claims, but cannot verify what the host actually saw.

`get_report` defaults to a stated, fixed 1h overview with source counts and stored
integrity status. It does not claim to revalidate the pin. `full:true` restores
complete stored bytes, including all outcomes and definitions. This selection
is not a saved requested measurement. Public report reads remain free.

Deploy web before MCP. No production latency or vision-host acceptance is
implied by local deterministic tests.


### Research journey continuity (local, release required)

Deploy web `/api/v1/research/scope` before this MCP build. `resolve_scope` uses
recorded sector tags and the same resolver as the web move-first door, filtered
to confirmed Binance crypto linear perpetuals. It returns the exact roster and
per-market history; missing/ambiguous/thin/oversized populations stay blocked.
There is no automatic widening. Membership is current recorded classification,
not point-in-time membership, and history does not prove feature completeness.

`run_scan.measure` now adds `selected_outcome.v1` alongside canonical bytes,
including the exact selected full-population count, opposite direction and
unconditional reference. Zero counts remain visible, zero denominators have no
rate, and unavailable metrics or rungs are never substituted. The inline view
leads with that same reading; its secondary chart remains explicitly closing-
return exploration. Existing reports keep their fixed, stated overview.

Similarity is exploratory proximity on stated dimensions. Monitoring requires
exact satisfaction of a versioned supported predicate, not identical historical
numbers. A discovered threshold must be labelled proposed, frozen before a
separate-period evaluation, and any tuning disclosed. No similarity-to-alert
conversion, trading-rule evaluator or automated forward-test readiness verdict
is added. Saving and monitoring use the private web handoff and explicit
confirmation. An alert reports condition satisfaction, not a repeat prediction.
