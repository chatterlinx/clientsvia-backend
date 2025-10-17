# ✅ HOW TO VERIFY THE DEFAULT TEMPLATE SYSTEM IS WORKING

## 🎯 What Does "Default Template" Do?

When you create a **NEW company** in ClientsVia, the system automatically:
1. Finds the template marked as `isDefaultTemplate: true`
2. Clones all 15+ categories and 16+ scenarios to the new company
3. New company's AI Agent is **immediately functional** on Day 1

---

## 📋 VERIFICATION STEPS

### **Step 1: Check Which Template is Default**

Run this command:
```bash
node scripts/check-default-template.js
```

**Expected Output:**
```
✅ DEFAULT TEMPLATE FOUND:
   Name: Universal AI Brain (All Industries)
   Version: v1.0.0
   Industry: Universal (All Industries)
   Categories: 15
   Published: Yes ✅

   📌 This template will be cloned for ALL new companies!
```

---

### **Step 2: Test Template Cloning**

Run this command:
```bash
node scripts/test-default-template-clone.js
```

**Expected Output:**
```
✅✅✅ SUCCESS! All scenarios cloned correctly!

📋 STEP 4: Verifying company has scenarios...
✅ Company "Test Company 1760098657443" now has:
   Categories: 15
   Total Scenarios: 16
```

---

### **Step 3: Create a Real Company (UI Test)**

1. Go to: `https://clientsvia-backend.onrender.com/add-company.html`
2. Fill in:
   - Company Name: "Test Auto Shop"
   - Phone: "+15551234567"
   - Address: "123 Main St, City, ST 12345"
3. Click **"Create Company"**
4. **Check the success message:**
   ```
   Company "Test Auto Shop" created successfully with 16 AI scenarios from default template
   ```

5. **Verify in the Company Profile:**
   - Go to: `https://clientsvia-backend.onrender.com/directory.html`
   - Find "Test Auto Shop" → Click **Profile**
   - Click **"Instant Responses"** tab
   - You should see **15 categories** with scenarios already loaded!

---

### **Step 4: Change the Default Template (UI Test)**

1. Go to: `https://clientsvia-backend.onrender.com/admin-global-instant-responses.html`
2. Navigate to: **Overview → Templates → All Templates**
3. Find any template (e.g., "Healthcare Template")
4. Click the **purple star** button (⭐ Set as Default)
5. **Confirm the popup** showing:
   - **Current Default:** Universal AI Brain (v1.0.0)
   - **New Default:** Healthcare Template (v2.0)
6. After confirming:
   - The star should turn **green** (badge icon) ✅
   - The "Status" column should show **"✓ Default"**

7. **Verify:** Run `node scripts/check-default-template.js` again
   - Should now show Healthcare as default

---

## 🔍 TROUBLESHOOTING

### **Problem: No default template found**
**Solution:** Set one in the Global AI Brain UI by clicking the star button.

### **Problem: Star button doesn't change to green after setting default**
**Solution:** 
1. Hard refresh browser: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
2. Clear cache: `Cmd+Shift+Delete` → Clear "All time"
3. Check console for `🔥 VERSION 2.2.0 LOADED` message

### **Problem: New companies have 0 scenarios**
**Solution:**
1. Check Render logs for: `📚 Cloning default template...`
2. Verify default template is published: `isPublished: true`
3. Run: `node scripts/test-default-template-clone.js` to debug

---

## 📊 EXPECTED SYSTEM BEHAVIOR

| Action | Result |
|--------|--------|
| Create new company | Gets 16 scenarios from default template |
| Set template as default | Green badge appears, database updated |
| No default template set | Warning in logs, companies start with 0 scenarios |
| Change default template | Next company created uses new default |

---

## 🎉 SUCCESS INDICATORS

✅ **Default template is set and visible in UI**  
✅ **Test script passes with 16/16 scenarios cloned**  
✅ **New companies automatically get scenarios**  
✅ **Green badge appears on default template**  
✅ **Success message shows scenario count: "...with 16 AI scenarios..."**

---

## 📞 SUPPORT

If any step fails, check:
1. Render deployment logs
2. MongoDB connection
3. Console errors in browser
4. Run diagnostic scripts first

**All systems operational = Default template system is working! 🚀**

