// Trademark checkout: charged = professional fee + 18% GST (on the fee only) + government
// fee (per class, by applicant type). Price comes from the server, never from the browser.
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
const good = { name: 'Asha Rao', email: 'asha@gmail.com', mobile: '9876543210', city: 'Bengaluru', applicantType: 'small', classes: 1, brandName: 'Acme Foods' }

test('charges professional fee + GST (fee only) + government fee, ignoring any client amount', async () => {
  const r = await request(app).post(URL).send({ ...good, amount: 1 })   // client "amount" must be ignored
  expect(r.status).toBe(200)
  expect(created.order.amount).toBe(685882)                              // ₹1,999 + ₹359.82 GST + ₹4,500 govt
  expect(r.body.breakdown).toMatchObject({ feePaise: 199900, gstPaise: 35982, govtPaise: 450000, govtCollected: true, totalPaise: 685882 })
  expect(created.payment.breakdown.govtCollected).toBe(true)
  expect(created.payment.trademark).toMatchObject({ applicantType: 'small', classes: 1, brandName: 'Acme Foods' })
  expect(created.payment.customer.city).toBe('Bengaluru')
  expect(created.so).toMatchObject({ professionalFee: 1999, gstAmount: 359.82, govtFee: 4500, totalAmount: 6858.82 })
  expect(created.ld.amount).toBe(6858.82)
  expect(created.ld.serviceTitle).toBe('Trademark Registration — 1 class')
})

test('government fee scales with classes and applicant type; GST stays on the fee only', async () => {
  const r = await request(app).post(URL).send({ ...good, applicantType: 'other', classes: 3 })
  expect(r.status).toBe(200)
  expect(r.body.breakdown.govtPaise).toBe(2700000)                       // 3 × ₹9,000
  expect(r.body.breakdown.gstPaise).toBe(35982)                          // unchanged
  expect(created.order.amount).toBe(2935882)                             // ₹1,999 + ₹359.82 + ₹27,000
  expect(created.ld.serviceTitle).toBe('Trademark Registration — 3 classes')
})

test('chosen class numbers set the class count (all 45 allowed)', async () => {
  const r = await request(app).post(URL).send({ ...good, classes: 3, classNumbers: [35, 9, 25, 9] })
  expect(r.status).toBe(200)
  expect(r.body.breakdown.govtPaise).toBe(1350000)                       // 3 unique classes × ₹4,500
  expect(created.payment.trademark.classNumbers).toEqual([9, 25, 35])
  expect(created.order.notes.classNumbers).toBe('9,25,35')
  const all = Array.from({ length: 45 }, (_, i) => i + 1)
  const r45 = await request(app).post(URL).send({ ...good, classes: 45, classNumbers: all })
  expect(r45.status).toBe(200)
  expect(r45.body.breakdown.govtPaise).toBe(45 * 450000)
})

test('expert to choose: no class list, billed as 1 class', async () => {
  const r = await request(app).post(URL).send({ ...good, classes: 1, classNumbers: [], expertToChoose: true })
  expect(r.status).toBe(200)
  expect(created.order.amount).toBe(685882)
  expect(created.payment.trademark.expertToChoose).toBe(true)
})

test('city does not change the price', async () => {
  await request(app).post(URL).send({ ...good, city: 'Mumbai' }); const a = created.order.amount
  await request(app).post(URL).send({ ...good, city: 'Jaipur' });  const b = created.order.amount
  expect(a).toBe(b)
})

test('rejects missing city, bad applicant type, class count, mobile, email, name', async () => {
  for (const bad of [{ city: '' }, { applicantType: 'vip' }, { classes: 0 }, { classes: 46 }, { classes: 'x' }, { classNumbers: [0] }, { classNumbers: [46] }, { classNumbers: 'x' }, { mobile: '12' }, { email: 'nope' }, { name: '' }]) {
    const r = await request(app).post(URL).send({ ...good, ...bad })
    expect(r.status).toBe(400)
  }
})

test('flag off: charges fee + GST only', () => {
  jest.resetModules()
  const pp = require('../config/planPrices')
  pp.TRADEMARK.collectGovtFeeOnline = false
  const p = pp.trademarkPrice({ applicantType: 'small', classes: 2 })
  expect(p.totalPaise).toBe(235882); expect(p.govtPaise).toBe(900000); expect(p.govtCollected).toBe(false)
})