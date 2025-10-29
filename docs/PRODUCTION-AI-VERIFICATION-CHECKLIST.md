# PRODUCTION AI - VERIFICATION CHECKLIST v1.0

**Date:** October 29, 2025  
**Tester:** Marc (ClientsVia.ai)  
**Purpose:** Step-by-step testing protocol to verify 100% functionality  

---

## 🎯 PRE-TESTING SETUP

Before starting tests, ensure:
- [ ] Server is running and accessible
- [ ] Logged in as admin user
- [ ] Browser console is open (F12) to view logs
- [ ] Network tab is open to monitor API calls
- [ ] Have test template ID ready (e.g., HVAC Trade Knowledge)

---

## ✅ TEST GROUP 1: TAB NAVIGATION

### Test 1.1: Access Production AI Tab
**Steps:**
1. Go to Global AI Brain page (`/admin-global-instant-responses.html`)
2. Click "Overview" main tab (if not already selected)
3. Look for sub-tabs: Dashboard | **Production AI** | Templates | Maintenance

**Expected Results:**
- [ ] ✅ Production AI sub-tab is visible
- [ ] ✅ Production AI sub-tab has robot icon (🤖)
- [ ] ✅ Production AI sub-tab has green "NEW" badge
- [ ] ✅ Sub-tab button styling matches other sub-tabs (compact design)

**If Failed:** Check `admin-global-instant-responses.html` line ~XXX for sub-tab button

---

### Test 1.2: Click Production AI Sub-Tab
**Steps:**
1. Click "Production AI" sub-tab

**Expected Results:**
- [ ] ✅ Content area switches to Production AI content
- [ ] ✅ Production AI sub-tab button becomes active (blue text, blue border)
- [ ] ✅ Other sub-tabs (Dashboard, Templates) are inactive (gray)
- [ ] ✅ Console shows: `🔄 [TAB SWITCH] Switching to: production-ai`
- [ ] ✅ Console shows: `🚀 [PRODUCTION AI] Initializing Production AI Manager...`

**If Failed:** Check `switchOverviewSubTab()` function in HTML

---

### Test 1.3: Switch Between Sub-Tabs
**Steps:**
1. Click "Dashboard" sub-tab
2. Verify content switches to Dashboard
3. Click "Production AI" sub-tab again
4. Verify content switches back to Production AI

**Expected Results:**
- [ ] ✅ Content switches correctly each time
- [ ] ✅ No console errors
- [ ] ✅ Production AI content reloads (health status, suggestions)

**If Failed:** Check hide/show logic in `switchOverviewSubTab()`

---

## ✅ TEST GROUP 2: HEALTH DASHBOARD

### Test 2.1: Health Cards Visible
**Steps:**
1. On Production AI tab, scroll to "System Health Status" section

**Expected Results:**
- [ ] ✅ Section header shows "System Health Status" with ❤️ icon
- [ ] ✅ 4 health cards are visible:
  - [ ] Card 1: LLM Connection (green gradient)
  - [ ] Card 2: MongoDB (blue gradient)
  - [ ] Card 3: Redis Cache (purple gradient)
  - [ ] Card 4: 3-Tier System (yellow gradient)
- [ ] ✅ Each card shows: Title, status indicator dot, status text, metric text

**If Failed:** Check HTML structure for health cards

---

### Test 2.2: LLM Health Check (Initial Load)
**Steps:**
1. Observe LLM Connection card on initial page load

**Expected Results:**
- [ ] ✅ Status indicator: Gray dot, pulsing animation
- [ ] ✅ Status text: "Checking..."
- [ ] ✅ After 2-3 seconds, updates to:
  - [ ] **If configured:** Green dot (pulsing), "✅ Connected", "Response time: XXXms"
  - [ ] **If not configured:** Yellow dot (static), "⚙️ Not Configured", "Add OPENAI_API_KEY to enable"
  - [ ] **If error:** Red dot (static), "❌ Error", error message
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/health/openai`
- [ ] ✅ Console shows: Response data

**If Failed:** Check `productionAIManager.initialize()` and API endpoint

---

### Test 2.3: Test OpenAI Connection Button
**Steps:**
1. Click "Test OpenAI Connection" button (green button, vial icon)

**Expected Results:**
- [ ] ✅ Button shows loading spinner (disabled during request)
- [ ] ✅ Toast appears: "Testing OpenAI connection..."
- [ ] ✅ After 2-3 seconds, toast updates:
  - [ ] **If connected:** "✅ OpenAI connection successful"
  - [ ] **If not configured:** "⚙️ OpenAI not configured"
  - [ ] **If error:** "❌ OpenAI connection failed: [error]"
- [ ] ✅ LLM card updates with new status
- [ ] ✅ Console shows: API call and response
- [ ] ✅ No console errors

**If Failed:** Check `productionAIManager.testOpenAIConnection()` function

---

### Test 2.4: Run Full Health Check Button
**Steps:**
1. Click "Run Full Health Check" button (blue button, heartbeat icon)

**Expected Results:**
- [ ] ✅ Button shows loading spinner
- [ ] ✅ Toast appears: "Running health check..."
- [ ] ✅ After 2-3 seconds, all 4 health cards update:
  - [ ] LLM card: Status updated
  - [ ] MongoDB card: Status updated (should be green "Connected")
  - [ ] Redis card: Status updated (should be green "Connected")
  - [ ] 3-Tier System card: Status updated (shows "Enabled" or "Disabled")
- [ ] ✅ Toast updates: "✅ Health check complete"
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/health/full`
- [ ] ✅ No console errors

**If Failed:** Check API endpoint `/api/admin/production-ai/health/full`

---

### Test 2.5: Refresh Button
**Steps:**
1. Click "Refresh" button (gray button, sync icon)

**Expected Results:**
- [ ] ✅ Button shows spinning icon animation
- [ ] ✅ Toast appears: "Refreshed"
- [ ] ✅ LLM card updates (re-checks OpenAI status)
- [ ] ✅ Other cards do NOT update (only LLM)
- [ ] ✅ Console shows: API call to LLM health endpoint

**If Failed:** Check `productionAIManager.refreshHealthStatus()` function

---

### Test 2.6: Auto-Refresh (30s Interval)
**Steps:**
1. Stay on Production AI tab for 1 minute
2. Watch LLM card status indicator

**Expected Results:**
- [ ] ✅ After 30 seconds: LLM card silently updates (no toast)
- [ ] ✅ After 60 seconds: LLM card updates again
- [ ] ✅ Console shows: API calls every 30s
- [ ] ✅ Switch to different sub-tab (Dashboard)
- [ ] ✅ Wait 30 seconds
- [ ] ✅ Verify: No API calls while not on Production AI tab (auto-refresh paused)

**If Failed:** Check `startAutoRefresh()` and `stopAutoRefresh()` functions

---

## ✅ TEST GROUP 3: SUGGESTIONS QUEUE

### Test 3.1: Stats Bar
**Steps:**
1. Scroll to "📚 KNOWLEDGE BASE - AI SUGGESTIONS QUEUE" section

**Expected Results:**
- [ ] ✅ Section header is visible
- [ ] ✅ Stats bar shows: "🟣 X Pending | 🟢 Y Applied | 🔴 Z Ignored"
- [ ] ✅ Numbers are accurate (match database)
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/suggestions/stats`

**If Failed:** Check API endpoint and frontend rendering

---

### Test 3.2: Suggestion Cards (If Data Exists)
**Steps:**
1. Observe suggestion cards in queue

**Expected Results (if suggestions exist):**
- [ ] ✅ Up to 10 suggestion cards are visible
- [ ] ✅ Each card shows:
  - [ ] Priority indicator: 🔥 High | 🟡 Medium | 🔵 Low
  - [ ] Brief description (1 line)
  - [ ] Impact summary (calls/month, savings, or similar)
  - [ ] Timestamp (e.g., "Oct 29, 2025 10:23 AM")
  - [ ] Company name
  - [ ] Template name
  - [ ] "📄 View Full Details" button (blue, hover effect)
- [ ] ✅ Cards are sorted by priority (High → Medium → Low), then date (newest first)
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/suggestions/:templateId`

**Expected Results (if no suggestions):**
- [ ] ✅ Empty state message: "No suggestions yet. Production call data will appear here once LLM analyzes calls."
- [ ] ✅ No "Load More" button visible

**If Failed:** Check `productionAIManager.loadSuggestions()` and rendering logic

---

### Test 3.3: Load More Button (If > 10 Suggestions)
**Steps:**
1. If "Load More Suggestions..." button is visible, click it

**Expected Results:**
- [ ] ✅ Button shows loading spinner
- [ ] ✅ Next 10 suggestions appear below existing ones
- [ ] ✅ Button text updates to "Load More..." again (if > 20 total)
- [ ] ✅ Console shows: API call with `?page=2` parameter
- [ ] ✅ No duplicate cards

**If Failed:** Check pagination logic in API and frontend

---

### Test 3.4: Template Selector Filter
**Steps:**
1. Locate template selector dropdown (above suggestions queue)
2. Change template selection

**Expected Results:**
- [ ] ✅ Dropdown shows all available templates
- [ ] ✅ Default option: "All Templates"
- [ ] ✅ On change: Suggestions reload for selected template
- [ ] ✅ Only suggestions for that template are shown
- [ ] ✅ Stats bar updates to match filtered suggestions
- [ ] ✅ Console shows: New API call with templateId filter

**If Failed:** Check template selector `onChange` handler

---

## ✅ TEST GROUP 4: SUGGESTION MODAL

### Test 4.1: Open Modal
**Steps:**
1. Click "📄 View Full Details" button on any suggestion card

**Expected Results:**
- [ ] ✅ Full-screen modal opens (overlay background)
- [ ] ✅ Modal takes up entire browser window
- [ ] ✅ Modal is scrollable (vertical scroll enabled)
- [ ] ✅ Modal header shows:
  - [ ] "◀ Back to Suggestions Queue" button (top left)
  - [ ] "🤖 LLM SUGGESTION ANALYSIS - Full Call Review" title
  - [ ] Close X button (top right)
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/suggestions/:id/details`
- [ ] ✅ Loading spinner shows while fetching data

**If Failed:** Check `openSuggestionModal()` function

---

### Test 4.2: Modal Section 1 - Call Details & Quick Actions
**Steps:**
1. In modal, scroll to top section

**Expected Results:**
- [ ] ✅ **Left Panel (Call Details)** shows:
  - [ ] Date: "Oct 29, 2025 10:23 AM" (formatted)
  - [ ] Company: "ABC Plumbing" (linked)
  - [ ] Template: "HVAC Trade Knowledge" (linked)
  - [ ] Duration: "2:34" (formatted)
  - [ ] Caller: "(555) 123-4567" (formatted)
  - [ ] Cost: "$0.47 (Tier 3 LLM)" (formatted)
  - [ ] Call ID: "#12345"
- [ ] ✅ **Right Panel (Quick Actions)** shows:
  - [ ] "✓ Apply All Suggestions" button (green)
  - [ ] "✗ Ignore All" button (red)
  - [ ] "💾 Save for Later" button (gray)
  - [ ] "📋 Export Report" button (blue)

**If Failed:** Check modal HTML structure and data population

---

### Test 4.3: Modal Section 2 - Full Transcript
**Steps:**
1. Scroll to "📝 FULL CALL TRANSCRIPT" section

**Expected Results:**
- [ ] ✅ Section header is visible
- [ ] ✅ Transcript is displayed in speech bubble style
  - [ ] Caller messages: Left-aligned
  - [ ] Agent messages: Right-aligned
- [ ] ✅ Speaker labels are bold ("Caller:", "Agent:")
- [ ] ✅ Transcript is readable (light gray background, monospace font)
- [ ] ✅ Copy button (top right of transcript box)
  - [ ] Click copy button
  - [ ] ✅ Toast appears: "Copied!"
  - [ ] ✅ Transcript copied to clipboard

**If Failed:** Check transcript rendering and copy functionality

---

### Test 4.4: Modal Section 3 - Routing Flow Visualization
**Steps:**
1. Scroll to "⚡ ROUTING FLOW VISUALIZATION" section

**Expected Results:**
- [ ] ✅ Section header is visible
- [ ] ✅ 3 tier blocks are shown vertically: Tier 1 → Tier 2 → Tier 3
- [ ] ✅ Each tier shows:
  - [ ] Title: "TIER 1 - Rule-Based", "TIER 2 - Semantic", "TIER 3 - LLM Fallback"
  - [ ] Response time: "5-15ms", "20-40ms", "XXXXms"
  - [ ] Status: ✅ SUCCESS (green) or ❌ FAILED (red)
  - [ ] Confidence: "0.XX"
  - [ ] Details: Why it matched/failed (text explanation)
- [ ] ✅ Color coding:
  - [ ] Green: If tier succeeded
  - [ ] Red: If tier failed
  - [ ] Gray: If tier not reached

**If Failed:** Check routing flow rendering logic

---

### Test 4.5: Modal Section 4 - LLM Reasoning
**Steps:**
1. Scroll to "🧠 LLM REASONING & ANALYSIS" section

**Expected Results:**
- [ ] ✅ Section header is visible
- [ ] ✅ Analysis details show:
  - [ ] Model: "GPT-4-turbo" (or actual model used)
  - [ ] Analysis time: "X.Xs"
  - [ ] Confidence: "XX%"
  - [ ] Token count: "XXX tokens"
  - [ ] Cost: "$0.XX"
- [ ] ✅ Reasoning text is displayed (multi-paragraph)
- [ ] ✅ Text is formatted (line breaks, bullet points preserved)
- [ ] ✅ Key terms are bold
- [ ] ✅ Sections are clearly labeled:
  - [ ] "Context Clues Detected"
  - [ ] "Pattern Recognition"
  - [ ] "Root Cause of Tier 1/2 Failure"
  - [ ] "Business Impact"

**If Failed:** Check LLM reasoning rendering

---

### Test 4.6: Modal Section 5 - Suggested Improvements (Filler Words)
**Steps:**
1. Scroll to "💡 SUGGESTED IMPROVEMENTS" section
2. Find "ADD FILLER WORDS" card (if present)

**Expected Results:**
- [ ] ✅ Card header shows:
  - [ ] Icon: "1️⃣"
  - [ ] Title: "ADD FILLER WORDS"
  - [ ] Impact badge: "Low Impact" | "Medium Impact" | "High Impact"
- [ ] ✅ Card content shows:
  - [ ] List of filler words (comma-separated): "um", "like", "you know", etc.
  - [ ] Why: Explanation of impact
  - [ ] Target: "Template-level filler words"
  - [ ] Impact: What improves
- [ ] ✅ Card actions show:
  - [ ] "✓ Apply" button (green)
  - [ ] "✗ Ignore" button (red)
  - [ ] "Edit Before Apply" button (gray)

**If Failed:** Check improvement card rendering

---

### Test 4.7: Apply Filler Words Suggestion
**Steps:**
1. Click "✓ Apply" button on "ADD FILLER WORDS" card

**Expected Results:**
- [ ] ✅ Button shows loading spinner (disabled)
- [ ] ✅ Toast appears: "Applying improvement..."
- [ ] ✅ After 1-2 seconds:
  - [ ] Toast updates: "✓ Improvement applied successfully"
  - [ ] Button text changes to "✓ Applied" (disabled, gray)
  - [ ] Card visual indicator (checkmark overlay or green border)
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/suggestions/:id/apply`
- [ ] ✅ Console shows: Request body includes `{ type: 'filler-words', data: {...} }`
- [ ] ✅ Console shows: Response `{ success: true, updated: {...} }`
- [ ] ✅ No console errors

**Verify in Database:**
1. Go to Templates tab
2. Find the template that was updated
3. Check fillerWords array
4. ✅ Verify: New filler words are present

**If Failed:** Check `applyImprovement()` function and API endpoint

---

### Test 4.8: Apply Synonym Mapping Suggestion
**Steps:**
1. Find "ADD SYNONYM MAPPING" card (if present)
2. Click "✓ Apply" button

**Expected Results:**
- [ ] ✅ Same as Test 4.7 (loading, toast, success)
- [ ] ✅ Console shows: `type: 'synonym'` in request
- [ ] ✅ Verify in database: Category synonyms updated

**If Failed:** Check synonym application logic

---

### Test 4.9: Apply Keywords Suggestion
**Steps:**
1. Find "ENHANCE EXISTING SCENARIO" card (if present)
2. Click "✓ Apply" button

**Expected Results:**
- [ ] ✅ Same as Test 4.7
- [ ] ✅ Console shows: `type: 'keywords'` in request
- [ ] ✅ Verify in database: Scenario keywords updated

**If Failed:** Check keyword application logic

---

### Test 4.10: Create Missing Scenario
**Steps:**
1. Find "CREATE MISSING SCENARIO" card (if present)
2. Review pre-filled data:
   - [ ] Suggested name
   - [ ] Suggested category
   - [ ] Suggested keywords
   - [ ] Suggested response
   - [ ] Suggested behavior
3. Click "✓ Create Scenario" button

**Expected Results:**
- [ ] ✅ Toast: "Creating scenario..."
- [ ] ✅ Toast updates: "✓ Scenario created successfully"
- [ ] ✅ Console shows: `type: 'create-scenario'` in request
- [ ] ✅ Verify in database: New scenario document exists
- [ ] ✅ Verify: Scenario appears in Templates tab

**If Failed:** Check scenario creation logic

---

### Test 4.11: Ignore Improvement
**Steps:**
1. Find any improvement card that hasn't been applied
2. Click "✗ Ignore" button

**Expected Results:**
- [ ] ✅ Toast: "Improvement ignored"
- [ ] ✅ Card fades out or is hidden
- [ ] ✅ Improvement does NOT update template/category/scenario
- [ ] ✅ Suggestion status remains "pending" (but improvement marked ignored)

**If Failed:** Check ignore logic

---

### Test 4.12: Edit Before Apply
**Steps:**
1. Click "Edit Before Apply" button on any improvement card

**Expected Results:**
- [ ] ✅ Inline editor opens (textarea or input fields)
- [ ] ✅ Pre-filled with suggested data
- [ ] ✅ User can modify data (add/remove words, edit text)
- [ ] ✅ "Save & Apply" button appears
- [ ] ✅ Click "Save & Apply"
- [ ] ✅ Modified data is applied (not original suggestion)
- [ ] ✅ Toast: "✓ Custom improvement applied"

**If Failed:** Check inline editor functionality

---

### Test 4.13: Modal Section 6 - Impact Analysis & ROI
**Steps:**
1. Scroll to "📊 IMPACT ANALYSIS & ROI" section

**Expected Results:**
- [ ] ✅ Section shows:
  - [ ] Similar Calls: "X calls this month, Y last month, Z projected next month"
  - [ ] Current Performance: Tier usage percentages, avg cost, avg response time
  - [ ] After Applying Suggestions: Projected tier usage, monthly savings, response time improvement
  - [ ] ROI Calculation: Setup time, monthly/annual savings, payback period, performance gain
- [ ] ✅ All numbers are formatted correctly (dollars, percentages, times)

**If Failed:** Check ROI calculation and rendering

---

### Test 4.14: Modal Section 7 - Related Suggestions
**Steps:**
1. Scroll to "🔄 RELATED SUGGESTIONS" section

**Expected Results:**
- [ ] ✅ If related suggestions exist: Shows up to 3 mini cards
  - [ ] Each card: 1-line summary + link
  - [ ] Click link: Opens that suggestion modal
- [ ] ✅ If no related suggestions: "No related suggestions found"

**If Failed:** Check related suggestions query and rendering

---

### Test 4.15: Apply All Suggestions
**Steps:**
1. Scroll to top of modal
2. Click "✓ Apply All Suggestions" button (right panel, green)

**Expected Results:**
- [ ] ✅ Confirmation dialog: "Apply all X improvements? This cannot be undone."
- [ ] ✅ Click "Confirm"
- [ ] ✅ Progress toast: "Applying improvement 1 of X..."
- [ ] ✅ Toast updates for each improvement
- [ ] ✅ Final toast: "✓ All improvements applied successfully"
- [ ] ✅ All improvement cards show "✓ Applied" status
- [ ] ✅ Console shows: Multiple API calls (one per improvement)
- [ ] ✅ Verify in database: All improvements applied

**If Failed:** Check batch apply logic

---

### Test 4.16: Ignore All
**Steps:**
1. Open a new suggestion modal (not already applied)
2. Click "✗ Ignore All" button

**Expected Results:**
- [ ] ✅ Confirmation dialog: "Ignore this suggestion? It will be removed from the queue."
- [ ] ✅ Click "Confirm"
- [ ] ✅ Toast: "Suggestion ignored"
- [ ] ✅ Modal closes
- [ ] ✅ Return to suggestions queue
- [ ] ✅ Suggestion card is removed from queue
- [ ] ✅ Stats bar updates (Pending -1, Ignored +1)
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/suggestions/:id/ignore`

**If Failed:** Check ignore functionality

---

### Test 4.17: Save for Later
**Steps:**
1. Click "💾 Save for Later" button

**Expected Results:**
- [ ] ✅ Toast: "Suggestion saved for later"
- [ ] ✅ Suggestion remains in queue (not removed)
- [ ] ✅ Suggestion status: Still "pending"
- [ ] ✅ Visual indicator: "Saved" badge on card (optional)

**If Failed:** Check save-for-later logic

---

### Test 4.18: Export Report
**Steps:**
1. Click "📋 Export Report" button

**Expected Results:**
- [ ] ✅ Download starts immediately
- [ ] ✅ File downloaded: `suggestion-report-[id].pdf` or `.json`
- [ ] ✅ File contains: Full call details, transcript, reasoning, suggestions, impact
- [ ] ✅ File is readable and well-formatted

**If Failed:** Check export functionality

---

### Test 4.19: Close Modal
**Steps:**
1. Test both close methods:
   - a. Click "◀ Back to Suggestions Queue" button
   - b. Click "X" button (top right)

**Expected Results:**
- [ ] ✅ Modal closes (disappears)
- [ ] ✅ Returns to suggestions queue view
- [ ] ✅ Suggestions queue is still loaded (not empty)
- [ ] ✅ Stats bar reflects any changes (if suggestions were applied)
- [ ] ✅ No console errors

**If Failed:** Check modal close logic

---

## ✅ TEST GROUP 5: INTEGRATIONS

### Test 5.1: Template Tab Integration
**Steps:**
1. Go to Overview tab → Templates sub-tab
2. Find any template card
3. Look for "⚙️ Production AI" button (last column)
4. Click button

**Expected Results:**
- [ ] ✅ Button exists on every template card
- [ ] ✅ Button has robot icon + "Production AI" text
- [ ] ✅ Click button: Navigates to Production AI sub-tab
- [ ] ✅ Template selector (in Production AI) is pre-filled with clicked template
- [ ] ✅ Suggestions queue shows only suggestions for that template
- [ ] ✅ Page scrolls to suggestions queue section

**If Failed:** Check template card rendering and `navigateToProductionAI()` function

---

### Test 5.2: Test Pilot Integration (Logging)
**Steps:**
1. Go to test pilot (in Global AI Brain)
2. Enter test query: "Hey, um, my thingy on the wall is broken"
3. Click "Test Query"
4. Observe tier used (should be Tier 3 if synonyms not added)

**Expected Results:**
- [ ] ✅ Test results show tier used: "Matched via Tier X"
- [ ] ✅ If Tier 3 used: "Generate Suggestion" button appears
- [ ] ✅ Console shows: API call to `/api/admin/production-ai/call-logs` (fire-and-forget)
- [ ] ✅ Verify in database: ProductionAICallLog document created with `isTest: true`

**If Failed:** Check test pilot integration in `routes/v2twilio.js`

---

### Test 5.3: Test Pilot Integration (Generate Suggestion)
**Steps:**
1. After test (from Test 5.2), if Tier 3 was used
2. Click "Generate Suggestion" button

**Expected Results:**
- [ ] ✅ Toast: "Analyzing call..."
- [ ] ✅ After 3-5 seconds: Toast: "Suggestion created"
- [ ] ✅ Link appears: "View Suggestion"
- [ ] ✅ Click link: Opens suggestion modal
- [ ] ✅ Modal shows full details from test call
- [ ] ✅ Verify: Suggestion document created in database

**If Failed:** Check immediate analysis endpoint

---

### Test 5.4: Notification Center Integration (High-Priority)
**Steps:**
1. Create a high-priority suggestion (manually via database or wait for LLM to create one)
2. Go to Notification Center

**Expected Results:**
- [ ] ✅ Notification appears in list
- [ ] ✅ Alert code: `PRODUCTION_AI_SUGGESTION_HIGH_PRIORITY`
- [ ] ✅ Severity: WARNING (orange/yellow)
- [ ] ✅ Message: "New high-priority suggestion: [brief description]"
- [ ] ✅ Details: Call ID, company, template, estimated savings
- [ ] ✅ Action link: Click → navigates to Production AI tab → opens suggestion modal

**If Failed:** Check notification sending logic in LLMSuggestionAnalyzer

---

### Test 5.5: Notification Center Integration (Applied)
**Steps:**
1. Apply any suggestion (from Test 4.7)
2. Go to Notification Center

**Expected Results:**
- [ ] ✅ Notification appears
- [ ] ✅ Alert code: `PRODUCTION_AI_SUGGESTION_APPLIED`
- [ ] ✅ Severity: INFO (blue)
- [ ] ✅ Message: "Suggestion applied: [type] for template [name]"
- [ ] ✅ Details: What changed, by whom, timestamp

**If Failed:** Check notification sending in apply endpoint

---

### Test 5.6: Notification Center Integration (Analysis Failed)
**Steps:**
1. Simulate LLM analysis failure (disconnect OpenAI or invalid API key)
2. Create a Tier 3 call log
3. Wait for cron job to attempt analysis (or trigger manually)
4. After 3 failures, check Notification Center

**Expected Results:**
- [ ] ✅ Notification appears
- [ ] ✅ Alert code: `PRODUCTION_AI_ANALYSIS_FAILED`
- [ ] ✅ Severity: CRITICAL (red)
- [ ] ✅ Message: "Failed to analyze call log after 3 attempts"
- [ ] ✅ Details: Call ID, error message, stack trace

**If Failed:** Check error handling in LLMSuggestionAnalyzer

---

## ✅ TEST GROUP 6: ERROR HANDLING

### Test 6.1: Network Failure (Disconnect Internet)
**Steps:**
1. Disconnect internet (turn off Wi-Fi)
2. Click "Test OpenAI Connection" button

**Expected Results:**
- [ ] ✅ Toast: "Testing OpenAI connection..."
- [ ] ✅ After timeout: Toast: "Connection lost, retrying..."
- [ ] ✅ Retry 3 times (exponential backoff: 1s, 2s, 4s)
- [ ] ✅ After 3 failures: Toast: "❌ Unable to connect, please check your internet"
- [ ] ✅ No console errors (error logged but caught)

**If Failed:** Check network error handling

---

### Test 6.2: Network Failure (Reconnect)
**Steps:**
1. Reconnect internet
2. Click "Test OpenAI Connection" again

**Expected Results:**
- [ ] ✅ Works normally (no errors)
- [ ] ✅ Toast: "✅ OpenAI connection successful"

**If Failed:** Check retry logic

---

### Test 6.3: Auth Failure (Invalid Token)
**Steps:**
1. In browser console, run: `localStorage.setItem('adminToken', 'invalid-token')`
2. Refresh page
3. Try to click any button that makes API call

**Expected Results:**
- [ ] ✅ API call returns 401 Unauthorized
- [ ] ✅ Toast: "Session expired, please log in again"
- [ ] ✅ Redirect to `/login.html` after 2 seconds
- [ ] ✅ localStorage token is cleared

**If Failed:** Check auth error handling

---

### Test 6.4: Empty State (No Suggestions)
**Steps:**
1. Ensure database has 0 suggestions (or filter to template with no suggestions)
2. Reload Production AI tab

**Expected Results:**
- [ ] ✅ Stats bar shows: "🟣 0 Pending | 🟢 0 Applied | 🔴 0 Ignored"
- [ ] ✅ Suggestions queue shows: "No suggestions yet. Production call data will appear here once LLM analyzes calls."
- [ ] ✅ No "Load More" button
- [ ] ✅ No broken UI elements

**If Failed:** Check empty state rendering

---

### Test 6.5: Empty State (No Templates)
**Steps:**
1. Temporarily clear all templates (backup first!)
2. Reload Production AI tab

**Expected Results:**
- [ ] ✅ Template selector shows: "No templates found. Create a template in the Templates tab."
- [ ] ✅ Page doesn't crash
- [ ] ✅ User can still navigate to Templates tab

**If Failed:** Check empty state handling

---

### Test 6.6: Loading States
**Steps:**
1. Reload Production AI tab
2. Observe loading indicators

**Expected Results:**
- [ ] ✅ Health cards show: Gray pulsing dots with "Checking..." text
- [ ] ✅ Suggestions queue shows: 3 skeleton cards (gray boxes with shimmer animation)
- [ ] ✅ After data loads: Skeletons replaced with actual content
- [ ] ✅ No flash of empty state

**If Failed:** Check loading state rendering

---

### Test 6.7: Invalid Suggestion ID
**Steps:**
1. In browser console, run: `openSuggestionModal('invalid-id-12345')`

**Expected Results:**
- [ ] ✅ Toast: "Loading suggestion..."
- [ ] ✅ API returns 404 Not Found
- [ ] ✅ Toast updates: "❌ Suggestion not found"
- [ ] ✅ Modal doesn't open
- [ ] ✅ No console errors (error logged but caught)

**If Failed:** Check suggestion ID validation

---

### Test 6.8: API Rate Limiting
**Steps:**
1. Rapidly click "Test OpenAI Connection" 10 times in 1 second

**Expected Results:**
- [ ] ✅ First 5 requests: Processed normally
- [ ] ✅ Requests 6-10: Blocked by rate limiter
- [ ] ✅ Toast: "Too many requests, please wait"
- [ ] ✅ After 1 minute: Rate limit resets, requests work again

**If Failed:** Check rate limiting middleware

---

## ✅ TEST GROUP 7: PERFORMANCE & OPTIMIZATION

### Test 7.1: Page Load Performance
**Steps:**
1. Open browser DevTools → Performance tab
2. Reload Production AI tab
3. Stop recording after page fully loads

**Expected Results:**
- [ ] ✅ Initial load: < 2 seconds (on fast connection)
- [ ] ✅ API calls: < 500ms each
- [ ] ✅ Rendering: No visible lag or stutter
- [ ] ✅ No memory leaks (check Memory tab)

**If Failed:** Optimize API calls or frontend rendering

---

### Test 7.2: Large Suggestion List (100+ Suggestions)
**Steps:**
1. Seed database with 100 suggestions (via script)
2. Reload Production AI tab

**Expected Results:**
- [ ] ✅ Only 10 suggestions load initially (pagination works)
- [ ] ✅ "Load More" button appears
- [ ] ✅ Page renders smoothly (no lag)
- [ ] ✅ Scroll is smooth

**If Failed:** Check pagination and lazy loading

---

### Test 7.3: Cache Performance
**Steps:**
1. Apply a suggestion (e.g., filler words)
2. Go to Templates tab
3. Edit the same template manually (add a category)
4. Return to Production AI tab
5. Click "Refresh"

**Expected Results:**
- [ ] ✅ Applied filler words are still present (cache was cleared)
- [ ] ✅ Manual category addition is visible (cache was cleared)
- [ ] ✅ Data is fresh (not stale)

**If Failed:** Check Redis cache invalidation logic

---

### Test 7.4: Auto-Refresh Performance (Long Session)
**Steps:**
1. Stay on Production AI tab for 10 minutes
2. Monitor Network tab in DevTools

**Expected Results:**
- [ ] ✅ Health status API called every 30 seconds (20 times in 10 minutes)
- [ ] ✅ No memory leaks (Memory usage stable)
- [ ] ✅ No duplicate requests
- [ ] ✅ Page remains responsive

**If Failed:** Check auto-refresh interval and memory management

---

## ✅ TEST GROUP 8: END-TO-END FLOWS

### Test 8.1: Complete Flow - Production Call to Applied Suggestion
**Steps:**
1. Make a production call (via Twilio, not test pilot)
2. Use a complex query that triggers Tier 3 (e.g., "my wall thingy is broken")
3. Wait 5-10 minutes for background analysis (or trigger manually)
4. Go to Production AI tab
5. Verify new suggestion appears
6. Click "View Full Details"
7. Review suggestion
8. Click "Apply" on synonym mapping
9. Verify template updated
10. Make the SAME call again
11. Verify: Now matches Tier 1 (synonym applied successfully)

**Expected Results:**
- [ ] ✅ Every step completes without errors
- [ ] ✅ Suggestion created from real call
- [ ] ✅ Applied suggestion improves performance
- [ ] ✅ Second call is faster and cheaper (Tier 1 instead of Tier 3)

**If Failed:** Review entire data flow (Integration Map)

---

### Test 8.2: Complete Flow - Test Pilot to Missing Scenario
**Steps:**
1. Go to test pilot
2. Test query: "Can I set up a payment plan for this repair?"
3. Observe: No matching scenario (Tier 3 or "Not Found")
4. Click "Generate Suggestion"
5. Wait for analysis
6. Go to Production AI tab
7. Find "CREATE MISSING SCENARIO" suggestion
8. Review suggested scenario details
9. Click "Create Scenario"
10. Verify: New scenario appears in Templates tab
11. Return to test pilot
12. Test same query again
13. Verify: Now matches new scenario

**Expected Results:**
- [ ] ✅ Every step completes without errors
- [ ] ✅ LLM correctly identifies missing scenario
- [ ] ✅ Scenario creation works
- [ ] ✅ Second test matches new scenario

**If Failed:** Review missing scenario detection and creation logic

---

## ✅ TEST GROUP 9: FINAL VERIFICATION

### Test 9.1: All Buttons Work
**Steps:**
1. Click every button in Production AI tab
2. Verify each button performs its intended action

**Checklist:**
- [ ] ✅ "Test OpenAI Connection" - works
- [ ] ✅ "Run Full Health Check" - works
- [ ] ✅ "Refresh" - works
- [ ] ✅ "View Full Details" - works
- [ ] ✅ "Load More Suggestions" - works
- [ ] ✅ "Apply All Suggestions" - works
- [ ] ✅ "Apply" (individual improvements) - works
- [ ] ✅ "Ignore" - works
- [ ] ✅ "Edit Before Apply" - works
- [ ] ✅ "Save for Later" - works
- [ ] ✅ "Export Report" - works
- [ ] ✅ "Back to Suggestions Queue" - works
- [ ] ✅ Close modal (X button) - works
- [ ] ✅ Template selector - works
- [ ] ✅ "Production AI" button (Templates tab) - works

**If Failed:** Fix non-working button(s)

---

### Test 9.2: No Console Errors
**Steps:**
1. Open browser console (F12)
2. Perform ALL tests above
3. Review console for errors

**Expected Results:**
- [ ] ✅ No red error messages (except intentional test errors)
- [ ] ✅ All API calls return 200 or expected status codes
- [ ] ✅ No "undefined" or "null" errors
- [ ] ✅ No missing imports or scripts

**If Failed:** Fix console errors

---

### Test 9.3: Database Integrity
**Steps:**
1. After ALL tests, check MongoDB collections

**Expected Results:**
- [ ] ✅ `ProductionAICallLogs`: Contains test and production calls
- [ ] ✅ `SuggestionKnowledgeBase`: Contains suggestions, statuses correct
- [ ] ✅ `GlobalInstantResponseTemplate`: Filler words updated
- [ ] ✅ `v2TradeCategory`: Synonyms updated
- [ ] ✅ `v2Template`: Keywords/negatives updated, new scenarios created
- [ ] ✅ `NotificationLog`: Notifications sent
- [ ] ✅ `AuditLog`: All actions logged

**If Failed:** Check data persistence and audit trail

---

### Test 9.4: Cache Integrity
**Steps:**
1. Check Redis cache keys (via Redis CLI or GUI)

**Expected Results:**
- [ ] ✅ `template:{templateId}` keys exist (for active templates)
- [ ] ✅ After applying suggestions: Affected keys are cleared (no stale data)
- [ ] ✅ After manual edits: Cache keys are cleared

**If Failed:** Check cache invalidation logic

---

### Test 9.5: User Experience Review
**Steps:**
1. As a developer, use the Production AI system for 30 minutes
2. Evaluate:
   - Is it intuitive?
   - Are loading states clear?
   - Are errors helpful?
   - Is data easy to understand?
   - Are actions easy to perform?

**Expected Results:**
- [ ] ✅ UI is intuitive (no confusion)
- [ ] ✅ All actions are 1-2 clicks (efficient)
- [ ] ✅ Data is well-organized (not overwhelming)
- [ ] ✅ Error messages are helpful (not cryptic)
- [ ] ✅ Loading states are clear (not "stuck")

**If Failed:** Improve UX based on feedback

---

## 🏆 FINAL APPROVAL

**All tests passed?**
- [ ] ✅ 100% of checkboxes above are checked
- [ ] ✅ No blocking issues found
- [ ] ✅ User (Marc) approves functionality
- [ ] ✅ System is ready for production use

**Signature:**
- **Tester:** _____________________ (Marc, ClientsVia.ai)
- **Date:** _____________________
- **Status:** ✅ APPROVED | ❌ NEEDS REVISION

---

**END OF VERIFICATION CHECKLIST**

