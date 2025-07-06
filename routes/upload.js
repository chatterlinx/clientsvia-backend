const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
router.use(express.json({ limit: '10mb' }));

async function uploadGreeting(req, res) {
  try {
    const { fileName, data } = req.body || {};
    if (!data) return res.status(400).json({ message: 'No file data provided' });
    const base64 = data.replace(/^data:audio\/\w+;base64,/, '');
    const ext = path.extname(fileName || 'greeting.mp3') || '.mp3';
    const name = `greeting_${Date.now()}${ext}`;
    const audioDir = path.join(__dirname, '../public/audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, name), Buffer.from(base64, 'base64'));
    res.json({ url: `/audio/${name}` });
  } catch (err) {
    console.error('[POST /api/upload/greeting] Error:', err.message);
    res.status(500).json({ message: 'Failed to save audio file' });
  }
}

router.post('/greeting', uploadGreeting);

module.exports = router;
