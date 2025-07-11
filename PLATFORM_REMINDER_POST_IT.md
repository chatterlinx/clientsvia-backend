# 📌 POST-IT NOTE: MULTI-TENANT PLATFORM REMINDER

```
🚨 STOP! BEFORE YOU CODE, READ THIS! 🚨

┌─────────────────────────────────────────┐
│  🌍 GLOBAL PLATFORM PRINCIPLE          │
│                                         │
│  ❌ NO HARDCODED COMPANY IDs           │
│  ❌ NO SPECIAL TREATMENT               │
│  ❌ NO PENGUIN AIR FAVORITISM          │
│                                         │
│  ✅ ALL OPTIMIZATIONS = GLOBAL         │
│  ✅ ALL COMPANIES = EQUAL TREATMENT    │
│  ✅ USE company.aiSettings FOR CONFIG  │
│                                         │
│  QUESTION: "Would this work for        │
│  company #1000 tomorrow?"              │
│  If NO, fix it!                        │
└─────────────────────────────────────────┘
```

## 🔥 IMMEDIATE RED FLAGS:
- `if (companyId === '686a680241806a4991f7367f')`
- `if (company.name === 'Penguin Air')`
- Hardcoded phone numbers in logic
- Company-specific optimization paths

## ✅ GREEN FLAGS:
- `company.aiSettings?.setting ?? globalDefault`
- Schema defaults that apply to ALL
- Platform-wide improvements
- Configurable per-company settings

**REMEMBER: PENGUIN AIR IS OUR TEST CASE, NOT OUR ONLY CASE!**

---
*Keep this file open while coding as a reminder!*
