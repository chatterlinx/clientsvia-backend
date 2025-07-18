const express = require('express');
const router = express.Router({ mergeParams: true });
const KnowledgeEntry = require('../models/KnowledgeEntry');
const { ObjectId } = require('mongodb');

// Middleware to validate companyId and ensure tenant isolation
const validateCompanyId = (req, res, next) => {
  const { companyId } = req.params;
  
  if (!companyId) {
    return res.status(400).json({ message: 'Company ID is required' });
  }
  
  if (!ObjectId.isValid(companyId)) {
    return res.status(400).json({ message: 'Invalid company ID format' });
  }
  
  // Log for audit trail
  console.log(`[TENANT-ISOLATION] Operation on companyId: ${companyId}`);
  
  next();
};

// Apply middleware to all routes
router.use(validateCompanyId);

// GET /api/company/:companyId/qna
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    console.log(`[GET company Q&A] Fetching for company: ${companyId}`);
    const entries = await KnowledgeEntry.find({ companyId }).sort({ createdAt: -1 });
    console.log(`[GET company Q&A] Found ${entries.length} entries for company: ${companyId}`);
    
    res.json(entries);
  } catch (err) {
    console.error('[GET company Q&A]', err);
    res.status(500).json({ message: 'Error fetching Q&A' });
  }
});

// POST /api/company/:companyId/qna
router.post('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { question, answer, category, keywords } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({ message: 'Question and answer are required.' });
    }
    
    console.log(`[POST company Q&A] Adding entry for company: ${companyId}`);
    console.log(`[POST company Q&A] Entry: Q="${question.substring(0, 50)}..." A="${answer.substring(0, 50)}..."`);
    
    // Ensure companyId is properly set and validated
    const entry = await KnowledgeEntry.create({ 
      companyId: new ObjectId(companyId), // Explicitly create ObjectId
      question, 
      answer, 
      category: category || 'General', 
      keywords: keywords || [] 
    });
    
    // Fetch all entries for THIS company only
    const entries = await KnowledgeEntry.find({ companyId }).sort({ createdAt: -1 });
    
    console.log(`[POST company Q&A] Successfully added entry. Total entries for company ${companyId}: ${entries.length}`);
    
    res.status(201).json(entries);
  } catch (err) {
    console.error('[POST company Q&A]', err);
    res.status(500).json({ message: 'Error adding Q&A entry' });
  }
});

// PUT /api/company/:companyId/qna/:id
router.put('/:id', async (req, res) => {
  try {
    const { companyId, id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid entry ID' });
    }
    
    const { question, answer, category, keywords } = req.body;
    
    console.log(`[PUT company Q&A] Updating entry ${id} for company: ${companyId}`);
    
    // CRITICAL: Use BOTH _id AND companyId to ensure tenant isolation
    const updated = await KnowledgeEntry.findOneAndUpdate(
      { _id: new ObjectId(id), companyId: new ObjectId(companyId) },
      { question, answer, category: category || 'General', keywords: keywords || [], updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!updated) {
      console.log(`[PUT company Q&A] Entry ${id} not found for company ${companyId} - possible cross-tenant access attempt`);
      return res.status(404).json({ message: 'Entry not found or access denied' });
    }
    
    console.log(`[PUT company Q&A] Successfully updated entry ${id} for company: ${companyId}`);
    res.json(updated);
  } catch (err) {
    console.error('[PUT company Q&A]', err);
    res.status(500).json({ message: 'Error updating entry' });
  }
});

// DELETE /api/company/:companyId/qna/:id
router.delete('/:id', async (req, res) => {
  try {
    const { companyId, id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid entry ID' });
    }
    
    console.log(`[DELETE company Q&A] Deleting entry ${id} for company: ${companyId}`);
    
    // CRITICAL: Use BOTH _id AND companyId to ensure tenant isolation
    const deleted = await KnowledgeEntry.findOneAndDelete({ 
      _id: new ObjectId(id), 
      companyId: new ObjectId(companyId) 
    });
    
    if (!deleted) {
      console.log(`[DELETE company Q&A] Entry ${id} not found for company ${companyId} - possible cross-tenant access attempt`);
      return res.status(404).json({ message: 'Entry not found or access denied' });
    }
    
    console.log(`[DELETE company Q&A] Successfully deleted entry ${id} for company: ${companyId}`);
    res.status(204).end();
  } catch (err) {
    console.error('[DELETE company Q&A]', err);
    res.status(500).json({ message: 'Error deleting entry' });
  }
});

module.exports = router;
