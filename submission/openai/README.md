# OpenAI MCP-only plugin submission

This directory is the copy source and regression fixture for the OpenAI plugin portal. The portal remains the system of record after submission; do not put reviewer passwords or challenge tokens in this repository.

Official references:

- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/guides/optimize-metadata
- https://developers.openai.com/plugins/app-guidelines

## Release order

1. Deploy the web API change first. Confirm `POST https://app.edgedepth.com/api/v1/research/baseline` reaches the new key-authenticated, free baseline route rather than 404.
2. Publish and deploy MCP version 0.3.0, keeping all four exact Nginx well-known locations in `deploy/nginx-mcp-oauth-locations.conf`.
3. Verify `GET /healthz`, `GET /.well-known/glama.json`, and `GET /.well-known/oauth-protected-resource/mcp` on `mcp.edgedepth.com`. Before the portal issues a token, verify `GET /.well-known/openai-apps-challenge` returns 404 rather than Nginx's dot-file 403.
4. In the OpenAI Platform organization, confirm the publisher identity is verified and the submitter has Apps Management write access.
5. Create a new submission with **With MCP**, URL type **Universal**, and `https://mcp.edgedepth.com/mcp`.
6. When the portal issues its domain token, put the exact value in `OPENAI_APPS_CHALLENGE_TOKEN` on the MCP service, restart it, and verify the challenge URL returns only that token as plain text.
7. Provide a dedicated reviewer account with no MFA and enough genuine research allowance for all positive tests. Keep the credentials outside git.
8. Select **Scan Tools**, review all eleven annotations and descriptions, then run the starter prompts and all eight cases in `submission.json`.
9. Fill listing fields from `submission.json`, choose the closest available category if Research is not offered, select supported countries, add release notes, and submit for review.

## Expected annotations

- Closed free reads: `readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=false`.
- `interpret_prose`: `readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=true` because it uses the configured external interpreter.
- Fresh metered computations (`run_scan`, `run_cohort`, `run_stratified`): `readOnlyHint=false`, `destructiveHint=true`, `openWorldHint=false`. They cannot alter market or account data, but a fresh call can consume a non-refundable allowance unit.

## OAuth note

The existing OAuth flow is sufficient for ordinary plugin authorization. It does not yet advertise OpenID/email scopes or a UserInfo endpoint, so OpenAI workspace-domain restrictions will not be available until that separate authorization-server capability is built. This is optional for the initial public submission and should be stated honestly if the portal asks.

## Local checks

```bash
npm run submission:check
npm test
npm run typecheck
npm run build
```
