/**
 * Server identity + defaults. Keep SERVER_VERSION in sync with
 * package.json "version" (a build could read it, but hardcoding keeps
 * the stdio bundle dependency-free). The drift is pinned by
 * test/tools.schema.test.ts, which fails locally before mcp-deploy.sh
 * can ship a release whose /healthz reports the wrong version.
 */
export const SERVER_NAME = 'edgedepth-research'
export const SERVER_VERSION = '0.2.6'

/**
 * The public REST base of the phase-A/B research API. The on-box HTTP
 * service overrides this with the localhost hop
 * (http://127.0.0.1:3002/api/v1/research) via EDGEDEPTH_API_BASE; note
 * 3002 is the app (3000 is Grafana, 3001 the market backend).
 */
export const DEFAULT_API_BASE = 'https://app.edgedepth.com/api/v1/research'
