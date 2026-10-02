// Guest checkout: price is computed on the server; signature proves payment.
process.env.RAZORPAY_KEY_ID = 'rzp_test_x'
process.env.RAZORPAY_KEY_SECRET = 'secret123'
const crypto = require('crypto')
const express = require('express')
const request = require('supertest')

const created = {}
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  orders: { create: jest.fn(async (o) => { created.order = o; return { id: 'order_1', amount: o.amount, currency: o.currency } }) },
})))
jest.mock('../models/User', () => ({
  findOne: jest.fn(async () => null),
  create: jest.fn(async (d) => { created.user = d; return { _id: 'u1', ...d } }),
  updateOne: jest.fn(),
}))
jest.mock('../models/Payment', () => ({
  create: jest.fn(async (d) => { created.payment = d; return { _id: 'p1', ...d } }),
  updateOne: jest.fn(),
  findOne: jest.fn(async () => ({ _id: 'p1' })),
}))
jest.mock('../models/ServiceOrder', () => ({ updateOne: jest.fn((...a) => { created.so = a }) }))
jest.mock('../services/orderService', () => ({ createOrder: jest.fn(async () => ({ _id: 'o1', orderNumber: 'LD-2026-000001' })) }))
jest.mock('../services/paymentService', () => ({ markPaid: jest.fn(async () => ({ order: { orderNumber: 'LD-2026-000001' }, alreadyProcessed: false })) }))

const paymentRoutes = require('../routes/payments')
const app = express()
app.use(express.json())
app.use('/api/payments', paymentRoutes)
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }))

const good = { serviceSlug: 'private-limited-company-registration', tier: 'Basic', name: 'Asha Rao', email: 'asha@gmail.com', mobile: '9876543210', city: 'Bengaluru' }

test('charges fee + 18% GST computed on the server and ignores a client amount', async () => {
  const r = await request(app).post('/api/payments/checkout/create-order').send({ ...good, amount: 1 })
  expect(r.status).toBe(200)
  expect(created.order.amount).toBe(589882)            // ₹4,999 + ₹899.82 GST
  expect(r.body.breakdown).toMatchObject({ feePaise: 499900, gstPaise: 89982, totalPaise: 589882 })
  expect(created.payment.customer).toMatchObject({ email: 'asha@gmail.com', city: 'Bengaluru' })
  expect(created.user.city).toBe('Bengaluru')
})

test('rejects missing city / bad mobile / bad tier / unknown service', async () => {
  for (const bad of [{ city: '' }, { mobile: '123' }, { tier: 'Gold' }, { email: 'nope' }]) {
    const r = await request(app).post('/api/payments/checkout/create-order').send({ ...good, ...bad })
    expect(r.status).toBe(400)
  }
  const r = await request(app).post('/api/payments/checkout/create-order').send({ ...good, serviceSlug: 'seo' })
  expect(r.status).toBe(400)
})

test('verify accepts a valid signature and rejects a forged one', async () => {
  const sig = crypto.createHmac('sha256', 'secret123').update('order_1|pay_1').digest('hex')
  const ok = await request(app).post('/api/payments/checkout/verify').send({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sig })
  expect(ok.status).toBe(200); expect(ok.body.orderNumber).toBe('LD-2026-000001')
  const bad = await request(app).post('/api/payments/checkout/verify').send({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'a'.repeat(64) })
  expect(bad.status).toBe(400)
})