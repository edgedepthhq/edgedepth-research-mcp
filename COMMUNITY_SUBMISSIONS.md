# Community index submissions (James submits; Claude prepared)

Ready-to-paste entries for the main MCP directories, to run AFTER the official
registry listing (see REGISTRY_LISTING.md). Most of these auto-ingest the
official registry once it lands; submit manually only where a form gets you a
curated listing sooner. House rule: no em-dashes.

## Canonical facts (copy from here, keep every listing identical)

| Field | Value |
| --- | --- |
| Name | EdgeDepth Research |
| Registry name | `com.edgedepth/research` |
| npm package | `@edgedepth/research-mcp` (0.4.0, MIT) |
| One-line install | `npx -y @edgedepth/research-mcp` |
| Remote (Streamable HTTP) | `https://mcp.edgedepth.com/mcp` |
| Repository | `https://github.com/edgedepthhq/edgedepth-research-mcp` |
| Docs | `https://app.edgedepth.com/research/api/mcp` |
| Get a key | `https://app.edgedepth.com/account#api-keys` |
| Homepage | `https://edgedepth.com` |
| Auth | Browser OAuth for hosted MCP; `EDGEDEPTH_API_KEY` only for stdio fallback |
| Transports | Remote streamable-http + local npx stdio |
| Tools (11, research-only) | list_features, list_instruments, interpret_prose, run_scan, next_page, snapshot_at, base_rate, commonality, get_report, run_cohort, run_stratified |
| Tags | crypto, tradfi, market-data, trading, perpetual-futures, research, finance, analytics, order-flow, reproducible |

Short description (one sentence, from server.json):

> Search recorded crypto and TradFi microstructure through deterministic, reproducible agent tools.

Long description (the honesty hook, reuse verbatim):

> An MCP server for the EdgeDepth Research API, an evidence engine over recorded crypto and TradFi-perpetual microstructure. Counts carry their denominators, outcomes are computed forward over all matches, every scan includes an unconditional same-scope reference when available, and replay handoffs open exact occurrences. No tool trades or writes account data. Fresh scans can consume allowance units; cached reruns are free.

## Preconditions

- [ ] npm `@edgedepth/research-mcp` published and `npx -y @edgedepth/research-mcp` starts (REGISTRY_LISTING.md step 1).
- [ ] `mcp.edgedepth.com` answers publicly (deploy phase C / RUNBOOK).
- [ ] Official registry listing live (REGISTRY_LISTING.md step 3) so directories can auto-ingest.

## 1. mcp.so

Auto-ingests the official registry in most cases. If submitting manually, use the
short description, the npm package, the repo, the remote URL, and the tags above.

## 2. Glama (glama.ai/mcp/servers)

Submit the repository (it reads the repo + npm). Fields:

- Repository: `https://github.com/edgedepthhq/edgedepth-research-mcp`
- npm: `@edgedepth/research-mcp`
- Description: the long description above.
- Tags: crypto, tradfi, market-data, trading, research, finance, analytics.
- Ownership: deploy `/.well-known/glama.json`, then confirm the remote health check passes.

## 3. PulseMCP (pulsemcp.com/submit)

Form fields:

- Name: EdgeDepth Research
- Tagline: Search recorded crypto and TradFi microstructure through deterministic, reproducible agent tools.
- Description: the long description above.
- Categories: Finance, Data, Research.
- npm: `@edgedepth/research-mcp`
- Source code: `https://github.com/edgedepthhq/edgedepth-research-mcp`
- Remote server URL: `https://mcp.edgedepth.com/mcp`
- Homepage / docs: `https://app.edgedepth.com/research/api/mcp`

## 4. Smithery (smithery.ai)

Smithery connects a Git repo and can host remotes. The canonical public repository is GitHub. Two options:

- Preferred: point Smithery at the remote (`https://mcp.edgedepth.com/mcp`) and
  the npm package; fill name + description + tags from the table.
- If Smithery requires repository authorization, connect
  `https://github.com/edgedepthhq/edgedepth-research-mcp`. Keep `server.json`
  and `package.json` `mcpName` identical.

## 5. Awesome MCP Servers (github.com/punkpeye/awesome-mcp-servers)

Open a PR adding one line under the "Finance & Fintech" section, alphabetized.
The list uses a legend: language icon + service scope. This server is TypeScript
(📇) and offers both a hosted remote (☁️) and a local stdio server (🏠):

```markdown
- [EdgeDepth Research](https://github.com/edgedepthhq/edgedepth-research-mcp) 📇 ☁️ 🏠 - Search recorded crypto and TradFi microstructure with deterministic agent tools: counts carry denominators, outcomes can never be filtered, and every result returns a reproducibility key.
```

PR title: `Add EdgeDepth Research (market microstructure search) to Finance & Fintech`.
Confirm the exact legend icons against the current README before opening the PR
(the maintainer adjusts them periodically).

## 6. Cursor MCP directory

Submit via Cursor when their listing form is open. Use the remote block from the
package README (`~/.cursor/mcp.json`), the short description, and the tags.

## 7. Anthropic connector directory

Submit when it opens to third-party remote MCP servers. The `remotes` entry
(streamable-http at `https://mcp.edgedepth.com/mcp`) is what they list.

## After submitting

- [ ] Record each listing URL back here as it goes live.
- [ ] On the next version bump, the official registry re-publish (REGISTRY_LISTING.md
      step 3) propagates to the auto-ingesting directories; only the manual
      listings (PulseMCP form, Awesome PR) may need a touch-up.
