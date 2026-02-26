const {
  AGENT2_STORAGE_NAMESPACE,
  AGENT2_DISPLAY_NAMESPACE,
  toDisplayConfigPath,
  toLookupCandidates
} = require('../public/agent-console/lib/agent2PathNamespace');

describe('agent2PathNamespace', () => {
  test('exports canonical namespace constants', () => {
    expect(AGENT2_STORAGE_NAMESPACE).toBe('aiAgentSettings.agent2');
    expect(AGENT2_DISPLAY_NAMESPACE).toBe('agent2');
  });

  test('normalizes canonical storage paths for display', () => {
    expect(toDisplayConfigPath('aiAgentSettings.agent2.bridge.lines')).toBe('agent2.bridge.lines');
    expect(toDisplayConfigPath('aiAgentSettings.agent2')).toBe('agent2');
  });

  test('keeps non-agent2 paths unchanged', () => {
    expect(toDisplayConfigPath('aiAgentSettings.connectionMessages.connected')).toBe(
      'aiAgentSettings.connectionMessages.connected'
    );
    expect(toDisplayConfigPath('greetings.callStart')).toBe('greetings.callStart');
  });

  test('returns canonical and display candidates for lookup', () => {
    expect(toLookupCandidates('aiAgentSettings.agent2.discovery.playbook.fallback.noMatchAnswer')).toEqual([
      'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchAnswer',
      'agent2.discovery.playbook.fallback.noMatchAnswer'
    ]);
  });
});
