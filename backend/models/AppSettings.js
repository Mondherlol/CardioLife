const mongoose = require('mongoose')

const schema = new mongoose.Schema({
  maxFileSizeMB:         { type: Number, default: 50 },
  maxTotalSpaceMB:       { type: Number, default: 2048 },
  defaultUploadFolderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
}, { timestamps: true })

module.exports = mongoose.model('AppSettings', schema)
