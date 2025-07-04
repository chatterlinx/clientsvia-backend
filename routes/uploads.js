const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });

router.post('/', upload.single('file'), (req, res) => {
  // TODO: virus scan and upload to object storage
  res.json({ file: req.file.filename });
});

module.exports = router;
