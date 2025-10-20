# Production Database Configuration

## ⚠️ CRITICAL: Database Environment Distinction

### Production (Render)
- **Database**: MongoDB Atlas (Remote)
- **Connection**: Set via Render environment variables
- **Purpose**: Live production data
- **DO NOT**: Connect to this from local scripts without explicit production flag

### Local Development
- **Database**: `mongodb://localhost:27017/clientsvia-test`
- **Connection**: Set via `.env` file
- **Purpose**: Local testing only
- **Note**: Companies here are TEST DATA and do NOT exist in production

---

## 🚨 Common Mistake to Avoid

**NEVER assume a company ID from your local database exists in production!**

When testing:
1. Always use the Data Center to find the correct production company ID
2. Never hardcode company IDs in scripts
3. Always verify which database you're connecting to

---

## ✅ Best Practice for Scripts

When creating diagnostic scripts:

```javascript
// ❌ BAD: Assumes local data matches production
const COMPANY_ID = '68eeaf924e989145e9d46c12'; // This might not exist in production!

// ✅ GOOD: Query dynamically
const company = await Company.findOne({ companyName: 'Royal Plumbing' });
if (!company) {
    console.log('Company not found in this environment');
    process.exit(1);
}
```

---

## 🎯 Current Production Companies

To find current production companies, use the Data Center:
- URL: `https://clientsvia-backend.onrender.com/admin-data-center.html`
- This shows REAL production data
- Company IDs from here are authoritative

---

## 📋 Environment Variables

### Required in Render
```
MONGODB_URI=mongodb+srv://[production-connection-string]
```

### Local Development
```
MONGODB_URI=mongodb://localhost:27017/clientsvia-test
```

**These are DIFFERENT databases with DIFFERENT data!**

