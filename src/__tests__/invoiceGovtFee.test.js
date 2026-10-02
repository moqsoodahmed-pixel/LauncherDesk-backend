// GST on an invoice must only ever apply to the professional fee, never to a
// pass-through government fee.
jest.mock('../models/Invoice', () => ({ findOne: jest.fn(async () => null), create: jest.fn(async d => d) }))
jest.mock('../models/Counter', () => ({ next: jest.fn(async () => 7) }))
jest.mock('../models/User', () => ({ findById: () => ({ lean: async () => ({ name: 'Asha', email: 'a@x.in', phone: '+919876543210' }) }) }))
const { createInvoice, splitForInvoice } = require('../services/invoiceService')

test('trademark invoice: GST on fee only, government fee as its own line', async () => {
  const payment = { _id: 'p', amountRupees: 6858.82, razorpayPaymentId: 'pay_1',
    breakdown: { feePaise: 199900, gstPaise: 35982, govtPaise: 450000, govtCollected: true, totalPaise: 685882 } }
  const { invoice } = await createInvoice({ _id: 'o', user: 'u', serviceTitle: 'Trademark Registration — 1 class' }, payment)
  expect(invoice).toMatchObject({ taxableAmount: 1999, gstAmount: 359.82, govtFeeAmount: 4500, totalAmount: 6858.82 })
})

test('plan invoice (no government fee) still splits exactly', () => {
  const r = splitForInvoice({ amountRupees: 5898.82, breakdown: { feePaise: 499900, gstPaise: 89982, totalPaise: 589882 } })
  expect(r).toMatchObject({ taxable: 4999, gst: 899.82, govt: 0, total: 5898.82 })
})

test('older payments without a saved split fall back to the old inclusive split', () => {
  const r = splitForInvoice({ amountRupees: 1180 })
  expect(r).toMatchObject({ taxable: 1000, gst: 180, govt: 0, total: 1180 })
})

test('a split that does not add up is ignored (falls back safely)', () => {
  const r = splitForInvoice({ amountRupees: 5000, breakdown: { feePaise: 199900, gstPaise: 35982, govtPaise: 450000, govtCollected: true } })
  expect(r.govt).toBe(0); expect(r.total).toBe(5000)
})