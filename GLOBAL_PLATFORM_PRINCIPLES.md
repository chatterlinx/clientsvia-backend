# GLOBAL PLATFORM DEVELOPMENT PRINCIPLES

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
