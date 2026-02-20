# Agent 2.0 Complete Wiring Export - Testing Checklist

## 🎯 Purpose

This checklist helps you verify that the Agent 2.0 Complete Wiring Export is working **100% correctly**.

Use this to confirm every feature is functioning as designed.

---

## ✅ Pre-Flight Checks

Before testing, verify:

- [ ] You have access to the Control Plane UI
- [ ] You can navigate to the Agent 2.0 page
- [ ] You have a company with Agent 2.0 configuration
- [ ] Your browser allows file downloads
- [ ] You have a JSON viewer or text editor ready

---

## 📋 Test Suite

### Test 1: Basic Export Functionality

**What to test**: Export button works and downloads a file

**Steps**:
1. Navigate to Agent 2.0 page in Control Plane
2. Locate the "📥 Download Complete Wiring Report" button (top right)
3. Click the button
4. Wait for download

**Expected Results**:
- [ ] File downloads successfully
- [ ] Filename format: `agent2-wiring-complete-{companyId}-{YYYY-MM-DD}.json`
- [ ] File size is reasonable (5-100 KB depending on config)
- [ ] Alert appears: "✅ Complete Agent 2.0 wiring report downloaded and copied to clipboard!"
- [ ] JSON is also copied to clipboard (test by pasting)

**Pass/Fail**: ___________

---

### Test 2: JSON Structure Validation

**What to test**: Downloaded JSON has correct structure

**Steps**:
1. Download the export (Test 1)
2. Open the JSON file in your editor
3. Check for top-level sections

**Expected Results**:
- [ ] JSON is valid (no syntax errors)
- [ ] JSON is pretty-printed (2-space indentation)
- [ ] Has `_README` section with title and description
- [ ] Has `metadata` section with exportedAt, companyId, etc.
- [ ] Has `configuration` section with discovery and greetings
- [ ] Has `runtimeIntegration` section with services and flow
- [ ] Has `validation` section with criticalIssues, warnings, recommendations
- [ ] Has `statistics` section with discovery and greetings stats

**Pass/Fail**: ___________

---

### Test 3: Configuration Completeness

**What to test**: All configuration from all tabs is captured

**Steps**:
1. In Agent 2.0 UI, navigate to Configuration tab
2. Note the number of trigger cards (e.g., 5 cards)
3. Note one trigger card's label (e.g., "Service call pricing")
4. Switch to Greetings tab
5. Note the call start greeting text
6. Click export button
7. Open downloaded JSON
8. Navigate to `configuration.discovery.playbook.triggerCards.rules`
9. Count the rules array
10. Search for the trigger card label you noted
11. Navigate to `configuration.greetings.callStart.text`
12. Verify the greeting text matches

**Expected Results**:
- [ ] Trigger card count in JSON matches UI count
- [ ] Specific trigger card found in JSON with exact label
- [ ] Greeting text in JSON matches UI text
- [ ] All trigger card fields present (id, enabled, priority, label, match, answer, followUp)
- [ ] Greetings interceptor rules present
- [ ] Style settings present (ackWord, forbidPhrases, bridge, etc.)

**Pass/Fail**: ___________

---

### Test 4: Unsaved Changes Detection

**What to test**: Export captures unsaved changes dynamically

**Steps**:
1. Navigate to Agent 2.0 Configuration tab
2. Observe export button is **BLUE** (clean state)
3. Edit the ackWord field (e.g., change "Ok." to "Okay.")
4. **DO NOT CLICK SAVE**
5. Observe export button turns **ORANGE** (dirty state)
6. Hover over button and read tooltip
7. Click export button
8. Open downloaded JSON
9. Navigate to `configuration.discovery.style.ackWord`
10. Check the value
11. Navigate to `metadata.isDirty`

**Expected Results**:
- [ ] Button starts BLUE
- [ ] Button turns ORANGE after edit
- [ ] Tooltip mentions "unsaved changes"
- [ ] JSON has `ackWord: "Okay."` (your edit)
- [ ] JSON has `isDirty: true`
- [ ] Export captured unsaved change ✅

**Pass/Fail**: ___________

---

### Test 5: Runtime Integration Mapping

**What to test**: Runtime integration section shows correct wiring

**Steps**:
1. In Agent 2.0 UI, verify Agent 2.0 is **enabled**
2. Verify Discovery is **enabled**
3. Click export button
4. Open downloaded JSON
5. Navigate to `runtimeIntegration.speakerOwnership`
6. Check `isAgent2Primary`
7. Navigate to `runtimeIntegration.services.Agent2DiscoveryRunner`
8. Check `active` status
9. Navigate to `runtimeIntegration.services.Agent2GreetingInterceptor`
10. Check `active` status
11. Navigate to `runtimeIntegration.coreRuntimeIntegration.executionOrder`

**Expected Results**:
- [ ] `isAgent2Primary` is `true`
- [ ] `Agent2DiscoveryRunner.active` is `true`
- [ ] `Agent2DiscoveryRunner.file` is "services/engine/agent2/Agent2DiscoveryRunner.js"
- [ ] `Agent2GreetingInterceptor.active` matches greetings.interceptor.enabled
- [ ] All 5 services listed (Agent2DiscoveryRunner, Agent2GreetingInterceptor, Agent2VocabularyEngine, TriggerCardMatcher, ScenarioEngine)
- [ ] `executionOrder` array has 9+ stages
- [ ] API endpoints section has 4 endpoint groups

**Pass/Fail**: ___________

---

### Test 6: Validation System

**What to test**: Validation detects configuration issues

**Steps**:
1. In Agent 2.0 UI, **disable Discovery** (keep Agent 2.0 enabled)
2. Click export button
3. Open downloaded JSON
4. Navigate to `validation.criticalIssues`
5. Check for critical issue message
6. Navigate to `validation.checks.discoveryEnabled`
7. Re-enable Discovery in UI
8. Export again
9. Check `validation.criticalIssues` again

**Expected Results**:
- [ ] With Discovery disabled: `criticalIssues` has entry about Discovery disabled
- [ ] With Discovery disabled: `checks.discoveryEnabled` is `false`
- [ ] With Discovery re-enabled: `criticalIssues` is empty
- [ ] With Discovery re-enabled: `checks.discoveryEnabled` is `true`
- [ ] Validation is dynamic (changes with config) ✅

**Pass/Fail**: ___________

---

### Test 7: Statistics Accuracy

**What to test**: Statistics match actual configuration

**Steps**:
1. In Agent 2.0 UI, navigate to Configuration tab
2. Manually count enabled trigger cards (check each card's enabled checkbox)
3. Note your count: ___________
4. Manually count trigger cards with audio URLs (check each card)
5. Note your count: ___________
6. Click export button
7. Open downloaded JSON
8. Navigate to `statistics.discovery.triggerCards.enabled`
9. Compare to your manual count
10. Navigate to `statistics.discovery.triggerCards.withAudio`
11. Compare to your manual count

**Expected Results**:
- [ ] `statistics.discovery.triggerCards.total` matches total card count
- [ ] `statistics.discovery.triggerCards.enabled` matches your manual count
- [ ] `statistics.discovery.triggerCards.disabled` = total - enabled
- [ ] `statistics.discovery.triggerCards.withAudio` matches your manual count
- [ ] All statistics are accurate ✅

**Pass/Fail**: ___________

---

### Test 8: All Sub-Tabs Captured

**What to test**: All tabs contribute to the export

**Steps**:
1. Navigate to Configuration tab
2. Add a new trigger card with label "Test Card 123"
3. Navigate to Greetings tab
4. Edit call start greeting to "Test Greeting 456"
5. Navigate back to Configuration tab
6. Click export button (from Configuration tab)
7. Open downloaded JSON
8. Search for "Test Card 123"
9. Search for "Test Greeting 456"

**Expected Results**:
- [ ] "Test Card 123" found in `configuration.discovery.playbook.triggerCards.rules`
- [ ] "Test Greeting 456" found in `configuration.greetings.callStart.text`
- [ ] Both tabs captured despite being on Configuration tab when exporting ✅
- [ ] Call Review tab metadata present (activeTab field)

**Pass/Fail**: ___________

---

### Test 9: Export Metadata

**What to test**: Export metadata is complete and accurate

**Steps**:
1. Click export button
2. Open downloaded JSON
3. Navigate to `metadata` section
4. Check all fields

**Expected Results**:
- [ ] `exportedAt` is a valid ISO timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)
- [ ] `exportedAt` is recent (within last few minutes)
- [ ] `exportVersion` is "1.0.0"
- [ ] `uiBuild` is "AGENT2_UI_V0.9" (or current version)
- [ ] `companyId` matches your company ID
- [ ] `isDirty` matches button state (true if orange, false if blue)
- [ ] `activeTab` shows current tab ("config", "greetings", or "callReview")
- [ ] `_description` field explains the export

**Pass/Fail**: ___________

---

### Test 10: Button Visual States

**What to test**: Button changes color based on dirty state

**Steps**:
1. Navigate to Agent 2.0 page
2. If dirty (orange), click Save to make clean
3. Observe button is **BLUE** (#1f6feb)
4. Edit any field (e.g., ackWord)
5. Observe button turns **ORANGE** (#f59e0b)
6. Hover over button and read tooltip
7. Click Save
8. Observe button turns **BLUE** again

**Expected Results**:
- [ ] Button starts blue (clean state)
- [ ] Button turns orange immediately after edit (dirty state)
- [ ] Tooltip changes based on state
- [ ] Clean tooltip: "Download complete Agent 2.0 wiring report..."
- [ ] Dirty tooltip: "Configuration has unsaved changes - export will include current state"
- [ ] Button returns to blue after save
- [ ] Visual state always matches dirty flag ✅

**Pass/Fail**: ___________

---

### Test 11: File Naming Convention

**What to test**: Downloaded filename is descriptive and unique

**Steps**:
1. Note today's date: ___________
2. Note your company ID: ___________
3. Click export button
4. Check downloaded filename

**Expected Results**:
- [ ] Filename matches pattern: `agent2-wiring-complete-{companyId}-{YYYY-MM-DD}.json`
- [ ] Company ID in filename matches your company ID
- [ ] Date in filename matches today's date
- [ ] Filename is URL-safe (no spaces or special chars)
- [ ] Exporting twice on same day creates same filename (overwrites previous)

**Pass/Fail**: ___________

---

### Test 12: Clipboard Integration

**What to test**: JSON is copied to clipboard in addition to download

**Steps**:
1. Click export button
2. Wait for download to complete
3. Open a text editor or JSON viewer
4. Paste (Ctrl+V or Cmd+V)

**Expected Results**:
- [ ] Clipboard contains valid JSON
- [ ] Clipboard JSON matches downloaded file content
- [ ] Clipboard JSON is pretty-printed (readable)
- [ ] User can paste immediately without opening file

**Pass/Fail**: ___________

---

### Test 13: Error Handling

**What to test**: Export handles errors gracefully

**Steps**:
1. Open browser console (F12)
2. Click export button
3. Check console for errors
4. Simulate error: Temporarily disable navigator.clipboard (via console: `navigator.clipboard = null`)
5. Click export button again
6. Observe behavior

**Expected Results**:
- [ ] No errors in console during normal export
- [ ] If clipboard fails, file still downloads
- [ ] Error alert shows helpful message (not just "undefined")
- [ ] Console.error logs detailed error for debugging
- [ ] Export is robust to failures ✅

**Pass/Fail**: ___________

---

### Test 14: Validation Warnings

**What to test**: Warnings are shown for non-critical issues

**Steps**:
1. In Agent 2.0 UI, delete all trigger cards
2. Click export button
3. Open downloaded JSON
4. Navigate to `validation.warnings`
5. Check for warning about no trigger cards
6. Add a trigger card back
7. Export again
8. Check `validation.warnings` again

**Expected Results**:
- [ ] With no cards: Warning "No trigger cards configured - agent will only use fallback responses"
- [ ] Warning is in `warnings` array (not `criticalIssues`)
- [ ] After adding card: Warning disappears
- [ ] Warnings are helpful and actionable

**Pass/Fail**: ___________

---

### Test 15: Recommendations

**What to test**: Recommendations are shown for best practices

**Steps**:
1. In Agent 2.0 UI, disable Vocabulary System
2. Click export button
3. Open downloaded JSON
4. Navigate to `validation.recommendations`
5. Look for vocabulary recommendation
6. Enable Vocabulary System
7. Export again
8. Check recommendations again

**Expected Results**:
- [ ] With vocabulary disabled: Recommendation to enable it
- [ ] Recommendation explains benefit (normalize STT mishears)
- [ ] After enabling: Recommendation disappears or changes
- [ ] Recommendations are constructive and helpful

**Pass/Fail**: ___________

---

## 📊 Final Verification

### Overall Results

Count your passes and fails:

- Tests Passed: _____ / 15
- Tests Failed: _____ / 15
- Pass Rate: _____ %

### 100% Verification Criteria

To verify **100% completeness**, all of these must be true:

- [ ] **14+ tests passed** (93%+ pass rate)
- [ ] **No critical failures** (Tests 1, 2, 3 must pass)
- [ ] **Export downloads successfully** (Test 1)
- [ ] **JSON structure is valid** (Test 2)
- [ ] **All configuration captured** (Test 3)
- [ ] **Unsaved changes work** (Test 4)
- [ ] **Runtime integration shown** (Test 5)
- [ ] **Validation works** (Test 6)
- [ ] **Statistics accurate** (Test 7)

If all checked: ✅ **100% VERIFIED**

---

## 🐛 Troubleshooting

### Common Issues

**Issue**: Export button not visible
- **Check**: Are you on the Agent 2.0 page?
- **Check**: Are you on the Call Review tab? (button hidden there)
- **Fix**: Navigate to Configuration or Greetings tab

**Issue**: File doesn't download
- **Check**: Browser console for errors
- **Check**: Browser download settings (allow downloads)
- **Check**: Popup blocker settings
- **Fallback**: JSON is still in clipboard - paste to save manually

**Issue**: JSON is empty or incomplete
- **Check**: Did export complete? (check alert message)
- **Check**: Browser console for errors
- **Fix**: Try refreshing page and exporting again

**Issue**: Button not changing color
- **Check**: Make a change in a form field
- **Check**: Browser console for errors
- **Fix**: The _setDirty() method may not be called - report as bug

**Issue**: Validation not detecting issues
- **Check**: Did you create an actual issue? (e.g., disable Discovery)
- **Check**: Export is recent (timestamp)
- **Check**: Validation section exists in JSON

---

## 📝 Test Notes

Use this space to record any issues, observations, or feedback:

```
Date: ___________
Tester: ___________

Notes:







```

---

## ✅ Sign-Off

After completing all tests:

**Tested By**: ___________________  
**Date**: ___________________  
**Overall Status**: ⬜ PASS  ⬜ FAIL  
**Ready for Production**: ⬜ YES  ⬜ NO  

**Signature**: ___________________

---

**Next Steps After Testing**:

✅ **If all tests pass**:
- Mark as production-ready
- Document any observations
- Share with team

❌ **If any tests fail**:
- Document failures in test notes
- Report issues with details (test number, expected vs actual)
- Re-test after fixes

---

**Related Documentation**:
- `AGENT2_EXPORT_SUMMARY.md` - Executive summary
- `docs/AGENT2_EXPORT_QUICK_START.md` - Quick start guide
- `docs/AGENT2_COMPLETE_WIRING_EXPORT.md` - Full technical docs
- `docs/AGENT2_EXPORT_IMPLEMENTATION_REPORT.md` - Implementation details
