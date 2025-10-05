/**
 * ============================================================================
 * 🎯 V2 PLACEHOLDERS ROUTES - ENTERPRISE GRADE
 * ============================================================================
 * 
 * Purpose: Manage dynamic placeholders for AI responses
 * Pattern: Mongoose + Redis (consistent with entire platform)
 * Location: AI Agent Logic > Placeholders Tab
 * 
 * API Endpoints:
 *   GET    /api/company/:companyId/placeholders         - Get all placeholders
 *   POST   /api/company/:companyId/placeholders         - Create placeholder
 *   PUT    /api/company/:companyId/placeholders/:id     - Update placeholder
 *   DELETE /api/company/:companyId/placeholders/:id     - Delete placeholder
 * 
 * Data Structure:
 *   Stored in: company.aiAgentLogic.placeholders[]
 *   Schema: { id, name, value, category, usageCount, createdAt, updatedAt }
 * 
 * Checkpoint Logging: Every operation logged with [PH-XXX] prefix
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');
const Company = require('../../models/v2Company');
const redisClient = require('../../db').redisClient;
const { v4: uuidv4 } = require('uuid');

// ============================================================================
// GET ALL PLACEHOLDERS
// ============================================================================

router.get('/:companyId/placeholders', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    console.log('==========================================');
    console.log('[PH-GET-1] 📥 GET Placeholders Request');
    console.log('[PH-GET-2] Company ID:', companyId);
    console.log('[PH-GET-3] Timestamp:', new Date().toISOString());
    
    try {
        // CHECKPOINT 1: Find company
        console.log('[PH-GET-4] 🔍 Finding company document...');
        const company = await Company.findById(companyId).select('companyName aiAgentLogic.placeholders');
        
        if (!company) {
            console.error('[PH-GET-5] ❌ Company not found:', companyId);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found',
                checkpoint: 'PH-GET-5'
            });
        }
        
        console.log('[PH-GET-6] ✅ Found company:', company.companyName);
        
        // CHECKPOINT 2: Get placeholders
        const placeholders = company.aiAgentLogic?.placeholders || [];
        console.log('[PH-GET-7] 📊 Placeholders count:', placeholders.length);
        
        if (placeholders.length > 0) {
            console.log('[PH-GET-8] 📊 First placeholder:', placeholders[0].name);
        }
        
        const responseTime = Date.now() - startTime;
        console.log('[PH-GET-9] ⏱️ Response time:', responseTime, 'ms');
        console.log('[PH-GET-10] ✅ Returning', placeholders.length, 'placeholders');
        console.log('==========================================');
        
        res.json({
            success: true,
            data: placeholders,
            meta: {
                count: placeholders.length,
                responseTime,
                checkpoint: 'PH-GET-10'
            }
        });
        
    } catch (error) {
        console.error('[PH-GET-ERROR] ❌ Error:', error.message);
        console.error('[PH-GET-ERROR] ❌ Stack:', error.stack);
        console.log('==========================================');
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load placeholders',
            error: error.message,
            checkpoint: 'PH-GET-ERROR'
        });
    }
});

// ============================================================================
// CREATE PLACEHOLDER
// ============================================================================

router.post('/:companyId/placeholders', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { name, value, category } = req.body;
    const startTime = Date.now();
    
    console.log('==========================================');
    console.log('[PH-POST-1] 📝 CREATE Placeholder Request');
    console.log('[PH-POST-2] Company ID:', companyId);
    console.log('[PH-POST-3] Request body:', { name, value, category });
    console.log('[PH-POST-4] Timestamp:', new Date().toISOString());
    
    try {
        // CHECKPOINT 1: Validation
        console.log('[PH-POST-5] 🔍 Validating input...');
        if (!name || !value) {
            console.error('[PH-POST-6] ❌ Validation failed: Missing name or value');
            return res.status(400).json({ 
                success: false, 
                message: 'Name and value are required',
                checkpoint: 'PH-POST-6'
            });
        }
        
        // Strip brackets if user included them
        const cleanName = name.trim().replace(/^[\[{]|[\]}]$/g, '');
        console.log('[PH-POST-7] 🔧 Cleaned name:', cleanName, '(original:', name + ')');
        
        // CHECKPOINT 2: Find company
        console.log('[PH-POST-8] 🔍 Finding company document...');
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.error('[PH-POST-9] ❌ Company not found:', companyId);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found',
                checkpoint: 'PH-POST-9'
            });
        }
        
        console.log('[PH-POST-10] ✅ Found company:', company.companyName);
        
        // CHECKPOINT 3: Initialize structure if needed
        if (!company.aiAgentLogic) {
            console.log('[PH-POST-11] 🔧 Initializing aiAgentLogic...');
            company.aiAgentLogic = {};
        }
        
        if (!company.aiAgentLogic.placeholders) {
            console.log('[PH-POST-12] 🔧 Initializing placeholders array...');
            company.aiAgentLogic.placeholders = [];
        }
        
        console.log('[PH-POST-13] 📊 Current placeholders count:', company.aiAgentLogic.placeholders.length);
        
        // CHECKPOINT 4: Check for duplicates
        console.log('[PH-POST-14] 🔍 Checking for duplicate names...');
        const exists = company.aiAgentLogic.placeholders.find(
            p => p.name.toLowerCase() === cleanName.toLowerCase()
        );
        
        if (exists) {
            console.error('[PH-POST-15] ❌ Duplicate name found:', cleanName);
            return res.status(409).json({ 
                success: false, 
                message: `Placeholder "${cleanName}" already exists`,
                checkpoint: 'PH-POST-15'
            });
        }
        
        console.log('[PH-POST-16] ✅ No duplicates found');
        
        // CHECKPOINT 5: Create new placeholder
        const newPlaceholder = {
            id: uuidv4(),
            name: cleanName,
            value: value.trim(),
            category: category || 'general',
            usageCount: 0,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        console.log('[PH-POST-17] 💾 Created placeholder object:', newPlaceholder);
        
        // CHECKPOINT 6: Add to array
        company.aiAgentLogic.placeholders.push(newPlaceholder);
        console.log('[PH-POST-18] 📊 New placeholders count:', company.aiAgentLogic.placeholders.length);
        
        // CHECKPOINT 7: Mark as modified (CRITICAL for nested objects!)
        company.markModified('aiAgentLogic.placeholders');
        console.log('[PH-POST-19] 🔧 Marked aiAgentLogic.placeholders as modified');
        
        // CHECKPOINT 8: Save to MongoDB
        console.log('[PH-POST-20] 💾 Saving to MongoDB...');
        await company.save();
        console.log('[PH-POST-21] ✅ MongoDB save complete');
        
        // CHECKPOINT 9: Verify save
        console.log('[PH-POST-22] 🔍 Verifying save by re-fetching...');
        const verifyCompany = await Company.findById(companyId).select('aiAgentLogic.placeholders');
        const verifiedCount = verifyCompany.aiAgentLogic?.placeholders?.length || 0;
        console.log('[PH-POST-23] 🔍 Verified placeholders count:', verifiedCount);
        
        if (verifiedCount === 0) {
            console.error('[PH-POST-24] ⚠️ WARNING: Save verification failed - count is still 0!');
        }
        
        // CHECKPOINT 10: Clear Redis cache
        console.log('[PH-POST-25] 🗑️ Clearing Redis cache...');
        if (redisClient && redisClient.isReady) {
            const cacheKeys = [
                `company:${companyId}`,
                `ai:placeholders:${companyId}`
            ];
            
            await Promise.all(cacheKeys.map(key => redisClient.del(key)));
            console.log('[PH-POST-26] ✅ Redis cache cleared:', cacheKeys.join(', '));
        } else {
            console.log('[PH-POST-27] ⚠️ Redis client not available - skipping cache clear');
        }
        
        const responseTime = Date.now() - startTime;
        console.log('[PH-POST-28] ⏱️ Total operation time:', responseTime, 'ms');
        console.log('[PH-POST-29] ✅ Placeholder created successfully:', newPlaceholder.id);
        console.log('==========================================');
        
        res.status(201).json({
            success: true,
            message: 'Placeholder created successfully',
            data: newPlaceholder,
            meta: {
                responseTime,
                verifiedCount,
                checkpoint: 'PH-POST-29'
            }
        });
        
    } catch (error) {
        console.error('[PH-POST-ERROR] ❌ Error:', error.message);
        console.error('[PH-POST-ERROR] ❌ Stack:', error.stack);
        console.log('==========================================');
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create placeholder',
            error: error.message,
            checkpoint: 'PH-POST-ERROR'
        });
    }
});

// ============================================================================
// UPDATE PLACEHOLDER
// ============================================================================

router.put('/:companyId/placeholders/:id', authenticateJWT, async (req, res) => {
    const { companyId, id } = req.params;
    const { name, value, category } = req.body;
    const startTime = Date.now();
    
    console.log('==========================================');
    console.log('[PH-PUT-1] ✏️ UPDATE Placeholder Request');
    console.log('[PH-PUT-2] Company ID:', companyId);
    console.log('[PH-PUT-3] Placeholder ID:', id);
    console.log('[PH-PUT-4] Request body:', { name, value, category });
    
    try {
        // CHECKPOINT 1: Find company
        console.log('[PH-PUT-5] 🔍 Finding company document...');
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.error('[PH-PUT-6] ❌ Company not found:', companyId);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found',
                checkpoint: 'PH-PUT-6'
            });
        }
        
        console.log('[PH-PUT-7] ✅ Found company:', company.companyName);
        
        // CHECKPOINT 2: Find placeholder
        console.log('[PH-PUT-8] 🔍 Finding placeholder...');
        const placeholders = company.aiAgentLogic?.placeholders || [];
        const placeholderIndex = placeholders.findIndex(p => p.id === id);
        
        if (placeholderIndex === -1) {
            console.error('[PH-PUT-9] ❌ Placeholder not found:', id);
            return res.status(404).json({ 
                success: false, 
                message: 'Placeholder not found',
                checkpoint: 'PH-PUT-9'
            });
        }
        
        console.log('[PH-PUT-10] ✅ Found placeholder at index:', placeholderIndex);
        
        // CHECKPOINT 3: Update fields
        console.log('[PH-PUT-11] 💾 Updating placeholder fields...');
        if (name !== undefined) {
            const cleanName = name.trim().replace(/^[\[{]|[\]}]$/g, '');
            company.aiAgentLogic.placeholders[placeholderIndex].name = cleanName;
            console.log('[PH-PUT-12] Updated name:', cleanName);
        }
        if (value !== undefined) {
            company.aiAgentLogic.placeholders[placeholderIndex].value = value.trim();
            console.log('[PH-PUT-13] Updated value:', value.trim());
        }
        if (category !== undefined) {
            company.aiAgentLogic.placeholders[placeholderIndex].category = category;
            console.log('[PH-PUT-14] Updated category:', category);
        }
        company.aiAgentLogic.placeholders[placeholderIndex].updatedAt = new Date();
        
        // CHECKPOINT 4: Mark as modified and save
        company.markModified('aiAgentLogic.placeholders');
        console.log('[PH-PUT-15] 🔧 Marked as modified');
        
        console.log('[PH-PUT-16] 💾 Saving to MongoDB...');
        await company.save();
        console.log('[PH-PUT-17] ✅ MongoDB save complete');
        
        // CHECKPOINT 5: Clear cache
        console.log('[PH-PUT-18] 🗑️ Clearing Redis cache...');
        if (redisClient && redisClient.isReady) {
            await Promise.all([
                redisClient.del(`company:${companyId}`),
                redisClient.del(`ai:placeholders:${companyId}`)
            ]);
            console.log('[PH-PUT-19] ✅ Redis cache cleared');
        }
        
        const responseTime = Date.now() - startTime;
        console.log('[PH-PUT-20] ⏱️ Response time:', responseTime, 'ms');
        console.log('[PH-PUT-21] ✅ Placeholder updated successfully');
        console.log('==========================================');
        
        res.json({
            success: true,
            message: 'Placeholder updated successfully',
            data: company.aiAgentLogic.placeholders[placeholderIndex],
            meta: {
                responseTime,
                checkpoint: 'PH-PUT-21'
            }
        });
        
    } catch (error) {
        console.error('[PH-PUT-ERROR] ❌ Error:', error.message);
        console.error('[PH-PUT-ERROR] ❌ Stack:', error.stack);
        console.log('==========================================');
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update placeholder',
            error: error.message,
            checkpoint: 'PH-PUT-ERROR'
        });
    }
});

// ============================================================================
// DELETE PLACEHOLDER
// ============================================================================

router.delete('/:companyId/placeholders/:id', authenticateJWT, async (req, res) => {
    const { companyId, id } = req.params;
    const startTime = Date.now();
    
    console.log('==========================================');
    console.log('[PH-DELETE-1] 🗑️ DELETE Placeholder Request');
    console.log('[PH-DELETE-2] Company ID:', companyId);
    console.log('[PH-DELETE-3] Placeholder ID:', id);
    
    try {
        // CHECKPOINT 1: Find company
        console.log('[PH-DELETE-4] 🔍 Finding company document...');
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.error('[PH-DELETE-5] ❌ Company not found:', companyId);
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found',
                checkpoint: 'PH-DELETE-5'
            });
        }
        
        console.log('[PH-DELETE-6] ✅ Found company:', company.companyName);
        
        // CHECKPOINT 2: Remove placeholder
        const before = company.aiAgentLogic?.placeholders?.length || 0;
        console.log('[PH-DELETE-7] 📊 Placeholders before delete:', before);
        
        company.aiAgentLogic.placeholders = company.aiAgentLogic?.placeholders?.filter(p => p.id !== id) || [];
        
        const after = company.aiAgentLogic.placeholders.length;
        console.log('[PH-DELETE-8] 📊 Placeholders after delete:', after);
        
        if (before === after) {
            console.error('[PH-DELETE-9] ❌ Placeholder not found:', id);
            return res.status(404).json({ 
                success: false, 
                message: 'Placeholder not found',
                checkpoint: 'PH-DELETE-9'
            });
        }
        
        console.log('[PH-DELETE-10] ✅ Placeholder removed from array');
        
        // CHECKPOINT 3: Save
        company.markModified('aiAgentLogic.placeholders');
        console.log('[PH-DELETE-11] 💾 Saving to MongoDB...');
        await company.save();
        console.log('[PH-DELETE-12] ✅ MongoDB save complete');
        
        // CHECKPOINT 4: Clear cache
        console.log('[PH-DELETE-13] 🗑️ Clearing Redis cache...');
        if (redisClient && redisClient.isReady) {
            await Promise.all([
                redisClient.del(`company:${companyId}`),
                redisClient.del(`ai:placeholders:${companyId}`)
            ]);
            console.log('[PH-DELETE-14] ✅ Redis cache cleared');
        }
        
        const responseTime = Date.now() - startTime;
        console.log('[PH-DELETE-15] ⏱️ Response time:', responseTime, 'ms');
        console.log('[PH-DELETE-16] ✅ Placeholder deleted successfully');
        console.log('==========================================');
        
        res.json({
            success: true,
            message: 'Placeholder deleted successfully',
            meta: {
                responseTime,
                removedCount: before - after,
                checkpoint: 'PH-DELETE-16'
            }
        });
        
    } catch (error) {
        console.error('[PH-DELETE-ERROR] ❌ Error:', error.message);
        console.error('[PH-DELETE-ERROR] ❌ Stack:', error.stack);
        console.log('==========================================');
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to delete placeholder',
            error: error.message,
            checkpoint: 'PH-DELETE-ERROR'
        });
    }
});

console.log('[INIT] ✅ V2 Placeholders routes loaded - Enterprise grade with checkpoint logging');

module.exports = router;

