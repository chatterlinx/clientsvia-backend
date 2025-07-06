const fs = require('fs');
const path = require('path');

// Log to disk for now; move to DB in production.
function auditLog(action, req) {
  const entry = {
    time: new Date().toISOString(),
    user: req.user?.email || "unknown",
    ip: req.ip,
    route: req.originalUrl,
    method: req.method,
    action,
  };
  fs.appendFileSync(path.join(__dirname, '../audit.log'), JSON.stringify(entry) + '\n');
}

module.exports = { auditLog };
