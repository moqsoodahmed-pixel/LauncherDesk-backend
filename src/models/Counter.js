const mongoose = require('mongoose')

/** Atomic sequence numbers for order IDs, invoice numbers and ticket IDs. */
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { collection: 'ld_counters' })

counterSchema.statics.next = async function (name) {
  const c = await this.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true })
  return c.seq
}

module.exports = mongoose.model('Counter', counterSchema)
