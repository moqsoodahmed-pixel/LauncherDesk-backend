// A customer may be logged in through either the original site login or the
// newer "Portal" unified login (separate account model, short-lived tokens).
// `protect` must authenticate both, bridging a Portal account to a matching
// (or newly created) record in this site's own User model by email, so
// consumer-facing routes (e-stamp, dashboard, invoices...) work for either.
const express = require('express')
const request = require('supertest')

process.env.JWT_SECRET = 'own-secret'

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn((token, secret) => {
    if (token === 'OWN_TOKEN' && secret === 'own-secret') return { id: 'own-user-1' }
    const e = new Error('invalid'); throw e
  }),
}))
const mockUser = { findById: jest.fn(), findOne: jest.fn(), create: jest.fn() }
jest.mock('../models/User', () => mockUser)

const mockVerifyAccessToken = jest.fn()
jest.mock('../services/portal/token.service', () => ({ verifyAccessToken: mockVerifyAccessToken }))

const mockPortalUser = { findById: jest.fn() }
jest.mock('../models/portal', () => ({ User: mockPortalUser }))

const { protect } = require('../middleware/auth')
const app = express()
app.get('/whoami', protect, (req, res) => res.json({ id: req.user._id, email: req.user.email, bridged: req.user.authProvider === 'portal' }))
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ message: err.message }))

const call = token => request(app).get('/whoami').set('Authorization', `Bearer ${token}`)

beforeEach(() => jest.clearAllMocks())

test('a normal site login still works exactly as before', async () => {
  mockUser.findById.mockReturnValue({ select: () => ({ _id: 'own-user-1', email: 'a@x.com' }) })
  const r = await call('OWN_TOKEN')
  expect(r.status).toBe(200)
  expect(r.body).toMatchObject({ id: 'own-user-1', email: 'a@x.com' })
  expect(mockVerifyAccessToken).not.toHaveBeenCalled()
})

test('a Portal login for an existing customer reaches the SAME account (matched by email)', async () => {
  mockVerifyAccessToken.mockReturnValue({ sub: 'portal-1', tv: 0 })
  mockPortalUser.findById.mockResolvedValue({ _id: 'portal-1', email: 'Srinivas@Launcherdesk.com', name: 'Srinivas', status: 'active', tokenVersion: 0 })
  mockUser.findOne.mockResolvedValue({ _id: 'own-user-9', email: 'srinivas@launcherdesk.com' })
  const r = await call('PORTAL_TOKEN')
  expect(r.status).toBe(200)
  expect(r.body.id).toBe('own-user-9')
  expect(mockUser.findOne).toHaveBeenCalledWith({ email: 'srinivas@launcherdesk.com' })
  expect(mockUser.create).not.toHaveBeenCalled()
})

test('a Portal login never seen before creates one matching account, not re-created on the next request', async () => {
  mockVerifyAccessToken.mockReturnValue({ sub: 'portal-2', tv: 0 })
  mockPortalUser.findById.mockResolvedValue({ _id: 'portal-2', email: 'new.customer@gmail.com', name: 'New Customer', phone: '9000000000', status: 'active', tokenVersion: 0 })
  mockUser.findOne.mockResolvedValueOnce(null)
  mockUser.create.mockResolvedValue({ _id: 'own-user-new', email: 'new.customer@gmail.com' })
  const r1 = await call('PORTAL_TOKEN_NEW')
  expect(r1.status).toBe(200)
  expect(mockUser.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'new.customer@gmail.com', authProvider: 'portal', role: 'user', emailVerified: true }))

  mockUser.findOne.mockResolvedValueOnce({ _id: 'own-user-new', email: 'new.customer@gmail.com' })
  const r2 = await call('PORTAL_TOKEN_NEW')
  expect(r2.status).toBe(200)
  expect(mockUser.create).toHaveBeenCalledTimes(1) // not created a second time
})

test('a Portal account that was logged out everywhere (tokenVersion bumped) is rejected', async () => {
  mockVerifyAccessToken.mockReturnValue({ sub: 'portal-3', tv: 0 })
  mockPortalUser.findById.mockResolvedValue({ _id: 'portal-3', email: 'x@x.com', status: 'active', tokenVersion: 5 })
  const r = await call('PORTAL_TOKEN_STALE')
  expect(r.status).toBe(401)
})

test('a disabled Portal account is rejected even with a valid token', async () => {
  mockVerifyAccessToken.mockReturnValue({ sub: 'portal-4', tv: 0 })
  mockPortalUser.findById.mockResolvedValue({ _id: 'portal-4', email: 'x@x.com', status: 'disabled', tokenVersion: 0 })
  const r = await call('PORTAL_TOKEN_DISABLED')
  expect(r.status).toBe(401)
})

test('garbage tokens (neither system) are rejected', async () => {
  mockVerifyAccessToken.mockImplementation(() => { throw new Error('bad token') })
  const r = await call('GARBAGE')
  expect(r.status).toBe(401)
})

test('no Authorization header → unchanged 401', async () => {
  const r = await request(app).get('/whoami')
  expect(r.status).toBe(401)
})
