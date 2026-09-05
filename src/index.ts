/**
 * Library entry (for tests + programmatic embedding). The runnable
 * entry points are dist/stdio.js (bin) and dist/http.js (systemd).
 */
export { createResearchMcpServer } from './server.js'
export {
  registerResearchTools,
  readingDocUrl,
  CONFIRM_GATE_CONTRACT,
  READING_DOC_HINT,
  type ToolContext,
} from './tools.js'
export { apiRequest, type ApiRequest, type ApiResponse } from './apiClient.js'
export { getRegistry, clearRegistryCache, type RegistryResult } from './registry.js'
export { SERVER_NAME, SERVER_VERSION, DEFAULT_API_BASE } from './version.js'
