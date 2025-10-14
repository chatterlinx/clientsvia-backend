# Quick Fix Summary - Template Issues

## Issue 1: Universal template not showing in Clone dropdown
**Problem:** Universal template has `isActive: true` but maybe `isPublished: false`
**Fix:** Update Universal template to set `isPublished: true`

## Issue 2: Cannot delete templates  
**Problem:** Backend prevents deleting templates with `isActive: true`
**Fix:** Change backend to allow deletion (or check `isDefaultTemplate` instead)

## Issue 3: Edit button goes to Behaviors tab
**Problem:** User expects template metadata editor, not behaviors list
**Fix:** Create proper template editor modal or change edit behavior

## Actions Needed:
1. Update backend DELETE route to allow deleting non-default templates
2. Add script to set Universal template `isPublished: true`  
3. Change editTemplate() to open metadata editor instead of switching tabs

