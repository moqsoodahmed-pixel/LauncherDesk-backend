// Trademark checkout: optional brand logo upload — PDF only, max 5 MB.
process.env.RAZORPAY_KEY_ID = 'rzp_test_x'
process.env.RAZORPAY_KEY_SECRET = 'secret123'
const fs = require('fs')
const os = require('os')
const path = require('path')
const express = require('express')
const request = require('supertest')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-logo-'))
const created = {}
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  orders: { create: jest.fn(async (o) => { created.order = o; return { id: 'order_tm', amount: o.amount, currency: o.currency } }) },
})))
jest.mock('../models/User', () => ({ findOne: jest.fn(async () => null), create: jest.fn(async (d) => ({ _id: 'u1', ...d })), updateOne: jest.fn() }))
jest.mock('../models/Payment', () => ({ create: jest.fn(async (d) => { created.payment = d; return { _id: 'p1', ...d } }), updateOne: jest.fn(), findOne: jest.fn() }))
jest.mock('../models/ServiceOrder', () => ({ updateOne: jest.fn() }))
jest.mock('../models/ServiceDocument', () => ({ create: jest.fn(async (d) => { created.doc = d; return d }) }))
jest.mock('../middleware/privateUpload', () => ({ DIR: require('path').join(require('os').tmpdir(), 'ld-logo-test') }))
jest.mock('../services/orderService', () => ({ createOrder: jest.fn(async () => ({ _id: 'o1', orderNumber: 'LD-2026-000011' })) }))
jest.mock('../services/paymentService', () => ({ markPaid: jest.fn() }))

const DIR = path.join(os.tmpdir(), 'ld-logo-test')
fs.mkdirSync(DIR, { recursive: true })

const app = express()
app.use(express.json())
app.use('/api/payments', require('../routes/payments'))
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }))

const URL = '/api/payments/checkout/trademark/create-order'
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const form = (req, extra = {}) => {
  const f = { name: 'Asha Rao', email: 'asha@gmail.com', mobile: '9876543210', city: 'Bengaluru',
    applicantType: 'small', classes: '2', classNumbers: JSON.stringify([25, 35]), brandName: 'Acme Foods',
    whatsappOptIn: 'false', expertToChoose: 'false', ...extra }
  Object.entries(f).forEach(([k, v]) => req.field(k, v))
  return req
}

beforeEach(() => { created.doc = null })

test('accepts a PDF logo and saves it as the order\'s logo document', async () => {
  const r = await form(request(app).post(URL)).attach('logo', PDF, { filename: 'acme-logo.pdf', contentType: 'application/pdf' })
  expect(r.status).toBe(200)
  expect(r.body.breakdown.govtPaise).toBe(900000)                         // 2 classes from the form fields
  expect(created.payment.trademark.classNumbers).toEqual([25, 35])
  expect(created.payment.customer.whatsappOptIn).toBe(false)              // "false" text is not treated as true
  expect(created.doc).toMatchObject({ order: 'o1', name: 'Brand name / logo file', filename: 'acme-logo.pdf', mimeType: 'application/pdf', status: 'UPLOADED' })
  expect(fs.existsSync(path.join(DIR, created.doc.filePath))).toBe(true)
  expect(created.order.notes.logoUploaded).toBe('true')
})

test('rejects images and other non-PDF files', async () => {
  const r = await form(request(app).post(URL)).attach('logo', Buffer.from('\x89PNG....'), { filename: 'logo.png', contentType: 'image/png' })
  expect(r.status).toBe(400)
  expect(r.body.message).toMatch(/PDF/)
  expect(created.doc).toBeNull()
})

test('rejects a file renamed to .pdf that is not really a PDF', async () => {
  const r = await form(request(app).post(URL)).attach('logo', Buffer.from('not a pdf at all'), { filename: 'logo.pdf', contentType: 'application/pdf' })
  expect(r.status).toBe(400)
  expect(created.doc).toBeNull()
})

test('rejects a PDF over 5 MB', async () => {
  const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 + 10)])
  const r = await form(request(app).post(URL)).attach('logo', big, { filename: 'big.pdf', contentType: 'application/pdf' })
  expect(r.status).toBe(400)
  expect(r.body.message).toMatch(/5 MB/)
})

test('logo is optional: JSON checkout without a logo still works', async () => {
  const r = await request(app).post(URL).send({ name: 'Asha Rao', email: 'asha@gmail.com', mobile: '9876543210', city: 'Bengaluru', applicantType: 'small', classes: 1 })
  expect(r.status).toBe(200)
  expect(created.doc).toBeNull()
})