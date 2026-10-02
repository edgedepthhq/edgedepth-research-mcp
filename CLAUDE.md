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
