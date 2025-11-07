# LLM Learning Console V2 - Testing Guide

## 🎯 **YOU'RE READY TO TEST!**

Everything is wired and deployed. Here's how to verify it works:

---

## ✅ **STEP 1: Verify UI is Accessible**

### **Open the Console**

```
https://clientsvia-backend.onrender.com/admin/llm-learning-v2
```

**Expected Result:**
- ✅ Page loads (not 404)
- ✅ Filters bar at top
- ✅ "Suggestions | Task Queue" tabs
- ✅ Empty table with message: "No suggestions found for the current filters."

**If you see this, the UI is WORKING!** 🎉

---

## ✅ **STEP 2: Trigger Tier 3 to Create a Suggestion**

Now let's make the system generate a real suggestion.

### **Method A: Use Test Pilot (Template Testing)**

1. **Go to Test Pilot**
   ```
   https://clientsvia-backend.onrender.com/admin/test-pilot
   ```

2. **Select a Template**
   - Choose "Universal AI Brain" or any template

3. **Ask Something Unusual**
   
   Test phrases that should trigger Tier 3:
   ```
   "I need a plumber for my flying saucer"
   "Can you fix my teleportation device?"
   "My time machine is leaking"
   "I need someone to repair my robot butler"
   ```

4. **Submit the Test**
   - AI should respond (may take 2-3 seconds if Tier 3 fires)
   - Check console logs for `[LLM LEARNING V2]`

5. **Verify Logging**
   
   Open browser console (F12) and look for:
   ```
   📝 [LLM LEARNING V2] Tier 3 usage logged with smart classification
   ```

---

### **Method B: Direct MongoDB Check**

If you want to verify without Test Pilot:

1. **Connect to MongoDB**
   ```bash
   mongo YOUR_MONGODB_URI
   ```

2. **Check for Suggestions**
   ```javascript
   use clientsvia
   db.productionllmsuggestions.find().sort({createdAt:-1}).limit(1).pretty()
   ```

3. **Expected Output**
   ```json
   {
     "_id": ObjectId("..."),
     "templateId": ObjectId("..."),
     "templateName": "Universal AI Brain",
     "companyId": null,
     "companyName": null,
     "callSource": "template-test",
     "tier1Score": 0.42,
     "tier2Score": 0.68,
     "tier3LatencyMs": 640,
     "suggestionType": "ADD_KEYWORDS",
     "priority": "medium",
     "severity": "medium",
     "changeImpactScore": 2.5,
     "status": "pending",
     "createdAt": ISODate("2025-11-07T...")
   }
   ```

---

## ✅ **STEP 3: Verify UI Displays the Suggestion**

1. **Refresh the LLM Learning Console**
   ```
   https://clientsvia-backend.onrender.com/admin/llm-learning-v2
   ```

2. **Expected Result:**
   - ✅ Suggestions table shows 1+ rows
   - ✅ Template name visible
   - ✅ Call source badge: "Template Test"
   - ✅ Issue type (e.g., "Add keywords")
   - ✅ Priority + Severity badges
   - ✅ Latency metrics
   - ✅ Status: "pending"

3. **Click "View" Button**
   - ✅ Side drawer opens
   - ✅ Shows tier routing details
   - ✅ Shows customer phrase
   - ✅ Shows agent response
   - ✅ Shows root cause reason
   - ✅ Action buttons: Apply, Reject, Snooze

---

## ✅ **STEP 4: Test Actions**

### **4A: Test "Apply" Action**

1. Click **"Apply"** button on a suggestion
2. Expected:
   - ✅ Suggestion disappears from "Pending" filter
   - ✅ Status changes to "applied"
   - ✅ Applied date recorded

### **4B: Test "Reject" Action**

1. Click **"Reject"** button
2. Enter rejection reason (optional): "Already fixed manually"
3. Expected:
   - ✅ Suggestion disappears from "Pending" filter
   - ✅ Status changes to "rejected"
   - ✅ Rejection reason saved

### **4C: Test "Snooze" Action**

1. Click **"Snooze"** button
2. Enter days: `7`
3. Expected:
   - ✅ Suggestion disappears from "Pending" filter
   - ✅ Status changes to "snoozed"
   - ✅ Snooze date set to 7 days from now

---

## ✅ **STEP 5: Test Filters**

### **5A: Filter by Call Source**

1. Set filter: **Call Source = "Template Test"**
2. Click **"Apply Filters"**
3. Expected:
   - ✅ Only template-test suggestions shown
   - ✅ No production/company-test suggestions

### **5B: Filter by Status**

1. Set filter: **Status = "Applied"**
2. Click **"Apply Filters"**
3. Expected:
   - ✅ Only applied suggestions shown
   - ✅ Pending suggestions hidden

### **5C: Slow Only Filter**

1. Check **"Show only slow / dead-air calls"**
2. Click **"Apply Filters"**
3. Expected:
   - ✅ Only suggestions with high latency (>500ms Tier 3, >2s dead air, or >1s overall)

### **5D: Reset Filters**

1. Click **"Reset"**
2. Expected:
   - ✅ All filters cleared
   - ✅ All suggestions shown

---

## ✅ **STEP 6: Test Task Queue**

1. Click **"Task Queue"** tab
2. Expected:
   - ✅ Suggestions grouped by template + company + suggestionType
   - ✅ Shows taskType, summary, severity, priority
   - ✅ Shows affected calls count
   - ✅ "View suggestions" button per task

3. Click **"View suggestions"** on a task
4. Expected:
   - ✅ Filters applied to show only suggestions in that task group

---

## 🔍 **VERIFICATION CHECKLIST**

Run through this checklist:

- [ ] UI loads at `/admin/llm-learning-v2`
- [ ] Filters bar visible
- [ ] Tabs work (Suggestions ↔ Task Queue)
- [ ] Test Pilot triggers Tier 3
- [ ] Suggestion appears in MongoDB
- [ ] Suggestion appears in UI table
- [ ] "View" button opens drawer
- [ ] Drawer shows all details
- [ ] "Apply" button works
- [ ] "Reject" button works
- [ ] "Snooze" button works
- [ ] Filters work (callSource, status, severity)
- [ ] "Slow only" filter works
- [ ] Pagination works (if >25 suggestions)
- [ ] Task Queue groups correctly
- [ ] No console errors

---

## 🐛 **TROUBLESHOOTING**

### **Problem: UI shows 404**

**Solution:** Route not deployed yet.
- Wait 2-3 minutes for Render auto-deploy
- Check Render dashboard for deploy status
- Verify route is mounted in `index.js`

### **Problem: Empty table after Tier 3 call**

**Solution:** Check MongoDB.

```bash
# Connect to MongoDB
mongo YOUR_MONGODB_URI

# Count suggestions
use clientsvia
db.productionllmsuggestions.count()

# If 0, check logs
# Look for: [LLM LEARNING V2] Tier 3 usage logged
```

If count > 0 but UI empty:
- Check API endpoint: `GET /api/admin/llm-learning/v2/suggestions`
- Verify no JS errors in browser console

### **Problem: "Apply" button doesn't work**

**Solution:** Check PATCH endpoint.

```bash
# Test endpoint manually
curl -X PATCH "https://clientsvia-backend.onrender.com/api/admin/llm-learning/v2/suggestions/SUGGESTION_ID/approve" \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json"
```

### **Problem: Filters don't work**

**Solution:** Check query params in network tab.

1. Open browser Dev Tools → Network
2. Apply filter
3. Look for: `GET /api/admin/llm-learning/v2/suggestions?callSource=template-test&page=1&pageSize=25`
4. Verify response has correct filtered data

---

## 📊 **EXPECTED DATA FLOW**

Here's what should happen end-to-end:

```
1. Customer/Test call arrives
   ↓
2. 3-Tier system routes (IntelligentRouter.js)
   ↓
3. Tier 1 fails (score < threshold)
   ↓
4. Tier 2 fails (score < threshold)
   ↓
5. Tier 3 (LLM) called (line 340-350 in IntelligentRouter.js)
   ↓
6. Tier 3 succeeds (line 352)
   ↓
7. Learning logger called (line 397-461)
   ↓
8. logTier3SuggestionSmart() executes
   ↓
9. Smart classification:
   - determineSuggestionType() → "ADD_KEYWORDS"
   - calculatePriority() → "medium"
   - calculateSeverity() → "medium"
   - calculateChangeImpactScore() → 2.5
   ↓
10. ProductionLLMSuggestion.create() saves to MongoDB
   ↓
11. Console log: "📝 [LLM LEARNING V2] Tier 3 usage logged"
   ↓
12. Open /admin/llm-learning-v2
   ↓
13. UI calls GET /api/admin/llm-learning/v2/suggestions
   ↓
14. API queries MongoDB
   ↓
15. Returns JSON with suggestion
   ↓
16. UI renders table row
   ↓
17. Admin clicks "View" → Drawer opens
   ↓
18. Admin clicks "Apply" → PATCH /suggestions/:id/approve
   ↓
19. MongoDB updated: status='applied', appliedAt=now
   ↓
20. ✅ COMPLETE!
```

---

## 🎯 **SUCCESS CRITERIA**

You'll know it's working when:

1. ✅ Test Pilot call triggers Tier 3
2. ✅ Console logs show: `[LLM LEARNING V2] Tier 3 usage logged`
3. ✅ MongoDB has 1+ productionllmsuggestions
4. ✅ UI shows suggestion in table
5. ✅ Drawer opens with full details
6. ✅ Apply/Reject/Snooze actions work
7. ✅ Filters work
8. ✅ Task Queue shows grouped tasks

---

## 🚀 **NEXT: Production Testing**

Once Test Pilot works, test with real production calls:

1. Make a real call to a company number
2. Say something unusual to trigger Tier 3
3. Check LLM Learning Console for production suggestions
4. Verify `callSource='production'`
5. Verify higher priority/severity for slow production calls

---

## 📸 **SEND ME A SCREENSHOT**

When you get your first suggestion showing, send me:

1. Screenshot of the table with at least 1 suggestion
2. Screenshot of the drawer panel (click "View")
3. Sample API response from: `GET /api/admin/llm-learning/v2/suggestions?page=1&pageSize=1`

I'll verify everything looks perfect and suggest any tweaks! 🎯

---

**You're 100% ready to test!** Let's see this baby in action! 🔥

