# Agent 2.0 Complete Wiring Export - Quick Start Guide

## 🎯 What Is This?

The **"📥 Download Complete Wiring Report"** button exports a comprehensive JSON file that shows **exactly** what Agent 2.0 is configured to do, how it's wired into the runtime, and any configuration issues.

## 🚀 How to Use (30 Seconds)

1. **Click the button** (top right of Agent 2.0 page)
2. **File downloads** (`agent2-wiring-complete-{companyId}-{date}.json`)
3. **JSON also copied to clipboard** (for quick paste)
4. **Open the JSON** in your editor or JSON viewer

## 📋 What's Included?

### ✅ 100% Complete Configuration
- All Discovery settings (trigger cards, vocabulary, clarifiers, fallback)
- All Greetings settings (call start, interceptor rules)
- All style configuration (ackWord, bridge lines, delays, etc.)
- **Includes unsaved changes** from the UI

### ✅ Runtime Integration Status
- Which services are active (Agent2DiscoveryRunner, VocabularyEngine, etc.)
- How Agent 2.0 is wired into FrontDeskCoreRuntime
- API endpoints and cache invalidation
- Speaker ownership (who owns the mic)

### ✅ Validation & Health Checks
- **Critical Issues**: Blocking problems (must fix)
- **Warnings**: Non-blocking issues (should fix)
- **Recommendations**: Optimization suggestions
- Health check results for all systems

### ✅ Statistics & Insights
- Trigger card counts (total, enabled, with audio, etc.)
- Keyword/phrase statistics (total, unique)
- Vocabulary/clarifier counts
- Greeting configuration stats

## 🎨 Button Visual States

| Color | Meaning | Action |
|-------|---------|--------|
| **🔵 Blue** | Clean - reflects saved config | Export shows current saved state |
| **🟠 Orange** | Dirty - has unsaved changes | Export includes unsaved changes |

**Tooltip**: Hover over button for detailed description

## 🔍 Quick JSON Navigation

Open the downloaded JSON and check these sections:

```json
{
  "_README": {
    /* START HERE - explains entire structure */
  },
  
  "validation": {
    "criticalIssues": [],  /* ❌ Must fix these */
    "warnings": [],        /* ⚠️ Should fix these */
    "recommendations": []  /* 💡 Best practices */
  },
  
  "configuration": {
    "discovery": {
      /* All Discovery tab settings */
      "playbook": {
        "triggerCards": {
          "rules": [ /* All trigger cards */ ],
          "_stats": { /* Quick counts */ }
        }
      }
    },
    "greetings": {
      /* All Greetings tab settings */
    }
  },
  
  "runtimeIntegration": {
    "services": {
      /* Which services are active */
    }
  },
  
  "statistics": {
    /* Quick insights about your config */
  }
}
```

## ⚡ Common Use Cases

### 1. "Is Agent 2.0 actually running?"
```json
"runtimeIntegration": {
  "speakerOwnership": {
    "isAgent2Primary": true  // ✅ Yes, it's active
  }
}
```

### 2. "What trigger cards are enabled?"
```json
"statistics": {
  "discovery": {
    "triggerCards": {
      "enabled": 12  // 12 active cards
    }
  }
}
```

### 3. "Are there any config problems?"
```json
"validation": {
  "criticalIssues": ["..."],  // Check this first
  "warnings": ["..."]          // Then this
}
```

### 4. "What's the complete trigger card list?"
```json
"configuration": {
  "discovery": {
    "playbook": {
      "triggerCards": {
        "rules": [ /* Full list here */ ]
      }
    }
  }
}
```

## 🔄 Dynamic Updates

**Key Feature**: Export is **always current**!

- ✅ Captures unsaved changes
- ✅ Runs validation on export
- ✅ Calculates stats in real-time
- ✅ Shows current enable/disable status
- ✅ Timestamps every export

**No stale data. Ever.**

## ✅ 100% Verification

Use this checklist to verify completeness:

- [ ] All trigger cards visible in `configuration.discovery.playbook.triggerCards.rules`
- [ ] Greetings config in `configuration.greetings`
- [ ] Runtime services in `runtimeIntegration.services`
- [ ] Validation results in `validation.criticalIssues/warnings`
- [ ] Statistics in `statistics.discovery` and `statistics.greetings`
- [ ] Export timestamp in `metadata.exportedAt`

**If all checked**, you have 100% complete wiring visibility.

## 🎓 Pro Tips

1. **Export before major changes** - Create a baseline
2. **Compare exports** - Use JSON diff to see what changed
3. **Check validation first** - Fix issues before production
4. **Commit to git** - Track config changes over time
5. **Share with team** - Complete documentation in one file

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| Button not visible | Check you're on Agent 2.0 page, not other tabs |
| Download fails | JSON is still copied to clipboard |
| Old data in export | Navigate to changed tab to load UI state |
| Validation unexpected | Check `validation.checks` for details |

## 📚 Full Documentation

For complete technical details, see:
- `docs/AGENT2_COMPLETE_WIRING_EXPORT.md` - Full technical documentation
- `docs/RUNTIME_ARCHITECTURE.md` - Overall runtime wiring
- `AGENT2_V119_HARD_ISOLATION_SPEC.md` - Agent 2.0 architecture

## 🎉 Summary

**One Click = Complete Truth**

The export gives you:
- ✅ All configuration (all tabs)
- ✅ Runtime integration status
- ✅ Validation results
- ✅ Statistics and insights
- ✅ Always current (includes unsaved changes)

**If it's not in the export, it's not wired.**

---

**Questions?** Check the full documentation or search the JSON for keywords.
