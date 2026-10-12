# edgedepth-research-mcp: project instructions

Read `../todos-edgedepth/PRIORITIES.md` for shared engineering policy, goals,
task lifecycle, and production boundaries, then `../todos-edgedepth/TASKS.md`
and the matching task before project work.

Read `README.md` for tool semantics, auth, transports, and development checks.
Preserve research-only behavior, explicit metering, missing-data states, and
canonical evidence. Load web or backend context only for a contract crossing.

## Daily crossing condition (2026-10-02, local)

The registry-driven tools accept `feature.price_oi_ratio_cross_5m_v1` once the
research engine and web registry are released. No new tool or feature allowlist
is needed. Contract mirror and in-memory `list_features` protocol test are updated;
these are not production MCP reads. Historical Binance, five-minute closes,
00:05 UTC daily reference; no live monitoring. Record scans retain one-hour match
spacing, whereas prevalence counts raw crossing closes. See backend
`docs/RESEARCH_RATIO_CROSSINGS.md`. No re-extraction or +5% study is part of this work.

## Private Radar hypotheses (2026-10-02, local)

get_hypothesis / prepare_hypothesis / save_hypothesis / run_hypothesis share web's
account-owned private history. Admin pilot only. Optional research:hypotheses
permission is required for writes; read + interpret defaults remain unchanged.
Web and its optional key-scope enum migration precede MCP. Exact human-approved
four-request plans execute serially through returned continuations. Stop on
absence/refusal/unknown completion; reopening never retries. Preserve negative
attempts, missingness, native denominators, receipts and reserved-date boundaries.
No evaluation-period execution, alerts, trades, publication or deployed claim.
See README private workflow and web docs/RADAR_HYPOTHESES.md.


## Shared saved assessment (2026-10-03, local)

get_investigation_assessment reads the web-owned released assessment and exact
scope/evidence metadata. No model, compute, new publication or private draft access.
Preserve 409 edition-change and 410 correction refusals. Deploy web reader first.
Tests: investigation-assessment and tool schema; current release version is unchanged
until an authorized release. Owner: research-surface-usability.

## Private strategy studies (2026-10-11, local)

get/prepare/save/run/cancel_strategy expose web's private trade_query.v2 workflow.
Read + interpret defaults remain; saving/running/cancelling require optional
research:strategies and current Research entitlement. Exact human confirmation
precedes allowance reservation and background work. Reopening never runs.
See README's strategy section and web docs/RESEARCH_STRATEGIES.md. Backend then
web migration/application precede MCP. Current package version stays unchanged
until James authorizes release. Full 216-test suite passes locally.

## Edge questions lead with payoff (2026-10-12, local)

James: payoff is the centerpiece of any edge research. A scan answers how
often and how far price moved, never whether trading it paid. The server
instructions now open with an EDGE QUESTIONS rule (say so in the first
sentence, never imply an edge from rates, MFE/MAE or representatives,
propose run_trade_test with explicit rules, and when one has run lead with
expectancy after fees and slippage, win rate, wins/losses, average win and
loss with counts, plus the largest win's share of profit when a few wins
carry the total). run_scan's description says it measures frequency, not
payoff; the text answer carries an "Edge: not answered by this scan" line
before Limits. The scan widget opens with a computed verdict comparing both
directions with the reference ("Bigger moves either way, not a direction",
"Leans up", "Leans down", "No clear difference from usual", or "Too few
outcomes"), each ratio with its counts, and an always-visible "Is there an
edge?" box pointing to a trade test. Prompted by a 2026-10-12 claude.ai
recording where a newcomer could not read an answer from the charts. Tests:
scanChart (verdict cases), scanText and workflow (instructions). 221 tests,
typecheck and build pass. Package version unchanged; James releases.
