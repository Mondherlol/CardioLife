const mongoose = require('mongoose')

const clientTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
}, { timestamps: true })

module.exports = mongoose.model('ClientType', clientTypeSchema)
