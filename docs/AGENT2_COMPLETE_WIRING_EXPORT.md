# Agent 2.0 Complete Wiring Export - Technical Documentation

## 📋 Overview

The Agent 2.0 Complete Wiring Export is a comprehensive JSON report that captures **every aspect** of Agent 2.0's configuration, runtime integration, and operational status. This is the **single source of truth** for understanding exactly what Agent 2.0 will do when processing live calls.

## 🎯 Purpose

**WHY THIS EXISTS:**
- **Development Visibility**: Know exactly what's wired and how during active development
- **Configuration Truth**: Eliminate guesswork about what settings are actually active
- **Runtime Integration**: See how Agent 2.0 connects to all backend services
- **Validation**: Catch configuration issues before they cause problems in production
- **Documentation**: Auto-generated documentation of your Agent 2.0 setup
- **Debugging**: Complete snapshot for troubleshooting unexpected behavior

## 🚀 Features

### 1. **Dynamic & Real-Time**
- ✅ **Auto-captures unsaved changes** - Export reflects current UI state, not just saved config
- ✅ **Live validation** - Checks run every time you export
- ✅ **Change detection** - Visual indicator shows when config has changed
- ✅ **Timestamp tracking** - Every export is timestamped for version control

### 2. **Complete Coverage**

The export includes **ALL** Agent 2.0 configuration across **ALL** tabs:

#### Configuration Tab
- Discovery system enable/disable status
- Style configuration (ackWord, forbid phrases, bridge lines, system delay, robot challenge, when-in-doubt)
- **Vocabulary System** (V119+) - Hard normalize + soft hints
- **Clarifier System** (V119+) - Disambiguation questions
- Playbook configuration (scenario fallback, allowed types, min scores)
- Fallback responses (no match, when reason captured, clarifiers, after answer)
- **Trigger Cards** - Complete rules with keywords, phrases, negative keywords, answers, follow-ups, audio URLs, priorities

#### Greetings Tab
- Call start greeting (text + audio)
- Greeting interceptor configuration
- Intent word blocking
- Greeting rules (hi/hello/good morning/etc.)

#### Metadata
- UI build version
- Last updated timestamps
- Company ID

### 3. **Runtime Integration Map**

The export shows **exactly how** Agent 2.0 is wired into the live call processing runtime:

#### Speaker Ownership
- Primary discovery speaker: `Agent2DiscoveryRunner` vs `DiscoveryFlowRunner (legacy)`
- Greeting speaker: `Agent2GreetingInterceptor` vs `GreetingInterceptor (legacy)`
- Is Agent 2.0 primary? (one mic architecture)

#### Service Layer Wiring
Each service shows:
- **Active/Inactive status**
- **File path** in codebase
- **Purpose** (what it does)
- **Configuration count** (triggers, entries, rules)

Services tracked:
1. `Agent2DiscoveryRunner` - Main discovery orchestrator
2. `Agent2GreetingInterceptor` - Greeting handler
3. `Agent2VocabularyEngine` - STT normalization + hints
4. `TriggerCardMatcher` - Keyword/phrase matching
5. `ScenarioEngine` - Fallback to global scenarios

#### Core Runtime Integration
- Shows position in `FrontDeskCoreRuntime.js` execution flow
- Complete execution order (S1 → S7)
- Agent 2.0's position: GREET + S4
- One mic architecture explanation

#### API Endpoints
- Configuration GET/PATCH endpoints
- GPT prefill endpoint (AI-powered trigger card generation)
- Greeting seed endpoint (import legacy rules)
- Call Review endpoints (call list + events)

#### Cache Invalidation
- Redis cache invalidation on save
- Cache key patterns
- Immediate config pickup by Twilio

### 4. **Validation & Health Checks**

Automated validation runs on every export:

#### Critical Issues (Block Production)
- Agent 2.0 enabled but Discovery disabled
- Missing essential configuration

#### Warnings (Should Fix)
- No trigger cards configured
- Empty call start greeting
- Trigger cards with no keywords/phrases
- Trigger cards with no answer text/audio
- Scenario fallback enabled but no types allowed

#### Recommendations (Best Practices)
- Enable Vocabulary System for STT normalization
- Enable Clarifiers for disambiguation
- Add audio files to trigger cards
- General optimization suggestions

### 5. **Statistics & Insights**

Comprehensive statistics about your configuration:

#### Discovery Stats
- Trigger card counts (total, enabled, disabled, with audio, with follow-ups)
- Keyword stats (total, unique)
- Phrase stats (total, unique)
- Vocabulary stats (total, hard normalize, soft hints)
- Clarifier stats (total, enabled)

#### Greetings Stats
- Interceptor rule count
- Intent word count
- Call start configuration status

## 📥 How to Use

### Accessing the Export

1. Navigate to **Agent 2.0** in the Control Plane
2. Click **"📥 Download Complete Wiring Report"** button (top right)
3. The report will:
   - Download as a JSON file: `agent2-wiring-complete-{companyId}-{date}.json`
   - Copy to clipboard for immediate use
   - Include any unsaved changes from the UI

### Button Visual States

- **Blue** (#1f6feb): Clean state - export reflects saved configuration
- **Orange** (#f59e0b): Dirty state - export will include unsaved changes
- **Tooltip**: Hover to see detailed description

### Reading the Export

The JSON is organized into clear sections:

```json
{
  "_README": {
    "title": "Agent 2.0 Complete Wiring Report",
    "description": "This is the TRUTH of how Agent 2.0 is configured...",
    "sections": { ... },
    "lastExported": "2026-02-20T..."
  },
  "metadata": { ... },
  "configuration": { ... },
  "runtimeIntegration": { ... },
  "validation": { ... },
  "statistics": { ... }
}
```

## 🔧 Technical Implementation

### File Locations

**Frontend:**
- Main Manager: `public/js/ai-agent-settings/Agent2Manager.js`
  - Method: `_generateComprehensiveWiringReport()`
  - Export handler: Line ~2503

**Backend:**
- API Routes: `routes/admin/agent2.js`
- Model: `models/v2Company.js` (schema: `aiAgentSettings.agent2`)
- Services:
  - `services/engine/agent2/Agent2DiscoveryRunner.js`
  - `services/engine/agent2/Agent2GreetingInterceptor.js`
  - `services/engine/agent2/Agent2VocabularyEngine.js`
  - `services/engine/agent2/TriggerCardMatcher.js`

### How It Works

1. **User clicks export button** → Event handler triggered
2. **`_readFormIntoConfig()`** → Captures current UI state (including unsaved changes)
3. **`_generateComprehensiveWiringReport()`** → Builds complete report:
   - Section 1: Configuration snapshot (all tabs)
   - Section 2: Runtime integration status
   - Section 3: Validation & health checks
   - Section 4: Statistics & insights
   - Section 5: Export metadata
4. **JSON serialization** → Pretty-printed with 2-space indent
5. **Download + Clipboard** → File download AND clipboard copy for convenience

### Dynamic Updates

The export is **always current** because:
- Reads directly from UI form state (not just saved config)
- Validation runs on-demand at export time
- Statistics calculated dynamically from current rules/entries
- Runtime integration status reflects current enable/disable flags
- Timestamp shows exact export moment

## ✅ Verification Checklist

Use this checklist to verify 100% completeness:

### Configuration Coverage
- [ ] Discovery enabled/disabled status
- [ ] All style settings (ackWord, forbid, bridge, delays, challenges)
- [ ] All vocabulary entries with types and match modes
- [ ] All clarifier entries with hint triggers
- [ ] Playbook version and scenario fallback settings
- [ ] All fallback response texts
- [ ] All trigger cards with full match/answer/followUp data
- [ ] Greetings call start (text + audio)
- [ ] Greetings interceptor rules and intent words

### Runtime Integration Coverage
- [ ] Speaker ownership (Agent2 vs legacy)
- [ ] All 5 service layers with active status
- [ ] Core runtime execution order
- [ ] All API endpoints listed
- [ ] Cache invalidation mechanism documented

### Validation Coverage
- [ ] Critical issues detection
- [ ] Warnings for incomplete config
- [ ] Recommendations for optimization
- [ ] Health check results

### Statistics Coverage
- [ ] Trigger card counts and breakdowns
- [ ] Keyword/phrase statistics
- [ ] Vocabulary/clarifier stats
- [ ] Greeting stats

### Metadata Coverage
- [ ] Export timestamp
- [ ] UI build version
- [ ] Company ID
- [ ] Dirty state flag
- [ ] Active tab

## 🎓 Use Cases

### 1. Development Workflow
**Scenario**: Building new trigger cards
- Export before changes (baseline)
- Make changes in UI
- Export again (with unsaved changes)
- Compare JSON to verify changes
- Commit both config and export to version control

### 2. Production Debugging
**Scenario**: Agent not responding as expected
- Export current config
- Check validation section for issues
- Verify runtime integration status
- Check if Agent 2.0 is actually enabled
- Validate trigger card keywords match caller input

### 3. Configuration Audit
**Scenario**: Review what's actually wired
- Export full report
- Check statistics for coverage gaps
- Review validation warnings
- Follow recommendations for improvements

### 4. Handoff Documentation
**Scenario**: Transferring knowledge to team member
- Export complete wiring report
- Share JSON file
- New team member can see entire configuration
- No need to click through every tab

### 5. Version Control
**Scenario**: Track configuration changes over time
- Export after every significant change
- Commit to git alongside code
- Diff JSON files to see what changed
- Rollback if needed

## 🔍 Troubleshooting

### Export button not working?
- Check browser console for errors
- Verify you're on the Agent 2.0 page
- Try refreshing the page

### JSON file not downloading?
- Check browser download settings
- Verify popup blocker isn't interfering
- JSON will still be copied to clipboard as fallback

### Export shows old data?
- Make sure you've navigated to the tab with the changes
- The export captures current UI state, not just saved data
- Try clicking in a field to ensure UI is fully loaded

### Validation showing unexpected issues?
- Review the validation.checks section for details
- Each check has a true/false value
- Critical issues are blocking problems
- Warnings are non-blocking but recommended to fix

## 📊 Export Schema Reference

### Top-Level Structure
```json
{
  "_README": { /* Documentation */ },
  "metadata": { /* Export metadata */ },
  "configuration": { /* All tabs config */ },
  "runtimeIntegration": { /* Service wiring */ },
  "validation": { /* Health checks */ },
  "statistics": { /* Stats and insights */ }
}
```

### Configuration Structure
```json
{
  "enabled": boolean,
  "discovery": {
    "enabled": boolean,
    "style": { /* ackWord, forbid, bridge, delays, etc */ },
    "vocabulary": { /* entries, stats */ },
    "clarifiers": { /* entries, stats */ },
    "playbook": {
      "version": string,
      "useScenarioFallback": boolean,
      "allowedScenarioTypes": string[],
      "minScenarioScore": number,
      "fallback": { /* noMatchAnswer, etc */ },
      "triggerCards": {
        "rules": [ /* Full trigger card objects */ ],
        "_stats": { /* Counts and breakdowns */ }
      }
    }
  },
  "greetings": {
    "callStart": { /* text, audioUrl, flags */ },
    "interceptor": { /* rules, intentWords, stats */ }
  }
}
```

### Runtime Integration Structure
```json
{
  "speakerOwnership": { /* Who owns the mic */ },
  "services": {
    "Agent2DiscoveryRunner": { /* active, file, purpose, count */ },
    /* ... other services ... */
  },
  "coreRuntimeIntegration": { /* Flow position, execution order */ },
  "apiEndpoints": { /* All API routes */ },
  "cacheInvalidation": { /* Cache mechanism */ }
}
```

### Validation Structure
```json
{
  "criticalIssues": string[],
  "warnings": string[],
  "recommendations": string[],
  "checks": {
    "agent2Enabled": boolean,
    "discoveryEnabled": boolean,
    /* ... all health checks ... */
  }
}
```

## 🚦 Best Practices

1. **Export Early, Export Often**
   - Export before major config changes
   - Export after major config changes
   - Export before deploying to production

2. **Version Control Integration**
   - Commit exports alongside code changes
   - Use meaningful file names (include date/version)
   - Track in git for change history

3. **Review Validation Section**
   - Always check for critical issues before production
   - Address warnings when possible
   - Consider recommendations for optimization

4. **Use for Documentation**
   - Share exports with team members
   - Include in project documentation
   - Attach to support tickets when debugging

5. **Compare Exports**
   - Use JSON diff tools to compare versions
   - Identify configuration drift
   - Verify intentional vs accidental changes

## 🔐 Security Notes

- Export contains **full configuration** including text responses
- Does **NOT** include sensitive data like API keys
- Safe to commit to version control
- Safe to share with team members
- Contains company ID but no customer PII

## 📈 Future Enhancements

Potential future additions:
- Call volume statistics per trigger card
- Performance metrics (match rate, latency)
- A/B testing configuration
- Historical comparison (diff from last export)
- Import/restore from export file
- Export scheduling (auto-export on save)

## 🎉 Conclusion

The Agent 2.0 Complete Wiring Export is your **single source of truth** for understanding Agent 2.0 configuration and runtime integration. Use it during development, debugging, auditing, and documentation to ensure you have complete visibility into your AI agent's behavior.

**Key Takeaway**: If it's not in the export, it's not wired. If it's in the export, it's the truth.

---

**Last Updated**: February 20, 2026  
**Version**: 1.0.0  
**Related Docs**: 
- `docs/RUNTIME_ARCHITECTURE.md` - Overall runtime wiring
- `AGENT2_V119_HARD_ISOLATION_SPEC.md` - Agent 2.0 architecture
- `routes/admin/agent2.js` - API implementation
