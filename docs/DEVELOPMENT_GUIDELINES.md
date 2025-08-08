# Development Guidelines - ClientsVia Backend

## 🚨 CRITICAL: File Creation Policy

### **NO NEW FILES WITHOUT APPROVAL**
- **All new file creation must be explicitly approved before implementation**
- This includes: HTML, JS, CSS, configuration files, scripts, documentation, etc.
- The platform is now **production-ready and streamlined** - we maintain this state

### **Current Clean File Structure (PROTECTED)**
```
Essential Files Only:
├── public/
│   ├── *.html (9 essential HTML files)
│   ├── js/ (3 referenced JS files only)
│   └── css/ (2 CSS files only)
├── docs/ (structured documentation)
├── server.js, app.js, index.js (core backend)
└── package.json, render.yaml (deployment)
```

### **Before Any Changes:**
1. **ASK FIRST** - "Should I create [filename] for [purpose]?"
2. **JUSTIFY NECESSITY** - Explain why existing files cannot be modified instead
3. **GET EXPLICIT APPROVAL** - Wait for confirmation before proceeding
4. **CONSIDER ALTERNATIVES** - Can functionality be added to existing files?

### **Preferred Approach:**
- ✅ **Modify existing files** when possible
- ✅ **Extend current functionality** within established structure
- ✅ **Use inline styles/scripts** for small additions
- ✅ **Consolidate** rather than fragment

### **Platform Status: STREAMLINED & PRODUCTION-READY**
- Recent cleanup removed 100+ redundant/test/legacy files
- All remaining files are essential and referenced
- Zero orphaned files, broken links, or legacy clutter
- Maintain this clean state at all costs

---
**Last Updated:** August 8, 2025  
**Status:** Active Policy - All AI Agents Must Follow
