const mongoose = require('mongoose')

const stockMovementSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  type:           { type: String, enum: ['entree', 'sortie', 'ajustement', 'serialisation'], required: true },
  quantity:       { type: Number, required: true },
  previousStock:  { type: Number },
  newStock:       { type: Number },
  reason:         { type: String, trim: true },
  serialNumbers:  [{ type: String, trim: true }],
  lotNumber:      { type: String, trim: true },
  expirationDate: { type: Date },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true })

module.exports = mongoose.model('StockMovement', stockMovementSchema)
