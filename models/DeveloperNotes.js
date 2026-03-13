/**
 * DeveloperNotes — Enterprise Build Notepad
 *
 * Stores company-scoped developer notes as tabbed sections.
 * Each tab contains ordered sections with a title + HTML content body.
 *
 * @module models/DeveloperNotes
 */

const mongoose = require('mongoose');

const SectionSchema = new mongoose.Schema({
  id:        { type: String, required: true },
  title:     { type: String, default: 'Untitled Section' },
  content:   { type: String, default: '' },
  collapsed: { type: Boolean, default: false },
  order:     { type: Number, default: 0 },
  tags:      [{ type: String }]
}, { _id: false });

const TabSchema = new mongoose.Schema({
  id:       { type: String, required: true },
  title:    { type: String, default: 'New Tab' },
  color:    { type: String, default: '#3B82F6' },
  order:    { type: Number, default: 0 },
  sections: [SectionSchema]
}, { _id: false });

const DeveloperNotesSchema = new mongoose.Schema({
  companyId:       { type: String, required: true, unique: true, index: true },
  tabs:            [TabSchema],
  lastActiveTabId: { type: String, default: null }
}, {
  timestamps: true,
  collection: 'developer_notes'
});

DeveloperNotesSchema.statics.getNotes = async function(companyId) {
  let doc = await this.findOne({ companyId });
  if (!doc) {
    doc = await this.create({ companyId, tabs: [], lastActiveTabId: null });
  }
  return doc;
};

DeveloperNotesSchema.statics.saveNotes = async function(companyId, data) {
  return this.findOneAndUpdate(
    { companyId },
    { $set: { tabs: data.tabs || [], lastActiveTabId: data.lastActiveTabId || null } },
    { new: true, upsert: true }
  );
};

module.exports = mongoose.model('DeveloperNotes', DeveloperNotesSchema);
