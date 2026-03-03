# Deployment Checklist - NEVER GET TRAPPED AGAIN

## The Problem That Cost 12+ Hours

**What happened:**
- MONGODB_URI was missing database name (`/clientsvia`)
- MongoDB defaulted to "test" database
- Data was split: triggers in "test", runtime expected "clientsvia"
- UI showed 42 triggers (reading from "test")
- Runtime loaded 0 triggers (reading from "clientsvia")
- Spent months debugging code when it was just wrong database

**Root cause:** No loud, visible validation on startup

---

## PERMANENT PROTECTIONS NOW IN PLACE

### 1. **Startup Truth Banner** (LOUD, Cannot Miss)

Every deployment shows:
```
╔═══════════════════════════════════════════════════════════════════════════╗
║  🎯 RUNTIME TRUTH - DATABASE CONNECTION                                   ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Environment:     PRODUCTION                                              ║
║  Mongo Host:      cluster0-shard-00-02.mongodb.net:27017                  ║
║  Database Name:   clientsvia                                              ║
║  Connect Time:    845ms                                                   ║
║  Ready State:     CONNECTED                                               ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

**If you see anything other than "clientsvia" → STOP IMMEDIATELY**

### 2. **Triple-Layer "test" Database Block**

Server **CRASHES** if:
- ❌ MONGODB_URI has no database name (would default to "test")
- ❌ MONGODB_URI explicitly says "/test"
- ❌ Connection somehow ends up on "test" database

**No exceptions. No warnings. Just crashes.**

### 3. **Every Call Report Shows Database Name**

New event in EVERY call:
```json
{
  "kind": "DATABASE_CONNECTION_INFO",
  "payload": {
    "mongoDbName": "clientsvia",
    "mongoHost": "cluster0...",
    "readyStateText": "connected"
  }
}
```

**If you ever see `"mongoDbName": "test"` in a call report → ALERT!**

### 4. **Truth Panel API** (Live Reality Check)

Before testing, check:
```
GET /api/agent-console/:companyId/truth-panel
```

Shows:
- Database name
- Trigger counts (published/draft/null)
- Problems detected
- Specific fixes

**Check this BEFORE every test session**

### 5. **Pre-Save Hook** (Force Correct State)

Every new local trigger automatically gets:
- `state: "published"` (never null)
- `publishedAt: <timestamp>`
- `enabled: true`
- `companyId` as string (never ObjectId)

**No more `state:null` trap**

### 6. **Health Endpoint** (Public, No Login)

Check anytime:
```
GET /api/health
```

Shows database name without requiring authentication.

**Bookmark this and check it weekly**

---

## NEW WORKFLOW (Prevents Issues)

### **Every Morning / Before Testing:**

```bash
# 1. Check health endpoint
curl https://cv-backend-va.onrender.com/api/health

# Look for:
{
  "details": {
    "mongodb": {
      "database": "clientsvia"  // ← MUST be clientsvia
    }
  }
}

# 2. If anything looks wrong, check truth panel
curl https://cv-backend-va.onrender.com/api/agent-console/68e3f77a9d623b8058c700c4/truth-panel

# 3. Make ONE test call before real testing
# 4. Download call report
# 5. Check DATABASE_CONNECTION_INFO event
# 6. Proceed with testing
```

### **After ANY Environment Change:**

1. Check Render logs for truth banner
2. Verify database name = "clientsvia"
3. Make test call
4. Download call report
5. Verify `DATABASE_CONNECTION_INFO` shows correct database

### **After ANY Trigger Changes:**

1. Make change in UI
2. Click "Refresh Cache"
3. Check truth panel (verify count updated)
4. Make test call
5. Download call report
6. Verify `TRIGGER_LOADING_REPORT` shows expected count

---

## WHAT TO WATCH FOR

### 🚨 **Critical Red Flags:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| Startup banner shows "test" | MONGODB_URI wrong | Add `/clientsvia` to URI in Render |
| Call report shows `mongoDbName: "test"` | Wrong database | Same as above |
| `totalTriggersLoaded: 0` but UI shows triggers | Database mismatch or state:null | Check truth panel, run cleanup |
| Health endpoint shows wrong database | Environment variable issue | Check Render settings |
| Triggers work in UI but not in calls | Cache stale or database split | Refresh cache, check database |

### ✅ **Good Signs:**

| What to See | Where | Meaning |
|-------------|-------|---------|
| `Database Name: clientsvia` | Startup banner | Correct database |
| `"mongoDbName": "clientsvia"` | Call reports | Correct database |
| `"totalTriggersLoaded": 42` | Call reports | Triggers loading |
| `"diagnosis": "✅ MATCH SUCCESSFUL"` | Call reports | System working |
| `"runtimeTotal": 42` | Truth panel | All triggers available |

---

## ENVIRONMENT VARIABLE VALIDATION

### **Correct MONGODB_URI Format:**

```
mongodb+srv://USER:PASS@cluster0.0o7c1u.mongodb.net/clientsvia?retryWrites=true&w=majority
                                                              ^^^^^^^^^^^
                                                              REQUIRED!
```

### **Wrong Formats (Will Crash):**

```
❌ mongodb+srv://...@cluster0.mongodb.net/?retryWrites=...
   (Missing database name - would default to "test")

❌ mongodb+srv://...@cluster0.mongodb.net/test?retryWrites=...
   (Explicitly uses "test" - blocked)
```

---

## RENDER ENVIRONMENT CHECKLIST

**Before every deploy, verify:**

1. ✅ `MONGODB_URI` includes `/clientsvia`
2. ✅ `NODE_ENV=production`
3. ✅ No `TEST_MODE` or similar variables exist
4. ✅ No duplicate database environment variables

**In Render Dashboard:**
- Go to: Service → Environment
- Find: `MONGODB_URI`
- Verify: Contains `/clientsvia` before `?`

---

## AUTOMATED CHECKS (Set These Up)

### **1. Daily Health Check (Cron or Monitoring)**

```bash
# Run daily at 6am
curl https://cv-backend-va.onrender.com/api/health | jq '.details.mongodb.database'
# Should always return: "clientsvia"
# If returns "test" → ALERT
```

### **2. Post-Deploy Validation**

Add to CI/CD or run manually after each deploy:
```bash
# Check database name
DB_NAME=$(curl -s https://cv-backend-va.onrender.com/api/health | jq -r '.details.mongodb.database')

if [ "$DB_NAME" != "clientsvia" ]; then
  echo "❌ CRITICAL: Wrong database ($DB_NAME)"
  exit 1
fi

echo "✅ Database correct: $DB_NAME"
```

### **3. Weekly Trigger Count Audit**

```bash
# Check truth panel weekly
curl https://cv-backend-va.onrender.com/api/agent-console/68e3f77a9d623b8058c700c4/truth-panel

# Verify:
# - runtimeTotal > 0
# - no problems array entries
# - database name = clientsvia
```

---

## SIGNS YOU'RE IN TROUBLE (What to Look For)

### **Early Warning Signs:**

1. **Dashboard shows companies/triggers but runtime sees 0**
   - Check database name in health endpoint
   - Compare UI queries vs runtime queries

2. **Calls work in dev but fail in production**
   - Check startup banner - different databases?
   - Check environment variables

3. **Triggers visible in UI but don't match in calls**
   - Download call report
   - Check `TRIGGER_LOADING_REPORT.totalTriggersLoaded`
   - If 0 → database or state issue

4. **Changes in UI don't appear in test calls**
   - Click "Refresh Cache"
   - Check truth panel for updated counts
   - If still wrong → database mismatch

---

## MONTHLY AUDIT TASKS

**Set a calendar reminder:**

### **First Monday of Each Month:**

```bash
# 1. Check database name
curl https://cv-backend-va.onrender.com/api/health | jq '.details.mongodb'

# 2. Check trigger counts for main companies
curl .../truth-panel | jq '.triggers'

# 3. Make test calls to each company
# 4. Download call reports
# 5. Verify DATABASE_CONNECTION_INFO in each

# 6. Check for "test" database remnants
# SSH to Render:
node -e '
const { MongoClient } = require("mongodb");
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const admin = client.db().admin();
  const dbs = await admin.listDatabases();
  console.log("All databases:", dbs.databases.map(d => d.name));
  if (dbs.databases.find(d => d.name === "test")) {
    console.log("⚠️  WARNING: test database still exists");
  }
  await client.close();
})();
'
```

---

## DOCUMENTATION UPDATES

**Added to codebase:**

1. ✅ `CALL_CONSOLE_DIAGNOSTICS_GUIDE.md` - How to read call reports
2. ✅ `TRIGGER_LOADING_DEBUG.md` - Technical architecture
3. ✅ `ENGINEERING_REPORT_TRIGGER_LOADING_FAILURE.md` - Full incident report
4. ✅ `DEPLOYMENT_CHECKLIST.md` - This file
5. ✅ `MIGRATION_COMMAND.md` - Emergency migration commands

**Keep these updated when architecture changes**

---

## IF IT HAPPENS AGAIN (Emergency Recovery)

### **Symptoms:**
- Triggers showing in UI but not working in calls
- `totalTriggersLoaded: 0` in call reports
- Agent responding with "you cut out" to clear requests

### **Diagnosis (30 seconds):**

```bash
# Check database name
curl https://cv-backend-va.onrender.com/api/health | jq '.details.mongodb.database'
```

**If returns "test" or anything other than "clientsvia":**

1. **Fix Render environment variable:**
   - Add `/clientsvia` to MONGODB_URI
   - Save → Redeploy

2. **Migrate data if needed:**
   ```bash
   # See MIGRATION_COMMAND.md
   node -e '...' # Copy from test → clientsvia
   ```

3. **Verify fix:**
   ```bash
   curl .../health | jq '.details.mongodb.database'
   # Should return: "clientsvia"
   ```

4. **Test:**
   - Make call
   - Download report
   - Check `DATABASE_CONNECTION_INFO`

---

## LONG-TERM PREVENTION

### **Code-Level:**
✅ URI validation before connect (crashes if missing DB name)  
✅ Runtime validation after connect (crashes if DB = "test")  
✅ Pre-save hooks (force correct state/types)  
✅ Comprehensive logging (every call shows database)

### **Process-Level:**
✅ Check health endpoint daily  
✅ Review startup banner on every deploy  
✅ Download call report after every code change  
✅ Check truth panel before testing  

### **Monitoring-Level:**
✅ Set up alert for "test" database detection  
✅ Set up alert for `TRIGGER_POOL_EMPTY` events  
✅ Weekly audit of database name  
✅ Monthly full system check  

---

## FINAL RULE

**Never deploy without seeing the startup truth banner show:**
```
Database Name: clientsvia
```

**If you see anything else, STOP and fix before proceeding.**

This is your "ground truth" - everything else is downstream from this.
