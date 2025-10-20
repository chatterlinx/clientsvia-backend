# 🧪 COMPLETE TESTING GUIDE
## Systems 1, 2, 3: AI Performance, Call Archives, Spam Filter

**Date:** October 20, 2025  
**Version:** 1.0  
**Purpose:** Step-by-step testing instructions for all 3 newly built systems

---

## 🎯 OVERVIEW

We've built 3 major enterprise systems:
1. **AI Performance Dashboard** - Real-time AI metrics & database performance
2. **Call Archives** - Search, view, export all call transcripts
3. **Smart Call Filter** - Multi-layer spam/robocall protection

---

## ✅ PRE-TESTING CHECKLIST

Before you begin testing, ensure:
- [ ] Backend server is running (`npm start` or deployed to Render)
- [ ] You have admin credentials
- [ ] At least 1 company exists in the database
- [ ] Redis is running (for caching)
- [ ] MongoDB is accessible

---

# 📊 SYSTEM 1: AI PERFORMANCE DASHBOARD

## What It Does
Tracks AI Agent response times, cache efficiency, database index usage, and slow queries in real-time.

## Where to Find It
1. **Option A: Company Profile → AI Performance Tab**
   - Go to: `https://your-domain.com/company-profile.html?id=COMPANY_ID`
   - Click the **"AI Performance"** tab (icon: tachometer)

2. **Option B: AI Agent Settings → Analytics → AI Performance Sub-tab**
   - Go to: `https://your-domain.com/company-profile.html?id=COMPANY_ID`
   - Click **"AI Agent Settings"** tab
   - Click **"Analytics"** sub-tab
   - Click **"AI Performance"** within Analytics

---

## 🧪 TEST CASES

### Test 1.1: Dashboard Loads Successfully
**Steps:**
1. Navigate to Company Profile → AI Performance tab
2. Wait for dashboard to load (2-3 seconds)

**Expected Results:**
✅ Page shows "AI Performance Dashboard" header  
✅ 4 stat cards appear:
   - Total Lookups
   - Average Speed
   - Cache Hit Rate
   - Database Queries
✅ "Speed Breakdown" chart displays  
✅ "7-Day Performance Trends" chart displays  
✅ "Database Index Usage" table shows indexes  
✅ "Slow Queries" table appears (may be empty)  
✅ "Database Statistics" card shows collection info  
✅ Console logs show checkpoints 1-10 without errors

**If No Data:**
✅ Dashboard should show zeros or "No data yet" messages  
✅ This is normal if no AI calls have been made yet

---

### Test 1.2: Real-Time Data Updates
**Steps:**
1. Make an AI phone call to the company (or trigger the AI Agent via API)
2. Wait 30 seconds (auto-refresh interval)
3. Observe the dashboard

**Expected Results:**
✅ "Total Lookups" count increases  
✅ "Average Speed" updates with new timing  
✅ "Cache Hit Rate" percentage updates  
✅ New entry appears in "7-Day Performance Trends"  
✅ Console shows "🔄 [AI PERF DASHBOARD] Auto-refreshing..."

---

### Test 1.3: Database Index Usage
**Steps:**
1. Scroll to "Database Index Usage" section
2. Look for these critical indexes:
   - `companyId_1` on `v2companies`
   - `companyId_1_timestamp_1` on `v2aiagentcalllogs`

**Expected Results:**
✅ At least 5-10 indexes listed  
✅ "Accesses" column shows numbers > 0  
✅ "Usage %" shows percentage of total queries  
✅ No red warning messages about missing indexes

---

### Test 1.4: Slow Queries Detection
**Steps:**
1. Scroll to "Slow Queries (>100ms)" section
2. Check if any queries appear

**Expected Results:**
✅ If slow queries exist, they show:
   - Collection name
   - Query time in ms
   - Query pattern (sanitized)
✅ If empty: shows "No slow queries detected 🎉"

---

### Test 1.5: Manual Refresh
**Steps:**
1. Make several AI calls
2. Click browser refresh (F5)
3. Watch dashboard reload

**Expected Results:**
✅ Dashboard clears and shows loading state  
✅ New data loads within 2-3 seconds  
✅ All metrics update to reflect new calls

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "No auth token found" in console | Not logged in | Clear cookies, log in again |
| All metrics show "0" | No calls made yet | Make test AI calls first |
| Dashboard stuck loading | API endpoint error | Check browser console for 500 errors |
| "Container not found" error | Wrong container ID | Clear cache, hard refresh (Ctrl+Shift+R) |

---

# 📞 SYSTEM 2: CALL ARCHIVES

## What It Does
Provides comprehensive search, filtering, viewing, and exporting of all call transcripts and recordings across all companies.

## Where to Find It
**Navigation Bar → Call Archives**
- From any admin page (Directory, Data Center, Global AI Brain, etc.)
- Look for the 📞 "Call Archives" link in the navigation
- Direct URL: `https://your-domain.com/admin-call-archives.html`

---

## 🧪 TEST CASES

### Test 2.1: Page Loads with Stats
**Steps:**
1. Navigate to Call Archives page
2. Wait for page to load

**Expected Results:**
✅ Header shows "📞 Call Transcripts & Recordings"  
✅ 4 stat cards at top:
   - Total Calls
   - Total Minutes
   - Companies with Calls
   - Average Call Duration
✅ Search box appears  
✅ Filter dropdowns appear (Company, Date Range, Confidence, Source, Sentiment)  
✅ Empty table shows "Loading..." initially

---

### Test 2.2: Search by Keywords
**Steps:**
1. In the search box, type: `plumbing`
2. Click "Search" button
3. Wait for results

**Expected Results:**
✅ Table updates with filtered results  
✅ Only calls with "plumbing" in transcript appear  
✅ Pagination shows correct page count  
✅ Each row shows:
   - Company Name
   - Caller ID
   - Date/Time
   - Confidence Score (with color badge)
   - Source (Instant Response / Company Q&A / Trade Q&A / Template / Fallback)
   - Sentiment (😊 / 😐 / ☹️)
   - Actions (View button)

---

### Test 2.3: Filter by Company
**Steps:**
1. Clear search box
2. Select a company from "Company" dropdown
3. Click "Search"

**Expected Results:**
✅ Only calls from that company appear  
✅ Stat cards update to reflect filtered data  
✅ Results show only the selected company

---

### Test 2.4: Filter by Date Range
**Steps:**
1. Set "From Date" to 7 days ago
2. Set "To Date" to today
3. Click "Search"

**Expected Results:**
✅ Only calls within date range appear  
✅ Dates shown match the selected range  
✅ No calls outside the range appear

---

### Test 2.5: View Call Details (Transcript)
**Steps:**
1. Find any call in the results table
2. Click the blue "View" button

**Expected Results:**
✅ Modal window opens  
✅ Modal shows:
   - Company Name
   - Caller ID
   - Timestamp
   - Duration
   - Confidence Score
   - Match Source
   - Full transcript (if available)
   - Recording player (if available)
✅ Close button (X) works

---

### Test 2.6: Export to CSV
**Steps:**
1. Perform a search with some results
2. Click "Export CSV" button
3. Wait for download

**Expected Results:**
✅ CSV file downloads (e.g., `call-archives-2025-10-20.csv`)  
✅ File opens in Excel/Google Sheets  
✅ Columns include: Company, Caller ID, Timestamp, Duration, Confidence, Source, Sentiment, Transcript Preview  
✅ All visible rows are exported  
✅ No malicious content (CSV injection protected)

---

### Test 2.7: Pagination
**Steps:**
1. Search for calls with many results (>20)
2. Look at pagination controls at bottom
3. Click "Next" page button

**Expected Results:**
✅ Page 2 loads  
✅ Different calls appear  
✅ Page number updates (e.g., "Page 2 of 5")  
✅ "Previous" button becomes active  
✅ Can navigate back to Page 1

---

### Test 2.8: Sort by Column
**Steps:**
1. Click on "Date/Time" column header
2. Observe results reorder

**Expected Results:**
✅ Calls sort by date (newest first or oldest first)  
✅ Arrow icon appears showing sort direction  
✅ Clicking again reverses sort order

---

### Test 2.9: Quick Navigation from Data Center
**Steps:**
1. Go to Data Center page
2. Find a company in the table
3. Click the 📞 (phone icon) in "Quick Actions" column

**Expected Results:**
✅ Redirects to Call Archives page  
✅ Company is pre-selected in filter dropdown  
✅ Search auto-executes showing only that company's calls

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "No calls found" | No calls in database | Make test AI calls first |
| CSV export empty | API error | Check backend logs for `/export` endpoint |
| Modal won't open | JavaScript error | Check browser console, refresh page |
| Pagination not working | API returning wrong count | Check `/search` endpoint logs |
| Transcript shows "null" | Call didn't record transcript | Expected for old calls or test calls |

---

# 🛡️ SYSTEM 3: SMART CALL FILTER (SPAM PROTECTION)

## What It Does
5-layer intelligent spam detection system:
1. **Whitelist** - Always allow specific numbers
2. **Blacklist** - Always block specific numbers
3. **Global Spam DB** - Block numbers reported by other companies
4. **Frequency Analysis** - Block numbers calling too often
5. **Robocall Detection** - AI-powered automated call detection

## Where to Find It
**Company Profile → Spam Filter Tab**
- Navigate to: `https://your-domain.com/company-profile.html?id=COMPANY_ID`
- Click the **"Spam Filter"** tab (shield icon)

---

## 🧪 TEST CASES

### Test 3.1: Dashboard Loads
**Steps:**
1. Navigate to Company Profile → Spam Filter tab
2. Wait for dashboard to load

**Expected Results:**
✅ Header shows "🛡️ Smart Call Filter"  
✅ Status banner at top shows:
   - "🟢 Spam Filter Active" (if enabled)
   - OR "🔴 Spam Filter Disabled" (if disabled)
✅ Toggle switch matches enabled state  
✅ 4 stat cards show:
   - Calls Blocked (All Time)
   - Blacklisted Numbers
   - Whitelisted Numbers
   - Blocked Today
✅ Two sections appear: "Blacklist" and "Whitelist"  
✅ "Detection Settings" section appears at bottom

---

### Test 3.2: Enable/Disable Spam Filter
**Steps:**
1. Click the toggle switch in status banner
2. Wait for confirmation

**Expected Results:**
✅ Alert shows "✅ Spam filter enabled" or "✅ Spam filter disabled"  
✅ Status banner updates color (green → red or vice versa)  
✅ Status text updates  
✅ Console logs show API call succeeded  
✅ Page re-renders with new state

---

### Test 3.3: Add Number to Blacklist
**Steps:**
1. Click "+ Add Number" button in Blacklist section
2. Enter a test phone number: `+15551234567`
3. Click OK

**Expected Results:**
✅ Alert shows "✅ Number added to blacklist"  
✅ Number appears in the blacklist with phone icon  
✅ Delete button (trash icon) appears next to number  
✅ "Blacklisted Numbers" stat card increases by 1  
✅ Dashboard re-renders

---

### Test 3.4: Remove Number from Blacklist
**Steps:**
1. Find a blacklisted number
2. Click the red trash icon next to it
3. Confirm removal

**Expected Results:**
✅ Confirmation dialog appears  
✅ Alert shows "✅ Number removed from blacklist"  
✅ Number disappears from list  
✅ "Blacklisted Numbers" stat card decreases by 1

---

### Test 3.5: Add Number to Whitelist
**Steps:**
1. Click "+ Add Number" button in Whitelist section
2. Enter a test phone number: `+15559876543`
3. Click OK

**Expected Results:**
✅ Alert shows "✅ Number added to whitelist"  
✅ Number appears in the whitelist  
✅ Delete button appears next to number  
✅ "Whitelisted Numbers" stat card increases by 1

---

### Test 3.6: Invalid Phone Number Format
**Steps:**
1. Click "+ Add Number" in Blacklist
2. Enter invalid format: `555-1234` (not E.164)
3. Click OK

**Expected Results:**
✅ Alert shows "❌ Invalid phone number format. Use E.164 format (e.g., +15551234567)"  
✅ Number is NOT added to list  
✅ User can try again with correct format

---

### Test 3.7: Configure Detection Settings
**Steps:**
1. Scroll to "Detection Settings" section
2. Uncheck "Check Global Spam Database"
3. Uncheck "Frequency Analysis"
4. Keep "Robocall Detection" checked
5. Click "Save Settings" button

**Expected Results:**
✅ Alert shows "✅ Detection settings saved"  
✅ Console logs show API call to `/settings` endpoint  
✅ Settings persist after page refresh

---

### Test 3.8: Test Actual Call Blocking (Real-World Test)
**Steps:**
1. Add a test number to blacklist: `+15551111111`
2. From that number, make a call to your Twilio phone number
3. Observe call behavior

**Expected Results:**
✅ Call is rejected immediately (caller hears busy signal or "call cannot be completed")  
✅ Call does NOT reach AI Agent  
✅ Backend logs show: `🛡️ [SPAM FILTER] Call blocked: +15551111111`  
✅ "Blocked Today" stat increases by 1  
✅ New entry appears in Blocked Call Logs (if you implement that feature)

---

### Test 3.9: Test Whitelist Override
**Steps:**
1. Add same number to both blacklist AND whitelist
2. Make a call from that number

**Expected Results:**
✅ Call goes through (whitelist overrides blacklist)  
✅ AI Agent answers the call  
✅ Backend logs show: `✅ [SPAM FILTER] Call allowed (whitelist)`

---

### Test 3.10: Statistics Update After Blocking
**Steps:**
1. Note current "Calls Blocked (All Time)" number
2. Trigger a blocked call (or simulate one)
3. Refresh Spam Filter tab

**Expected Results:**
✅ "Calls Blocked (All Time)" increases  
✅ "Blocked Today" increases  
✅ Stats update within auto-refresh interval (60 seconds)

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Toggle doesn't work | API endpoint error | Check backend logs for `/settings` route |
| Can't add numbers | Authentication issue | Re-login, check auth token |
| Dashboard shows 0s for all stats | No blocked calls yet | Normal - block a test call first |
| Blacklist/whitelist empty after refresh | Data not saving | Check MongoDB connection, verify `callFiltering` schema |
| Call not actually blocked | Twilio integration issue | Verify `SmartCallFilter` is in `v2twilio.js` route |

---

# 🔗 INTEGRATION TESTS

## Test I.1: Data Center Quick Actions
**Steps:**
1. Go to Data Center
2. Find a company
3. Click phone icon (📞) → Should open Call Archives filtered by company
4. Click chart icon (📊) → Should open Company Profile AI Performance tab
5. Click shield icon (🛡️) → Should open Company Profile Spam Filter tab

**Expected:**
✅ All 3 quick action buttons work  
✅ Each opens correct destination with correct company selected

---

## Test I.2: Navigation Bar Consistency
**Steps:**
1. Visit these pages:
   - Directory
   - Add Company
   - Data Center
   - Global Trade Categories
   - Global AI Brain
2. On each page, look for "Call Archives" link in navigation

**Expected:**
✅ "Call Archives" link appears on ALL admin pages  
✅ Link is consistently positioned (after "Data Center")  
✅ Clicking it always goes to Call Archives page

---

## Test I.3: Cross-System Data Flow
**Steps:**
1. Make an AI call to a company
2. Check AI Performance Dashboard → Should show new lookup
3. Check Call Archives → Should show new call record
4. Add caller to blacklist in Spam Filter
5. Make another call from that number
6. Check Call Archives → Should NOT show new call (blocked before AI processing)

**Expected:**
✅ Data flows correctly between all 3 systems  
✅ Spam filter blocks calls BEFORE they hit AI (no Call Archive entry)  
✅ AI Performance tracks only successful AI calls

---

# 📋 FINAL CHECKLIST

After completing all tests above, verify:

## System 1: AI Performance Dashboard
- [ ] Dashboard loads without errors
- [ ] All 4 stat cards display
- [ ] Charts render correctly
- [ ] Auto-refresh works (30 seconds)
- [ ] Real-time data updates after AI calls
- [ ] Database index usage shows > 0 accesses
- [ ] Slow queries section works

## System 2: Call Archives
- [ ] Page loads with stats
- [ ] Search by keywords works
- [ ] Filter by company works
- [ ] Filter by date range works
- [ ] View call details modal works
- [ ] CSV export downloads correctly
- [ ] Pagination works (if > 20 calls)
- [ ] Quick navigation from Data Center works

## System 3: Smart Call Filter
- [ ] Dashboard loads with correct enabled state
- [ ] Toggle switch enables/disables filter
- [ ] Add to blacklist works
- [ ] Remove from blacklist works
- [ ] Add to whitelist works
- [ ] Remove from whitelist works
- [ ] Invalid format validation works
- [ ] Detection settings save correctly
- [ ] Real call blocking works (if tested)
- [ ] Stats update after blocked calls

## Navigation & Integration
- [ ] "Call Archives" link on all admin pages
- [ ] Data Center quick actions work (all 3)
- [ ] Cross-system data flow verified
- [ ] No console errors across any page
- [ ] All auth tokens work correctly

---

# 🚨 CRITICAL ISSUES TO REPORT IMMEDIATELY

If you encounter any of these, STOP testing and report:
1. **500 Server Errors** - Backend crashes or API failures
2. **Data Loss** - Blacklist/whitelist numbers disappear after save
3. **Auth Failures** - "No auth token" on multiple pages despite being logged in
4. **Call Blocking Failure** - Blacklisted calls reach AI Agent
5. **Database Crashes** - MongoDB or Redis connection errors

---

# ✅ SUCCESS CRITERIA

All 3 systems are production-ready when:
- ✅ All test cases pass
- ✅ No critical console errors
- ✅ Data persists after page refresh
- ✅ Real AI calls trigger updates in all 3 systems
- ✅ CSV export works without corruption
- ✅ Spam filter actually blocks calls in production
- ✅ Performance metrics track actual AI calls
- ✅ Call transcripts are searchable and exportable

---

**END OF TESTING GUIDE**

**Questions?** Check backend logs in:
- `routes/company/v2aiPerformance.js`
- `routes/admin/callArchives.js`
- `routes/admin/callFiltering.js`
- `services/SmartCallFilter.js`

