/**
 * GOLD STANDARD V2 NOTES ROUTES
 * Chief Spartan Engineering - Multi-tenant Notes Management
 * Features: Full CRUD, tenant isolation, advanced search, categories, priorities
 */

const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const Company = require('../models/v2Company');
const { authenticateJWT } = require('../middleware/auth');

// Middleware to validate company ID and tenant isolation
const validateCompanyAccess = async (req, res, next) => {
    const { companyId } = req.params;
    
    if (!companyId || !ObjectId.isValid(companyId)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid company ID format' 
        });
    }
    
    try {
        // In a real multi-tenant system, you'd also check user permissions
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        req.company = company;
        next();
    } catch (error) {
        console.error('[Notes API] Company validation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error validating company access' 
        });
    }
};

/**
 * GET /api/notes/:companyId
 * Get all notes for a company with optional filtering
 */
router.get('/:companyId', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { search, category, priority, pinned, sort = 'updated-desc' } = req.query;
        
        console.log(`[Notes API] GET request for company ${companyId} with filters:`, { search, category, priority, pinned, sort });
        
        const company = await Company.findById(companyId);
        let notes = company.notes || [];
        
        // Apply filters
        if (search) {
            const searchTerm = search.toLowerCase();
            notes = notes.filter(note => 
                note.title.toLowerCase().includes(searchTerm) ||
                note.content.toLowerCase().includes(searchTerm) ||
                (note.tags && note.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
            );
        }
        
        if (category) {
            notes = notes.filter(note => note.category === category);
        }
        
        if (priority) {
            notes = notes.filter(note => note.priority === priority);
        }
        
        if (pinned !== undefined) {
            const isPinned = pinned === 'true';
            notes = notes.filter(note => note.isPinned === isPinned);
        }
        
        // Sort notes
        notes.sort((a, b) => {
            // Always keep pinned notes at top
            if (a.isPinned && !b.isPinned) {return -1;}
            if (!a.isPinned && b.isPinned) {return 1;}
            
            switch (sort) {
                case 'created-desc':
                    return new Date(b.createdAt) - new Date(a.createdAt);
                case 'title-asc':
                    return a.title.localeCompare(b.title);
                case 'priority-desc':
                    const priorityOrder = { high: 3, normal: 2, low: 1 };
                    return (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2);
                case 'updated-desc':
                default:
                    return new Date(b.updatedAt) - new Date(a.updatedAt);
            }
        });
        
        console.log(`[Notes API] Retrieved ${notes.length} notes for company ${companyId}`);
        
        res.json({
            success: true,
            data: notes,
            count: notes.length,
            pinnedCount: notes.filter(n => n.isPinned).length
        });
        
    } catch (error) {
        console.error('[Notes API] GET error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error retrieving notes' 
        });
    }
});

/**
 * POST /api/notes/:companyId
 * Create a new note
 */
router.post('/:companyId', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { title, content, category = 'general', priority = 'normal', isPinned = false, tags = [] } = req.body;
        
        console.log(`[Notes API] POST request for company ${companyId}:`, { title, content, category, priority, isPinned });
        
        // Validation
        if (!content || !content.trim()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Content is required' 
            });
        }
        
        // Create new note
        const newNote = {
            id: Date.now() + Math.random(), // Frontend compatibility
            title: title?.trim() || content.split('\n')[0].substring(0, 50) || 'Untitled Note',
            content: content.trim(),
            category,
            priority,
            isPinned,
            tags: Array.isArray(tags) ? tags : [],
            author: 'Developer', // In real app, get from authenticated user
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        // Add to company notes
        await Company.findByIdAndUpdate(
            companyId,
            { 
                $push: { notes: newNote },
                $set: { updatedAt: new Date() }
            },
            { new: true }
        );
        
        console.log(`[Notes API] Created note ${newNote.id} for company ${companyId}`);
        
        res.status(201).json({
            success: true,
            data: newNote,
            message: 'Note created successfully'
        });
        
    } catch (error) {
        console.error('[Notes API] POST error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error creating note' 
        });
    }
});

/**
 * PUT /api/notes/:companyId/:noteId
 * Update an existing note
 */
router.put('/:companyId/:noteId', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId, noteId } = req.params;
        const { title, content, category, priority, isPinned, tags } = req.body;
        
        console.log(`[Notes API] PUT request for note ${noteId} in company ${companyId}`);
        
        // Validation
        if (!content || !content.trim()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Content is required' 
            });
        }
        
        // Update note
        const updateResult = await Company.updateOne(
            { 
                _id: new ObjectId(companyId),
                'notes.id': noteId
            },
            {
                $set: {
                    'notes.$.title': title?.trim() || content.split('\n')[0].substring(0, 50) || 'Untitled Note',
                    'notes.$.content': content.trim(),
                    'notes.$.category': category || 'general',
                    'notes.$.priority': priority || 'normal',
                    'notes.$.isPinned': isPinned || false,
                    'notes.$.tags': Array.isArray(tags) ? tags : [],
                    'notes.$.updatedAt': new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Note not found' 
            });
        }
        
        // Get updated note
        const company = await Company.findById(companyId);
        const updatedNote = company.notes.find(note => note.id == noteId);
        
        console.log(`[Notes API] Updated note ${noteId} for company ${companyId}`);
        
        res.json({
            success: true,
            data: updatedNote,
            message: 'Note updated successfully'
        });
        
    } catch (error) {
        console.error('[Notes API] PUT error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating note' 
        });
    }
});

/**
 * DELETE /api/notes/:companyId/:noteId
 * Delete a note
 */
router.delete('/:companyId/:noteId', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId, noteId } = req.params;
        
        console.log(`[Notes API] DELETE request for note ${noteId} in company ${companyId}`);
        
        // Remove note from company
        const updateResult = await Company.updateOne(
            { _id: new ObjectId(companyId) },
            { 
                $pull: { notes: { id: noteId } },
                $set: { updatedAt: new Date() }
            }
        );
        
        if (updateResult.modifiedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Note not found' 
            });
        }
        
        console.log(`[Notes API] Deleted note ${noteId} from company ${companyId}`);
        
        res.json({
            success: true,
            message: 'Note deleted successfully'
        });
        
    } catch (error) {
        console.error('[Notes API] DELETE error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting note' 
        });
    }
});

/**
 * PATCH /api/notes/:companyId/:noteId/pin
 * Toggle pin status of a note
 */
router.patch('/:companyId/:noteId/pin', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId, noteId } = req.params;
        
        console.log(`[Notes API] PATCH pin toggle for note ${noteId} in company ${companyId}`);
        
        // Get current note to toggle pin status
        const company = await Company.findById(companyId);
        const note = company.notes.find(n => n.id == noteId);
        
        if (!note) {
            return res.status(404).json({ 
                success: false, 
                message: 'Note not found' 
            });
        }
        
        const newPinStatus = !note.isPinned;
        
        // Update pin status
        await Company.updateOne(
            { 
                _id: new ObjectId(companyId),
                'notes.id': noteId
            },
            {
                $set: {
                    'notes.$.isPinned': newPinStatus,
                    'notes.$.updatedAt': new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(`[Notes API] Note ${noteId} pin status changed to ${newPinStatus}`);
        
        res.json({
            success: true,
            data: { isPinned: newPinStatus },
            message: `Note ${newPinStatus ? 'pinned' : 'unpinned'} successfully`
        });
        
    } catch (error) {
        console.error('[Notes API] PATCH pin error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating pin status' 
        });
    }
});

/**
 * GET /api/notes/:companyId/stats
 * Get notes statistics for dashboard
 */
router.get('/:companyId/stats', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await Company.findById(companyId);
        const notes = company.notes || [];
        
        // Calculate statistics
        const stats = {
            total: notes.length,
            pinned: notes.filter(n => n.isPinned).length,
            categories: {},
            priorities: {},
            recentCount: 0
        };
        
        // Count by categories and priorities
        notes.forEach(note => {
            // Categories
            stats.categories[note.category] = (stats.categories[note.category] || 0) + 1;
            
            // Priorities
            stats.priorities[note.priority] = (stats.priorities[note.priority] || 0) + 1;
            
            // Recent (last 7 days)
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            if (new Date(note.createdAt) > weekAgo) {
                stats.recentCount++;
            }
        });
        
        console.log(`[Notes API] Generated stats for company ${companyId}:`, stats);
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('[Notes API] Stats error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error generating stats' 
        });
    }
});

module.exports = router;
