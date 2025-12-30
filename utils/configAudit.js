const crypto = require('crypto');

function getClientIp(req) {
  return req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    'unknown';
}

function getUserAgent(req) {
  const ua = req.headers['user-agent'];
  return ua ? ua.substring(0, 500) : null;
}

function getRequestId(req) {
  const header = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  if (typeof header === 'string' && header.trim()) return header.trim().slice(0, 120);
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function summarizePaths(paths) {
  const list = Array.isArray(paths) ? paths : [];
  if (list.length === 0) return null;
  if (list.length <= 4) return `Updated: ${list.join(', ')}`;
  return `Updated ${list.length} fields (e.g. ${list.slice(0, 4).join(', ')}, ...)`;
}

module.exports = {
  getClientIp,
  getUserAgent,
  getRequestId,
  summarizePaths
};


