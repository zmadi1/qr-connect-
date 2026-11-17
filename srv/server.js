import cds from '@sap/cds'
import express from 'express'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import {
  authenticate,
  cardByToken,
  clearCookie,
  createEvent,
  ensureLeadColumns,
  ensureSchema,
  eventByToken,
  hasEnded,
  photoFor,
  qrTarget,
  readSession,
  saveMessage,
  seed,
  sendToServiceNow,
  sessionCookie,
  setDisplay,
  vcard,
  workspace,
} from './directory.js'
import { backupDatabase } from './persist.js'
import { contentSecurityPolicy, renderPage } from './pages.js'

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../app')
const pages = new Map()
const hits = new Map()

function page(name) {
  if (!pages.has(name)) pages.set(name, readFileSync(path.join(appDir, name), 'utf8'))
  return pages.get(name)
}

cds.on('bootstrap', (app) => {
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000')
    if (req.path.startsWith('/api') || req.path === '/app') res.setHeader('Cache-Control', 'private, no-store')
    next()
  })
  app.use(express.json({ limit: '32kb' }))
  app.use((req, res, next) => {
    const started = Date.now()
    res.on('finish', () => {
      if (req.path !== '/health') console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`)
      if (req.method === 'GET' || req.method === 'HEAD' || res.statusCode >= 400) return
      saveDatabase()
    })
    next()
  })
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    const origin = req.headers.origin
    if (!origin) return next()
    try {
      if (new URL(origin).host === req.get('host')) return next()
    } catch { /* refuse a broken Origin header */ }
    return fail(res, 403, 'This request was refused.')
  })
  app.use((req, res, next) => {
    req.userId = readSession(req)
    if (isPublic(req)) return next()
    if (req.userId) return next()
    if (req.path.startsWith('/api')) return fail(res, 401, 'Login required.')
    return res.redirect('/login')
  })

  app.get('/', (_req, res) => res.redirect('/app'))
  app.get('/health', async (_req, res) => {
    try {
      const { Employees } = cds.entities('bcx.qr')
      await SELECT.one.from(Employees).columns('ID')
      res.json({ ok: true })
    } catch (error) {
      console.error(`Health check failed: ${error.message}`)
      res.status(503).json({ ok: false })
    }
  })
  app.get('/login', (req, res) => sendPage(req, res, 'login.html'))
  app.post('/login', async (req, res) => {
    if (!allow(req, 'login', 20, 15 * 60 * 1000)) return fail(res, 429, 'Too many sign-in attempts. Wait a few minutes.')
    const person = await authenticate(req.body?.username, req.body?.password)
    if (!person) return fail(res, 401, 'Unknown username or password.')
    res.setHeader('Set-Cookie', sessionCookie(person.ID, req.secure))
    res.json({ ok: true })
  })
  app.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearCookie(req.secure))
    res.json({ ok: true })
  })

  app.get('/app', (req, res) => sendPage(req, res, 'home.html'))
  app.get('/api/workspace', async (req, res, next) => {
    try { res.json(await workspace(req.userId, req.query.person)) } catch (error) { next(error) }
  })
  app.post('/api/events', async (req, res, next) => {
    try { res.status(201).json(await createEvent(req.userId, req.body || {})) } catch (error) { next(error) }
  })
  app.post('/api/display', async (req, res, next) => {
    try { res.json(await setDisplay(req.userId, req.body?.eventId || null)) } catch (error) { next(error) }
  })
  app.post('/api/leads/:id/servicenow', async (req, res, next) => {
    try {
      if (!allow(req, 'snow', 30, 10 * 60 * 1000)) return fail(res, 429, 'Too many ServiceNow sends. Wait a few minutes.')
      res.json(await sendToServiceNow(req.userId, req.params.id))
    } catch (error) { next(error) }
  })
  app.get('/api/photo/:id', async (req, res, next) => {
    try {
      const png = await photoFor(req.userId, req.params.id)
      res.setHeader('Cache-Control', 'private, no-store')
      res.type('png').send(png)
    } catch (error) { next(error) }
  })

  app.get('/s/:token/current', async (req, res, next) => {
    try {
      const target = await qrTarget(req.params.token, origin(req))
      if (!target) return fail(res, 404, 'This card link is not valid.')
      res.setHeader('Cache-Control', 'no-store')
      res.json(target)
    } catch (error) { next(error) }
  })
  app.get('/s/:token/qr.png', async (req, res, next) => {
    try {
      const target = await qrTarget(req.params.token, origin(req))
      if (!target) return fail(res, 404, 'This card link is not valid.')
      await sendQr(res, target.url)
    } catch (error) { next(error) }
  })
  app.get('/s/:token/sheet', async (req, res, next) => {
    try {
      const employee = await cardByToken(req.params.token)
      if (!employee) return fail(res, 404, 'This card link is not valid.')
      const target = await qrTarget(req.params.token, origin(req))
      const sheet = cardSheet(employee)
      if (target.version.startsWith('event:')) {
        const standToken = target.url.slice(target.url.lastIndexOf('/') + 1)
        const found = await eventByToken(standToken)
        if (found) Object.assign(sheet, eventSheet(found.event, employee))
      }
      sheet.qr = `/s/${encodeURIComponent(req.params.token)}/qr.png`
      res.json(sheet)
    } catch (error) { next(error) }
  })
  app.get('/s/:token/print', (req, res) => sendPage(req, res, 'print.html'))
  app.get('/s/:token', (req, res) => sendPage(req, res, 'screen.html'))

  app.get('/c/:token/info', async (req, res, next) => {
    try {
      const employee = await cardByToken(req.params.token)
      if (!employee) return fail(res, 404, 'This card link is not valid.')
      res.json(scanInfo(employee, false))
    } catch (error) { next(error) }
  })
  app.get('/c/:token/card.vcf', async (req, res, next) => {
    try {
      const employee = await cardByToken(req.params.token)
      if (!employee) return fail(res, 404, 'This card link is not valid.')
      sendCard(res, employee)
    } catch (error) { next(error) }
  })
  app.post('/c/:token/message', async (req, res, next) => {
    try {
      const employee = await cardByToken(req.params.token)
      if (!employee) return fail(res, 404, 'This card link is not valid.')
      if (!allow(req, 'message', 10, 10 * 60 * 1000)) return fail(res, 429, 'Too many messages. Wait a few minutes.')
      res.json(await saveMessage(employee, null, req.body, false))
    } catch (error) { next(error) }
  })
  app.get('/c/:token/qr.png', async (req, res, next) => {
    try {
      const employee = await cardByToken(req.params.token)
      if (!employee) return fail(res, 404, 'This card link is not valid.')
      await sendQr(res, `${origin(req)}/c/${encodeURIComponent(employee.cardToken)}`)
    } catch (error) { next(error) }
  })
  app.get('/c/:token/sheet', async (req, res, next) => {
    try {
      const employee = await cardByToken(req.params.token)
      if (!employee) return fail(res, 404, 'This card link is not valid.')
      res.json({ ...cardSheet(employee), qr: `/c/${encodeURIComponent(req.params.token)}/qr.png` })
    } catch (error) { next(error) }
  })
  app.get('/c/:token/print', (req, res) => sendPage(req, res, 'print.html'))
  app.get('/c/:token', (req, res) => sendPage(req, res, 'scan.html'))

  app.get('/e/:token/info', async (req, res, next) => {
    try {
      const found = await eventByToken(req.params.token)
      if (!found) return fail(res, 404, 'This event link is not valid.')
      res.json({ ...scanInfo(found.owner, hasEnded(found.event)), eventName: found.event.name })
    } catch (error) { next(error) }
  })
  app.get('/e/:token/card.vcf', async (req, res, next) => {
    try {
      const found = await eventByToken(req.params.token)
      if (!found) return fail(res, 404, 'This event link is not valid.')
      sendCard(res, found.owner)
    } catch (error) { next(error) }
  })
  app.post('/e/:token/message', async (req, res, next) => {
    try {
      const found = await eventByToken(req.params.token)
      if (!found) return fail(res, 404, 'This event link is not valid.')
      if (!allow(req, 'message', 10, 10 * 60 * 1000)) return fail(res, 429, 'Too many messages. Wait a few minutes.')
      res.json(await saveMessage(found.owner, found.event, req.body, !hasEnded(found.event)))
    } catch (error) { next(error) }
  })
  app.get('/e/:token/qr.png', async (req, res, next) => {
    try {
      const found = await eventByToken(req.params.token)
      if (!found) return fail(res, 404, 'This event link is not valid.')
      await sendQr(res, `${origin(req)}/e/${encodeURIComponent(found.event.standToken)}`)
    } catch (error) { next(error) }
  })
  app.get('/e/:token/sheet', async (req, res, next) => {
    try {
      const found = await eventByToken(req.params.token)
      if (!found) return fail(res, 404, 'This event link is not valid.')
      res.json({ ...eventSheet(found.event, found.owner), qr: `/e/${encodeURIComponent(req.params.token)}/qr.png` })
    } catch (error) { next(error) }
  })
  app.get('/e/:token/print', (req, res) => sendPage(req, res, 'print.html'))
  app.get('/e/:token', (req, res) => sendPage(req, res, 'scan.html'))

  app.use((error, _req, res, _next) => {
    const status = error.status || 500
    const message = status < 500 ? error.message : 'Something went wrong.'
    if (status >= 500) console.error(error)
    fail(res, status, message)
  })
})

cds.on('served', async () => {
  await ensureSchema()
  await ensureLeadColumns()
  await seed()
  await saveDatabase()
})

let saving = Promise.resolve()

function saveDatabase() {
  if (cds.db?.kind && cds.db.kind !== 'sqlite') return Promise.resolve()
  saving = saving.then(writeSnapshot).catch((error) => {
    console.error(`Saving the database failed: ${error.message}`)
  })
  return saving
}

async function writeSnapshot() {
  const { DatabaseSync } = await import('node:sqlite')
  const snapshot = path.resolve('db.snapshot.sqlite')
  const database = path.resolve('db.sqlite')
  rmSync(snapshot, { force: true })
  const db = new DatabaseSync(database)
  let bytes
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    try {
      db.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`)
      bytes = readFileSync(snapshot)
    } catch (error) {
      console.error(`Snapshot copy failed: ${error.message}`)
      db.exec('PRAGMA wal_checkpoint(FULL)')
      bytes = readFileSync(database)
    }
  } finally {
    db.close()
    rmSync(snapshot, { force: true })
  }
  await backupDatabase(bytes)
}

function sendPage(req, res, name) {
  const rendered = renderPage(page(name), name)
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(rendered.nonce))
  res.setHeader('Cache-Control', 'no-store')
  res.type('html').send(rendered.html)
}

function allow(req, name, limit, windowMs) {
  const now = Date.now()
  const key = `${name}:${req.ip}`
  const recent = (hits.get(key) || []).filter((time) => now - time < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) {
    for (const [entry, times] of hits) {
      if (!times.some((time) => now - time < windowMs)) hits.delete(entry)
    }
  }
  return true
}

function isPublic(req) {
  if (req.path === '/login' || req.path === '/styles.css' || req.path === '/health') return true
  if (req.path === '/logout' && req.method === 'POST') return true
  return /^\/(s|c|e)\//.test(req.path)
}

function origin(req) {
  return `${req.protocol}://${req.get('host')}`
}

async function sendQr(res, url) {
  const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'Q', margin: 4, width: 640 })
  res.setHeader('Cache-Control', 'no-store')
  res.type('png').send(png)
}

function southAfrica(iso) {
  return new Date(iso).toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function cardSheet(employee) {
  return {
    kicker: 'BCX',
    title: `${employee.firstName} ${employee.lastName}`,
    lines: [employee.role, employee.organisation, 'General card'],
    prompt: 'Scan to save the business card and send a message.',
  }
}

function eventSheet(event, employee) {
  const lines = [`${southAfrica(event.startAt)} – ${southAfrica(event.endAt)}`]
  if (event.location) lines.push(event.location)
  lines.push(`${employee.firstName} ${employee.lastName} · ${employee.role}`)
  return {
    kicker: 'BCX',
    title: event.name,
    lines,
    prompt: 'Scan to save the business card and send a message.',
  }
}

function scanInfo(employee, ended) {
  return {
    name: `${employee.firstName} ${employee.lastName}`,
    role: employee.role,
    organisation: employee.organisation,
    ended,
  }
}

function sendCard(res, employee) {
  const file = `${employee.firstName}-${employee.lastName}.vcf`.replace(/[^\w.-]+/g, '-')
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`)
  res.send(vcard(employee))
}

function fail(res, status, message) {
  res.status(status).json({ error: { message } })
}

export default cds.server
