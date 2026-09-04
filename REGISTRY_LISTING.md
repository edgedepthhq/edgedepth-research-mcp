# Registry listing checklist (James runs; Claude prepared)

Goal: list `@edgedepth/research-mcp` on the official MCP registry and the main community indexes so agent builders can find it. Nothing here is destructive; do the steps in order. House rule: no em-dashes.

User onboarding: every listing should link `https://edgedepth.com/account/mcp`. Hosted clients use a one-time browser OAuth approval and silent renewal. API keys are an advanced fallback for stdio or non-OAuth clients.

## 0. Decide the namespace (one choice, affects two files)

The registry name must match how you authenticate.

- Recommended: `com.edgedepth/research` (reverse-DNS). You control `edgedepth.com`, so DNS auth is clean and branded. This is what `server.json` and `package.json` `mcpName` already say.
- Fallback: `io.github.<your-github-username>/research` (GitHub auth). If you go this way, change BOTH `server.json` `name` and `package.json` `mcpName` to match, then re-run the npm publish.

The `name` in `server.json` and the `mcpName` in `package.json` MUST be identical, or the registry rejects the publish.

## 1. Publish the npm package first

The registry stores metadata only; the artifact lives on npm.

- [ ] Confirm `package.json`: `name` `@edgedepth/research-mcp`, `version` `0.4.0`, `mcpName` `com.edgedepth/research`, `bin`, and `files` (`dist`, `README.md`, `server.json`).
- [ ] `NODE_ENV=development npm ci --include=dev && npm run build && npm test` (gate: tsc + vitest green).
- [ ] `npm login` (npm account with rights to the `@edgedepth` scope; create the org/scope if new).
- [ ] `npm publish --access public` (scoped packages default to restricted; `--access public` is required).
- [ ] Verify: `https://www.npmjs.com/package/@edgedepth/research-mcp` shows 0.4.0, and `npx -y @edgedepth/research-mcp` starts (set `EDGEDEPTH_API_KEY` first).

Version bumps: publishing a new version means bump `version` in BOTH `package.json` and `server.json` (and the top-level and per-package `version`), then republish npm, then re-run the registry publish (step 3).

## 2. Prove domain ownership (DNS namespace only)

Skip if you chose the GitHub namespace.

- [ ] Install the CLI: `brew install mcp-publisher` (or grab the release binary from `github.com/modelcontextprotocol/registry/releases`).
- [ ] `mcp-publisher login dns --domain edgedepth.com` and follow the prompt: it prints a TXT record to add at your DNS (Cloudflare, zone edgedepth.com). Add it, wait for propagation, confirm.

## 3. Publish to the official MCP registry

- [ ] From the package root (where `server.json` lives): `mcp-publisher publish`.
- [ ] Verify:
  ```
  curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.edgedepth/research"
  ```
  You should see the server with both the `remotes` (streamable-http at `https://mcp.edgedepth.com/mcp`) and the `packages` (npm stdio) entries.

Preconditions the registry checks: the npm package carries `mcpName` matching the server name (ownership), the remote URL is publicly reachable (deploy phase C first, RUNBOOK), and the package registry is trusted (npm is).

Note on ordering: the `remotes` entry requires `mcp.edgedepth.com` to answer publicly. Deploy the remote service (deploy/RUNBOOK.md "Research MCP" section) BEFORE step 3, or temporarily publish packages-only and add `remotes` on the next version.

## 4. Community indexes (each is a separate, optional submission)

Most of these ingest the official registry automatically once step 3 lands; submit manually only where a form is offered and you want a curated listing sooner.

- [ ] mcp.so - submit at the site (or auto-ingested from the official registry).
- [ ] Glama MCP directory - `glama.ai/mcp/servers`, submit repo/npm.
- [ ] PulseMCP - `pulsemcp.com`, submit form.
- [ ] Smithery - `smithery.ai`, connect the GitLab/GitHub repo (Smithery can host remotes too).
- [ ] Awesome MCP Servers (the community GitHub list) - open a PR adding a one-line entry.
- [ ] Cursor MCP directory - submit via Cursor when their listing form is open.
- [ ] Anthropic connector directory - submit when it opens to third-party remote MCP servers (the `remotes` entry is what they list).

## 5. Post-listing smoke test (from a clean machine)

- [ ] Cursor: paste the `~/.cursor/mcp.json` remote block from the README; confirm `/mcp` shows the 11 tools and `list_features` returns the registry.
- [ ] Codex: `codex mcp add` or the `config.toml` block; `/mcp` lists tools.
- [ ] Claude Desktop: use the npm stdio block from the onboarding page; run `list_features`, then a small `run_scan`, and confirm the reproducibility key comes back.
- [ ] Local: `npx -y @edgedepth/research-mcp` with `EDGEDEPTH_API_KEY` set, from any stdio client.

## Files in this repo used by the above

- `server.json` - the registry manifest (name, remotes, packages). Edit here, not by hand at publish time.
- `package.json` - `mcpName` must equal `server.json` `name`.
- `README.md` - the config blocks users copy.
