const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });
const { auditLog } = require('../middleware/audit');

function handleUpload(req, res) {
  // TODO: virus scan and upload to object storage
  auditLog('upload file', req);
  res.json({ file: req.file.filename });
}

router.post('/', upload.single('file'), handleUpload);

module.exports = router;
