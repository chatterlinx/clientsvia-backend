# Git Workflow Policy

## CRITICAL: Main Branch Only

**This project uses a single-branch workflow.**

### Rules

1. ✅ **Work directly on `main`** - No feature branches, no dev branches, no test branches
2. ❌ **Never create branches** - This is not a mistake, it's policy
3. ✅ **Commit directly to main** - Clear, descriptive commit messages
4. ✅ **Push directly to main** - No pull requests needed for solo development

### Why?

- **Simplicity**: One line of development, no confusion
- **No Abandoned Branches**: Prevents accumulation of forgotten branches
- **Clear History**: Linear commit history
- **Fast Iteration**: No branch management overhead

### Historical Context

On February 22, 2026, we cleaned up **28 abandoned branches** that had accumulated over months. This policy prevents that from happening again.

### For AI Assistants

If you're an AI assistant helping with this codebase:

- **Never suggest creating branches**
- **Never create branches automatically**
- **Always work on `main`**
- **If asked about branching, refer to this document**

### Standard Workflow

```bash
# Make changes
git add .
git commit -m "Clear description of changes"
git push origin main
```

### Exception

The only time to create a branch is if explicitly requested by the repository owner with specific reasoning.

---

**Last Updated**: February 22, 2026  
**Reason**: Cleanup of 28 abandoned branches
