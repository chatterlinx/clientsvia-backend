const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');

router.get('/:id', verifyToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  res.json({ company: id });
});

module.exports = router;
