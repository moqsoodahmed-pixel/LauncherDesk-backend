// e-Stamp checkout: charged = stamp duty (at actual, no GST) + LauncherDesk fees + 18% GST on the fees.
// The price is recalculated on the server; the browser only sends the customer's choices.
process.env.RAZORPAY_KEY_ID = 'rzp_test_x'
process.env.RAZORPAY_KEY_SECRET = 'secret123'
const express = require('express')
const request = require('supertest')

const created = {}
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  orders: { create: jest.fn(async (o) => { created.order = o; return { id: 'order_es', amount: o.amount, currency: o.currency } }) },
})))
jest.mock('../middleware/auth', () => ({
  protect: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer ok') return res.status(401).json({ success: false, message: 'Not authorised' })
    req.user = { _id: 'u9', name: 'Asha Rao', email: 'asha@gmail.com' }; next()
  },
  optionalAuth: (req, _res, next) => next(),
  restrictTo: () => (_req, _res, next) => next(),
}))
jest.mock('../models/Payment', () => ({
  create: jest.fn(async (d) => { created.payment = d; return { _id: 'p1', ...d } }),
  updateOne: jest.fn(), findOne: jest.fn(),
}))
jest.mock('../models/ServiceOrder', () => ({ updateOne: jest.fn((...a) => { created.so = a[1] }) }))
jest.mock('../services/orderService', () => ({ createOrder: jest.fn(async (o) => { created.ld = o; return { _id: 'o1', orderNumber: 'LD-2026-000010' } }) }))
jest.mock('../services/paymentService', () => ({ markPaid: jest.fn() }))

const pp = require('../config/planPrices')
const app = express()
app.use(express.json())
app.use('/api/payments', require('../routes/payments'))
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }))

const URL = '/api/payments/checkout/estamp/create-order'
const good = {
  state: 'karnataka', stateName: 'Karnataka', firstParty: 'Asha Rao', secondParty: 'NIL', payer: 'First Party',
  documentType: 'Affidavit', purpose: 'Address affidavit', stampDuty: 100, delivery: 'email',
  name: 'Asha Rao', email: 'asha@gmail.com', mobile: '9876543210',
}
const post = (body, auth = 'Bearer ok') => request(app).post(URL).set('Authorization', auth).send(body)

afterEach(() => { pp.ESTAMP.convenienceFee = 0; pp.ESTAMP.procurementFee = 99; pp.ESTAMP.courierFee = 149 })

test('works with authentication or seamless checkout fallback', async () => {
  const r = await post(good, 'Bearer ok')
  expect(r.status).toBe(200)
})

test('with no fees set, charges exactly the stamp duty and ignores any client amount', async () => {
  pp.ESTAMP.procurementFee = 0
  const r = await post({ ...good, amount: 1 })
  expect(r.status).toBe(200)
  expect(created.order.amount).toBe(10000)
  expect(r.body.breakdown).toMatchObject({ dutyPaise: 10000, feePaise: 0, gstPaise: 0, totalPaise: 10000 })
  expect(created.payment.breakdown).toMatchObject({ govtPaise: 10000, govtCollected: true, totalPaise: 10000 })
  expect(created.ld.serviceSlug).toBe('e-stamp-paper')
  expect(created.so.details).toMatchObject({ kind: 'e-stamp', state: 'Karnataka', firstParty: 'Asha Rao', stampDuty: 100, delivery: 'Email scan only' })
})

test('courier adds the ₹99 procurement charge + ₹149 courier fee, plus 18% GST on fees; stamp duty has no GST', async () => {
  const r = await post({ ...good, stampDuty: 500, delivery: 'courier', address: '12 MG Road', city: 'Bengaluru', pincode: '560001' })
  expect(r.status).toBe(200)
  // ₹500 duty + ₹99 procurement + ₹149 courier + 18% GST on ₹248 (₹44.64) = ₹792.64
  expect(r.body.breakdown).toMatchObject({ dutyPaise: 50000, feePaise: 24800, gstPaise: 4464, totalPaise: 79264 })
  expect(created.order.amount).toBe(79264)
})

test('a convenience fee gets 18% GST on top, alongside the procurement and courier fees', async () => {
  pp.ESTAMP.convenienceFee = 199
  const r = await post({ ...good, stampDuty: 500, delivery: 'courier', address: '12 MG Road', city: 'Bengaluru', pincode: '560001' })
  // ₹500 duty + ₹199 + ₹99 + ₹149 fees (₹447) + 18% GST (₹80.46) = ₹1027.46
  expect(r.body.breakdown).toMatchObject({ dutyPaise: 50000, feePaise: 44700, gstPaise: 8046, totalPaise: 102746 })
  expect(created.so).toMatchObject({ professionalFee: 447, gstAmount: 80.46, govtFee: 500, totalAmount: 1027.46 })
  expect(created.so.details.deliveryAddress).toMatchObject({ city: 'Bengaluru', pincode: '560001' })
})

test('print option uses the print slug (customer is asked to upload the document)', async () => {
  await post({ ...good, printDocument: true })
  expect(created.ld.serviceSlug).toBe('e-stamp-paper-print')
})

test('rejects bad input', async () => {
  for (const bad of [{ state: 'atlantis' }, { stampDuty: 0 }, { stampDuty: 100001 }, { stampDuty: 'x' }, { payer: 'Someone' },
    { firstParty: '' }, { purpose: '' }, { delivery: 'drone' }, { mobile: '12' }, { email: 'nope' },
    { delivery: 'courier' }, { delivery: 'courier', address: 'x', city: 'y', pincode: '12' }]) {
    const r = await post({ ...good, ...bad })
    expect([400, 422]).toContain(r.status)
  }
})

describe('stamp-act articles', () => {
  test('Karnataka affidavit (Art. 4) must be the fixed ₹100', async () => {
    const base = { ...good, articleCode: '4', documentType: 'Affidavit' }
    expect((await post({ ...base, stampDuty: 20 })).status).toBe(400)
    const ok = await post({ ...base, stampDuty: 100 })
    expect(ok.status).toBe(200)
    expect(created.so.details.documentType).toBe('Article 4 Affidavit')
  })

  test('Karnataka indemnity bond (Art. 29) = 2% of consideration, max ₹500', async () => {
    const base = { ...good, articleCode: '29', documentType: 'Indemnity Bond' }
    expect((await post({ ...base, consideration: 10000, stampDuty: 100 })).status).toBe(400)
    expect((await post({ ...base, consideration: 10000, stampDuty: 200 })).status).toBe(200)
    expect((await post({ ...base, consideration: 100000, stampDuty: 500 })).status).toBe(200)
  })

  test('Karnataka title-deed loan (Art. 6(1)(ii)) uses the loan amount and the ₹10 lakh limit', async () => {
    const base = { ...good, articleCode: '6(1)(ii)', documentType: 'Agreement relating to deposit of title deeds, loan up to ₹10 lakh' }
    expect((await post({ ...base, baseAmount: 500000, stampDuty: 2500 })).status).toBe(200)
    expect(created.so.details.dutyCalculatedFrom).toBe('Loan amount: ₹5,00,000')
    expect((await post({ ...base, baseAmount: 2000000, stampDuty: 10000 })).status).toBe(400)
  })

  test('articles without a duty rule keep the customer’s amount; unknown articles are rejected', async () => {
    const lease = { ...good, articleCode: '30(1)(i)', documentType: 'Lease of immovable property, up to 1 year, residential', stampDuty: 500 }
    expect((await post(lease)).status).toBe(200)
    expect((await post({ ...lease, articleCode: '999' })).status).toBe(400)
  })

  test('states without an official list accept plain document types', async () => {
    const r = await post({ ...good, state: 'goa-not-listed' })
    expect(r.status).toBe(400)   // still must be a supported state
    const ok = await post({ ...good, state: 'maharashtra', stateName: 'Maharashtra', documentType: 'Rent / Lease Agreement', stampDuty: 500 })
    expect(ok.status).toBe(200)
  })
})