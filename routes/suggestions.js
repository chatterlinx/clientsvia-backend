const express = require('express');
const router = express.Router();
const SuggestedKnowledgeEntry = require('../models/SuggestedKnowledgeEntry');
const KnowledgeEntry = require('../models/KnowledgeEntry');
const { ObjectId } = require('mongodb');
const { authenticateJWT, requireRole } = require('../middleware/auth'); // Authentication

// POST /api/suggestions - Add a new suggested knowledge entry (used internally by agent)
router.post('/', async (req, res) => {
  try {
    const { question, suggestedAnswer, category, originalCallSid } = req.body;
    if (!question || !suggestedAnswer) {
      return res.status(400).json({ message: 'Question and suggested answer are required.' });
    }
    const newSuggestedEntry = new SuggestedKnowledgeEntry({ question, suggestedAnswer, category, originalCallSid });
    await newSuggestedEntry.save();
    res.status(201).json(newSuggestedEntry);
  } catch (error) {
    console.error('[API POST /api/suggestions] Error:', error);
    res.status(500).json({ message: 'Error adding suggested knowledge entry.' });
  }
});

// GET /api/suggestions - ADMIN ENDPOINT: Get all suggested knowledge entries (requires admin authentication)
// Security Fix: July 27, 2025 - Previously disabled, now restored with proper authentication
// Only accessible to admin users with valid JWT tokens
router.get('/', authenticateJWT, requireRole('admin'), async (req, res) => {
  try {
    console.log('[ADMIN API GET /api/suggestions] Admin user requesting all suggestions:', req.user.email);
    
    // Get all suggested knowledge entries with company information
    const suggestions = await SuggestedKnowledgeEntry.find({})
      .populate('companyId', 'companyName tradeTypes') // Include company name and trade types
      .sort({ createdAt: -1 }) // Most recent first
      .limit(1000); // Reasonable limit for admin dashboard
    
    console.log(`[ADMIN API GET /api/suggestions] Returning ${suggestions.length} suggestions to admin`);
    
    res.json({
      success: true,
      data: suggestions,
      count: suggestions.length,
      message: 'Admin access granted to all suggested knowledge entries'
    });
    
  } catch (err) {
    console.error('[ADMIN API GET /api/suggestions] Error:', err);
    res.status(500).json({ 
      message: 'Server error retrieving suggestions',
      error: err.message 
    });
  }
});

// PATCH /api/suggestions/:id - Update a suggested knowledge entry (e.g., change status)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ID format.' });
    }
    const { status, category, question, suggestedAnswer } = req.body;
    const updateFields = { updatedAt: new Date() };
    if (status) updateFields.status = status;
    if (category) updateFields.category = category;
    if (question) updateFields.question = question;
    if (suggestedAnswer) updateFields.suggestedAnswer = suggestedAnswer;

    const updatedEntry = await SuggestedKnowledgeEntry.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );
    if (!updatedEntry) {
      return res.status(404).json({ message: 'Suggested knowledge entry not found.' });
    }
    res.json(updatedEntry);
  } catch (error) {
    console.error('[API PATCH /api/suggestions/:id] Error:', error);
    res.status(500).json({ message: 'Error updating suggested knowledge entry.' });
  }
});

// POST /api/suggestions/:id/approve - Approve a suggested entry and move to KnowledgeEntry
router.post('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ID format.' });
    }

    const suggestedEntry = await SuggestedKnowledgeEntry.findById(id);
    if (!suggestedEntry) {
      return res.status(404).json({ message: 'Suggested knowledge entry not found.' });
    }

    // Create a new KnowledgeEntry from the suggested one
    const newKnowledgeEntry = new KnowledgeEntry({
      category: suggestedEntry.category || 'General', // Ensure a category is set
      question: suggestedEntry.question,
      answer: suggestedEntry.suggestedAnswer,
      approved: true,
    });
    await newKnowledgeEntry.save();

    // Mark the suggested entry as approved/reviewed or delete it
    await SuggestedKnowledgeEntry.findByIdAndDelete(id); // Or update status to 'approved'

    res.status(201).json(newKnowledgeEntry);
  } catch (error) {
    console.error('[API POST /api/suggestions/:id/approve] Error:', error);
    res.status(500).json({ message: 'Error approving suggested knowledge entry.' });
  }
});

// DELETE /api/suggestions/:id - Delete a suggested knowledge entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid ID format.' });
    }
    const deletedEntry = await SuggestedKnowledgeEntry.findByIdAndDelete(id);
    if (!deletedEntry) {
      return res.status(404).json({ message: 'Suggested knowledge entry not found.' });
    }
    res.status(204).send(); // No content on successful deletion
  } catch (error) {
    console.error('[API DELETE /api/suggestions/:id] Error:', error);
    res.status(500).json({ message: 'Error deleting suggested knowledge entry.' });
  }
});

module.exports = router;