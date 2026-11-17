import cds from '@sap/cds'
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { loadSuccessFactorsPeople, successFactorsStatus } from './successfactors.js'
import { createServiceNowLead, leadRecord, readConfig as readServiceNowConfig, serviceNowStatus } from './servicenow.js'

const ZONE = 'Africa/Johannesburg'
const scryptAsync = promisify(scrypt)
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
let warnedSecret = false
let dummyPassword = null

export const QUERY_TYPES = [
  'General enquiry',
  'Product information',
  'Request a meeting',
  'Pricing',
  'Partnership',
  'Support',
  'Other',
]

export const COUNTRIES = [
  { code: '+27', flag: '🇿🇦', name: 'South Africa' },
  { code: '+264', flag: '🇳🇦', name: 'Namibia' },
  { code: '+267', flag: '🇧🇼', name: 'Botswana' },
  { code: '+263', flag: '🇿🇼', name: 'Zimbabwe' },
  { code: '+260', flag: '🇿🇲', name: 'Zambia' },
  { code: '+266', flag: '🇱🇸', name: 'Lesotho' },
  { code: '+268', flag: '🇸🇿', name: 'Eswatini' },
  { code: '+258', flag: '🇲🇿', name: 'Mozambique' },
  { code: '+254', flag: '🇰🇪', name: 'Kenya' },
  { code: '+234', flag: '🇳🇬', name: 'Nigeria' },
  { code: '+44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: '+1', flag: '🇺🇸', name: 'United States' },
  { code: '+971', flag: '🇦🇪', name: 'United Arab Emirates' },
  { code: '+91', flag: '🇮🇳', name: 'India' },
  { code: '+49', flag: '🇩🇪', name: 'Germany' },
  { code: '+61', flag: '🇦🇺', name: 'Australia' },
]

const PEOPLE = [
  person('11111111-1111-4111-8111-111111111111', 'lerato', 'Lerato', 'Dlamini', 'Sales Manager', '+27 82 555 0101', 'lerato.dlamini@bcx.co.za', 'Lr8kQm2vN4pX0sT6aY1c', [11, 58, 91], null),
  person('22222222-2222-4222-8222-222222222222', 'thabo', 'Thabo', 'Mokoena', 'Account Executive', '+27 82 555 0102', 'thabo.mokoena@bcx.co.za', 'Tb3nH7wK9dR5mC2yF8qL', [31, 111, 139], '11111111-1111-4111-8111-111111111111'),
  person('33333333-3333-4333-8333-333333333333', 'ayesha', 'Ayesha', 'Patel', 'Solutions Consultant', '+27 83 555 0103', 'ayesha.patel@bcx.co.za', 'Ay6pD1sJ4uV0eB9nG3zW', [140, 74, 43], '11111111-1111-4111-8111-111111111111'),
  person('44444444-4444-4444-8444-444444444444', 'johan', 'Johan', 'Botha', 'Sales Manager', '+27 82 555 0104', 'johan.botha@bcx.co.za', 'Jh2cT5xM8kP7aL4rQ1vN', [46, 89, 68], null),
  person('55555555-5555-4555-8555-555555555555', 'sipho', 'Sipho', 'Ndlovu', 'Account Executive', '+27 71 555 0105', 'sipho.ndlovu@bcx.co.za', 'Sp9wE3yH6bN1tC5uK8mR', [92, 45, 115], '44444444-4444-4444-8444-444444444444'),
]

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
}

function person(ID, username, firstName, lastName, role, cellphone, email, cardToken, color, manager_ID) {
  return {
    ID, username, password: 'demo', firstName, lastName, role,
    organisation: 'BCX', cellphone, email, website: 'https://www.bcx.co.za',
    cardToken, color, manager_ID, active: true,
  }
}

function entities() {
  return cds.entities('bcx.qr')
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function secret() {
  const fromEnv = process.env.SESSION_SECRET || ''
  if (fromEnv.length >= 32) return Buffer.from(fromEnv)
  if (process.env.NODE_ENV === 'production' && !warnedSecret) {
    warnedSecret = true
    console.error('SESSION_SECRET is missing or shorter than 32 characters. Sign-in will not survive a restart.')
  }
  const file = path.resolve('db/.session-secret')
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, randomBytes(32))
  }
  return readFileSync(file)
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 200) {
    throw httpError(400, 'Enter a password.')
  }
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function passwordMatches(stored, password) {
  if (typeof stored !== 'string' || typeof password !== 'string' || password.length < 1 || password.length > 200) return false
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$')
    if (parts.length !== 6) return false
    const n = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    if (!Number.isInteger(n) || n < 2 || n > 131072) return false
    if (!Number.isInteger(r) || r < 1 || r > 16) return false
    if (!Number.isInteger(p) || p < 1 || p > 4) return false
    const salt = Buffer.from(parts[4], 'base64url')
    const expected = Buffer.from(parts[5], 'base64url')
    if (!salt.length || expected.length < 16 || expected.length > 64) return false
    const hash = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 })
    return hash.length === expected.length && timingSafeEqual(hash, expected)
  }
  const left = Buffer.from(stored)
  const right = Buffer.from(password)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

async function burnPasswordTime(password) {
  dummyPassword ??= await hashPassword('qr-connect')
  await passwordMatches(dummyPassword, password)
}

function avatarPng(firstName, lastName, rgb) {
  const size = 128
  const png = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5
      const dy = y - size / 2 + 0.5
      const inside = dx * dx + dy * dy <= 58 * 58
      const index = (size * y + x) << 2
      png.data[index] = inside ? rgb[0] : 255
      png.data[index + 1] = inside ? rgb[1] : 255
      png.data[index + 2] = inside ? rgb[2] : 255
      png.data[index + 3] = 255
    }
  }
  const letters = `${firstName[0]}${lastName[0]}`.toUpperCase()
  const scale = 7
  const width = letters.length * 5 * scale + (letters.length - 1) * scale
  let cursor = Math.round((size - width) / 2)
  const top = Math.round((size - 7 * scale) / 2)
  for (const letter of letters) {
    const rows = FONT[letter]
    if (rows) {
      rows.forEach((row, rowIndex) => {
        for (let col = 0; col < 5; col++) {
          if (row[col] !== '1') continue
          for (let py = 0; py < scale; py++) {
            for (let px = 0; px < scale; px++) {
              const x = cursor + col * scale + px
              const y = top + rowIndex * scale + py
              const index = (size * y + x) << 2
              png.data[index] = 255
              png.data[index + 1] = 255
              png.data[index + 2] = 255
              png.data[index + 3] = 255
            }
          }
        }
      })
    }
    cursor += 6 * scale
  }
  return PNG.sync.write(png)
}

const sendingLeads = new Set()

export async function ensureLeadColumns() {
  const { Leads } = entities()
  try {
    await SELECT.one.from(Leads).columns('snowNumber')
    return
  } catch (error) {
    const message = String(error.message || error)
    if (!/no such column|invalid column|snowNumber/i.test(message)) throw error
  }
  if (cds.db.kind !== 'sqlite') {
    console.error('ServiceNow lead columns are missing. Run cds deploy --to hana:qr-connect-hdi.')
    return
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path.resolve('db.sqlite'))
  try {
    const names = new Set(db.prepare('PRAGMA table_info(bcx_qr_Leads)').all().map((row) => row.name))
    for (const name of ['snowSysId', 'snowNumber', 'snowSentAt']) {
      if (!names.has(name)) db.exec(`ALTER TABLE bcx_qr_Leads ADD COLUMN ${name} TEXT`)
    }
  } finally {
    db.close()
  }
}

export async function ensureSchema() {
  const { Employees } = entities()
  try {
    await SELECT.one.from(Employees).columns('ID')
  } catch (error) {
    const message = String(error.message || error)
    if (!/no such table|does not exist|relation|undefined_table/i.test(message)) throw error
    await cds.deploy('db/schema.cds').to(cds.db)
  }
}

export async function seed() {
  try {
    const people = await loadSuccessFactorsPeople()
    if (people) {
      await applySuccessFactors(people)
      return
    }
  } catch (error) {
    console.error(`SuccessFactors sync failed: ${error.message}`)
  }
  const { Employees } = entities()
  const existing = await SELECT.one.from(Employees).columns('ID')
  if (existing) return
  if (cds.db.kind !== 'sqlite' && await importSqliteFile()) return
  for (const entry of PEOPLE) {
    const { color, ...row } = entry
    row.password = await hashPassword('demo')
    row.photo = avatarPng(entry.firstName, entry.lastName, color).toString('base64')
    await INSERT.into(Employees).entries(row)
  }
}

async function importSqliteFile() {
  const file = path.resolve('db.sqlite')
  if (!existsSync(file)) return false
  const { DatabaseSync } = await import('node:sqlite')
  const source = new DatabaseSync(file, { readOnly: true })
  let employees = []
  let events = []
  let leads = []
  try {
    employees = source.prepare('SELECT * FROM bcx_qr_Employees').all()
    events = source.prepare('SELECT * FROM bcx_qr_Events').all()
    leads = source.prepare('SELECT * FROM bcx_qr_Leads').all()
  } finally {
    source.close()
  }
  if (!employees.length) return false
  const { Employees, Events, Leads } = entities()
  await cds.tx(async () => {
    for (const row of employees) {
      await INSERT.into(Employees).entries({ ...row, active: truthy(row.active), manager_ID: null, displayEvent_ID: null })
    }
    for (const row of events) await INSERT.into(Events).entries(row)
    for (const row of employees) {
      if (!row.manager_ID && !row.displayEvent_ID) continue
      await UPDATE(Employees).set({ manager_ID: row.manager_ID || null, displayEvent_ID: row.displayEvent_ID || null }).where({ ID: row.ID })
    }
    for (const row of leads) await INSERT.into(Leads).entries(row)
  })
  console.log(`Imported ${employees.length} people, ${events.length} events and ${leads.length} leads into the persistent database.`)
  return true
}

function truthy(value) {
  return value === true || value === 1 || value === '1'
}

async function applySuccessFactors(people) {
  const { Employees } = entities()
  const existing = await SELECT.from(Employees)
  const byUsername = new Map(existing.map((row) => [row.username, row]))
  const ids = new Map()
  for (const person of people) {
    const current = byUsername.get(person.username)
    const photo = person.photo || avatarPng(person.firstName, person.lastName, colorFrom(person.username)).toString('base64')
    if (current) {
      const changes = {
        firstName: person.firstName,
        lastName: person.lastName,
        role: person.role,
        organisation: person.organisation,
        cellphone: person.cellphone,
        email: person.email,
        photo,
        active: true,
      }
      if (person.website) changes.website = person.website
      await UPDATE(Employees).set(changes).where({ ID: current.ID })
      ids.set(person.externalId, current.ID)
    } else {
      const ID = randomUUID()
      await INSERT.into(Employees).entries({
        ID,
        username: person.username,
        password: await hashPassword(person.password),
        firstName: person.firstName,
        lastName: person.lastName,
        role: person.role,
        organisation: person.organisation,
        cellphone: person.cellphone,
        email: person.email,
        website: person.website,
        photo,
        cardToken: person.cardToken,
        active: true,
      })
      ids.set(person.externalId, ID)
    }
  }
  for (const person of people) {
    const ID = ids.get(person.externalId)
    if (!ID) continue
    const managerId = person.managerExternalId ? ids.get(person.managerExternalId) || null : null
    await UPDATE(Employees).set({ manager_ID: managerId }).where({ ID })
  }
}

function colorFrom(name) {
  let hash = 0
  for (const char of name) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return [40 + (hash & 127), 40 + ((hash >> 8) & 127), 40 + ((hash >> 16) & 127)]
}

export function readSession(req) {
  const header = req.headers.cookie || ''
  const raw = header.split(';').map((part) => part.trim()).find((part) => part.startsWith('qr_session='))
  if (!raw) return null
  const token = decodeURIComponent(raw.slice('qr_session='.length))
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!data?.id || !data.exp || data.exp < Date.now()) return null
    return data.id
  } catch {
    return null
  }
}

export function sessionCookie(id, secure = false) {
  const body = Buffer.from(JSON.stringify({ id, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url')
  const signature = createHmac('sha256', secret()).update(body).digest('base64url')
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']
  if (secure) flags.push('Secure')
  return `qr_session=${body}.${signature}; ${flags.join('; ')}`
}

export function clearCookie(secure = false) {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (secure) flags.push('Secure')
  return `qr_session=; ${flags.join('; ')}`
}

export async function authenticate(username, password) {
  const { Employees } = entities()
  const name = String(username || '').trim().toLowerCase().slice(0, 80)
  if (!name || typeof password !== 'string' || password.length < 1 || password.length > 200) return null
  const personRow = await SELECT.one.from(Employees).where({ username: name, active: true })
  if (!personRow) {
    await burnPasswordTime(password)
    return null
  }
  const matches = await passwordMatches(personRow.password, password)
  if (!matches) return null
  if (!String(personRow.password).startsWith('scrypt$')) {
    try {
      await UPDATE(Employees).set({ password: await hashPassword(password) }).where({ ID: personRow.ID })
    } catch (error) {
      console.error(`Password upgrade failed: ${error.message}`)
    }
  }
  return personRow
}

export async function employeeById(id) {
  const { Employees } = entities()
  return SELECT.one.from(Employees).where({ ID: id, active: true })
}

function publicCard(row) {
  return {
    ID: row.ID,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    organisation: row.organisation,
    cellphone: row.cellphone,
    email: row.email,
    website: row.website,
    cardToken: row.cardToken,
  }
}

export function hasEnded(event, now = Date.now()) {
  if (!event || event.status === 'Closed') return true
  const end = new Date(event.endAt).getTime()
  return !Number.isFinite(end) || now > end
}

export function canShow(event, now = Date.now()) {
  return !hasEnded(event, now)
}

async function eventsFor(ownerId) {
  const { Events } = entities()
  return SELECT.from(Events).where({ owner_ID: ownerId }).orderBy('startAt desc')
}

async function leadsFor(ownerId) {
  const { Leads } = entities()
  return SELECT.from(Leads).where({ employee_ID: ownerId }).orderBy('createdAt desc')
}

export async function activeDisplay(employee) {
  const { Employees, Events } = entities()
  if (!employee.displayEvent_ID) return { mode: 'default', event: null }
  const event = await SELECT.one.from(Events).where({ ID: employee.displayEvent_ID, owner_ID: employee.ID })
  if (canShow(event)) return { mode: 'event', event }
  await UPDATE(Employees).set({ displayEvent_ID: null }).where({ ID: employee.ID })
  employee.displayEvent_ID = null
  return { mode: 'default', event: null }
}

async function canView(viewer, personId) {
  if (!viewer || !personId) return null
  const personRow = await employeeById(personId)
  if (!personRow) return null
  if (personRow.ID === viewer.ID || personRow.manager_ID === viewer.ID) return personRow
  return null
}

function leadView(lead) {
  return {
    ID: lead.ID,
    firstName: lead.firstName,
    surname: lead.surname,
    email: lead.email,
    countryCode: lead.countryCode,
    phone: lead.phone,
    company: lead.company,
    queryType: lead.queryType,
    message: lead.message,
    createdAt: lead.createdAt,
    source: lead.source,
    snowNumber: lead.snowNumber || '',
    snowSentAt: lead.snowSentAt || null,
  }
}

export async function workspace(viewerId, personId) {
  const viewer = await employeeById(viewerId)
  if (!viewer) throw httpError(401, 'Login required.')
  const { Employees } = entities()
  const reports = await SELECT.from(Employees).columns('ID', 'firstName', 'lastName', 'role').where({ manager_ID: viewer.ID, active: true })
  const viewing = await canView(viewer, personId || viewer.ID)
  if (!viewing) throw httpError(403, 'You can only open your own card, or a card that reports to you.')
  const display = await activeDisplay(viewing)
  const events = await eventsFor(viewing.ID)
  const leads = await leadsFor(viewing.ID)
  const groups = events.map((event) => ({
    kind: 'event',
    ID: event.ID,
    standToken: event.standToken,
    name: event.name,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    valid: canShow(event),
    active: display.mode === 'event' && display.event.ID === event.ID,
    leads: leads.filter((lead) => lead.event_ID === event.ID).map(leadView),
  }))
  groups.push({
    kind: 'general',
    ID: null,
    name: 'General',
    valid: true,
    active: display.mode === 'default',
    leads: leads.filter((lead) => !lead.event_ID).map(leadView),
  })
  return {
    profileSource: successFactorsStatus().configured ? 'successfactors' : 'sample',
    serviceNow: serviceNowStatus(),
    viewer: { ...publicCard(viewer), manager: !viewer.manager_ID },
    people: [
      { ID: viewer.ID, firstName: viewer.firstName, lastName: viewer.lastName, role: viewer.role, self: true },
      ...reports.map((report) => ({ ...report, self: false })),
    ],
    viewing: publicCard(viewing),
    canEdit: viewing.ID === viewer.ID,
    active: { mode: display.mode, eventId: display.event?.ID || null, eventName: display.event?.name || null },
    choices: events.filter((event) => canShow(event)).map((event) => ({
      ID: event.ID, name: event.name, startAt: event.startAt, endAt: event.endAt,
    })),
    groups,
  }
}

export function parseJohannesburg(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''))) return null
  const date = new Date(`${value}:00+02:00`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export async function sendToServiceNow(viewerId, leadId) {
  const viewer = await employeeById(viewerId)
  if (!viewer) throw httpError(401, 'Login required.')
  const { Leads, Events } = entities()
  const lead = await SELECT.one.from(Leads).where({ ID: leadId })
  if (!lead) throw httpError(404, 'That lead was not found.')
  const owner = await canView(viewer, lead.employee_ID)
  if (!owner) throw httpError(403, 'You can only send a lead from your own card, or from a card that reports to you.')
  if (lead.snowNumber || lead.snowSysId) {
    return { ok: true, number: lead.snowNumber, sysId: lead.snowSysId || '', sentAt: lead.snowSentAt, alreadySent: true }
  }
  if (sendingLeads.has(lead.ID)) throw httpError(409, 'This lead is already being sent.')
  sendingLeads.add(lead.ID)
  try {
    let eventName = null
    if (lead.event_ID) {
      const event = await SELECT.one.from(Events).columns('name').where({ ID: lead.event_ID })
      eventName = event?.name || null
    }
    const config = readServiceNowConfig()
    const created = await createServiceNowLead(leadRecord(lead, {
      salesperson: `${owner.firstName} ${owner.lastName}`,
      eventName,
    }, config), config)
    const sentAt = new Date().toISOString()
    await UPDATE(Leads).set({
      snowSysId: created.sysId || null,
      snowNumber: created.number,
      snowSentAt: sentAt,
    }).where({ ID: lead.ID })
    return { ok: true, number: created.number, sysId: created.sysId, sentAt, alreadySent: false }
  } finally {
    sendingLeads.delete(lead.ID)
  }
}

export async function createEvent(viewerId, input) {
  const viewer = await employeeById(viewerId)
  if (!viewer) throw httpError(401, 'Login required.')
  const name = clean(input.name, 160)
  const startAt = parseJohannesburg(input.startAt)
  const endAt = parseJohannesburg(input.endAt)
  if (!name) throw httpError(400, 'Enter an event name.')
  if (!startAt || !endAt) throw httpError(400, 'Enter a start and an end in South Africa time.')
  if (endAt <= startAt) throw httpError(400, 'The end must be after the start.')
  const { Events } = entities()
  const row = {
    ID: randomUUID(),
    name,
    startAt,
    endAt,
    location: clean(input.location, 160),
    status: 'Open',
    standToken: randomBytes(24).toString('base64url'),
    owner_ID: viewer.ID,
  }
  await INSERT.into(Events).entries(row)
  return row
}

export async function setDisplay(viewerId, eventId) {
  const viewer = await employeeById(viewerId)
  if (!viewer) throw httpError(401, 'Login required.')
  const { Employees, Events } = entities()
  if (!eventId) {
    await UPDATE(Employees).set({ displayEvent_ID: null }).where({ ID: viewer.ID })
    return { mode: 'default', eventId: null }
  }
  const event = await SELECT.one.from(Events).where({ ID: eventId, owner_ID: viewer.ID })
  if (!event) throw httpError(404, 'Event not found.')
  if (!canShow(event)) throw httpError(400, 'That event has ended, so the client screen stays on your general card.')
  await UPDATE(Employees).set({ displayEvent_ID: event.ID }).where({ ID: viewer.ID })
  return { mode: 'event', eventId: event.ID, eventName: event.name }
}

export async function photoFor(viewerId, personId) {
  const viewer = await employeeById(viewerId)
  const personRow = await canView(viewer, personId)
  if (!personRow?.photo) throw httpError(404, 'Photo not found.')
  return Buffer.from(personRow.photo, 'base64')
}

export async function cardByToken(token) {
  const { Employees } = entities()
  if (!token) return null
  return SELECT.one.from(Employees).where({ cardToken: String(token).trim(), active: true })
}

export async function eventByToken(token) {
  const { Events } = entities()
  if (!token) return null
  const event = await SELECT.one.from(Events).where({ standToken: String(token).trim() })
  if (!event) return null
  const owner = await employeeById(event.owner_ID)
  if (!owner) return null
  return { event, owner }
}

export async function qrTarget(cardToken, origin) {
  const employee = await cardByToken(cardToken)
  if (!employee) return null
  const display = await activeDisplay(employee)
  if (display.mode === 'event') {
    return {
      version: `event:${display.event.ID}`,
      url: `${origin}/e/${encodeURIComponent(display.event.standToken)}`,
    }
  }
  return { version: 'default', url: `${origin}/c/${encodeURIComponent(employee.cardToken)}` }
}

export function vcard(employee) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vtext(employee.lastName)};${vtext(employee.firstName)};;;`,
    `FN:${vtext(`${employee.firstName} ${employee.lastName}`)}`,
    `ORG:${vtext(employee.organisation)}`,
    `TITLE:${vtext(employee.role)}`,
    `TEL;TYPE=CELL:${vtext(employee.cellphone)}`,
    `EMAIL;TYPE=INTERNET:${vtext(employee.email)}`,
    `URL:${vtext(employee.website)}`,
  ]
  const photo = jpegPhoto(employee.photo)
  if (photo) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${photo}`)
  lines.push('END:VCARD')
  return lines.map(fold).join('\r\n') + '\r\n'
}

function jpegPhoto(photo) {
  const bytes = photoBytes(photo)
  if (!bytes) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return bytes.toString('base64')
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const png = PNG.sync.read(bytes)
  const encoded = jpeg.encode({ data: png.data, width: png.width, height: png.height }, 85)
  return Buffer.from(encoded.data).toString('base64')
}

function photoBytes(photo) {
  if (!photo) return null
  const cleaned = String(photo).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '').replace(/\s/g, '')
  if (!cleaned) return null
  const bytes = Buffer.from(cleaned, 'base64')
  return bytes.length ? bytes : null
}

export async function saveMessage(owner, event, input, active) {
  const visitor = readVisitor(input)
  if (visitor.honeypot) return { ok: true }
  const { Leads } = entities()
  const useEvent = Boolean(event && active)
  await INSERT.into(Leads).entries({
    ID: randomUUID(),
    source: useEvent ? 'EVENT' : 'GENERAL',
    event_ID: useEvent ? event.ID : null,
    employee_ID: owner.ID,
    ...visitor.fields,
  })
  return { ok: true }
}

export function readVisitor(input) {
  const body = input || {}
  if (clean(body.companyWebsite, 200)) return { honeypot: true }
  const firstName = personName(body.firstName, 'Enter a name.')
  const surname = personName(body.surname, 'Enter a surname.')
  const email = validEmail(body.email)
  const country = COUNTRIES.find((item) => item.code === String(body.countryCode || ''))
  const phone = clean(body.phone, 40)
  const digits = phone ? phone.replace(/\D/g, '') : ''
  const company = clean(body.company, 160)
  const queryType = QUERY_TYPES.includes(body.queryType) ? body.queryType : null
  const message = clean(body.message, 2000)
  if (!email) throw httpError(400, 'Enter a valid email address.')
  if (!country) throw httpError(400, 'Choose a country code.')
  if (!phone || digits.length < 7 || !/^[0-9][0-9 ]*$/.test(phone)) throw httpError(400, 'Enter a phone number.')
  if (!company) throw httpError(400, 'Enter a company name.')
  if (!queryType) throw httpError(400, 'Choose a type of query.')
  if (!message) throw httpError(400, 'Enter a message.')
  return {
    fields: { firstName, surname, email, countryCode: country.code, phone, company, queryType, message },
  }
}

function personName(value, message) {
  const text = clean(value, 80)
  if (!text || !/^[\p{L}][\p{L} .'\-]{0,79}$/u.test(text)) throw httpError(400, message)
  return text
}

function validEmail(value) {
  const email = clean(value, 320)?.toLowerCase()
  if (!email || email.includes(' ')) return null
  const at = email.indexOf('@')
  const domain = email.slice(at + 1)
  if (at < 1 || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null
  return email
}

function clean(value, max) {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  return text.slice(0, max)
}

function vtext(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function fold(line) {
  if (line.length <= 75) return line
  let rest = line
  const parts = [rest.slice(0, 75)]
  rest = rest.slice(75)
  while (rest.length) {
    parts.push(` ${rest.slice(0, 74)}`)
    rest = rest.slice(74)
  }
  return parts.join('\r\n')
}

export { ZONE }
