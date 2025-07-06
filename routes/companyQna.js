const express = require('express');
const router = express.Router({ mergeParams: true });
const KnowledgeEntry = require('../models/KnowledgeEntry');
const { ObjectId } = require('mongodb');

// GET /api/company/:companyId/qna
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!ObjectId.isValid(companyId)) {
      return res.status(400).json({ message: 'Invalid companyId' });
    }
    const entries = await KnowledgeEntry.find({ companyId }).sort({ createdAt: -1 });
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
    if (!ObjectId.isValid(companyId)) {
      return res.status(400).json({ message: 'Invalid companyId' });
    }
    if (!question || !answer) {
      return res.status(400).json({ message: 'Question and answer are required.' });
    }
    const entry = await KnowledgeEntry.create({ companyId, question, answer, category: category || 'General', keywords: keywords || [] });
    const entries = await KnowledgeEntry.find({ companyId }).sort({ createdAt: -1 });
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
    if (!ObjectId.isValid(companyId) || !ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const { question, answer, category, keywords } = req.body;
    const updated = await KnowledgeEntry.findOneAndUpdate(
      { _id: id, companyId },
      { question, answer, category: category || 'General', keywords: keywords || [], updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Entry not found' });
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
    if (!ObjectId.isValid(companyId) || !ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const deleted = await KnowledgeEntry.findOneAndDelete({ _id: id, companyId });
    if (!deleted) return res.status(404).json({ message: 'Entry not found' });
    res.status(204).end();
  } catch (err) {
    console.error('[DELETE company Q&A]', err);
    res.status(500).json({ message: 'Error deleting entry' });
  }
});

module.exports = router;
