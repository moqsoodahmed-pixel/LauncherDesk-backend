const mongoose = require('mongoose')

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    order:    { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceOrder', required: true, index: true },
    payment:  { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerName:  String,
    customerEmail: String,
    customerPhone: String,
    serviceName:   String,
    taxableAmount: Number,
    gstRate:       { type: Number, default: 18 },
    gstAmount:     Number,
    govtFeeAmount: { type: Number, default: 0 },   // pass-through government fee, no GST on it
    totalAmount:   Number,
    paymentReference: String,
    invoiceDate:   { type: Date, default: Date.now },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Invoice', invoiceSchema)