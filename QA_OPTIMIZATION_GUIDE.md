# 🎯 **Q&A Optimization Guide**

## ❌ **Current Issue Analysis**

**User said:** `"My thermostat is blank and it's leaking water."`
**System incorrectly matched:** AC repair (because of "leaking" keyword)
**Should have:** Either no match, or a specific thermostat Q&A

## 🔧 **Root Cause:**
- Keywords are too broad and generic
- Single word matches trigger false positives
- Need more specific, contextual Q&A entries

## ✅ **Recommended Q&A Structure**

### **Instead of broad keywords:**
```
❌ BAD:
question: 'ac repair'
keywords: ['repair', 'leaking', 'broken', 'not cooling']
```

### **Use specific, contextual keywords:**
```
✅ GOOD:
question: 'ac repair'
keywords: ['ac repair', 'air conditioner broken', 'ac not cooling', 'ac stopped working']

question: 'thermostat issues'
keywords: ['thermostat blank', 'thermostat not working', 'thermostat display', 'thermostat screen']

question: 'water leak issues'  
keywords: ['water leaking from ac', 'ac unit leaking', 'water dripping from unit']
```

## 🎯 **Improved Q&A Entries for HVAC:**

### **1. AC Repair (Specific)**
```
question: 'ac repair'
keywords: [
  'ac repair',
  'air conditioner repair', 
  'ac not cooling',
  'ac stopped working',
  'ac unit broken',
  'air conditioner broken'
]
answer: 'We'll be happy to schedule your AC repair as soon as possible. Would you like the first available appointment, or do you have a specific time in mind?'
```

### **2. Thermostat Issues (New)**
```
question: 'thermostat problems'
keywords: [
  'thermostat blank',
  'thermostat not working',
  'thermostat display',
  'thermostat screen',
  'thermostat dead',
  'thermostat frozen'
]
answer: 'I can help you with thermostat issues. Is the display completely blank, or are you seeing any error messages? This will help me determine if it needs a battery replacement or a technician visit.'
```

### **3. Water Leak Issues (New)**
```
question: 'water leak from ac'
keywords: [
  'water leaking from ac',
  'ac unit leaking water',
  'water dripping from unit',
  'ac drain leak',
  'condensation leak'
]
answer: 'Water leaking from your AC unit usually indicates a clogged drain or condensation issue. This typically requires a service call. Would you like me to schedule a technician to inspect and fix the leak?'
```

### **4. Emergency Service (New)**
```
question: 'emergency ac service'
keywords: [
  'ac emergency',
  'no cooling emergency',
  'urgent ac repair',
  'ac broke down',
  'emergency service'
]
answer: 'I understand this is urgent! We offer emergency AC service. Let me check our emergency technician availability right now. What time would work best for an emergency visit today?'
```

## 🔍 **New Matching Logic (Implemented):**

- **Requires 2+ word matches** (prevents single word false positives)
- **60% match rate minimum** (ensures strong relevance)
- **Enhanced debugging** to see exactly what matched

## 📊 **Expected Results:**

**Before:**
- `"My thermostat is blank and it's leaking water"` → ❌ AC repair (wrong)

**After:**
- `"My thermostat is blank and it's leaking water"` → ✅ No match (escalate to AI for proper handling)
- `"My AC is leaking water"` → ✅ Water leak Q&A (correct)
- `"My thermostat display is blank"` → ✅ Thermostat Q&A (correct)

**Update your Q&A entries with these more specific, contextual keywords for much better matching!** 🎯
