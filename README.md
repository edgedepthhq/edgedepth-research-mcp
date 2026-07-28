# @edgedepth/research-mcp

The MCP interface to EdgeDepth, a search engine for recorded crypto and TradFi microstructure across Binance USDT-M perpetuals. Ask from Claude, Cursor, Codex, or any MCP client; get deterministic counts, forward outcome distributions, cohort comparisons, and replay-linked evidence. Same query, same bytes.

One tool core, two transports:

- **Remote (recommended):** Streamable HTTP at `https://mcp.edgedepth.com/mcp`, with browser OAuth.
- **Local:** an npx stdio shim, `npx @edgedepth/research-mcp`.

The hosted server validates opaque OAuth access tokens, exchanges them for separate 60-second internal assertions, and never passes OAuth tokens to the REST API. Access tokens last about 15 minutes; compatible clients silently rotate a refresh token with a sliding 90-day inactivity window. Active users stay signed in without managing credentials. Its grammar comes from the live registry and is ETag-revalidated, so newly added feature ids do not require hard-coded tool-schema changes.

## Connect

Add `https://mcp.edgedepth.com/mcp` to your client. The client opens EdgeDepth once in your browser. Sign in with Google, Discord, or email and click **Authorize**. The connection then renews silently and appears under [Connected Apps](https://edgedepth.com/account/mcp), where it can be revoked immediately.

API keys remain available on the Developer page for scripts, the stdio package, and clients that do not implement MCP OAuth.

## Install

### Claude (Desktop)

In Settings > Connectors > Add custom connector, enter `https://mcp.edgedepth.com/mcp`, then complete the EdgeDepth browser prompt.

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

Then run `codex mcp login edgedepth`. Remove any old `bearer_token_env_var` line first.

### Local (npx stdio)

```json
{
  "mcpServers": {
    "edgedepth-research": {
      "command": "npx",
      "args": ["-y", "@edgedepth/research-mcp"],
      "env": { "EDGEDEPTH_API_KEY": "edk_live_YOUR_KEY" }
    }
  }
}
```

## Environment

| Variable | Used by | Default |
| --- | --- | --- |
| `EDGEDEPTH_API_KEY` | stdio fallback | (none; required for stdio tool calls) |
| `EDGEDEPTH_API_BASE` | both | `https://app.edgedepth.com/api/v1/research` |
| `EDGEDEPTH_OAUTH_EXCHANGE_URL` | remote | `http://127.0.0.1:3002/api/mcp/oauth/exchange` |
| `MCP_INTERNAL_SECRET` | remote | (none; required, must match the web app) |
| `PORT`, `HOST` | remote (http) | `3003`, `127.0.0.1` |

## Tools (read-only v1)

| Tool | What it does |
| --- | --- |
| `list_features` | The closed grammar registry. Call it first; do not invent field names. |
| `list_instruments` | Universe + coverage. Default = a compact summary; `symbols: [...]` for specific full records; `full: true` for the verbatim (~360 KB) canonical bytes. |
| `interpret_prose` | Prose to a PROPOSED document (never executed here). Optional `time_zone` is an IANA calendar-planning default; omission means UTC. Needs `research:interpret`. |
| `run_scan` | Execute a research_query.v2 document; canonical bytes with the reproducibility key. |
| `next_page` | Cursor continuation of a prior `run_scan`. |
| `snapshot_at` | The registry as-of a moment (feature values, window aggregates, fired rules). |
| `base_rate` | One-clause count over a window: matches / eligible, with denominators. |
| `commonality` | Deterministic intersection across N moments, with the honesty framing in the output. |
| `get_report` | A published report by its 8-hex canonical hash. |
| `run_cohort` | Compare what followed every match with what followed every other eligible bucket. |

Errors pass through verbatim: validation as `422 {errors:[{code,message}]}` with the frozen contract codes, transport as the `{error,code}` envelope. The codes are machine-actionable: read the code, call `list_features`, repair the document.

`interpret_prose` passes `time_zone` unchanged to the public planning API and does no date math. The API returns the versioned time-zone resolution receipt. Deterministic tools (`run_scan`, `run_cohort`, `base_rate`) remain exact-document, UTC-only tools and never reinterpret calendar language.

0.2.2 also repairs client serialization drift deterministically (`base_rate` values sent as `"0.8"` become `0.8`; string-encoded JSON arrays become arrays; enum labels pass through untouched) and right-sizes `list_instruments` for agent contexts (summary by default, `symbols` filter, `full: true` for the canonical bytes). Query and snapshot byte contracts are untouched.

0.2.3 makes `list_instruments` ETags projection-scoped: the raw API ETag names the FULL canonical bytes only, so the summary and `symbols` projections now return a tagged ETag (`W/"...+summary"`, `W/"...+symbols:<hash>"`). Passing an ETag from one mode against another never answers 304, so "identical result" only ever refers to the representation the caller actually holds. Revalidating a projection with its own tagged ETag still answers a free 304.

## Develop

```bash
npm install
npm run build      # tsc to dist/
npm test           # vitest
npm run typecheck
```

Example nginx locations, systemd hardening, and environment values are under `deploy/`. Production deployment remains an operator action.

## License

MIT
