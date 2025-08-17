// Phase 2 — tiny in-memory TTL cache with ETag
const CACHE_TTL_MS = 60_000; // 60s
const _store = new Map(); // key: companyId, val: { etag, expiresAt, data }

let _etagCounter = 1;
const _now = () => Date.now();

exports.get = (companyId) => {
  const hit = _store.get(String(companyId));
  if (!hit) return null;
  if (_now() > hit.expiresAt) { _store.delete(String(companyId)); return null; }
  return { etag: hit.etag, data: hit.data };
};

exports.set = (companyId, data) => {
  const etag = `W/"ecfg-${_etagCounter++}"`;
  _store.set(String(companyId), { etag, data, expiresAt: _now() + CACHE_TTL_MS });
  return etag;
};

exports.invalidate = (companyId) => { _store.delete(String(companyId)); };
