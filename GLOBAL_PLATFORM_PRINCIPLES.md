# 🚨 CRITICAL PLATFORM RULE: GLOBAL FIRST, NEVER HARDCODE COMPANY IDs

**⚠️ WARNING: BREAKING THIS RULE DESTROYS THE MULTI-TENANT PLATFORM ⚠️**

## 🌍 **GOLDEN RULE: ALL OPTIMIZATIONS MUST BE GLOBAL**

### ❌ **NEVER DO THIS:**
```javascript
// ❌ WRONG - Hardcoded company ID
if (companyId === '686a680241806a4991f7367f') {
  // Special optimization only for Penguin Air
}

// ❌ WRONG - Specific company logic
if (company.name === 'Penguin Air') {
  speechTimeout: 'auto'
}
```

### ✅ **ALWAYS DO THIS:**
```javascript
// ✅ CORRECT - Global optimization with per-company customization
const gather = twiml.gather({
  speechTimeout: company.aiSettings?.speechTimeout ?? 'auto', // Global default + customizable
  enhanced: true, // Applied to ALL companies
  speechModel: 'phone_call' // Applied to ALL companies
});

// ✅ CORRECT - Global model defaults
twilioSpeechConfidenceThreshold: { type: Number, default: 0.4 }, // ALL companies get this
```

## 🎯 **PLATFORM ARCHITECTURE PRINCIPLES:**

### **1. GLOBAL OPTIMIZATIONS**
- All performance improvements apply to **EVERY company**
- No client should get worse service than another
- Platform-wide consistency ensures scalability

### **2. PER-COMPANY CUSTOMIZATION**
- Use `company.aiSettings` for customizable values
- Provide sensible global defaults
- Allow overrides through UI/API, not code

### **3. DATA VS LOGIC SEPARATION**
- **Company ID** = Data identifier for THAT specific client
- **Platform Logic** = Shared functionality for ALL clients
- Never mix the two!

## 📋 **DEVELOPMENT CHECKLIST:**

Before any code change, ask:
- [ ] Does this apply to ALL companies?
- [ ] Am I hardcoding any company IDs?
- [ ] Are my defaults global?
- [ ] Can companies customize if needed?
- [ ] Would this break multi-tenancy?

## 🚨 **RED FLAGS TO WATCH FOR:**

### **Code Smells:**
- `if (companyId === '...')` 
- `if (company.name === '...')`
- Hardcoded phone numbers
- Company-specific feature flags in code
- Different logic paths for different companies

### **File Headers to Use:**
```javascript
// 🌍 GLOBAL MULTI-TENANT PLATFORM
// All changes affect ALL companies - no company-specific hardcoding
// Use company.aiSettings for per-company configuration
```

## 💡 **REMEMBER:**

**Penguin Air is our EXAMPLE, not our FAVORITE**
- We use Penguin Air for testing and documentation
- All optimizations must benefit EVERY company
- No special treatment in code logic
- Platform equality is non-negotiable

## 🎯 **THE ULTIMATE TEST:**

**"If a new company signs up tomorrow, do they get the SAME optimized experience as every other company?"**

If the answer is NO, fix it immediately.

---

**🔗 This applies to:**
- Twilio speech recognition settings
- AI response optimizations  
- Database query patterns
- Cache strategies
- Performance improvements
- Security measures
- Feature rollouts

**GLOBAL FIRST. CUSTOMIZE SECOND. NEVER HARDCODE.**

## 🌍 **MULTI-TENANT PLATFORM MINDSET**

### **ALWAYS REMEMBER:**
- This is a **GLOBAL PLATFORM** serving multiple companies
- **Penguin Air = Sample/Test Company** (not the only client)
- Every change affects **ALL companies** on the platform
- Think **SCALABLE** not **COMPANY-SPECIFIC**

### **DEVELOPMENT APPROACH:**

#### ✅ **DO THIS (Global):**
- Update Company model defaults for ALL new companies
- Use `Company.updateMany({}, {...})` for ALL existing companies
- Test with sample company but deploy globally
- Make features configurable per company via admin UI
- Use environment variables for platform-wide settings
- Design for thousands of companies, not just one

#### ❌ **NEVER DO THIS (Company-Specific):**
- Hardcode specific company IDs in code
- Make changes only for one company
- Use company names in logic (use settings instead)
- Create company-specific routes or functions
- Assume only one company exists

### **TESTING WORKFLOW:**
1. **Test** with Penguin Air (sample company)
2. **Verify** settings work for any company
3. **Deploy** globally to ALL companies
4. **Monitor** platform-wide performance

### **CODE EXAMPLES:**

#### ✅ **Global Database Updates:**
```javascript
// Update ALL companies
await Company.updateMany({}, { 
  $set: { 'aiSettings.newFeature': true } 
});
```

#### ✅ **Global Model Defaults:**
```javascript
// In Company model - affects all new companies
newFeature: { type: Boolean, default: true }
```

#### ✅ **Dynamic Company Settings:**
```javascript
// Use company-specific settings, not hardcoded values
const timeout = company.aiSettings?.silenceTimeout ?? 8;
```

#### ❌ **Company-Specific Code:**
```javascript
// NEVER do this
if (companyId === '686a680241806a4991f7367f') {
  // special logic for one company
}
```

### **PLATFORM MINDSET:**
- **Scale:** Thousands of companies
- **Performance:** Must work for all simultaneously  
- **Configuration:** Admin UI controls per-company settings
- **Consistency:** Same experience across all companies
- **Flexibility:** Companies can customize via settings

---

**🚀 Remember: We're building the next Twilio/CallRail competitor - a GLOBAL platform, not a single-company solution!**
