// Trademark checkout: pay-now = professional fee + 18% GST; government fee is
// per class, stored for the team, and NOT charged online. Price comes from the server.
process.env.RAZORPAY_KEY_ID = 'rzp_test_x'
process.env.RAZORPAY_KEY_SECRET = 'secret123'
const express = require('express')
const request = require('supertest')

const created = {}
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  orders: { create: jest.fn(async (o) => { created.order = o; return { id: 'order_tm', amount: o.amount, currency: o.currency } }) },
})))
jest.mock('../models/User', () => ({
  findOne: jest.fn(async () => null),
  create: jest.fn(async (d) => { created.user = d; return { _id: 'u1', ...d } }),
  updateOne: jest.fn(),
}))
jest.mock('../models/Payment', () => ({
  create: jest.fn(async (d) => { created.payment = d; return { _id: 'p1', ...d } }),
  updateOne: jest.fn(), findOne: jest.fn(),
}))
jest.mock('../models/ServiceOrder', () => ({ updateOne: jest.fn((...a) => { created.so = a[1] }) }))
jest.mock('../services/orderService', () => ({ createOrder: jest.fn(async (o) => { created.ld = o; return { _id: 'o1', orderNumber: 'LD-2026-000009' } }) }))
jest.mock('../services/paymentService', () => ({ markPaid: jest.fn() }))

const app = express()
app.use(express.json())
app.use('/api/payments', require('../routes/payments'))
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }))

const URL = '/api/payments/checkout/trademark/create-order'
const good = { name: 'Asha Rao', email: 'asha@gmail.com', mobile: '9876543210', state: 'Karnataka', applicantType: 'small', classes: 1, brandName: 'Acme Foods' }

test('charges professional fee + 18% GST only; government fee is stored, not charged', async () => {
  const r = await request(app).post(URL).send({ ...good, amount: 1 })   // client "amount" must be ignored
  expect(r.status).toBe(200)
  expect(created.order.amount).toBe(235882)                              // ₹1,999 + ₹359.82
  expect(r.body.breakdown).toMatchObject({ feePaise: 199900, gstPaise: 35982, totalPaise: 235882, govtPaise: 450000 })
  expect(created.payment.trademark).toMatchObject({ applicantType: 'small', classes: 1, brandName: 'Acme Foods' })
  expect(created.payment.customer.state).toBe('Karnataka')
  expect(created.so.govtFee).toBe(4500)
  expect(created.ld.serviceTitle).toBe('Trademark Registration — 1 class')
})

test('government fee scales with classes and applicant type, amount charged does not', async () => {
  const r = await request(app).post(URL).send({ ...good, applicantType: 'other', classes: 3 })
  expect(r.status).toBe(200)
  expect(r.body.breakdown.govtPaise).toBe(2700000)                       // 3 × ₹9,000
  expect(created.order.amount).toBe(235882)
  expect(created.ld.serviceTitle).toBe('Trademark Registration — 3 classes')
})

test('rejects bad state, applicant type, class count, mobile, email', async () => {
  for (const bad of [{ state: 'Atlantis' }, { state: '' }, { applicantType: 'vip' }, { classes: 0 }, { classes: 11 }, { classes: 'x' }, { mobile: '12' }, { email: 'nope' }, { name: '' }]) {
    const r = await request(app).post(URL).send({ ...good, ...bad })
    expect(r.status).toBe(400)
  }
})