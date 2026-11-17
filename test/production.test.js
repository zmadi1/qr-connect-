import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars'

const { hashPassword, passwordMatches, sessionCookie, readSession, readVisitor } = await import('../srv/directory.js')
const { renderPage, contentSecurityPolicy } = await import('../srv/pages.js')

test('passwords are stored as scrypt hashes', async () => {
  const stored = await hashPassword('demo')
  assert.match(stored, /^scrypt\$16384\$8\$1\$/)
  assert.equal(stored.length < 255, true)
  assert.equal(await passwordMatches(stored, 'demo'), true)
  assert.equal(await passwordMatches(stored, 'Demo'), false)
  assert.equal(await passwordMatches('demo', 'demo'), true)
  assert.equal(await passwordMatches('demo', 'other'), false)
  assert.equal(await passwordMatches(stored, ''), false)
  assert.equal(await passwordMatches(stored, 'x'.repeat(201)), false)
})

test('session cookies are signed and expire', () => {
  const header = sessionCookie('22222222-2222-4222-8222-222222222222', true)
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Lax/)
  assert.match(header, /Secure/)
  const req = { headers: { cookie: header.split(';')[0] } }
  assert.equal(readSession(req), '22222222-2222-4222-8222-222222222222')
  assert.equal(readSession({ headers: { cookie: 'qr_session=aaaa.bbbb' } }), null)
})

test('the message form rejects bad input and the honeypot', () => {
  const good = readVisitor({
    firstName: 'Amina',
    surname: 'Dlamini',
    email: 'amina.dlamini@example.com',
    countryCode: '+27',
    phone: '071 123 4567',
    company: 'Northwind',
    queryType: 'Product information',
    message: 'Please send the brochure.',
  })
  assert.equal(good.fields.countryCode, '+27')
  assert.equal(readVisitor({ companyWebsite: 'https://spam.example' }).honeypot, true)
  assert.throws(() => readVisitor({ ...good.fields, email: 'not-an-email', countryCode: '+27' }), /valid email/)
})

test('the production login page hides the sample password', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  delete process.env.SHOW_SAMPLE_LOGIN
  const html = readFileSync(new URL('../app/login.html', import.meta.url), 'utf8')
  const rendered = renderPage(html, 'login.html')
  assert.equal(rendered.html.includes('demo'), false)
  assert.match(rendered.html, new RegExp(`<script nonce="${rendered.nonce}">`))
  assert.match(contentSecurityPolicy(rendered.nonce), /script-src 'nonce-/)
  process.env.SHOW_SAMPLE_LOGIN = '1'
  assert.match(renderPage(html, 'login.html').html, /demo/)
  process.env.NODE_ENV = previous
  delete process.env.SHOW_SAMPLE_LOGIN
})
