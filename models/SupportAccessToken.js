const mongoose = require('mongoose');

/**
 * Break-glass support access token (time-limited, scoped, revocable).
 *
 * Stored so tokens can be revoked and audited.
 */
const SupportAccessTokenSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true, index: true }, // token id
  issuedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  issuedByEmail: { type: String, default: null },

  // Scope
  companyIds: { type: [mongoose.Schema.Types.ObjectId], default: [], index: true },
  allowedPathPrefixes: { type: [String], default: [] }, // e.g. ['/api/admin/front-desk-behavior/', '/api/company/']
  allowedMethods: { type: [String], default: ['GET'] }, // e.g. ['GET','PATCH']

  // Lifecycle
  reason: { type: String, default: null, maxLength: 500 },
  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null, index: true },
  revokedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revokedByEmail: { type: String, default: null }
});

SupportAccessTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SupportAccessToken', SupportAccessTokenSchema);


