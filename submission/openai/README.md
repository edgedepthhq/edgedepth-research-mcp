# OpenAI MCP-only plugin submission

This directory is the copy source and regression fixture for the OpenAI plugin portal. The portal remains the system of record after submission; do not put reviewer passwords or challenge tokens in this repository.

Official references:

- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/guides/optimize-metadata
- https://developers.openai.com/plugins/app-guidelines

## Release order

1. Check the currently hosted release and registry before deploying anything. On 2026-09-06, the production origin health and official MCP Registry both reported 0.6.2. The older 0.3.0 release instructions are obsolete; this submission-pack edit needs no server release.
2. Verify public `GET /healthz`, `GET /.well-known/glama.json`, and `GET /.well-known/oauth-protected-resource/mcp` on `mcp.edgedepth.com`. Confirm the OAuth connect flow from a fresh ordinary account, including consent and a successful tool result. Local tests and origin health alone do not prove this.
3. In the OpenAI Platform organization, confirm publisher identity verification and Apps Management write access. Start at https://platform.openai.com/plugins.
4. Create a submission with **With MCP**, URL type **Universal**, and `https://mcp.edgedepth.com/mcp`. MCP-only submissions do not require a custom UI.
5. When the portal issues its domain token, James puts that exact value in `OPENAI_APPS_CHALLENGE_TOKEN` on the MCP service, restarts it, and verifies the challenge URL returns only the token as plain text. Keep the token out of git.
6. Provide a dedicated ordinary reviewer account with email already verified, no inaccessible MFA, and enough genuine research allowance for all positive tests. Record credentials outside git. Do not use a staff account: it bypasses entitlement checks.
7. Select **Scan Tools** and review the current tool list (12 in 0.6.2). Run the starter prompts and all eight cases in `submission.json` through the connected client. P3 includes its complete confirmed document, P4 includes three recorded moments, and P5 uses report `fec86629`, whose production integrity status was verified on 2026-09-06. Missing data or zero matches must remain honest results.
8. Record the date, client, server version, result and any failure for each live case. The local submission test checks pack structure and current tool names; it is not evidence that portal tests passed.
9. Fill listing fields from `submission.json`, select supported countries and the closest available category, add release notes, and submit for review. Review approval and the later publish action are separate from MCP Registry publication.

### Remaining portal gates

Publisher identity/permissions, the issued domain challenge, the public ChatGPT connection and all eight client-behavior tests still require verification. A dedicated ordinary reviewer login has been provisioned separately. Do not label the plugin submitted, approved, or listed until the portal confirms each state. No credentials or domain token are included in this pack.

## Expected annotations

- Closed free reads: `readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=false`.
- `interpret_prose`: `readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=true` because it uses the configured external interpreter.
- Fresh metered computations (`run_scan`, `run_cohort`, `run_stratified`, `outcome_first`): `readOnlyHint=false`, `destructiveHint=true`, `openWorldHint=false`. They cannot alter market or account data, but a fresh call can consume a non-refundable allowance unit.

## OAuth note

The existing OAuth flow is sufficient for ordinary plugin authorization. It does not yet advertise OpenID/email scopes or a UserInfo endpoint, so OpenAI workspace-domain restrictions will not be available until that separate authorization-server capability is built. This is optional for the initial public submission and should be stated honestly if the portal asks.

## Local checks

```bash
npm run submission:check
npm test
npm run typecheck
npm run build
```

## Live service check, 2026-09-06

A dedicated ordinary Research account (role `user`, `internal-test` acquisition marker) passed password login, an actual live BTC scan (one match), dynamic OAuth client registration, consent/PKCE authorization-code exchange, and authenticated MCP discovery of all 12 tools on hosted 0.6.2. These requests reached production services through an SSH tunnel; they do not certify the public proxy or ChatGPT connector path.

All five positive tool calls returned HTTP 200 after correcting the fixture argument names against the real tool schemas. P1 and P2 returned non-executable clarification responses, preserving the missing date window and ambiguous setup terms. P3 returned one match and an unconditional reference; P4 returned recorded moments/commonality; P5 fetched verified report `fec86629`. These are tool-level checks, not model-routing or final-answer evaluations. The three negative prompts still need to be tested in ChatGPT, where the correct behavior is no EdgeDepth tool invocation.

Reviewer credentials are stored outside git, with Research access through 2026-12-05 and 299 allowance units remaining immediately after this check. Check allowance and expiry again before submission. No emails were sent by the fixture setup.
