// Service "Pay ₹X" buttons (e.g. DSC "₹4,200 + GST"): with addGst the amount
// charged is the price + 18% GST, worked out on the server.
process.env.RAZORPAY_KEY_ID = 'rzp_test_x'
process.env.RAZORPAY_KEY_SECRET = 'secret123'
const express = require('express')
const request = require('supertest')

const created = {}
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  orders: { create: jest.fn(async (o) => { created.order = o; return { id: 'order_dsc', amount: o.amount, currency: o.currency } }) },
})))
jest.mock('../middleware/auth', () => ({
  protect: (req, _res, next) => { req.user = { _id: 'u1', name: 'Asha', email: 'asha@gmail.com' }; next() },
}))
jest.mock('../models/Payment', () => ({
  create: jest.fn(async (d) => { created.payment = d; return { _id: 'p1', ...d } }),
  updateOne: jest.fn(), findOne: jest.fn(),
}))
jest.mock('../models/ServiceOrder', () => ({ updateOne: jest.fn((...a) => { created.so = a[1] }) }))
jest.mock('../services/orderService', () => ({ createOrder: jest.fn(async (o) => { created.ld = o; return { _id: 'o1', orderNumber: 'LD-2026-000010' } }) }))
jest.mock('../services/paymentService', () => ({ markPaid: jest.fn() }))

const app = express()
app.use(express.json())
app.use('/api/payments', require('../routes/payments'))
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }))

const URL = '/api/payments/create-order'
const dsc = { amount: 4200, serviceSlug: 'dsc', serviceTitle: 'Digital Signature Certificate' }

test('addGst: DSC ₹4,200 is charged as ₹4,956 (₹756 GST)', async () => {
  const r = await request(app).post(URL).send({ ...dsc, addGst: true })
  expect(r.status).toBe(200)
  expect(created.order.amount).toBe(495600)
  expect(r.body.breakdown).toMatchObject({ feePaise: 420000, gstPaise: 75600, totalPaise: 495600 })
  expect(created.payment.amountRupees).toBe(4956)
  expect(created.payment.breakdown).toMatchObject({ feePaise: 420000, gstPaise: 75600, totalPaise: 495600 })
  expect(created.so).toMatchObject({ professionalFee: 4200, gstAmount: 756, totalAmount: 4956 })
  expect(created.ld.amount).toBe(4956)
})

test('paise are kept exactly (₹1,999 + GST = ₹2,358.82)', async () => {
  await request(app).post(URL).send({ ...dsc, amount: 1999, addGst: true })
  expect(created.order.amount).toBe(235882)
})

test('without addGst the amount is unchanged (old behaviour)', async () => {
  created.payment = null
  const r = await request(app).post(URL).send(dsc)
  expect(r.status).toBe(200)
  expect(created.order.amount).toBe(420000)
  expect(created.payment.breakdown).toBeUndefined()
})