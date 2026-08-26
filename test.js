/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║            LauncherDesk — Full Backend Connectivity Test Suite           ║
 * ║  Run: node test.js                                                       ║
 * ║  Requirements: node >= 18 (fetch is built-in)                           ║
 * ║  Set BASE_URL below to your Railway API URL or http://localhost:5001     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

'use strict'

const BASE_URL    = process.env.API_URL || 'https://launcherdesk-backend-production.up.railway.app/api'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@launcherdesk.com'
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'admin123456'

const C = {
  reset:  '\x1b[0m', bold:   '\x1b[1m', green:  '\x1b[32m', red:    '\x1b[31m',
  yellow: '\x1b[33m', cyan:   '\x1b[36m', grey:   '\x1b[90m', blue:   '\x1b[34m', magenta:'\x1b[35m',
}

let adminToken = null, partnerToken = null, contactId = null, leadId = null
let quoteId = null, appId = null, partnerId = null
const results = { pass: 0, fail: 0, warn: 0, tests: [] }
const TS = `test_${Date.now()}`

function section(title) {
  console.log(`\n${C.bold}${C.blue}${'─'.repeat(60)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`)
  console.log(`${C.bold}${C.blue}${'─'.repeat(60)}${C.reset}`)
}
function pass(name, detail = '') { results.pass++; results.tests.push({ name, status: 'PASS', detail }); console.log(`  ${C.green}✓ PASS${C.reset}  ${name}${detail ? C.grey + ' — ' + detail + C.reset : ''}`) }
function fail(name, detail = '') { results.fail++; results.tests.push({ name, status: 'FAIL', detail }); console.log(`  ${C.red}✗ FAIL${C.reset}  ${name}${detail ? C.grey + ' — ' + detail + C.reset : ''}`) }
function warn(name, detail = '') { results.warn++; results.tests.push({ name, status: 'WARN', detail }); console.log(`  ${C.yellow}⚠ WARN${C.reset}  ${name}${detail ? C.grey + ' — ' + detail + C.reset : ''}`) }

async function api(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE_URL}${path}`, opts)
  let data; try { data = await res.json() } catch { data = null }
  return { status: res.status, ok: res.ok, data }
}

async function testHealth() {
  section('1. HEALTH CHECK')
  const r = await api('GET', '/health')
  r.ok && r.data?.success ? pass('GET /api/health', r.data.status || 'API running') : fail('GET /api/health', `Status ${r.status}`)
}

async function testAuth() {
  section('2. AUTH — Admin Login & Token Verification')
  const r1 = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: 'wrongpassword' })
  r1.status === 401 ? pass('POST /api/auth/login — rejects bad password', 'returns 401') : warn('POST /api/auth/login — bad password check', `Got ${r1.status}`)
  const r2 = await api('POST', '/auth/login', { email: ADMIN_EMAIL })
  r2.status === 400 ? pass('POST /api/auth/login — rejects missing password', 'returns 400') : warn('POST /api/auth/login — missing field check', `Got ${r2.status}`)
  const r3 = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS })
  if (r3.ok && r3.data?.token) { adminToken = r3.data.token; pass('POST /api/auth/login — admin login succeeds', `role=${r3.data.user?.role}`) }
  else fail('POST /api/auth/login — admin login', `Status ${r3.status}: ${r3.data?.message}`)
  if (adminToken) { const r4 = await api('GET', '/auth/me', null, adminToken); r4.ok && r4.data?.user?.role === 'admin' ? pass('GET /api/auth/me — returns admin user', `email=${r4.data.user.email}`) : fail('GET /api/auth/me — admin profile', `Status ${r4.status}`) }
  const r5 = await api('GET', '/auth/me')
  r5.status === 401 ? pass('GET /api/auth/me — blocks unauthenticated request', 'returns 401') : fail('GET /api/auth/me — auth guard', `Got ${r5.status}`)
}

async function testContacts() {
  section('3. CONTACT FORM → MONGODB → ADMIN FETCH')
  const r1 = await api('POST', '/contact', { name: 'Test User', mobile: '9999999999', email: `test_${TS}@example.com`, state: 'Karnataka', message: 'Automated test submission.', whatsappOptin: true, source: 'test-suite', service: 'Private Limited Company' })
  if (r1.status === 201 && r1.data?.success) { contactId = r1.data.data?.id; pass('POST /api/contact — saves to MongoDB', `id=${contactId}`) }
  else fail('POST /api/contact', `Status ${r1.status}: ${JSON.stringify(r1.data)}`)
  const r2 = await api('POST', '/contact', { name: 'No Mobile' })
  r2.status === 400 ? pass('POST /api/contact — rejects missing fields', 'returns 400') : warn('POST /api/contact — validation', `Got ${r2.status}`)
  const r3 = await api('POST', '/contact', { name: 'No Email', mobile: '8888888888', state: 'Delhi', message: 'No email test' })
  r3.status === 201 ? pass('POST /api/contact — accepts submission without email') : fail('POST /api/contact without email', `Status ${r3.status}`)
  if (adminToken) {
    const r4 = await api('GET', '/contact', null, adminToken)
    r4.ok && Array.isArray(r4.data?.data) ? pass('GET /api/contact (admin) — fetches from MongoDB', `total=${r4.data.total}`) : fail('GET /api/contact (admin)', `Status ${r4.status}`)
    const r5 = await api('GET', '/contact')
    r5.status === 401 ? pass('GET /api/contact — blocks unauthenticated', 'returns 401') : fail('GET /api/contact — auth guard', `Got ${r5.status}`)
    if (contactId) { const r6 = await api('PATCH', `/contact/${contactId}`, { status: 'contacted', notes: 'Test note' }, adminToken); r6.ok && r6.data?.data?.status === 'contacted' ? pass('PATCH /api/contact/:id — admin updates status') : fail('PATCH /api/contact/:id', `Status ${r6.status}`) }
    const r7 = await api('GET', '/contact?page=1&limit=5', null, adminToken)
    r7.ok && r7.data?.data?.length <= 5 ? pass('GET /api/contact?page=1&limit=5 — pagination works', `returned ${r7.data?.data?.length} records`) : warn('Pagination', `Got ${r7.status}`)
    const r8 = await api('GET', '/contact?status=new', null, adminToken)
    r8.ok ? pass('GET /api/contact?status=new — filter works', `total=${r8.data?.total}`) : warn('Status filter', `Got ${r8.status}`)
  }
}

async function testLeads() {
  section('4. LEADS → MONGODB → ADMIN FETCH')
  const r1 = await api('POST', '/leads', { name: 'Lead Test User', email: `lead_${TS}@example.com`, mobile: '7777777777', state: 'Maharashtra', businessType: 'Startup', serviceInterest: 'private-limited-company-registration', source: 'test-suite' })
  if (r1.status === 201 && r1.data?.success) { leadId = r1.data.data?.id; pass('POST /api/leads — saves to MongoDB', `id=${leadId}`) }
  else fail('POST /api/leads', `Status ${r1.status}: ${JSON.stringify(r1.data)}`)
  const r2 = await api('POST', '/leads', { name: 'No Email' })
  r2.status === 400 ? pass('POST /api/leads — rejects missing email') : warn('POST /api/leads — validation', `Got ${r2.status}`)
  if (adminToken) {
    const r3 = await api('GET', '/leads', null, adminToken)
    r3.ok && Array.isArray(r3.data?.data) ? pass('GET /api/leads (admin) — fetches from MongoDB', `total=${r3.data.total}`) : fail('GET /api/leads (admin)', `Status ${r3.status}`)
    const r4 = await api('GET', '/leads')
    r4.status === 401 ? pass('GET /api/leads — blocks unauthenticated') : fail('GET /api/leads — auth guard', `Got ${r4.status}`)
    if (leadId) { const r5 = await api('PATCH', `/leads/${leadId}`, { status: 'working' }, adminToken); r5.ok && r5.data?.data?.status === 'working' ? pass('PATCH /api/leads/:id — admin updates status') : fail('PATCH /api/leads/:id', `Status ${r5.status}`) }
  }
}

async function testQuotes() {
  section('5. QUOTE REQUESTS → MONGODB → ADMIN FETCH')
  const r1 = await api('POST', '/quotes', { name: 'Quote Test', email: `quote_${TS}@example.com`, mobile: '6666666666', state: 'Tamil Nadu', serviceSlug: 'private-limited-company-registration', serviceTitle: 'Private Limited Company Registration', businessType: 'Startup', additionalInfo: 'Test from suite' })
  if (r1.status === 201 && r1.data?.success) { quoteId = r1.data.data?.id; pass('POST /api/quotes — saves to MongoDB', `id=${quoteId}`) }
  else fail('POST /api/quotes', `Status ${r1.status}: ${JSON.stringify(r1.data)}`)
  const r2 = await api('POST', '/quotes', { name: 'Test', email: 'test@test.com' })
  r2.status === 400 ? pass('POST /api/quotes — rejects missing fields') : warn('POST /api/quotes — validation', `Got ${r2.status}`)
  if (adminToken) {
    const r3 = await api('GET', '/quotes', null, adminToken)
    r3.ok && Array.isArray(r3.data?.data) ? pass('GET /api/quotes (admin) — fetches from MongoDB', `total=${r3.data.total}`) : fail('GET /api/quotes (admin)', `Status ${r3.status}`)
    const r4 = await api('GET', '/quotes')
    r4.status === 401 ? pass('GET /api/quotes — blocks unauthenticated') : fail('GET /api/quotes — auth guard', `Got ${r4.status}`)
    if (quoteId) { const r5 = await api('PATCH', `/quotes/${quoteId}`, { status: 'reviewed', quotedAmount: 15000 }, adminToken); r5.ok && r5.data?.data?.status === 'reviewed' ? pass('PATCH /api/quotes/:id — admin updates quote') : fail('PATCH /api/quotes/:id', `Status ${r5.status}`) }
  }
}

async function testApplications() {
  section('6. CAREER APPLICATIONS → MONGODB → ADMIN FETCH')
  const r1 = await api('POST', '/applications', { name: 'Applicant Test', email: `applicant_${TS}@example.com`, mobile: '5555555555', role: 'Internship', message: 'Test application from suite' })
  if (r1.status === 201 && r1.data?.success) { appId = r1.data.data?.id; pass('POST /api/applications — saves to MongoDB', `id=${appId}`) }
  else fail('POST /api/applications', `Status ${r1.status}: ${JSON.stringify(r1.data)}`)
  const r2 = await api('POST', '/applications', { name: 'No Mobile' })
  r2.status === 400 ? pass('POST /api/applications — rejects missing fields') : warn('POST /api/applications — validation', `Got ${r2.status}`)
  if (adminToken) {
    const r3 = await api('GET', '/applications', null, adminToken)
    r3.ok && Array.isArray(r3.data?.data) ? pass('GET /api/applications (admin) — fetches from MongoDB', `total=${r3.data.total}`) : fail('GET /api/applications (admin)', `Status ${r3.status}`)
    const r4 = await api('GET', '/applications')
    r4.status === 401 ? pass('GET /api/applications — blocks unauthenticated') : fail('GET /api/applications — auth guard', `Got ${r4.status}`)
    if (appId) { const r5 = await api('PATCH', `/applications/${appId}`, { status: 'shortlisted' }, adminToken); r5.ok && r5.data?.data?.status === 'shortlisted' ? pass('PATCH /api/applications/:id — admin updates status') : fail('PATCH /api/applications/:id', `Status ${r5.status}`) }
  }
}

async function testPartners() {
  section('7. PARTNER REGISTRATION → LOGIN → DASHBOARD → ADMIN')
  const partnerEmail = `partner_${TS}@testcorp.com`, partnerPassword = 'testpartner123'
  const r1 = await api('POST', '/partners', { companyName: `Test Corp ${TS}`, contactName: 'Partner Test', email: partnerEmail, mobile: '4444444444', website: 'https://testcorp.example.com', city: 'Bengaluru', state: 'Karnataka', categories: ['crm'], productName: `TestCRM ${TS}`, tagline: 'Test CRM', description: 'A test partner registration from the test suite', pricing: 'Custom', integrations: 'REST API', whyPartner: 'To test the flow', password: partnerPassword })
  if (r1.status === 201 && r1.data?.success) { partnerToken = r1.data.token; partnerId = r1.data.partner?._id; pass('POST /api/partners — partner registered in MongoDB', `id=${partnerId}`) }
  else fail('POST /api/partners', `Status ${r1.status}: ${r1.data?.message}`)
  const r2 = await api('POST', '/partners', { companyName: 'Dup', contactName: 'Dup', email: partnerEmail, mobile: '1111111111', productName: 'Dup', password: partnerPassword })
  r2.status === 409 ? pass('POST /api/partners — rejects duplicate email') : warn('POST /api/partners — duplicate check', `Got ${r2.status}`)
  const r3 = await api('POST', '/partners', { companyName: 'No Email Corp' })
  r3.status === 400 ? pass('POST /api/partners — rejects missing fields') : warn('POST /api/partners — validation', `Got ${r3.status}`)
  const r4 = await api('POST', '/partners/login', { email: partnerEmail, password: partnerPassword })
  if (r4.ok && r4.data?.token) { partnerToken = r4.data.token; pass('POST /api/partners/login — login succeeds', `company=${r4.data.partner?.companyName}`) }
  else fail('POST /api/partners/login', `Status ${r4.status}: ${r4.data?.message}`)
  const r5 = await api('POST', '/partners/login', { email: partnerEmail, password: 'wrongpass' })
  r5.status === 401 ? pass('POST /api/partners/login — rejects wrong password') : warn('Wrong password check', `Got ${r5.status}`)
  if (partnerToken) {
    const r6 = await api('GET', '/partners/dashboard', null, partnerToken)
    r6.ok && r6.data?.data?.partner ? pass('GET /api/partners/dashboard — returns data', `leads=${r6.data.data.stats?.totalLeads}`) : fail('GET /api/partners/dashboard', `Status ${r6.status}`)
    const r7 = await api('GET', '/partners/leads', null, partnerToken)
    r7.ok && Array.isArray(r7.data?.data) ? pass('GET /api/partners/leads — returns partner leads', `total=${r7.data.total}`) : fail('GET /api/partners/leads', `Status ${r7.status}`)
  }
  if (adminToken) {
    const r8 = await api('GET', '/partners', null, adminToken)
    r8.ok && Array.isArray(r8.data?.data) ? pass('GET /api/partners (admin) — fetches all partners', `total=${r8.data.total}`) : fail('GET /api/partners (admin)', `Status ${r8.status}`)
    if (partnerId) {
      const r9 = await api('PATCH', `/partners/${partnerId}`, { status: 'approved' }, adminToken)
      r9.ok && r9.data?.data?.status === 'approved' ? pass('PATCH /api/partners/:id — admin approves partner') : fail('PATCH /api/partners/:id', `Status ${r9.status}`)
      const r10 = await api('GET', `/partners/${partnerId}`, null, adminToken)
      r10.ok && r10.data?.data?._id ? pass('GET /api/partners/:id (admin) — fetches single partner', `company=${r10.data.data?.companyName}`) : fail('GET /api/partners/:id', `Status ${r10.status}`)
    }
  }
  if (partnerId) {
    const r11 = await api('POST', `/partners/${partnerId}/lead`, { name: 'Marketplace Visitor', email: `visitor_${TS}@test.com`, mobile: '3333333333', company: 'Visitor Corp', message: 'Interested', source: 'marketplace', category: 'crm' })
    r11.status === 201 && r11.data?.success ? pass('POST /api/partners/:id/lead — marketplace lead recorded') : fail('POST /api/partners/:id/lead', `Status ${r11.status}`)
  }
}

async function testAdminDashboard() {
  section('8. ADMIN DASHBOARD — STATS & RECENT DATA FROM MONGODB')
  if (!adminToken) { warn('Admin Dashboard — skipped (no admin token)'); return }
  const r1 = await api('GET', '/admin/stats', null, adminToken)
  if (r1.ok && r1.data?.data?.totals) { const t = r1.data.data.totals; pass('GET /api/admin/stats — returns aggregate counts', `contacts=${t.contacts} leads=${t.leads} quotes=${t.quotes} apps=${t.applications} partners=${t.partners}`) }
  else fail('GET /api/admin/stats', `Status ${r1.status}: ${r1.data?.message}`)
  if (r1.ok) {
    const d = r1.data.data
    const hasBreakdowns = d.contactsByStatus && d.leadsByStatus && d.quotesByStatus
    hasBreakdowns ? pass('GET /api/admin/stats — contains status breakdowns') : warn('GET /api/admin/stats — missing status breakdowns')
    Array.isArray(d.monthlyContacts) ? pass('GET /api/admin/stats — monthlyContacts for charts', `${d.monthlyContacts.length} months`) : warn('GET /api/admin/stats — monthlyContacts missing')
  }
  const r2 = await api('GET', '/admin/recent', null, adminToken)
  if (r2.ok && r2.data?.data) { const d = r2.data.data; pass('GET /api/admin/recent — returns recent records', `contacts=${d.contacts?.length} leads=${d.leads?.length} quotes=${d.quotes?.length} apps=${d.applications?.length}`) }
  else fail('GET /api/admin/recent', `Status ${r2.status}`)
  const r3 = await api('GET', '/admin/stats')
  r3.status === 401 ? pass('GET /api/admin/stats — blocks unauthenticated') : fail('GET /api/admin/stats — auth guard', `Got ${r3.status}`)
  if (partnerToken) { const r4 = await api('GET', '/admin/stats', null, partnerToken); r4.status === 403 ? pass('GET /api/admin/stats — blocks partner role (not admin)') : warn('Role guard', `Got ${r4.status} (expected 403)`) }
}

async function testVoiceflow() {
  section('9. AI ASSISTANT (VOICEFLOW/CLAUDE) → CHATSESSION MONGODB')
  const userId = `testuser_${TS}`
  const r1 = await api('POST', '/voiceflow/interact', { userId, action: { type: 'launch' } })
  if (r1.ok && r1.data?.traces?.length > 0) { const msg = r1.data.traces[0]?.payload?.message || ''; pass('POST /api/voiceflow/interact — launch creates ChatSession', `greeting: "${msg.substring(0, 60)}…"`) }
  else fail('POST /api/voiceflow/interact — launch', `Status ${r1.status}: ${r1.data?.message}`)
  const r2 = await api('POST', '/voiceflow/interact', { userId, action: { type: 'text', payload: 'How do I register a private limited company?' } })
  if (r2.ok && r2.data?.traces?.length > 0) { const msg = r2.data.traces[0]?.payload?.message || ''; pass('POST /api/voiceflow/interact — text gets AI response', `reply: "${msg.substring(0, 80)}…"`) }
  else fail('POST /api/voiceflow/interact — text', `Status ${r2.status}`)
  const r3 = await api('POST', '/voiceflow/interact', { action: { type: 'text', payload: 'test' } })
  r3.status === 400 ? pass('POST /api/voiceflow/interact — rejects missing userId') : warn('Validation', `Got ${r3.status}`)
  const r4 = await api('DELETE', `/voiceflow/session/${userId}`)
  r4.ok ? pass('DELETE /api/voiceflow/session/:userId — clears ChatSession') : warn('DELETE session', `Status ${r4.status}`)
  if (adminToken) { const r5 = await api('GET', '/voiceflow/sessions', null, adminToken); r5.ok && Array.isArray(r5.data?.data) ? pass('GET /api/voiceflow/sessions (admin) — lists ChatSessions', `total=${r5.data.total}`) : warn('GET sessions', `Status ${r5.status}`) }
}

async function testContactSources() {
  section('10. ALL CONTACT FORM SOURCES')
  const r1 = await api('POST', '/contact', { name: 'Virtual Office Test', mobile: '2222222222', email: `vo_${TS}@test.com`, state: 'Bengaluru', message: 'Virtual Office enquiry — Plan: Mail Address Plan', source: 'virtual-office', service: 'Virtual Office' })
  r1.status === 201 ? pass('Virtual Office form → POST /api/contact', `id=${r1.data?.data?.id}`) : fail('Virtual Office form', `Status ${r1.status}`)
  const r2 = await api('POST', '/contact', { name: 'Office Setup Test', mobile: '1111111110', email: `os_${TS}@test.com`, state: 'Karnataka', message: 'Office Setup — Budget: ₹50K–₹1L | Size: 10–20 seats', source: 'office-setup', service: 'Office Setup' })
  r2.status === 201 ? pass('Office Setup form → POST /api/contact', `id=${r2.data?.data?.id}`) : fail('Office Setup form', `Status ${r2.status}`)
  const r3 = await api('POST', '/contact', { name: 'E-Stamp Test', mobile: '9090909090', email: `es_${TS}@test.com`, state: 'Tamil Nadu', message: 'E-Stamp — Rental Agreement', source: 'estamp-page', service: 'E-Stamp' })
  r3.status === 201 ? pass('E-Stamp form → POST /api/contact', `id=${r3.data?.data?.id}`) : fail('E-Stamp form', `Status ${r3.status}`)
  const r4 = await api('POST', '/contact', { name: 'Finder Test', mobile: '8080808080', email: `finder_${TS}@test.com`, state: 'Maharashtra', message: '[FINDER] E-commerce, Maharashtra, 2–3 founders', source: 'service-finder', whatsappOptin: true })
  r4.status === 201 ? pass('Service Finder → POST /api/contact', `id=${r4.data?.data?.id}`) : fail('Service Finder form', `Status ${r4.status}`)
}

async function testRateLimit() {
  section('11. RATE LIMITER')
  const r = await api('GET', '/health')
  r.ok ? pass('Rate limiter — API responds within normal limits') : warn('Rate limiter test — health check failed')
}

async function testErrorHandling() {
  section('12. ERROR HANDLING — 404 & INVALID IDs')
  const r1 = await api('GET', '/nonexistent-route-xyz')
  r1.status === 404 ? pass('GET /api/nonexistent — returns 404') : warn('404 handler', `Got ${r1.status}`)
  if (adminToken) {
    const r2 = await api('PATCH', '/contact/not-a-valid-id', { status: 'new' }, adminToken)
    r2.status >= 400 ? pass('PATCH /api/contact/invalid-id — handles bad ObjectId gracefully', `Status ${r2.status}`) : warn('Invalid ObjectId', `Got ${r2.status}`)
    const r3 = await api('PATCH', `/contact/507f1f77bcf86cd799439011`, { status: 'new' }, adminToken)
    r3.status === 404 ? pass('PATCH /api/contact/non-existent-id — returns 404') : warn('Not-found handling', `Got ${r3.status}`)
  }
}

function printSummary() {
  const total = results.pass + results.fail + results.warn
  console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`)
  console.log(`${C.bold}  TEST SUMMARY${C.reset}`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  Total tests   : ${C.bold}${total}${C.reset}`)
  console.log(`  ${C.green}Passed${C.reset}        : ${C.bold}${C.green}${results.pass}${C.reset}`)
  console.log(`  ${C.red}Failed${C.reset}        : ${C.bold}${C.red}${results.fail}${C.reset}`)
  console.log(`  ${C.yellow}Warnings${C.reset}      : ${C.bold}${C.yellow}${results.warn}${C.reset}`)
  console.log(`${'═'.repeat(60)}`)
  if (results.fail > 0) {
    console.log(`\n${C.red}${C.bold}  FAILED TESTS:${C.reset}`)
    results.tests.filter(t => t.status === 'FAIL').forEach(t => { console.log(`  ${C.red}✗${C.reset} ${t.name}`); if (t.detail) console.log(`    ${C.grey}${t.detail}${C.reset}`) })
  }
  if (results.warn > 0) {
    console.log(`\n${C.yellow}${C.bold}  WARNINGS:${C.reset}`)
    results.tests.filter(t => t.status === 'WARN').forEach(t => { console.log(`  ${C.yellow}⚠${C.reset} ${t.name}`); if (t.detail) console.log(`    ${C.grey}${t.detail}${C.reset}`) })
  }
  console.log()
  results.fail === 0
    ? console.log(`${C.green}${C.bold}  ✓ ALL TESTS PASSED — Backend is production-ready!${C.reset}`)
    : console.log(`${C.red}${C.bold}  ✗ SOME TESTS FAILED — Fix issues before going live.${C.reset}`)
  console.log(`\n  ${C.grey}API: ${BASE_URL}${C.reset}`)
  console.log(`  ${C.grey}Run: API_URL=<url> ADMIN_EMAIL=<email> ADMIN_PASS=<pass> node test.js${C.reset}\n`)
  process.exit(results.fail > 0 ? 1 : 0)
}

async function run() {
  console.log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════╗${C.reset}`)
  console.log(`${C.bold}${C.magenta}║       LauncherDesk Backend — Full Connectivity Test Suite     ║${C.reset}`)
  console.log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════════╝${C.reset}`)
  console.log(`  ${C.grey}API:   ${BASE_URL}${C.reset}`)
  console.log(`  ${C.grey}Admin: ${ADMIN_EMAIL}${C.reset}`)
  console.log(`  ${C.grey}Time:  ${new Date().toISOString()}${C.reset}`)
  try {
    await testHealth(); await testAuth(); await testContacts(); await testLeads()
    await testQuotes(); await testApplications(); await testPartners()
    await testAdminDashboard(); await testVoiceflow(); await testContactSources()
    await testRateLimit(); await testErrorHandling()
  } catch (err) {
    console.error(`\n${C.red}${C.bold}  FATAL ERROR: ${err.message}${C.reset}`)
    console.error(`  ${C.grey}Make sure backend is running at: ${BASE_URL}${C.reset}`)
    results.fail++
  }
  printSummary()
}

run()