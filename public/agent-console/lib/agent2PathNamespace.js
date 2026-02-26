/**
 * Agent2 path namespace policy:
 * - Storage schema remains under aiAgentSettings.agent2 (canonical DB contract)
 * - UI display can use agent2.* for cleaner operator-facing telemetry
 */
(function attachAgent2PathNamespace(globalScope) {
  'use strict';

  const AGENT2_STORAGE_NAMESPACE = 'aiAgentSettings.agent2';
  const AGENT2_DISPLAY_NAMESPACE = 'agent2';

  function toDisplayConfigPath(path) {
    if (typeof path !== 'string' || !path.length) return path;
    if (path === AGENT2_STORAGE_NAMESPACE) return AGENT2_DISPLAY_NAMESPACE;
    if (path.startsWith(`${AGENT2_STORAGE_NAMESPACE}.`)) {
      return path.replace(AGENT2_STORAGE_NAMESPACE, AGENT2_DISPLAY_NAMESPACE);
    }
    return path;
  }

  function toLookupCandidates(path) {
    if (typeof path !== 'string' || !path.length) return [];
    const normalized = toDisplayConfigPath(path);
    if (normalized === path) return [path];
    return [path, normalized];
  }

  const api = {
    AGENT2_STORAGE_NAMESPACE,
    AGENT2_DISPLAY_NAMESPACE,
    toDisplayConfigPath,
    toLookupCandidates
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.Agent2PathNamespace = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
