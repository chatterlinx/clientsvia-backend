# PRODUCTION AI - FEATURE CONTRACT v1.0

**Date:** October 29, 2025  
**Developer:** AI Assistant  
**Approval Required:** Marc (ClientsVia.ai)  
**Commitment:** 100% complete build - NO partial features, NO broken buttons, NO missing integrations

---

## 🎯 SCOPE OVERVIEW

**What we're building:**
A complete Production AI monitoring and learning system that:
1. Shows real-time health of LLM/Database/Cache
2. Displays AI-generated suggestions from production call analysis
3. Provides full-screen modal for detailed call review
4. Integrates with Templates, Test Pilot, and Notification Center
5. Allows one-click application of suggestions to improve templates

**What success looks like:**
- Developer clicks Production AI tab → sees health dashboard + suggestions queue
- Developer clicks "View Full Details" → sees complete call transcript, LLM reasoning, and actionable improvements
- Developer clicks "Apply" → template/category immediately updated, Redis cache cleared, system faster
- All buttons work, all APIs connected, all integrations complete

---

## ✅ FEATURE CHECKLIST (100% Required)

### 🔷 SECTION 1: TAB LOCATION & NAVIGATION

**Location:**
- [ ] Production AI is an **Overview sub-tab** (NOT main tab)
- [ ] Order: Dashboard | **Production AI** | Templates | Maintenance
- [ ] Shows: Only when user is on Overview tab

**Tab Button:**
- [ ] ID: `overview-subtab-production-ai`
- [ ] Icon: `<i class="fas fa-robot"></i>`
- [ ] Text: "Production AI"
- [ ] Badge: Green "NEW" badge next to text
- [ ] onClick: `switchOverviewSubTab('production-ai')`
- [ ] Styling: Matches other Overview sub-tab buttons (compact design)

**Tab Content:**
- [ ] ID: `overview-production-ai-content`
- [ ] Class: `overview-subtab-content hidden` (hidden by default)
- [ ] Shows: When Production AI sub-tab is clicked
- [ ] Hides: When other sub-tabs clicked (Dashboard, Templates, Maintenance)

**switchOverviewSubTab() Integration:**
- [ ] Adds 'production-ai' to sub-tab array
- [ ] Shows/hides content correctly
- [ ] Calls `productionAIManager.initialize()` when opened
- [ ] Updates button styles (active vs inactive)

---

### 🔷 SECTION 2: SYSTEM HEALTH DASHBOARD

**Section Header:**
- [ ] Title: "System Health Status"
- [ ] Icon: `<i class="fas fa-heartbeat text-red-500"></i>`

**Health Status Cards (4 total):**

**Card 1: LLM Connection**
- [ ] Background: Green gradient (from-green-50 to-green-100)
- [ ] Title: "LLM Connection"
- [ ] Status indicator: Dot (id: `llm-status-indicator`)
  - [ ] Default: Gray, pulsing
  - [ ] Healthy: Green, pulsing
  - [ ] Not configured: Yellow, static
  - [ ] Error: Red, static
- [ ] Status text: (id: `llm-status-text`)
  - [ ] Default: "Checking..."
  - [ ] Healthy: "✅ Connected"
  - [ ] Not configured: "⚙️ Not Configured"
  - [ ] Error: "❌ Error"
- [ ] Response time: (id: `llm-response-time`)
  - [ ] Shows: "Response time: XXXms" or "Add OPENAI_API_KEY to enable"

**Card 2: MongoDB**
- [ ] Background: Blue gradient (from-blue-50 to-blue-100)
- [ ] Title: "MongoDB"
- [ ] Status indicator: (id: `db-status-indicator`)
- [ ] Status text: (id: `db-status-text`)
- [ ] Query time: (id: `db-query-time`)

**Card 3: Redis Cache**
- [ ] Background: Purple gradient (from-purple-50 to-purple-100)
- [ ] Title: "Redis Cache"
- [ ] Status indicator: (id: `redis-status-indicator`)
- [ ] Status text: (id: `redis-status-text`)
- [ ] Latency: (id: `redis-latency`)

**Card 4: 3-Tier System**
- [ ] Background: Yellow gradient (from-yellow-50 to-yellow-100)
- [ ] Title: "3-Tier System"
- [ ] Status indicator: (id: `tier-system-indicator`)
- [ ] Status text: (id: `tier-system-text`)
- [ ] Info: (id: `tier-system-info`)

**Action Buttons (3 total):**

**Button 1: Test OpenAI Connection**
- [ ] Text: "Test OpenAI Connection"
- [ ] Icon: `<i class="fas fa-vial"></i>`
- [ ] Color: Green (bg-green-600)
- [ ] onClick: `productionAIManager.testOpenAIConnection()`
- [ ] Functionality:
  - [ ] Calls: `GET /api/admin/production-ai/health/openai`
  - [ ] Shows: Toast with result
  - [ ] Updates: LLM card status
  - [ ] Error handling: Shows error toast if fails

**Button 2: Run Full Health Check**
- [ ] Text: "Run Full Health Check"
- [ ] Icon: `<i class="fas fa-heartbeat"></i>`
- [ ] Color: Blue (bg-blue-600)
- [ ] onClick: `productionAIManager.runFullHealthCheck()`
- [ ] Functionality:
  - [ ] Calls: `GET /api/admin/production-ai/health/full`
  - [ ] Shows: Toast "Running health check..."
  - [ ] Updates: All 4 health cards
  - [ ] Error handling: Shows error toast if fails

**Button 3: Refresh**
- [ ] Text: "Refresh"
- [ ] Icon: `<i class="fas fa-sync-alt"></i>`
- [ ] Color: Gray (bg-gray-600)
- [ ] onClick: `productionAIManager.refreshHealthStatus()`
- [ ] Functionality:
  - [ ] Calls: LLM health check
  - [ ] Shows: Toast "Refreshed"
  - [ ] Updates: LLM card only

**Auto-Refresh:**
- [ ] Interval: 30 seconds
- [ ] Starts: When Production AI tab opened
- [ ] Stops: When tab closed or user navigates away
- [ ] Function: `productionAIManager.startAutoRefresh()`
- [ ] Updates: LLM status silently (no toast)

---

### 🔷 SECTION 3: KNOWLEDGE BASE - SUGGESTIONS QUEUE

**Section Header:**
- [ ] Title: "📚 KNOWLEDGE BASE - AI SUGGESTIONS QUEUE"
- [ ] Subtitle: "LLM-generated improvements from production call analysis"

**Stats Bar:**
- [ ] Shows: "🟣 X Pending | 🟢 Y Applied | 🔴 Z Ignored"
- [ ] Updates: Real-time when suggestions applied/ignored
- [ ] Data source: GET /api/admin/production-ai/suggestions/stats

**Suggestion Cards:**
- [ ] Shows: 10 most recent suggestions
- [ ] Sorted by: Priority (High → Medium → Low), then date (newest first)
- [ ] Empty state: "No suggestions yet. Production call data will appear here once LLM analyzes calls."

**Each Suggestion Card Contains:**

**Priority Indicator:**
- [ ] High: 🔥 Red badge, "High Priority (X% confidence)"
- [ ] Medium: 🟡 Yellow badge, "Medium Priority (X% confidence)"
- [ ] Low: 🔵 Blue badge, "Low Priority (X% confidence)"

**Brief Description:**
- [ ] 1-line summary (e.g., "Add synonym: 'thingy on wall' → 'thermostat'")
- [ ] Auto-generated from suggestion type

**Impact Summary:**
- [ ] Shows: "Impact: X similar calls/month | Saves $X.XX/mo"
- [ ] Shows: "Impact: X unmatched calls this month" (for missing scenarios)
- [ ] Shows: "Impact: Appears in X% of calls" (for filler words)

**Metadata:**
- [ ] Timestamp: "Oct 29, 2025 10:23 AM"
- [ ] Company: "ABC Plumbing"
- [ ] Template: "HVAC Trade Knowledge"

**Action Button:**
- [ ] Text: "📄 View Full Details"
- [ ] onClick: `openSuggestionModal(suggestionId)`
- [ ] Styling: Blue, hover effect

**Load More:**
- [ ] Button: "Load More Suggestions..."
- [ ] Shows: Only if more than 10 suggestions exist
- [ ] Loads: Next 10 suggestions
- [ ] onClick: `productionAIManager.loadMoreSuggestions()`

---

### 🔷 SECTION 4: FULL-SCREEN SUGGESTION MODAL

**Modal Container:**
- [ ] Opens: When "View Full Details" clicked
- [ ] Style: Full browser window, overlay background
- [ ] ID: `suggestion-analysis-modal`
- [ ] z-index: 9999 (above everything)
- [ ] Scroll: Enabled (content may be long)

**Modal Header:**
- [ ] Back button: "◀ Back to Suggestions Queue"
  - [ ] onClick: `closeSuggestionModal()`
- [ ] Close X button: Top right corner
  - [ ] onClick: `closeSuggestionModal()`

**Modal Title:**
- [ ] Text: "🤖 LLM SUGGESTION ANALYSIS - Full Call Review"
- [ ] Subtitle: "Suggestion #X - [Type] - [Priority]"

---

#### **MODAL SECTION 1: Call Details & Quick Actions**

**Left Panel: Call Details**
- [ ] Date: "Oct 29, 2025 10:23 AM"
- [ ] Company: "ABC Plumbing" (linked to company profile)
- [ ] Template: "HVAC Trade Knowledge" (linked to template)
- [ ] Duration: "2:34"
- [ ] Caller: "(555) 123-4567" (formatted)
- [ ] Cost: "$0.47 (Tier 3 LLM)"
- [ ] Call ID: "#12345" (for reference)

**Right Panel: Quick Actions**
- [ ] Button: "✓ Apply All Suggestions"
  - [ ] onClick: `applySuggestion(suggestionId, 'all')`
  - [ ] Applies: All improvements in this suggestion
  - [ ] Shows: Progress toast for each improvement
  - [ ] Updates: Template/category in database
  - [ ] Clears: Redis cache
  - [ ] Sends: Notification to Notification Center
  - [ ] Marks: Suggestion as "applied" in database
  - [ ] Updates: Stats bar (Pending -1, Applied +1)
- [ ] Button: "✗ Ignore All"
  - [ ] onClick: `ignoreSuggestion(suggestionId)`
  - [ ] Marks: Suggestion as "ignored" in database
  - [ ] Updates: Stats bar (Pending -1, Ignored +1)
  - [ ] Shows: Confirmation toast
- [ ] Button: "💾 Save for Later"
  - [ ] onClick: `saveSuggestionForLater(suggestionId)`
  - [ ] Marks: Suggestion as "saved"
  - [ ] Keeps: In pending queue
  - [ ] Shows: Confirmation toast
- [ ] Button: "📋 Export Report"
  - [ ] onClick: `exportSuggestionReport(suggestionId)`
  - [ ] Generates: PDF or JSON report
  - [ ] Downloads: To user's computer
  - [ ] Contains: Full call details, reasoning, suggestions

---

#### **MODAL SECTION 2: Full Call Transcript**

**Section Header:**
- [ ] Title: "📝 FULL CALL TRANSCRIPT"
- [ ] Subtitle: "Complete conversation between caller and AI agent"

**Transcript Display:**
- [ ] Format: Speech bubble style (left: caller, right: agent)
- [ ] Background: Light gray box, monospace font
- [ ] Syntax highlighting: Bold for speaker labels ("Caller:", "Agent:")
- [ ] Scroll: If transcript is long
- [ ] Copy button: Top right of transcript box
  - [ ] onClick: Copies full transcript to clipboard
  - [ ] Shows: "Copied!" toast

**Example:**
```
Caller: "Hey, um, like, my thingy on the wall, you know, the one that 
        controls the temperature? It's like, not working. I think it needs
        batteries or something. Can someone come check it out?"

Agent: "I understand you're having an issue with your thermostat. Let me
       help you with that. First, let's try replacing the batteries..."
```

---

#### **MODAL SECTION 3: Routing Flow Visualization**

**Section Header:**
- [ ] Title: "⚡ ROUTING FLOW VISUALIZATION"
- [ ] Subtitle: "3-tier intelligence system progression"

**Flow Diagram:**
- [ ] Shows: Tier 1 → Tier 2 → Tier 3 as vertical blocks
- [ ] Color coding:
  - [ ] Green: Success/matched
  - [ ] Red: Failed/no match
  - [ ] Gray: Not reached

**Tier 1 Block:**
- [ ] Title: "TIER 1 - Rule-Based"
- [ ] Response time: "5-15ms"
- [ ] Status: ✅ SUCCESS or ❌ FAILED
- [ ] Confidence: "0.XX"
- [ ] Details: Why it matched/failed
  - [ ] Example: "❌ FAILED (confidence: 0.23)"
  - [ ] Example: "↳ Keywords 'thingy', 'wall' not recognized"

**Tier 2 Block:**
- [ ] Title: "TIER 2 - Semantic"
- [ ] Response time: "20-40ms"
- [ ] Status: ✅ SUCCESS or ❌ FAILED
- [ ] Confidence: "0.XX"
- [ ] Details: Why it matched/failed
  - [ ] Example: "❌ FAILED (confidence: 0.45)"
  - [ ] Example: "↳ Vector similarity too low"

**Tier 3 Block:**
- [ ] Title: "TIER 3 - LLM Fallback"
- [ ] Response time: "XXXXms"
- [ ] Cost: "$0.XX"
- [ ] Status: ✅ SUCCESS or ❌ FAILED
- [ ] Confidence: "0.XX"
- [ ] Matched scenario: "Thermostat Battery Replacement"
- [ ] Details: Why it matched
  - [ ] Example: "✅ SUCCESS (confidence: 0.95)"
  - [ ] Example: "↳ Matched 'Thermostat Battery Replacement'"

---

#### **MODAL SECTION 4: LLM Reasoning & Analysis**

**Section Header:**
- [ ] Title: "🧠 LLM REASONING & ANALYSIS"
- [ ] Subtitle: "GPT-4 interpretation and pattern detection"

**Analysis Details:**
- [ ] Model: "GPT-4-turbo" (or actual model used)
- [ ] Analysis time: "X.Xs"
- [ ] Confidence: "XX%"
- [ ] Token count: "XXX tokens"
- [ ] Cost: "$0.XX"

**Reasoning Text:**
- [ ] Full LLM explanation (multi-paragraph)
- [ ] Formatted: Line breaks, bullet points preserved
- [ ] Highlights: Bold for key terms
- [ ] Sections:
  - [ ] "Context Clues Detected" (what LLM noticed)
  - [ ] "Pattern Recognition" (similar calls)
  - [ ] "Root Cause of Tier 1/2 Failure" (why rule-based failed)
  - [ ] "Business Impact" (cost, performance, customer experience)

**Example:**
```
The caller used highly colloquial language to describe a thermostat:

Context Clues Detected:
• Location: 'on the wall' → thermostats are wall-mounted
• Function: 'controls temperature' → primary thermostat purpose
• Symptom: 'needs batteries' → common thermostat issue
• Alternative names: 'thingy' → indicates unfamiliarity with technical terms

Pattern Recognition:
Similar calls detected in database: 12 instances this month
Common phrases: 'wall thing', 'temperature box', 'controller'

Root Cause of Tier 1/2 Failure:
Rule-based system requires technical vocabulary. Semantic matching failed
due to lack of synonym mapping for colloquial terms.

Business Impact:
Each LLM fallback costs $0.47. With 12 similar calls/month, total cost
is $5.64/month that could be saved with proper synonym mapping.
```

---

#### **MODAL SECTION 5: Suggested Improvements**

**Section Header:**
- [ ] Title: "💡 SUGGESTED IMPROVEMENTS (X actions)"
- [ ] Subtitle: "One-click actions to improve template performance"

**Improvement Cards (Up to 5 types):**

---

**IMPROVEMENT TYPE 1: Add Filler Words**

**Card Header:**
- [ ] Icon: "1️⃣"
- [ ] Title: "ADD FILLER WORDS"
- [ ] Impact badge: "Low Impact" (gray) or "Medium Impact" (yellow) or "High Impact" (red)

**Card Content:**
- [ ] Words to add: List of filler words (comma-separated)
  - [ ] Example: "um", "like", "you know", "uh", "well"
- [ ] Why: Explanation of impact
  - [ ] Example: "These appear in 85% of failed matches and add no semantic meaning"
- [ ] Target: Where they'll be added
  - [ ] Example: "Template-level filler words"
- [ ] Impact: What improves
  - [ ] Example: "Cleaner input for Tier 1/2 matching"

**Card Actions:**
- [ ] Button: "✓ Apply"
  - [ ] onClick: `applyImprovement(suggestionId, 'filler-words')`
  - [ ] Calls: POST /api/admin/production-ai/suggestions/:id/apply
  - [ ] Payload: `{ type: 'filler-words', words: [...] }`
  - [ ] Updates: Template filler words in database
  - [ ] Clears: Redis cache for template
  - [ ] Shows: Toast "Filler words added successfully"
  - [ ] Disables: Button after success (shows "✓ Applied")
- [ ] Button: "✗ Ignore"
  - [ ] onClick: `ignoreImprovement(suggestionId, 'filler-words')`
  - [ ] Marks: This improvement as ignored
  - [ ] Hides: This card from modal
  - [ ] Shows: Toast "Improvement ignored"
- [ ] Button: "Edit Before Apply"
  - [ ] onClick: `editImprovement(suggestionId, 'filler-words')`
  - [ ] Opens: Inline editor
  - [ ] Shows: Textarea with words (one per line)
  - [ ] Allows: User to add/remove words
  - [ ] Button: "Save & Apply" (saves edits, then applies)

---

**IMPROVEMENT TYPE 2: Add Synonym Mapping**

**Card Header:**
- [ ] Icon: "2️⃣"
- [ ] Title: "ADD SYNONYM MAPPING"
- [ ] Impact badge: "HIGH IMPACT ⭐⭐⭐" (red, pulsing)

**Card Content:**
- [ ] Mapping: "colloquial" → "technical"
  - [ ] Example: "thingy on the wall" → "thermostat"
- [ ] Why: Explanation
  - [ ] Example: "Detected 12 times this month, each costing $0.47 in LLM calls"
- [ ] Estimated Monthly Savings: "$X.XX"
- [ ] Performance Gain: "XXXXms → XXms (Tier 3 → Tier 1)"
- [ ] Additional synonyms detected: (if applicable)
  - [ ] Shows: List of related synonyms found
  - [ ] Example: "wall thing" → "thermostat" (4 occurrences)
  - [ ] Checkboxes: Allow user to select which to apply

**Card Actions:**
- [ ] Button: "✓ Apply All"
  - [ ] onClick: `applyImprovement(suggestionId, 'synonym-mapping', { applyAll: true })`
  - [ ] Applies: Main synonym + all additional ones checked
  - [ ] Updates: Category synonyms in database
  - [ ] Clears: Redis cache
  - [ ] Shows: Toast "Synonyms added successfully"
- [ ] Button: "Select Individual"
  - [ ] onClick: Opens checklist modal
  - [ ] Shows: All detected synonyms with checkboxes
  - [ ] Button: "Apply Selected" (applies only checked ones)
- [ ] Button: "✗ Ignore"
  - [ ] Same as filler words

---

**IMPROVEMENT TYPE 3: Enhance Existing Scenario**

**Card Header:**
- [ ] Icon: "3️⃣"
- [ ] Title: "ENHANCE EXISTING SCENARIO"
- [ ] Impact badge: "Medium Impact" (yellow)

**Card Content:**
- [ ] Scenario: Name + link
  - [ ] Example: "Thermostat Battery Replacement" (linked to scenario editor)
- [ ] Current keywords: List
  - [ ] Example: "thermostat", "battery", "dead", "replace"
- [ ] Suggested keyword additions: List with occurrence counts
  - [ ] Example: "thingy" (appears 12x)
  - [ ] Example: "wall device" (appears 7x)
  - [ ] Example: "temperature control" (appears 15x)
  - [ ] Example: "not working" (appears 45x)
- [ ] Why: Explanation
  - [ ] Example: "Improves Tier 1 matching for non-technical callers"
- [ ] Impact: Prediction
  - [ ] Example: "15-20 additional Tier 1 matches per month"

**Card Actions:**
- [ ] Button: "✓ Apply"
  - [ ] onClick: `applyImprovement(suggestionId, 'enhance-scenario')`
  - [ ] Updates: Scenario keywords in database
  - [ ] Clears: Redis cache
  - [ ] Shows: Toast "Scenario enhanced successfully"
- [ ] Button: "Edit Keywords"
  - [ ] Opens: Inline editor with keyword list
  - [ ] Allows: Add/remove/edit keywords
  - [ ] Button: "Save & Apply"
- [ ] Button: "✗ Ignore"
  - [ ] Same as above

---

**IMPROVEMENT TYPE 4: Add Negative Keywords**

**Card Header:**
- [ ] Icon: "4️⃣"
- [ ] Title: "ADD NEGATIVE KEYWORDS"
- [ ] Impact badge: "High Impact" (red)

**Card Content:**
- [ ] Scenario: Name + link
- [ ] Current negative keywords: List (may be empty)
- [ ] Suggested additions: List with reasons
  - [ ] Example: "don't need" → Prevents false positive when caller declines
  - [ ] Example: "not interested" → Avoids triggering booking when caller refuses
- [ ] Why: Explanation
  - [ ] Example: "'Appointment Booking' scenario falsely matched 8x this month"
- [ ] Impact: Prediction
  - [ ] Example: "Reduces false positives by ~70%"

**Card Actions:**
- [ ] Same pattern as other improvement types

---

**IMPROVEMENT TYPE 5: Create Missing Scenario**

**Card Header:**
- [ ] Icon: "5️⃣"
- [ ] Title: "CREATE MISSING SCENARIO"
- [ ] Impact badge: "HIGH IMPACT ⭐⭐⭐" (red, pulsing)

**Card Content:**
- [ ] Suggested scenario name: "Payment Plan Inquiry"
- [ ] Suggested category: "Billing & Payment"
- [ ] Suggested keywords: List
  - [ ] Example: "payment plan", "installments", "monthly payments", "split payment"
- [ ] Suggested negative keywords: List
- [ ] Suggested response template: Multi-line text
  - [ ] Example: "We offer flexible payment plans for repairs over $500..."
- [ ] Suggested action hook: Dropdown (if applicable)
- [ ] Suggested behavior: Dropdown
  - [ ] Example: "Professional & Helpful"
- [ ] Why: Explanation
  - [ ] Example: "23 similar calls this month, no matching scenario. High business impact."
- [ ] LLM reasoning: Full explanation of why this scenario is needed

**Card Actions:**
- [ ] Button: "✓ Create Scenario"
  - [ ] onClick: `applyImprovement(suggestionId, 'create-scenario')`
  - [ ] Creates: New scenario in database
  - [ ] Assigns: To suggested category (or creates category if needed)
  - [ ] Clears: Redis cache
  - [ ] Sends: Notification "New scenario created from LLM suggestion"
  - [ ] Shows: Toast "Scenario created successfully"
  - [ ] Opens: Scenario editor (optional)
- [ ] Button: "Edit Before Creating"
  - [ ] Opens: Full scenario form pre-filled
  - [ ] Allows: User to modify all fields
  - [ ] Button: "Create Scenario"
- [ ] Button: "✗ Ignore"
  - [ ] Same as above

---

#### **MODAL SECTION 6: Impact Analysis & ROI**

**Section Header:**
- [ ] Title: "📊 IMPACT ANALYSIS & ROI"
- [ ] Subtitle: "Predicted performance gains and cost savings"

**Metrics Display:**

**Similar Calls:**
- [ ] This month: X calls
- [ ] Last month: Y calls
- [ ] Projected next month: Z calls (with confidence range)

**Current Performance:**
- [ ] Tier usage: "Tier 3 (LLM) used 100% of the time for these queries"
- [ ] Avg cost per call: "$0.XX"
- [ ] Avg response time: "X.Xs"
- [ ] Monthly cost: "$XX.XX"

**After Applying Suggestions:**
- [ ] Tier 1 (Rule) catch rate: "~XX%"
- [ ] Tier 2 (Semantic) catch rate: "~XX%"
- [ ] Tier 3 (LLM) remaining: "~X%"
- [ ] Monthly savings: "$XX.XX"
- [ ] Response time improvement: "XXXXms faster"
- [ ] Customer experience: "Better" (with explanation)

**ROI Calculation:**
- [ ] One-time setup time: "5 minutes"
- [ ] Monthly savings: "$XX.XX"
- [ ] Annual savings: "$XXX.XX"
- [ ] Payback period: "Immediate"
- [ ] Performance gain: "XX% faster responses"

---

#### **MODAL SECTION 7: Related Suggestions**

**Section Header:**
- [ ] Title: "🔄 RELATED SUGGESTIONS"
- [ ] Subtitle: "Other improvements for the same template/category"

**Related Suggestion Cards (3 max):**
- [ ] Shows: Suggestions with similar patterns
- [ ] Each card: Mini version (1 line + link)
  - [ ] Example: "• Suggestion #126: Add 'temperature gadget' synonym (same pattern)"
  - [ ] Link: `onclick="openSuggestionModal(126)"` (opens that suggestion)
- [ ] Empty state: "No related suggestions found"

---

### 🔷 SECTION 5: BACKEND - CALL LOG STORAGE

**New Model: ProductionAICallLog**
- [ ] File: `models/ProductionAICallLog.js`
- [ ] Schema fields:
  - [ ] `companyId` (ObjectId, required, indexed)
  - [ ] `templateId` (ObjectId, required, indexed)
  - [ ] `categoryId` (ObjectId, optional)
  - [ ] `scenarioId` (ObjectId, optional)
  - [ ] `callId` (String, unique)
  - [ ] `callerPhone` (String)
  - [ ] `transcript` (String, full conversation)
  - [ ] `tierUsed` (Number, 1/2/3)
  - [ ] `tier1Result` (Object: confidence, matched, reason)
  - [ ] `tier2Result` (Object: confidence, matched, reason)
  - [ ] `tier3Result` (Object: confidence, matched, reason, cost, model)
  - [ ] `finalResponse` (String)
  - [ ] `responseTime` (Number, milliseconds)
  - [ ] `cost` (Number, dollars)
  - [ ] `timestamp` (Date, indexed)
  - [ ] `analyzed` (Boolean, default: false)
  - [ ] `suggestionsGenerated` (Boolean, default: false)
- [ ] Indexes:
  - [ ] `companyId + timestamp` (compound)
  - [ ] `templateId + timestamp` (compound)
  - [ ] `tierUsed` (for analytics)
  - [ ] `analyzed` (for processing queue)
- [ ] TTL: 90 days (auto-delete old logs)
  - [ ] Index: `{ timestamp: 1, expireAfterSeconds: 7776000 }`

**API Endpoint: Store Call Log**
- [ ] Route: `POST /api/admin/production-ai/call-logs`
- [ ] Middleware: `authenticateJWT`, `adminOnly` (or service-to-service auth)
- [ ] Request body: All ProductionAICallLog fields
- [ ] Validation: Joi schema for all fields
- [ ] Logic:
  - [ ] Create new ProductionAICallLog document
  - [ ] Save to database
  - [ ] If `tierUsed === 3`, queue for LLM analysis
  - [ ] Return: `{ success: true, callLogId }`
- [ ] Error handling: Log to Notification Center if fails

**Integration Point: v2twilio.js**
- [ ] After call completes: Call POST /api/admin/production-ai/call-logs
- [ ] Include: Full transcript, tier results, response, timing, cost
- [ ] Non-blocking: Don't wait for response (fire-and-forget)
- [ ] Error handling: Log error but don't fail call

---

### 🔷 SECTION 6: BACKEND - LLM SUGGESTION GENERATION

**New Service: LLMSuggestionAnalyzer**
- [ ] File: `services/LLMSuggestionAnalyzer.js`
- [ ] Purpose: Analyze Tier 3 LLM calls and generate suggestions

**analyzeCall() Method:**
- [ ] Input: ProductionAICallLog document
- [ ] Logic:
  - [ ] 1. Extract transcript, tier results, LLM reasoning
  - [ ] 2. Call OpenAI GPT-4 with analysis prompt
  - [ ] 3. Parse LLM response (JSON format)
  - [ ] 4. Identify improvements:
    - [ ] Filler words (words that add no meaning)
    - [ ] Synonyms (colloquial → technical mappings)
    - [ ] Keywords (terms to add to scenarios)
    - [ ] Negative keywords (terms to exclude)
    - [ ] Missing scenarios (gaps in coverage)
  - [ ] 5. Calculate impact (similar calls, cost savings, performance gain)
  - [ ] 6. Create SuggestionKnowledgeBase document
  - [ ] 7. Send ACTION_REQUIRED notification if high priority
- [ ] Error handling: Log to Notification Center, retry 3x, then skip
- [ ] Performance: Process in background queue (not blocking)

**GPT-4 Analysis Prompt:**
```
You are analyzing a customer service call where the AI agent used expensive
LLM fallback (Tier 3) instead of cheaper rule-based or semantic matching.

Your task: Identify specific improvements to prevent future LLM calls.

Call Details:
- Transcript: [full transcript]
- Tier 1 Result: [confidence, why it failed]
- Tier 2 Result: [confidence, why it failed]
- Tier 3 Result: [what LLM matched]

Analyze and return JSON:
{
  "fillerWords": ["um", "like", ...],
  "synonymMappings": [
    { "colloquial": "thingy on wall", "technical": "thermostat", "confidence": 0.95 }
  ],
  "keywordsToAdd": {
    "scenarioId": "...",
    "keywords": ["thingy", "wall device", ...]
  },
  "negativeKeywords": {
    "scenarioId": "...",
    "keywords": ["don't need", ...]
  },
  "missingScenario": {
    "name": "Payment Plan Inquiry",
    "category": "Billing",
    "keywords": [...],
    "response": "..."
  },
  "reasoning": "Full explanation...",
  "impact": {
    "similarCallsThisMonth": 12,
    "estimatedMonthlySavings": 5.64,
    "performanceGain": 2785
  }
}
```

**Background Processing:**
- [ ] Cron job: Runs every 5 minutes
- [ ] Query: ProductionAICallLog where `tierUsed === 3 AND analyzed === false`
- [ ] Limit: Process 10 calls per run (avoid overload)
- [ ] For each call: Call `LLMSuggestionAnalyzer.analyzeCall()`
- [ ] Mark: `analyzed = true` after processing
- [ ] Errors: Log to Notification Center, retry later

---

### 🔷 SECTION 7: BACKEND - SUGGESTION STORAGE

**Existing Model: SuggestionKnowledgeBase**
- [ ] File: `models/knowledge/SuggestionKnowledgeBase.js` (already exists)
- [ ] New fields to add:
  - [ ] `callLogId` (ObjectId, reference to ProductionAICallLog)
  - [ ] `llmReasoning` (String, full LLM explanation)
  - [ ] `llmModel` (String, e.g., "gpt-4-turbo")
  - [ ] `llmCost` (Number, cost of analysis)
  - [ ] `impact` (Object):
    - [ ] `similarCallsThisMonth` (Number)
    - [ ] `similarCallsLastMonth` (Number)
    - [ ] `projectedNextMonth` (Number)
    - [ ] `estimatedMonthlySavings` (Number, dollars)
    - [ ] `performanceGain` (Number, milliseconds)
    - [ ] `currentTierUsage` (Object: tier1, tier2, tier3 percentages)
    - [ ] `projectedTierUsage` (Object: after applying suggestions)
  - [ ] `relatedSuggestions` (Array of ObjectIds)
  - [ ] `appliedAt` (Date, when suggestion was applied)
  - [ ] `appliedBy` (ObjectId, which admin applied it)
  - [ ] `ignoredAt` (Date, when suggestion was ignored)
  - [ ] `ignoredBy` (ObjectId, which admin ignored it)

**API Endpoints:**

**GET /api/admin/production-ai/suggestions/stats**
- [ ] Returns: `{ pending: X, applied: Y, ignored: Z }`
- [ ] Filters: By templateId if provided
- [ ] Cache: 30 seconds

**GET /api/admin/production-ai/suggestions/:templateId**
- [ ] Returns: Array of suggestions for template
- [ ] Filters: `status === 'pending'`, sorted by priority + date
- [ ] Limit: 10 per page
- [ ] Pagination: `?page=2` for next 10
- [ ] Include: Call log data, impact analysis, related suggestions

**GET /api/admin/production-ai/suggestions/:id/details**
- [ ] Returns: Full suggestion with complete call transcript, tier results, LLM reasoning
- [ ] Include: Related suggestions (3 max)
- [ ] Include: ROI calculation

**POST /api/admin/production-ai/suggestions/:id/apply**
- [ ] Request body: `{ type: 'filler-words' | 'synonym' | 'keywords' | 'negative-keywords' | 'create-scenario', data: {...} }`
- [ ] Validation: Suggestion exists, not already applied, valid type
- [ ] Logic:
  - [ ] If filler-words: Update template filler words array
  - [ ] If synonym: Update category synonyms
  - [ ] If keywords: Update scenario keywords array
  - [ ] If negative-keywords: Update scenario negativeKeywords array
  - [ ] If create-scenario: Create new scenario document
  - [ ] Clear Redis cache for affected template/category
  - [ ] Mark suggestion as applied (`status = 'applied', appliedAt = now, appliedBy = req.user._id`)
  - [ ] Send notification: "Suggestion applied successfully"
- [ ] Returns: `{ success: true, updated: {...} }`
- [ ] Error handling: Rollback on failure, log to Notification Center

**POST /api/admin/production-ai/suggestions/:id/ignore**
- [ ] Mark suggestion as ignored
- [ ] Update: `status = 'ignored', ignoredAt = now, ignoredBy = req.user._id`
- [ ] Returns: `{ success: true }`

---

### 🔷 SECTION 8: INTEGRATION WITH TEMPLATES TAB

**Templates Table Enhancements:**
- [ ] Each template row: Add "⚙️ Production AI" button
- [ ] Button location: Last column, after "Edit" button
- [ ] Button onClick: `navigateToProductionAI(templateId)`
- [ ] Function logic:
  - [ ] Switch to Overview tab
  - [ ] Switch to Production AI sub-tab
  - [ ] Load suggestions for this templateId
  - [ ] Scroll to suggestions queue
- [ ] Button style: Small, icon-only or icon+text

**Template Selector in Production AI:**
- [ ] Location: Above suggestions queue section
- [ ] Label: "Filter by Template:"
- [ ] Dropdown: Shows all templates
- [ ] Default: "All Templates"
- [ ] onChange: Reload suggestions for selected template
- [ ] Persist: Selection in sessionStorage

---

### 🔷 SECTION 9: INTEGRATION WITH TEST PILOT

**Test Pilot Enhancements:**
- [ ] After test query runs: Log to ProductionAICallLogs
- [ ] Test indicator: Mark as `isTest: true` in call log
- [ ] Show tier used: "Matched via Tier 1 (Rule-Based)" in results panel
- [ ] New button: "Generate Suggestion"
  - [ ] Location: Below test results
  - [ ] onClick: `generateSuggestionFromTest(callLogId)`
  - [ ] Calls: LLMSuggestionAnalyzer.analyzeCall() immediately (don't wait for cron)
  - [ ] Shows: Toast "Analyzing call..." then "Suggestion created"
  - [ ] Links: "View Suggestion" (opens suggestion modal)

---

### 🔷 SECTION 10: INTEGRATION WITH NOTIFICATION CENTER

**Notification Types:**

**ACTION_REQUIRED: New High-Priority Suggestion**
- [ ] Code: `PRODUCTION_AI_SUGGESTION_HIGH_PRIORITY`
- [ ] Severity: WARNING (email only, no SMS)
- [ ] Sent when: High-priority suggestion created (confidence > 90%)
- [ ] Message: "New high-priority suggestion: [brief description]"
- [ ] Details: Call ID, company, template, estimated savings
- [ ] Action: Link to suggestion modal
- [ ] Throttle: Max 1 per hour (prevent spam)

**INFO: Suggestion Applied**
- [ ] Code: `PRODUCTION_AI_SUGGESTION_APPLIED`
- [ ] Severity: INFO
- [ ] Sent when: Admin applies suggestion
- [ ] Message: "Suggestion applied: [type] for template [name]"
- [ ] Details: What changed, by whom, timestamp

**CRITICAL: LLM Analysis Failed**
- [ ] Code: `PRODUCTION_AI_ANALYSIS_FAILED`
- [ ] Severity: CRITICAL (email + SMS)
- [ ] Sent when: LLMSuggestionAnalyzer fails 3x for same call
- [ ] Message: "Failed to analyze call log after 3 attempts"
- [ ] Details: Call ID, error message, stack trace
- [ ] Action: Manual review required

---

### 🔷 SECTION 11: ERROR HANDLING & EDGE CASES

**All API Calls:**
- [ ] Wrap in try-catch
- [ ] Show error toast: "Failed to [action]: [error message]"
- [ ] Log to console: Full error with stack trace
- [ ] Report to Notification Center: If critical (save failures)

**Network Failures:**
- [ ] Show: "Connection lost, retrying..." message
- [ ] Retry: Exponential backoff (1s, 2s, 4s)
- [ ] Max retries: 3
- [ ] After 3 failures: "Unable to connect, please refresh page"

**Auth Failures:**
- [ ] Detect: 401 response from API
- [ ] Clear: localStorage token
- [ ] Redirect: /login.html with message "Session expired"

**Empty States:**
- [ ] No suggestions: "No suggestions yet. Production call data will appear here once LLM analyzes calls."
- [ ] No templates: "No templates found. Create a template in the Templates tab."
- [ ] No companies: "No companies found. Add a company first."

**Loading States:**
- [ ] Health check: Show spinner on button, disable button
- [ ] Suggestions load: Show skeleton cards (3 gray boxes)
- [ ] Modal load: Show "Loading suggestion..." overlay
- [ ] Apply suggestion: Show progress toast, disable button

**Data Validation:**
- [ ] Suggestion ID: Must be valid ObjectId
- [ ] Template ID: Must exist in database
- [ ] Company ID: Must exist in database
- [ ] All required fields: Check before API call

---

### 🔷 SECTION 12: PERFORMANCE & OPTIMIZATION

**Caching:**
- [ ] Suggestions list: Cache for 60 seconds
- [ ] Health status: Cache for 30 seconds
- [ ] Stats bar: Cache for 30 seconds
- [ ] Clear cache: When suggestion applied/ignored

**Lazy Loading:**
- [ ] Suggestions: Load 10 at a time (pagination)
- [ ] Modal: Only load full details when opened
- [ ] Transcript: Truncate if > 5000 chars (show "Read more")

**Debouncing:**
- [ ] Template selector: 500ms debounce
- [ ] Search (if added): 300ms debounce

**Auto-Refresh:**
- [ ] Health status: Every 30 seconds (only LLM card)
- [ ] Suggestions queue: Every 5 minutes
- [ ] Stats bar: Every 5 minutes
- [ ] Stop: When tab not visible (use Page Visibility API)

---

### 🔷 SECTION 13: TESTING REQUIREMENTS

**Manual Testing Checklist:**
(See VERIFICATION CHECKLIST document for full details)

**Minimum Tests Required:**
- [ ] Navigate to Production AI tab (works)
- [ ] See health dashboard (4 cards show)
- [ ] Click "Test OpenAI Connection" (updates card, shows toast)
- [ ] See suggestions queue (loads or shows empty state)
- [ ] Click "View Full Details" (opens modal)
- [ ] In modal: See all sections (transcript, routing, reasoning, suggestions, impact)
- [ ] Click "Apply" on filler words (applies, shows toast, marks applied)
- [ ] Click "Apply" on synonym (updates template, clears cache, shows toast)
- [ ] Click "Ignore" (marks ignored, removes from queue)
- [ ] Close modal (returns to queue)
- [ ] Go to Templates tab, click "Production AI" button (navigates correctly)
- [ ] Disconnect internet, click button (shows error toast)
- [ ] Reconnect, click button (works)

**API Testing (Postman):**
- [ ] GET /api/admin/production-ai/health/openai (returns status)
- [ ] GET /api/admin/production-ai/suggestions/stats (returns counts)
- [ ] GET /api/admin/production-ai/suggestions/:templateId (returns array)
- [ ] GET /api/admin/production-ai/suggestions/:id/details (returns full object)
- [ ] POST /api/admin/production-ai/suggestions/:id/apply (updates database)
- [ ] POST /api/admin/production-ai/suggestions/:id/ignore (marks ignored)
- [ ] POST /api/admin/production-ai/call-logs (stores call log)

**Integration Testing:**
- [ ] Create test suggestion → appears in queue
- [ ] Apply suggestion → template updated in database
- [ ] Check Redis cache → cleared after apply
- [ ] Check Notification Center → alert created
- [ ] Refresh page → changes persist

---

## 🚨 DEFINITION OF DONE

This feature is NOT complete until:

- [ ] ✅ Every checkbox in this document is checked
- [ ] ✅ All buttons work (none disabled or non-functional)
- [ ] ✅ All API endpoints return correct data
- [ ] ✅ All integrations work (Templates, Test Pilot, Notifications)
- [ ] ✅ All error cases handled gracefully
- [ ] ✅ All loading states show
- [ ] ✅ All empty states show
- [ ] ✅ Full manual testing completed (VERIFICATION CHECKLIST)
- [ ] ✅ REFACTOR_PROTOCOL audit passed
- [ ] ✅ No console errors
- [ ] ✅ User (Marc) approves functionality

---

## 📝 SIGNATURES

**Developer:** _____________________ (AI Assistant)  
**Date Started:** October 29, 2025  
**Date Completed:** _____________________

**Approver:** _____________________ (Marc, ClientsVia.ai)  
**Date Approved:** _____________________

---

**END OF FEATURE CONTRACT**

